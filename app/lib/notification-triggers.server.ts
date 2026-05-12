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
  type NotificationDispatchDeps,
} from "~/lib/notification-dispatch.server";

export type NotifySpoonOnMyRecipeDeps = NotificationDispatchDeps;

export interface NotifySpoonOnMyRecipeInput {
  recipeId: string;
  spoonerId: string;
}

export async function notifySpoonOnMyRecipe(
  db: PrismaClient,
  input: NotifySpoonOnMyRecipeInput,
  deps: NotifySpoonOnMyRecipeDeps,
): Promise<void> {
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
    if (!recipe || !spooner) return;
    if (recipe.chefId === spooner.id) return;

    await enqueueNotification(
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
  }
}
