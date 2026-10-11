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
import { flakyD1 } from "../../helpers/flaky-d1";
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
