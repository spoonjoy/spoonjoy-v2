// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { FormData as UndiciFormData, Request as UndiciRequest } from "undici";
import type { ApiPrincipal } from "~/lib/api-auth.server";
import { getLocalDb } from "~/lib/db.server";
import * as recipeImport from "~/lib/recipe-import.server";
import { createUserSessionCookie } from "~/lib/session.server";
import { callSpoonjoyApiOperation } from "~/lib/spoonjoy-api.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser } from "../utils";

// A retried import or fork used to make another recipe each time: an agent whose
// import_recipe_from_url or fork_recipe call timed out and was retried, or a fork dialog
// submitted twice. Now a repeat answers with the first recipe.

const mocked = vi.hoisted(() => ({ db: null as PrismaClient | null }));

vi.mock("~/lib/route-platform.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/route-platform.server")>();
  return {
    ...actual,
    getRequestDb: vi.fn(async () => {
      if (!mocked.db) throw new Error("test db was not configured");
      return mocked.db;
    }),
  };
});

const { action: forkAction } = await import("~/routes/recipes.$id.fork");

let db: PrismaClient;
let principal: ApiPrincipal;
let sourceId: string;

async function forkCount() {
  return db.recipe.count({ where: { chefId: principal.id, sourceRecipeId: sourceId, deletedAt: null } });
}

describe("retried imports and forks", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    mocked.db = db;
    await cleanupDatabase();
    const chef = await db.user.create({ data: createTestUser() });
    const author = await db.user.create({ data: createTestUser() });
    principal = { id: chef.id, email: chef.email, username: chef.username, source: "bearer", scopes: ["kitchen:read", "kitchen:write"] };
    const source = await db.recipe.create({ data: { title: "Grandma's Stew", chefId: author.id } });
    await db.recipeStep.create({ data: { recipeId: source.id, stepNum: 1, description: "Simmer" } });
    sourceId = source.id;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    mocked.db = null;
    await cleanupDatabase();
  });

  describe("fork_recipe", () => {
    const fork = (args: Record<string, unknown>) => callSpoonjoyApiOperation("fork_recipe", { sourceRecipeId: sourceId, ...args }, { db, principal }) as Promise<{
      recipeId: string;
      mutation: { idempotencyKey: string | null; replayed: boolean };
    }>;

    it("makes one fork for a retried call with the same idempotencyKey", async () => {
      const first = await fork({ idempotencyKey: "agent-fork-1" });
      const retry = await fork({ idempotencyKey: "agent-fork-1" });

      expect(first.mutation).toEqual({ idempotencyKey: "agent-fork-1", replayed: false });
      expect(retry).toEqual({ ...first, mutation: { idempotencyKey: "agent-fork-1", replayed: true } });
      expect(await forkCount()).toBe(1);
    });

    it("makes one fork for an identical retried call without a key, and a new one for a new title or after a delete", async () => {
      const first = await fork({});
      const retry = await fork({});
      expect(retry.recipeId).toBe(first.recipeId);
      expect(await forkCount()).toBe(1);

      const titled = await fork({ title: "My Stew" });
      expect(titled.recipeId).not.toBe(first.recipeId);

      await db.recipe.update({ where: { id: first.recipeId }, data: { deletedAt: new Date() } });
      const afterDelete = await fork({});
      expect(afterDelete.mutation.replayed).toBe(false);
      expect(afterDelete.recipeId).not.toBe(first.recipeId);
      expect(await forkCount()).toBe(2);
    });

    it("answers 409 for a key reused for another fork", async () => {
      await fork({ idempotencyKey: "agent-fork-2" });
      await expect(fork({ idempotencyKey: "agent-fork-2", title: "Different" }))
        .rejects.toMatchObject({ status: 409, message: "idempotencyKey was already used for a different request" });
    });
  });

  describe("import_recipe_from_url", () => {
    it("makes one recipe for a retried import, and imports again once that recipe is deleted", async () => {
      const importSpy = vi.spyOn(recipeImport, "importRecipeFromUrl").mockImplementation(async () => {
        const recipe = await db.recipe.create({ data: { title: `Imported ${crypto.randomUUID()}`, chefId: principal.id } });
        return { recipeId: recipe.id, recipe: { id: recipe.id, title: recipe.title }, confidence: "high", source: "json-ld", existingRecipeId: null, coverPending: false };
      });
      const importIt = () => callSpoonjoyApiOperation("import_recipe_from_url", { url: "https://example.com/stew", idempotencyKey: "agent-import-1" }, { db, principal }) as Promise<{
        recipeId: string;
        mutation: { replayed: boolean };
      }>;

      const first = await importIt();
      const retry = await importIt();
      expect(importSpy).toHaveBeenCalledTimes(1);
      expect(retry).toEqual({ ...first, mutation: { idempotencyKey: "agent-import-1", replayed: true } });

      await db.recipe.update({ where: { id: first.recipeId }, data: { deletedAt: new Date() } });
      const again = await importIt();
      expect(importSpy).toHaveBeenCalledTimes(2);
      expect(again.recipeId).not.toBe(first.recipeId);
    });

    it("does not record dry runs", async () => {
      vi.spyOn(recipeImport, "importRecipeFromUrl").mockResolvedValue({
        recipeId: null, recipe: { title: "draft" }, confidence: "high", source: "json-ld", existingRecipeId: null, coverPending: false,
      } as never);

      const answer = await callSpoonjoyApiOperation("import_recipe_from_url", { url: "https://example.com/stew", dryRun: true }, { db, principal });

      expect(answer).not.toHaveProperty("mutation");
      expect(await db.apiIdempotencyKey.count()).toBe(0);
    });
  });

  describe("the web fork dialog", () => {
    async function submitFork(token?: string) {
      const cookie = (await createUserSessionCookie(principal.id)).split(";")[0]!;
      const body = new UndiciFormData();
      if (token !== undefined) body.append("forkToken", token);
      const response = await forkAction({
        request: new UndiciRequest(`http://localhost/recipes/${sourceId}/fork`, { method: "POST", headers: { Cookie: cookie }, body }) as never,
        params: { id: sourceId },
        context: {},
      } as never).catch((error: unknown) => error);
      return response as Response;
    }

    it("makes one fork when the dialog is submitted twice at once, and sends both to it", async () => {
      const token = crypto.randomUUID();
      const [first, second] = await Promise.all([submitFork(token), submitFork(token)]);

      expect([first.status, second.status]).toEqual([302, 302]);
      expect(second.headers.get("Location")).toBe(first.headers.get("Location"));
      expect(await forkCount()).toBe(1);

      const resubmitted = await submitFork(token);
      expect(resubmitted.headers.get("Location")).toBe(first.headers.get("Location"));
      expect(await forkCount()).toBe(1);
    });

    it("builds one Prisma client for a fork's key and its write", async () => {
      const { getRequestDb } = await import("~/lib/route-platform.server");
      vi.mocked(getRequestDb).mockClear();

      expect((await submitFork(crypto.randomUUID())).status).toBe(302);
      expect(getRequestDb).toHaveBeenCalledTimes(1);
    });

    it("forks every time for posts without a usable token, as before", async () => {
      await submitFork();
      await submitFork("short");
      expect(await forkCount()).toBe(2);
    });

    it("answers 409 when a token is reused for another recipe", async () => {
      const token = crypto.randomUUID();
      await submitFork(token);
      const other = await db.recipe.create({ data: { title: "Other Stew", chefId: (await db.user.create({ data: createTestUser() })).id } });
      await db.recipeStep.create({ data: { recipeId: other.id, stepNum: 1, description: "Stir" } });
      sourceId = other.id;

      const answer = await submitFork(token);
      expect(answer.status).toBe(409);
    });
  });
});
