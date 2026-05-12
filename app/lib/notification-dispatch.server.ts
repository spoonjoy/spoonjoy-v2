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
 * Pure-ish: all platform deps (waitUntil, sendPush, vapid) are injected
 * so this module is testable in plain Node.
 */

import type { PrismaClient } from "@prisma/client";
import {
  sendPush as realSendPush,
  type PushSubscriptionRecord,
  type SendPushResult,
} from "~/lib/web-push.server";
import type { VapidConfig } from "~/lib/env.server";

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

export async function enqueueNotification(
  db: PrismaClient,
  input: EnqueueNotificationInput,
  deps: NotificationDispatchDeps,
): Promise<EnqueueNotificationResult> {
  // 1. Self-suppression.
  if (input.actorId === input.recipientId) {
    return { eventId: null, queuedSends: 0 };
  }

  // 2. Always log the event.
  const event = await db.notificationEvent.create({
    data: {
      recipientId: input.recipientId,
      kind: input.kind,
      payload: JSON.stringify(input.payload),
    },
    select: { id: true },
  });

  // 3. Preference lookup (default-on).
  const pref = await db.notificationPreference.findUnique({
    where: { userId: input.recipientId },
  });
  if (!isPreferenceEnabled(pref, input.kind)) {
    return { eventId: event.id, queuedSends: 0 };
  }

  // 4. Load active subscriptions.
  const subscriptions = await db.pushSubscription.findMany({
    where: { userId: input.recipientId },
  });
  if (subscriptions.length === 0) {
    return { eventId: event.id, queuedSends: 0 };
  }

  // 5. Build content once, schedule fan-out.
  const content = buildNotificationContent(input.kind, input.payload);
  const sendPush = deps.sendPush ?? realSendPush;

  // Shared promise that records "first delivery" so multiple parallel sends
  // converge to a single UPDATE.
  let markedDelivered = false;
  const markDelivered = async () => {
    if (markedDelivered) return;
    markedDelivered = true;
    await db.notificationEvent.update({
      where: { id: event.id },
      data: { pushDeliveredAt: new Date() },
    });
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
            .catch(() => {
              // Already gone — concurrent dispatch may have pruned it.
            });
        }
      } catch {
        // Per-subscription failures are isolated; never bubble up.
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
