import { env } from "cloudflare:test";
import { trackedExecutionContext } from "./execution-contexts";
import type { PrismaClient } from "@prisma/client";
import { beforeAll, describe, expect, it } from "vitest";

import { revokeAllAccountAccess } from "../../../app/lib/account-revocation.server";
import { D1_WRITE_UNAVAILABLE_MESSAGE } from "../../../app/lib/d1-write-retry.server";
import { getDb } from "../../../app/lib/db.server";
import { handleRecipeDetailAction } from "../../../app/lib/recipe-detail.server";
import { forkRecipeOnD1 } from "../../../app/lib/recipe-fork.server";
import { createSpoonOnD1 } from "../../../app/lib/recipe-spoon-d1.server";
import { createUserSessionCookie } from "../../../app/lib/session.server";
import { createCookbookWithRecipeOnD1, deleteSpoonOnD1 } from "../../../app/lib/recipe-detail-d1-actions.server";
import { flakyD1 } from "../../helpers/flaky-d1";
import { d1WriteOnceKey } from "../../../app/lib/d1-write-once.server";
import { addShoppingListItemOnD1, ensureShoppingListIdOnD1, setShoppingListItemCheckedOnD1 } from "../../../app/lib/shopping-list-d1-actions.server";
import { applyRepositoryMigrations } from "./repository-migrations";

// Writes that meet a dropped D1 connection, against Wrangler's real D1 (workerd). D1 may have
// applied a write whose answer was lost, so these run the real batches with the connection
// failing before the batch reaches the database ("lost") or after it committed ("lost-answer"),
// and check that each operation ends with the rows one successful write leaves: never a second
// spoon, fork or session-version bump, and a retryable 503 when D1 stays unreachable.

const CHEF = "transient-chef";
const COOK = "transient-cook";
const RECIPE = "transient-recipe";
const OLD = "2026-01-01T00:00:00.000Z";
const ORIGIN = "https://spoonjoy.test";

let prisma: PrismaClient;

function database(): D1Database {
  return env.DB as D1Database;
}

async function run(sql: string, ...values: unknown[]) {
  await database().prepare(sql).bind(...values).run();
}

async function count(sql: string, ...values: unknown[]): Promise<number> {
  const row = await database().prepare(sql).bind(...values).first<{ count: number }>();
  return row!.count;
}

const spoons = (id: string) => count(`SELECT COUNT(*) AS "count" FROM "RecipeSpoon" WHERE "id" = ?`, id);

describe("writes on Wrangler D1 when its connection drops", () => {
  beforeAll(async () => {
    await applyRepositoryMigrations(database());
    prisma = await getDb({ DB: database() });
    for (const id of [CHEF, COOK]) {
      await run(
        `INSERT INTO "User" ("id", "email", "username", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)`,
        id, `${id}@example.com`, id.replace("-", "_"), OLD, OLD,
      );
    }
    await run(
      `INSERT INTO "Recipe" ("id", "title", "chefId", "coverMode", "createdAt", "updatedAt") VALUES (?, 'Transient Loaf', ?, 'auto', ?, ?)`,
      RECIPE, CHEF, OLD, OLD,
    );
  });

  describe("logging a cook", () => {
    it("writes the spoon once when the batch committed but its answer was lost", async () => {
      const flaky = flakyD1(database());
      flaky.failNext(/INSERT INTO "RecipeSpoon"/, "lost-answer");

      const result = await createSpoonOnD1(flaky.binding, { id: "transient-spoon-1", chefId: COOK, recipeId: RECIPE, note: "Lost answer", useAsRecipeCover: false });

      expect(flaky.failures()).toBe(1);
      expect(result.spoon.id).toBe("transient-spoon-1");
      expect(await spoons("transient-spoon-1")).toBe(1);
    });

    it("writes the spoon once when the batch never reached the database", async () => {
      const flaky = flakyD1(database());
      flaky.failNext(/INSERT INTO "RecipeSpoon"/, "lost", "lost");

      await createSpoonOnD1(flaky.binding, { id: "transient-spoon-2", chefId: COOK, recipeId: RECIPE, note: "Lost", useAsRecipeCover: false });

      expect(flaky.failures()).toBe(2);
      expect(await spoons("transient-spoon-2")).toBe(1);
    });

    it("answers the page a retryable 503 when every try fails, and the resubmit logs the cook once", async () => {
      const flaky = flakyD1(database());
      flaky.failNext(/INSERT INTO "RecipeSpoon"/, "lost", "lost", "lost", "lost");
      const post = async () => {
        const cookie = await createUserSessionCookie(COOK, env as never, new Request(`${ORIGIN}/recipes/${RECIPE}`));
        const body = new FormData();
        body.set("intent", "createSpoon");
        body.set("note", "Resubmitted");
        body.set("spoonToken", "transient-token-0001");
        return handleRecipeDetailAction({
          request: new Request(`${ORIGIN}/recipes/${RECIPE}`, { method: "POST", headers: { Cookie: cookie }, body }),
          params: { id: RECIPE },
          context: { cloudflare: { env: { ...env, DB: flaky.binding }, ctx: trackedExecutionContext() } },
        } as never) as Promise<unknown>;
      };
      const resubmitted = () => count(`SELECT COUNT(*) AS "count" FROM "RecipeSpoon" WHERE "note" = 'Resubmitted'`);

      const refused = await post() as { data: unknown; init: { status: number } };
      expect(refused.init.status).toBe(503);
      expect(refused.data).toMatchObject({ intent: "createSpoon", error: D1_WRITE_UNAVAILABLE_MESSAGE, retryable: true });
      expect(await resubmitted()).toBe(0);

      await expect(post()).resolves.toMatchObject({ success: true, intent: "createSpoon" });
      await expect(post()).resolves.toMatchObject({ success: true, intent: "createSpoon" });
      expect(await resubmitted()).toBe(1);
    });
  });

  describe("forking a recipe", () => {
    it("makes one fork when the batch committed but its answer was lost", async () => {
      const flaky = flakyD1(database());
      flaky.failNext(/INSERT INTO "Recipe" \(/, "lost-answer");

      const result = await forkRecipeOnD1(flaky.binding, { sourceRecipeId: RECIPE, viewerId: COOK, recipeId: "transient-fork-1" });

      expect(flaky.failures()).toBe(1);
      expect(result).toMatchObject({ recipeId: "transient-fork-1", appliedTitle: "Transient Loaf" });
      expect(await count(`SELECT COUNT(*) AS "count" FROM "Recipe" WHERE "chefId" = ? AND "sourceRecipeId" = ?`, COOK, RECIPE)).toBe(1);
    });

    it("answers the same fork again for a repeat with its id", async () => {
      const again = await forkRecipeOnD1(database(), { sourceRecipeId: RECIPE, viewerId: COOK, recipeId: "transient-fork-1" });

      expect(again).toMatchObject({ recipeId: "transient-fork-1", replayed: true });
      expect(await count(`SELECT COUNT(*) AS "count" FROM "Recipe" WHERE "chefId" = ? AND "sourceRecipeId" = ?`, COOK, RECIPE)).toBe(1);
    });
  });

  describe("the recipe page's everyday writes", () => {
    it("makes one new cookbook when a late commit lands before the retry", async () => {
      const flaky = flakyD1(database());
      flaky.failNext(/INSERT INTO "Cookbook"/, "late");

      const created = await createCookbookWithRecipeOnD1(flaky.binding, { userId: COOK, recipeId: RECIPE, title: "Transient Breads" });

      expect(flaky.failures()).toBe(1);
      expect(await count(`SELECT COUNT(*) AS "count" FROM "Cookbook" WHERE "authorId" = ? AND "title" = 'Transient Breads'`, COOK)).toBe(1);
      expect(await count(`SELECT COUNT(*) AS "count" FROM "RecipeInCookbook" WHERE "cookbookId" = ?`, created.id)).toBe(1);
    });

    it("deletes a cook once when the batch committed but its answer was lost", async () => {
      const flaky = flakyD1(database());
      flaky.failNext(/UPDATE "RecipeSpoon"/, "lost-answer");

      await deleteSpoonOnD1(flaky.binding, { userId: COOK, spoonId: "transient-spoon-1" });

      expect(flaky.failures()).toBe(1);
      expect(await count(`SELECT COUNT(*) AS "count" FROM "RecipeSpoon" WHERE "id" = 'transient-spoon-1' AND "deletedAt" IS NOT NULL`)).toBe(1);
    });
  });

  describe("the shopping list's adds and checks", () => {
    const lemons = async (listId: string, outcome: "lost-answer" | "late" | null, token: string) => {
      const flaky = flakyD1(database());
      if (outcome) flaky.failNext(/"ApiIdempotencyKey"[\s\S]*"ShoppingListItem"/, outcome);
      const request = { ingredientText: "2 lemons" };
      await addShoppingListItemOnD1(flaky.binding, {
        shoppingListId: listId,
        ingredientName: "transient lemon",
        unitName: null,
        quantity: 2,
        categoryKey: null,
        iconKey: null,
        writeKey: await d1WriteOnceKey({ userId: COOK, operation: "shopping_list.add_item", token, request }),
        now: new Date(),
      });
      return flaky.failures();
    };
    const quantity = async (listId: string) => (await database().prepare(
      `SELECT i."quantity" AS "count" FROM "ShoppingListItem" i JOIN "IngredientRef" r ON r."id" = i."ingredientRefId"
       WHERE i."shoppingListId" = ? AND r."name" = 'transient lemon'`,
    ).bind(listId).first<{ count: number }>())!.count;

    it("adds once when the add committed but its answer was lost, or landed late, and once more for a new token", async () => {
      const listId = await ensureShoppingListIdOnD1(database(), COOK, new Date());

      expect(await lemons(listId, "lost-answer", "lemon-token-1")).toBe(1);
      expect(await quantity(listId)).toBe(2);
      expect(await lemons(listId, "late", "lemon-token-2")).toBe(1);
      expect(await quantity(listId)).toBe(4);
      // A resubmit of either form adds nothing more.
      await lemons(listId, null, "lemon-token-1");
      await lemons(listId, null, "lemon-token-2");
      expect(await quantity(listId)).toBe(4);
    });

    it("sets an item's checked state once when the answer was lost", async () => {
      const listId = await ensureShoppingListIdOnD1(database(), COOK, new Date());
      const item = await database().prepare(`SELECT "id" FROM "ShoppingListItem" WHERE "shoppingListId" = ?`).bind(listId).first<{ id: string }>();
      const flaky = flakyD1(database());
      flaky.failNext(/UPDATE "ShoppingListItem"/, "lost-answer");

      await setShoppingListItemCheckedOnD1(flaky.binding, { shoppingListId: listId, itemId: item!.id, checked: true, now: new Date() });

      expect(flaky.failures()).toBe(1);
      expect(await count(`SELECT "checked" AS "count" FROM "ShoppingListItem" WHERE "id" = ?`, item!.id)).toBe(1);
    });
  });

  describe("signing out everywhere", () => {
    it("moves the session version on once when the batch committed but its answer was lost", async () => {
      const version = () => count(`SELECT "sessionVersion" AS "count" FROM "User" WHERE "id" = ?`, CHEF);
      const before = await version();
      const flaky = flakyD1(database());
      flaky.failNext(/UPDATE "User" SET "sessionVersion"/, "lost-answer");

      const result = await revokeAllAccountAccess(prisma, CHEF, { d1: flaky.binding });

      expect(flaky.failures()).toBe(1);
      expect(result.sessionVersion).toBe(before + 1);
      expect(await version()).toBe(before + 1);
    });
  });
});
