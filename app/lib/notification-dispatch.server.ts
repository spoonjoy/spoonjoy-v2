/**
 * Notification dispatcher.
 *
 * Single entry point for firing in-app, web-push and native (Apple) notifications:
 *   1. Self-suppression (actorId === recipientId).
 *   2. Always writes a NotificationEvent row (durable log).
 *   3. Resolves recipient's NotificationPreference (defaults true).
 *   4. Loads all PushSubscription rows for the recipient, and, when the server has a push relay
 *      key, their live Apple devices (NativePushDevice rows with a sealed token).
 *   5. Schedules one sendPush per subscription, and one sendNativePush per device through the
 *      push relay (native-push.server.ts), via ctx.waitUntil.
 *   6. On 'expired' (web push's 404 / 410), prunes the subscription row; on 'expired' from Apple
 *      (the token is dead), revokes the device.
 *   7. On first delivery, marks NotificationEvent.pushDeliveredAt.
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

import type { NativePushDeviceRow, NotificationDb } from "~/lib/notification-db-d1.server";
import {
  sendPush as realSendPush,
  type PushSubscriptionRecord,
  type SendPushResult,
} from "~/lib/web-push.server";
import type { VapidConfig } from "~/lib/env.server";
import {
  sendNativePush as realSendNativePush,
  type NativePushConfig,
  type NativePushResult,
  type NativePushTarget,
} from "~/lib/native-push.server";
import { openNativePushToken } from "~/lib/native-push-token.server";
import {
  captureEvent,
  captureException,
  type PostHogServerConfig,
} from "~/lib/analytics-server";
import { retryD1Write } from "~/lib/d1-write-retry.server";

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
  /**
   * What made this notification, such as the fork's recipe id: the same trigger always names the
   * same event row, so running the trigger again finds the row it wrote instead of logging and
   * pushing a second one. Without it each call is its own event (still written once per call).
   */
  triggerKey?: string;
}

/**
 * The event row's id: derived from the trigger when there is one, so a repeat of the same trigger
 * writes the same row; otherwise chosen once per call, before the first try. Shaped as a UUID.
 */
export async function notificationEventId(input: EnqueueNotificationInput): Promise<string> {
  if (input.triggerKey === undefined) return crypto.randomUUID();
  const source = ["notification", input.kind, input.recipientId, input.actorId, input.triggerKey].join("\u0000");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source)));
  const hex = Array.from(digest.subarray(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** A Prisma unique-constraint failure. */
function isUniqueConflict(error: unknown): boolean {
  return prismaErrorCode(error) === "P2002";
}

export interface NotificationDispatchDeps {
  vapid: VapidConfig;
  waitUntil?: (p: Promise<unknown>) => void;
  sendPush?: (
    sub: PushSubscriptionRecord,
    payload: { title: string; body: string; url: string; icon?: string },
    vapid: VapidConfig,
  ) => Promise<SendPushResult>;
  /** The server's push relay settings (getNativePushConfig); without them no Apple device is sent to. */
  nativePush?: NativePushConfig | null;
  sendNativePush?: (
    config: NativePushConfig,
    target: NativePushTarget,
    payload: { title: string; body: string; url: string },
    options: { collapseId?: string },
  ) => Promise<NativePushResult>;
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
  db: NotificationDb,
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
  let devices: NativePushDeviceRow[] = [];
  try {
    // 1b. A recipient who blocked the actor hears nothing from them (moderation.server.ts).
    const blocked = await db.chefBlock.findUnique({
      where: { blockerId_blockedId: { blockerId: input.recipientId, blockedId: input.actorId } },
      select: { blockerId: true },
    });
    if (blocked) return { eventId: null, queuedSends: 0 };

    // 2. Always log the event, once. Its id is chosen before the first try, so a retry after a
    // lost answer finds the row the earlier try wrote instead of adding a second.
    const id = await notificationEventId(input);
    const written = async () =>
      db.notificationEvent.findFirst({ where: { id, recipientId: input.recipientId }, select: { id: true } });
    try {
      event = await retryD1Write({ scope: "notification.enqueue", applied: written }, () => db.notificationEvent.create({
        data: {
          id,
          recipientId: input.recipientId,
          kind: input.kind,
          payload: JSON.stringify(input.payload),
        },
        select: { id: true },
      }));
    } catch (error) {
      // The same trigger ran before and its event is logged (and pushed) already.
      if (isUniqueConflict(error) && (await written())) return { eventId: id, queuedSends: 0 };
      throw error;
    }

    // 3. Preference lookup (default-on).
    pref = await db.notificationPreference.findUnique({
      where: { userId: input.recipientId },
    });

    // 4. Load active subscriptions.
    subscriptions = await db.pushSubscription.findMany({
      where: { userId: input.recipientId },
    });
    if (deps.nativePush) {
      devices = await db.nativePushDevice.findMany({
        where: { userId: input.recipientId, revokedAt: null, sealedToken: { not: null } },
        select: { id: true, deviceId: true, platform: true, environment: true, sealedToken: true },
      });
    }
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

  if (subscriptions.length === 0 && devices.length === 0) {
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
    const pushDeliveredAt = new Date();
    await retryD1Write({ scope: "notification.mark_delivered" }, () => db.notificationEvent.update({
      where: { id: event.id },
      data: { pushDeliveredAt },
    }));
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
          // A delete by id: running it again after a lost answer deletes nothing more.
          await retryD1Write({ scope: "push_subscription.prune" }, () => db.pushSubscription.delete({ where: { id: sub.id } }))
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

  const nativePush = deps.nativePush;
  const sendNative = deps.sendNativePush ?? realSendNativePush;
  // Devices are loaded only when the server has a push relay key, so this runs for none without one.
  for (const device of devices) {
    const sendTask = (async (config: NativePushConfig) => {
      try {
        const token = await openNativePushToken(
          config.tokenSecret,
          { userId: input.recipientId, deviceId: device.deviceId, platform: device.platform, environment: device.environment },
          device.sealedToken,
        );
        // A token sealed under another secret (SESSION_SECRET changed, or a restore onto a server with
        // a new one) can never be read again: drop it, so it isn't loaded for each notification, and
        // count it. The device gets notifications again when the app registers it again.
        if (token === null) {
          await retryD1Write({ scope: "native_push_device.drop_unreadable" }, () =>
            db.nativePushDevice.updateMany({ where: { id: device.id, revokedAt: null, sealedToken: device.sealedToken }, data: { sealedToken: null } }),
          );
          scheduleCapture(deps, (config) =>
            captureEvent(config, {
              event: "spoonjoy.push.native_token_unreadable",
              distinctId: input.recipientId,
              properties: { kind: input.kind, deviceId: device.id },
            }),
          );
          return;
        }
        // The event id names the notification, so a send repeated after a lost answer replaces the
        // first on the device instead of showing twice.
        const result = await sendNative(config, { token, environment: device.environment }, content, { collapseId: event.id });
        if (result.status === "delivered") {
          await markDelivered();
        } else if (result.status === "expired") {
          // Only the live device still holding this token is revoked: running it again after a lost
          // answer changes nothing, and a device the app registered again meanwhile, with a new
          // token, stays.
          // revokedAt is ISO text, as the device API writes it (prisma/schema.prisma).
          const revokedAt = new Date().toISOString();
          await retryD1Write({ scope: "native_push_device.revoke" }, () =>
            db.nativePushDevice.updateMany({ where: { id: device.id, revokedAt: null, sealedToken: device.sealedToken }, data: { revokedAt, sealedToken: null } }),
          );
        } else if (result.status === "failed") {
          // An unavailable relay (no Apple push key yet) is expected until the key is set: no event.
          scheduleCapture(deps, (config) =>
            captureEvent(config, {
              event: "spoonjoy.push.native_send_failed",
              distinctId: input.recipientId,
              properties: {
                kind: input.kind,
                deviceId: device.id,
                httpStatus: result.httpStatus,
                failureMode: result.httpStatus === 0 ? "no_response" : "http_error",
                ...(result.apnsStatus === undefined ? {} : { apnsStatus: result.apnsStatus }),
                ...(result.reason ? { pushError: result.reason } : {}),
              },
            }),
          );
        }
      } catch (error) {
        scheduleCapture(deps, (config) =>
          captureException(config, {
            error,
            distinctId: input.recipientId,
            extras: { kind: input.kind, deviceId: device.id, phase: "nativeSendTask" },
          }),
        );
      }
    })(nativePush as NativePushConfig);

    if (deps.waitUntil) {
      deps.waitUntil(sendTask);
    } else {
      await sendTask;
    }
  }

  return { eventId: event.id, queuedSends: subscriptions.length + devices.length };
}
