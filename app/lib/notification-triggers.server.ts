/**
 * Notification trigger helpers.
 *
 * One thin function per event kind. Each takes a Prisma client + the minimum
 * inputs from the call site, loads any extra data (recipe title, actor
 * username), then delegates to `enqueueNotification`.
 *
 * Wrapped in try/catch so a dispatch failure can never break the action that
 * called us — push notifications are fire-and-forget.
 */

import type { PrismaClient } from "@prisma/client";
import {
  enqueueNotification,
  type EnqueueNotificationResult,
  type NotificationDispatchDeps,
} from "~/lib/notification-dispatch.server";

export type NotifySpoonOnMyRecipeDeps = NotificationDispatchDeps;

export interface NotifySpoonOnMyRecipeInput {
  recipeId: string;
  spoonerId: string;
}

const NO_ENQUEUED_NOTIFICATION = { eventId: null, queuedSends: 0 };

export async function notifySpoonOnMyRecipe(
  db: PrismaClient,
  input: NotifySpoonOnMyRecipeInput,
  deps: NotifySpoonOnMyRecipeDeps,
): Promise<EnqueueNotificationResult> {
  try {
    const [recipe, spooner] = await Promise.all([
      db.recipe.findUnique({
        where: { id: input.recipeId },
        select: { id: true, title: true, chefId: true },
      }),
      db.user.findUnique({
        where: { id: input.spoonerId },
        select: { id: true, username: true },
      }),
    ]);
    if (!recipe || !spooner) return NO_ENQUEUED_NOTIFICATION;
    if (recipe.chefId === spooner.id) return NO_ENQUEUED_NOTIFICATION;

    return await enqueueNotification(
      db,
      {
        actorId: spooner.id,
        recipientId: recipe.chefId,
        kind: "spoon_on_my_recipe",
        payload: {
          recipeId: recipe.id,
          recipeTitle: recipe.title,
          spoonerUsername: spooner.username,
        },
      },
      deps,
    );
  } catch {
    // Notifications must never break the originating action.
    return NO_ENQUEUED_NOTIFICATION;
  }
}

export type NotifyForkOfMyRecipeDeps = NotificationDispatchDeps;

export interface NotifyForkOfMyRecipeInput {
  forkedRecipeId: string;
  sourceRecipeId: string;
  forkerId: string;
  sourceChefId: string;
  appliedTitle: string;
}

export async function notifyForkOfMyRecipe(
  db: PrismaClient,
  input: NotifyForkOfMyRecipeInput,
  deps: NotifyForkOfMyRecipeDeps,
): Promise<void> {
  try {
    if (input.forkerId === input.sourceChefId) return;
    const forker = await db.user.findUnique({
      where: { id: input.forkerId },
      select: { id: true, username: true },
    });
    if (!forker) return;
    await enqueueNotification(
      db,
      {
        actorId: forker.id,
        recipientId: input.sourceChefId,
        kind: "fork_of_my_recipe",
        payload: {
          forkedRecipeId: input.forkedRecipeId,
          sourceRecipeId: input.sourceRecipeId,
          recipeId: input.forkedRecipeId,
          recipeTitle: input.appliedTitle,
          forkerUsername: forker.username,
        },
      },
      deps,
    );
  } catch {
    // Notifications must never break the originating action.
  }
}

export type NotifyCookbookSaveOfMineDeps = NotificationDispatchDeps;

export interface NotifyCookbookSaveOfMineInput {
  recipeId: string;
  actorId: string;
}

export async function notifyCookbookSaveOfMine(
  db: PrismaClient,
  input: NotifyCookbookSaveOfMineInput,
  deps: NotifyCookbookSaveOfMineDeps,
): Promise<EnqueueNotificationResult> {
  try {
    const [recipe, actor] = await Promise.all([
      db.recipe.findUnique({
        where: { id: input.recipeId },
        select: { id: true, title: true, chefId: true },
      }),
      db.user.findUnique({
        where: { id: input.actorId },
        select: { id: true, username: true },
      }),
    ]);
    if (!recipe || !actor) return NO_ENQUEUED_NOTIFICATION;
    if (recipe.chefId === actor.id) return NO_ENQUEUED_NOTIFICATION;
    return await enqueueNotification(
      db,
      {
        actorId: actor.id,
        recipientId: recipe.chefId,
        kind: "cookbook_save_of_mine",
        payload: {
          recipeId: recipe.id,
          recipeTitle: recipe.title,
          actorUsername: actor.username,
        },
      },
      deps,
    );
  } catch {
    // Notifications must never break the originating action.
    return NO_ENQUEUED_NOTIFICATION;
  }
}
