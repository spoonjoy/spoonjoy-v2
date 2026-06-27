/**
 * Notification dispatcher.
 *
 * Single entry point for firing in-app + web-push notifications:
 *   1. Self-suppression (actorId === recipientId).
 *   2. Always writes a NotificationEvent row (durable log).
 *   3. Resolves recipient's NotificationPreference (defaults true).
 *   4. Loads all PushSubscription rows for the recipient.
 *   5. Schedules one sendPush per subscription via ctx.waitUntil.
 *   6. On 'expired' (404 / 410), prunes the subscription row.
 *   7. On first 2xx, marks NotificationEvent.pushDeliveredAt.
 *
 * Telemetry: silent failure modes (push 'failed' incl. 100%-VAPID-fail,
 * non-P2025 prune errors, swallowed send-task throws, and real D1 failures on
 * the durable log that callers would misread as "VAPID not configured") are
 * captured via the injected `postHogConfig`. Capture is fire-and-forget and
 * never changes the dispatch result.
 *
 * Pure-ish: all platform deps (waitUntil, sendPush, vapid, postHogConfig) are
 * injected so this module is testable in plain Node.
 */

import type { PrismaClient } from "@prisma/client";
import {
  sendPush as realSendPush,
  type PushSubscriptionRecord,
  type SendPushResult,
} from "~/lib/web-push.server";
import type { VapidConfig } from "~/lib/env.server";
import {
  captureEvent,
  captureException,
  type PostHogServerConfig,
} from "~/lib/analytics-server";

export type NotificationKind =
  | "spoon_on_my_recipe"
  | "fork_of_my_recipe"
  | "cookbook_save_of_mine"
  | "fellow_chef_origin_cook";

export interface EnqueueNotificationInput {
  recipientId: string;
  actorId: string;
  kind: NotificationKind;
  payload: Record<string, unknown>;
}

export interface NotificationDispatchDeps {
  vapid: VapidConfig;
  waitUntil?: (p: Promise<unknown>) => void;
  sendPush?: (
    sub: PushSubscriptionRecord,
    payload: { title: string; body: string; url: string; icon?: string },
    vapid: VapidConfig,
  ) => Promise<SendPushResult>;
  /**
   * Optional PostHog config used to capture otherwise-silent push, prune, and
   * durable-write failures. When omitted (or disabled), capture is a no-op.
   * Capture is fire-and-forget — scheduled via {@link waitUntil} when present,
   * otherwise awaited — and never affects the dispatch result.
   */
  postHogConfig?: PostHogServerConfig;
}

export interface EnqueueNotificationResult {
  eventId: string | null;
  queuedSends: number;
}

/** Map a NotificationPreference row to the boolean for a given kind. */
function isPreferenceEnabled(
  pref: {
    notifySpoonOnMyRecipe: boolean;
    notifyForkOfMyRecipe: boolean;
    notifyCookbookSaveOfMine: boolean;
    notifyFellowChefOriginCook: boolean;
  } | null,
  kind: NotificationKind,
): boolean {
  if (!pref) return true; // default-on
  switch (kind) {
    case "spoon_on_my_recipe":
      return pref.notifySpoonOnMyRecipe;
    case "fork_of_my_recipe":
      return pref.notifyForkOfMyRecipe;
    case "cookbook_save_of_mine":
      return pref.notifyCookbookSaveOfMine;
    case "fellow_chef_origin_cook":
      return pref.notifyFellowChefOriginCook;
  }
}

/** Notification copy table — title is always "Spoonjoy". */
function buildNotificationContent(
  kind: NotificationKind,
  payload: Record<string, unknown>,
): { title: string; body: string; url: string } {
  const username = (payload.spoonerUsername ?? payload.forkerUsername ?? payload.actorUsername ?? "someone") as string;
  const recipeTitle = (payload.recipeTitle ?? "your recipe") as string;
  const recipeId = (payload.recipeId ?? payload.forkedRecipeId) as string | undefined;
  const url = recipeId ? `/recipes/${recipeId}` : "/";

  let body = "";
  switch (kind) {
    case "spoon_on_my_recipe":
      body = `@${username} cooked your "${recipeTitle}"!`;
      break;
    case "fork_of_my_recipe":
      body = `@${username} forked your "${recipeTitle}"`;
      break;
    case "cookbook_save_of_mine":
      body = `@${username} saved "${recipeTitle}" to a cookbook`;
      break;
    case "fellow_chef_origin_cook":
      body = `@${username} just cooked their new recipe: ${recipeTitle}`;
      break;
  }

  return { title: "Spoonjoy", body, url };
}

/** Read a Prisma known-request-error code off an unknown throw, if present. */
function prismaErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Schedule a fire-and-forget telemetry capture. Runs via `deps.waitUntil` when
 * present so it can outlive the response; otherwise it is awaited inline. The
 * underlying `captureException` / `captureEvent` already swallow their own
 * errors, so this never throws and never blocks the dispatch path.
 */
function scheduleCapture(
  deps: NotificationDispatchDeps,
  run: (config: PostHogServerConfig) => Promise<void>,
): void {
  if (!deps.postHogConfig) return;
  const task = run(deps.postHogConfig);
  if (deps.waitUntil) {
    deps.waitUntil(task);
  } else {
    void task;
  }
}

export async function enqueueNotification(
  db: PrismaClient,
  input: EnqueueNotificationInput,
  deps: NotificationDispatchDeps,
): Promise<EnqueueNotificationResult> {
  // 1. Self-suppression.
  if (input.actorId === input.recipientId) {
    return { eventId: null, queuedSends: 0 };
  }

  // Steps 2-4 are durable DB writes/reads. Callers swallow our throws on the
  // assumption "VAPID just isn't configured locally", so a real D1 failure here
  // would be misattributed and dropped. Capture it distinctly first, then
  // rethrow so caller-level isolation still holds.
  let event: { id: string };
  let pref: {
    notifySpoonOnMyRecipe: boolean;
    notifyForkOfMyRecipe: boolean;
    notifyCookbookSaveOfMine: boolean;
    notifyFellowChefOriginCook: boolean;
  } | null;
  let subscriptions: Array<{
    id: string;
    endpoint: string;
    p256dh: string;
    authSecret: string;
  }>;
  try {
    // 2. Always log the event.
    event = await db.notificationEvent.create({
      data: {
        recipientId: input.recipientId,
        kind: input.kind,
        payload: JSON.stringify(input.payload),
      },
      select: { id: true },
    });

    // 3. Preference lookup (default-on).
    pref = await db.notificationPreference.findUnique({
      where: { userId: input.recipientId },
    });

    // 4. Load active subscriptions.
    subscriptions = await db.pushSubscription.findMany({
      where: { userId: input.recipientId },
    });
  } catch (error) {
    scheduleCapture(deps, (config) =>
      captureException(config, {
        error,
        distinctId: input.recipientId,
        extras: { kind: input.kind, phase: "durableWrite" },
      }),
    );
    throw error;
  }

  if (!isPreferenceEnabled(pref, input.kind)) {
    return { eventId: event.id, queuedSends: 0 };
  }

  if (subscriptions.length === 0) {
    return { eventId: event.id, queuedSends: 0 };
  }

  // 5. Build content once, schedule fan-out.
  const content = buildNotificationContent(input.kind, input.payload);
  const sendPush = deps.sendPush ?? realSendPush;

  // Shared promise that records "first delivery" so multiple parallel sends
  // converge to a single UPDATE. The flag is flipped only AFTER the UPDATE
  // resolves: flipping it first would permanently suppress retries (and hide
  // the failure in the per-sub catch) if the write itself threw.
  let markedDelivered = false;
  const markDelivered = async () => {
    if (markedDelivered) return;
    await db.notificationEvent.update({
      where: { id: event.id },
      data: { pushDeliveredAt: new Date() },
    });
    markedDelivered = true;
  };

  for (const sub of subscriptions) {
    const sendTask = (async () => {
      try {
        const record: PushSubscriptionRecord = {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.authSecret },
        };
        const result = await sendPush(record, content, deps.vapid);
        if (result.status === "delivered") {
          await markDelivered();
        } else if (result.status === "expired") {
          await db.pushSubscription
            .delete({ where: { id: sub.id } })
            .catch((pruneError) => {
              // Already gone (P2025) — concurrent dispatch pruned it; expected.
              // Any other failure means dead endpoints accumulate: capture it.
              if (prismaErrorCode(pruneError) === "P2025") return;
              scheduleCapture(deps, (config) =>
                captureException(config, {
                  error: pruneError,
                  distinctId: input.recipientId,
                  extras: {
                    kind: input.kind,
                    subscriptionId: sub.id,
                    phase: "prune",
                  },
                }),
              );
            });
        } else {
          // status === "failed": the subscription stays in place (transient),
          // but a silent failure here — especially a 100%-of-pushes VAPID
          // misconfig (httpStatus 0 from build/sign) — must be observable.
          scheduleCapture(deps, (config) =>
            captureEvent(config, {
              event: "spoonjoy.push.send_failed",
              distinctId: input.recipientId,
              properties: {
                kind: input.kind,
                subscriptionId: sub.id,
                httpStatus: result.httpStatus,
                // httpStatus 0 = no HTTP response (VAPID build/sign or network
                // throw) vs. a real provider non-2xx/expired status.
                failureMode: result.httpStatus === 0 ? "no_response" : "http_error",
                ...(result.error ? { pushError: result.error } : {}),
              },
            }),
          );
        }
      } catch (error) {
        // Per-subscription failures are isolated; never bubble up — but capture
        // the swallowed throw (markDelivered UPDATE, sendPush throw) first.
        scheduleCapture(deps, (config) =>
          captureException(config, {
            error,
            distinctId: input.recipientId,
            extras: {
              kind: input.kind,
              subscriptionId: sub.id,
              phase: "sendTask",
            },
          }),
        );
      }
    })();

    if (deps.waitUntil) {
      deps.waitUntil(sendTask);
    } else {
      await sendTask;
    }
  }

  return { eventId: event.id, queuedSends: subscriptions.length };
}
