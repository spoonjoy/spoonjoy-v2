/**
 * Notification fan-out helper for `fellow_chef_origin_cook`.
 *
 * When a chef creates an origin-cook spoon (their own first cook of a new
 * recipe of theirs), every fellow chef in their derived `listFellowChefs`
 * graph is notified. This is the only multi-recipient trigger in D-006.
 *
 * The fan-out is capped at 100 recipients (the max page size on
 * `listFellowChefs`) for MVP-scale data. If production measurement ever
 * shows this exceeds the cap or becomes a hot path, open a fresh `SJ-*`
 * for a materialized chef-graph + streaming fan-out rather than
 * premature optimization.
 *
 * The helper is pure: all platform-coupled deps (`waitUntil`, `sendPush`,
 * `listFellowChefs`) are injected so it can be unit-tested in plain Node.
 */

import type { PrismaClient } from "@prisma/client";
import {
  enqueueNotification,
  type NotificationDispatchDeps,
} from "~/lib/notification-dispatch.server";
import {
  listFellowChefs as realListFellowChefs,
  type FellowChefListResult,
  type ListFellowChefsOptions,
} from "~/lib/fellow-chefs.server";

export interface FanoutFellowChefOriginCookInput {
  spoonerId: string;
  recipeId: string;
  recipeTitle: string;
  spoonerUsername: string;
}

export interface FanoutFellowChefOriginCookDeps extends NotificationDispatchDeps {
  listFellowChefs?: (
    db: PrismaClient,
    viewerUserId: string,
    opts: ListFellowChefsOptions,
  ) => Promise<FellowChefListResult>;
}

export interface FanoutFellowChefOriginCookResult {
  recipientsNotified: number;
}

const FANOUT_LIMIT = 100;

export async function fanoutFellowChefOriginCook(
  db: PrismaClient,
  input: FanoutFellowChefOriginCookInput,
  deps: FanoutFellowChefOriginCookDeps,
): Promise<FanoutFellowChefOriginCookResult> {
  try {
    const list = deps.listFellowChefs ?? realListFellowChefs;
    const result = await list(db, input.spoonerId, { limit: FANOUT_LIMIT });
    const recipients = result.rows.filter((row) => row.chefId !== input.spoonerId);

    for (const recipient of recipients) {
      await enqueueNotification(
        db,
        {
          actorId: input.spoonerId,
          recipientId: recipient.chefId,
          kind: "fellow_chef_origin_cook",
          payload: {
            recipeId: input.recipeId,
            recipeTitle: input.recipeTitle,
            spoonerUsername: input.spoonerUsername,
          },
        },
        deps,
      );
    }

    return { recipientsNotified: recipients.length };
  } catch {
    // Notifications must never break the originating action.
    return { recipientsNotified: 0 };
  }
}
