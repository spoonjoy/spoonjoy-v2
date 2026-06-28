/**
 * Notification trigger helpers.
 *
 * One thin function per event kind. Each takes a Prisma client + the minimum
 * inputs from the call site, loads any extra data (recipe title, actor
 * username), then delegates to `enqueueNotification`.
 *
 * Wrapped in try/catch so a dispatch failure can never break the action that
 * called us — push notifications are fire-and-forget.
 *
 * Telemetry: the trigger's OWN evaluation (the actor/recipe pre-load queries
 * that run before `enqueueNotification`) is otherwise silent — a real D1
 * failure there is swallowed by this catch and never reaches the dispatcher's
 * own capture. We capture it here via the injected `deps.postHogConfig` (the
 * same config the dispatcher uses), fire-and-forget, tagged with the trigger
 * kind. The dispatcher already captures its durable-write / push failures, so
 * a throw that surfaces from inside `enqueueNotification` is double-covered;
 * that is acceptable for a fire-and-forget diagnostic and keeps the trigger's
 * silent pre-load gap closed. No-op when PostHog is unconfigured.
 */

import type { PrismaClient } from "@prisma/client";
import {
  enqueueNotification,
  type NotificationDispatchDeps,
  type NotificationKind,
} from "~/lib/notification-dispatch.server";
import { captureException } from "~/lib/analytics-server";

/**
 * Schedule a fire-and-forget capture of a swallowed trigger-evaluation failure.
 * Runs via `deps.waitUntil` when present (so it can outlive the response),
 * otherwise left to run detached. `captureException` already swallows its own
 * errors and no-ops without a PostHog config, so this never throws and never
 * blocks the originating action.
 */
function captureTriggerFailure(
  deps: NotificationDispatchDeps,
  recipientId: string,
  kind: NotificationKind,
  error: unknown,
): void {
  const config = deps.postHogConfig;
  if (!config) return;
  const task = captureException(config, {
    error,
    distinctId: recipientId,
    extras: { kind, phase: "triggerEval" },
  });
  if (deps.waitUntil) {
    deps.waitUntil(task);
  } else {
    void task;
  }
}

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
  } catch (error) {
    // Notifications must never break the originating action — but the
    // recipe/spooner pre-load above is otherwise silent, so capture it. The
    // recipient (recipe owner) may be unresolved here, so fall back to a stable
    // server id; `kind` carries the diagnostic context.
    captureTriggerFailure(deps, "server", "spoon_on_my_recipe", error);
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
  } catch (error) {
    // The forker pre-load above is otherwise silent; capture it. The recipient
    // (source chef) IS known from the input, so attribute the failure to them.
    captureTriggerFailure(deps, input.sourceChefId, "fork_of_my_recipe", error);
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
): Promise<void> {
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
    if (!recipe || !actor) return;
    if (recipe.chefId === actor.id) return;
    await enqueueNotification(
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
  } catch (error) {
    // The recipe/actor pre-load above is otherwise silent; capture it. The
    // recipient (recipe owner) may be unresolved here, so fall back to a stable
    // server id; `kind` carries the diagnostic context.
    captureTriggerFailure(deps, "server", "cookbook_save_of_mine", error);
  }
}
