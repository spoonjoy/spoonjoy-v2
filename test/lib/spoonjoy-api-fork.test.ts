import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { faker } from "@faker-js/faker";
import { getLocalDb } from "~/lib/db.server";
import {
  callSpoonjoyApiOperation,
  listSpoonjoyApiOperations,
  type SpoonjoyApiContext,
} from "~/lib/spoonjoy-api.server";
import { ApiAuthError, type ApiPrincipal } from "~/lib/api-auth.server";
import { cleanupDatabase } from "../helpers/cleanup";

type Database = Awaited<ReturnType<typeof getLocalDb>>;

function uniqueEmail(prefix = "chef") {
  return `${prefix}-${faker.string.alphanumeric(8).toLowerCase()}@example.com`;
}

function uniqueUsername(prefix = "user") {
  return `${prefix}_${faker.string.alphanumeric(8).toLowerCase()}`;
}

async function makeUser(db: Database) {
  const user = await db.user.create({
    data: { email: uniqueEmail(), username: uniqueUsername() },
  });
  const principal: ApiPrincipal = {
    id: user.id,
    email: user.email,
    username: user.username,
    source: "bearer",
    scopes: ["cookbooks:read", "public:read", "recipes:read", "shopping_list:read", "shopping_list:write", "tokens:read", "tokens:write", "kitchen:read", "kitchen:write"],
  };
  return { user, principal };
}

async function makeRecipe(
  db: Database,
  chefId: string,
  options: { title?: string; deletedAt?: Date } = {},
) {
  return db.recipe.create({
    data: {
      title: options.title ?? `Fork Test ${faker.string.alphanumeric(6)}`,
      description: "src",
      chefId,
      deletedAt: options.deletedAt ?? null,
    },
  });
}

describe("spoonjoy-api fork_recipe", () => {
  let db: Database;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("operation registry", () => {
    it("lists fork_recipe", () => {
      const names = listSpoonjoyApiOperations().map((op) => op.name);
      expect(names).toContain("fork_recipe");
    });

    it("input schema requires sourceRecipeId", () => {
      const op = listSpoonjoyApiOperations().find((o) => o.name === "fork_recipe");
      const schema = op?.inputSchema as {
        required?: string[];
        properties?: Record<string, unknown>;
      };
      expect(schema.required).toContain("sourceRecipeId");
    });

    it("input schema does NOT include ownerEmail", () => {
      const op = listSpoonjoyApiOperations().find((o) => o.name === "fork_recipe");
      const props = (op?.inputSchema as { properties: Record<string, unknown> }).properties;
      expect(Object.keys(props)).not.toContain("ownerEmail");
    });

    it("input schema has additionalProperties: false", () => {
      const op = listSpoonjoyApiOperations().find((o) => o.name === "fork_recipe");
      const schema = op?.inputSchema as { additionalProperties?: boolean };
      expect(schema.additionalProperties).toBe(false);
    });
  });

  describe("handle", () => {
    it("rejects with a validation error when sourceRecipeId is missing", async () => {
      const { principal } = await makeUser(db);
      const context: SpoonjoyApiContext = { db, principal };
      await expect(
        callSpoonjoyApiOperation("fork_recipe", {}, context),
      ).rejects.toThrow(/sourceRecipeId/);
    });

    it("throws ApiAuthError(400) when ownerEmail is supplied", async () => {
      const { principal } = await makeUser(db);
      const recipe = await makeRecipe(db, principal.id);
      const context: SpoonjoyApiContext = { db, principal };
      await expect(
        callSpoonjoyApiOperation(
          "fork_recipe",
          { sourceRecipeId: recipe.id, ownerEmail: "x@y.com" },
          context,
        ),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("throws ApiAuthError(401) when principal is null", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const context: SpoonjoyApiContext = { db, principal: null };
      await expect(
        callSpoonjoyApiOperation(
          "fork_recipe",
          { sourceRecipeId: recipe.id },
          context,
        ),
      ).rejects.toBeInstanceOf(ApiAuthError);
    });

    it("returns 404 when the source recipe is not found", async () => {
      const { principal } = await makeUser(db);
      const context: SpoonjoyApiContext = { db, principal };
      await expect(
        callSpoonjoyApiOperation(
          "fork_recipe",
          { sourceRecipeId: "nope-nope" },
          context,
        ),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("returns 404 when the source recipe is soft-deleted", async () => {
      const { principal: chef } = await makeUser(db);
      const { principal: forker } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id, { deletedAt: new Date() });
      const context: SpoonjoyApiContext = { db, principal: forker };
      await expect(
        callSpoonjoyApiOperation(
          "fork_recipe",
          { sourceRecipeId: recipe.id },
          context,
        ),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("clones the recipe and returns recipeId + attribution on the happy path", async () => {
      const { principal: chef } = await makeUser(db);
      const { principal: forker } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id, { title: "Pasta-fork-happy" });
      const context: SpoonjoyApiContext = { db, principal: forker };

      const result = (await callSpoonjoyApiOperation(
        "fork_recipe",
        { sourceRecipeId: recipe.id },
        context,
      )) as {
        recipeId: string;
        recipe: { id: string; title: string; chef: { id: string }; sourceRecipeId: string };
        attribution: { sourceRecipeId: string; sourceChef: { id: string; username: string } };
      };

      expect(result.recipeId).toBeTruthy();
      expect(result.recipeId).not.toBe(recipe.id);
      expect(result.recipe.id).toBe(result.recipeId);
      expect(result.recipe.title).toBe("Pasta-fork-happy");
      expect(result.recipe.chef.id).toBe(forker.id);
      expect(result.recipe.sourceRecipeId).toBe(recipe.id);
      expect(result.attribution.sourceRecipeId).toBe(recipe.id);
      expect(result.attribution.sourceChef.id).toBe(chef.id);
      expect(result.attribution.sourceChef.username).toBe(chef.username);
    });

    it("returns 409 when the title cannot be resolved (variation cap exhausted)", async () => {
      const { principal: chef } = await makeUser(db);
      const { principal: forker } = await makeUser(db);
      // Pre-create titles X and X (variation 2..100) for the forker so resolveTitle exhausts.
      await makeRecipe(db, forker.id, { title: "X" });
      for (let n = 2; n <= 100; n++) {
        await makeRecipe(db, forker.id, { title: `X (variation ${n})` });
      }
      const recipe = await makeRecipe(db, chef.id, { title: "X" });
      const context: SpoonjoyApiContext = { db, principal: forker };

      await expect(
        callSpoonjoyApiOperation(
          "fork_recipe",
          { sourceRecipeId: recipe.id },
          context,
        ),
      ).rejects.toMatchObject({ status: 409 });
    });

    it("propagates unexpected (non-fork) errors unchanged", async () => {
      const { principal } = await makeUser(db);
      const recipe = await makeRecipe(db, principal.id);
      // Pass a context whose db.recipe.findUnique throws an unrelated Error.
      const broken = {
        ...db,
        recipe: {
          ...db.recipe,
          findUnique: async () => {
            throw new Error("boom-unexpected");
          },
        },
      } as unknown as Database;
      const context: SpoonjoyApiContext = { db: broken, principal };
      await expect(
        callSpoonjoyApiOperation(
          "fork_recipe",
          { sourceRecipeId: recipe.id },
          context,
        ),
      ).rejects.toThrow(/boom-unexpected/);
    });

    it("respects an explicit title override and applies collision suffix", async () => {
      const { principal: chef } = await makeUser(db);
      const { principal: forker } = await makeUser(db);
      await makeRecipe(db, forker.id, { title: "My Fork" });
      const recipe = await makeRecipe(db, chef.id, { title: "Pasta-fork-override" });
      const context: SpoonjoyApiContext = { db, principal: forker };

      const result = (await callSpoonjoyApiOperation(
        "fork_recipe",
        { sourceRecipeId: recipe.id, title: "My Fork" },
        context,
      )) as { recipe: { title: string } };

      expect(result.recipe.title).toBe("My Fork (variation 2)");
    });

    it("writes a NotificationEvent for the source-chef when another user forks (with VAPID env)", async () => {
      const { principal: chef } = await makeUser(db);
      const { principal: forker } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id, { title: "Notify Fork" });
      const captured: Promise<unknown>[] = [];
      const context: SpoonjoyApiContext = {
        db,
        principal: forker,
        waitUntil: (p) => captured.push(p),
        env: {
          VAPID_PUBLIC_KEY: "pub",
          VAPID_PRIVATE_KEY: "priv",
          VAPID_SUBJECT: "mailto:test@example.com",
        },
      };
      await callSpoonjoyApiOperation(
        "fork_recipe",
        { sourceRecipeId: recipe.id },
        context,
      );
      await Promise.all(captured);
      const events = await db.notificationEvent.findMany({
        where: { recipientId: chef.id, kind: "fork_of_my_recipe" },
      });
      expect(events).toHaveLength(1);
      const payload = JSON.parse(events[0].payload);
      expect(payload.sourceRecipeId).toBe(recipe.id);
      expect(payload.recipeTitle).toBe("Notify Fork");
      expect(payload.forkerUsername).toBe(forker.username);
    });

    it("does NOT enqueue when the forker IS the source-chef", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id, { title: "Self Fork" });
      const captured: Promise<unknown>[] = [];
      await callSpoonjoyApiOperation(
        "fork_recipe",
        { sourceRecipeId: recipe.id },
        {
          db,
          principal: chef,
          waitUntil: (p) => captured.push(p),
          env: {
            VAPID_PUBLIC_KEY: "pub",
            VAPID_PRIVATE_KEY: "priv",
            VAPID_SUBJECT: "mailto:test@example.com",
          },
        },
      );
      await Promise.all(captured);
      expect(await db.notificationEvent.count()).toBe(0);
    });

    it("does not break the fork response when VAPID env is missing", async () => {
      const { principal: chef } = await makeUser(db);
      const { principal: forker } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id, { title: "No-VAPID Fork" });
      const captured: Promise<unknown>[] = [];
      const result = (await callSpoonjoyApiOperation(
        "fork_recipe",
        { sourceRecipeId: recipe.id },
        {
          db,
          principal: forker,
          waitUntil: (p) => captured.push(p),
          env: null,
        },
      )) as { recipe: { id: string } };
      await Promise.all(captured);
      expect(result.recipe.id).toBeDefined();
      expect(await db.notificationEvent.count()).toBe(0);
    });
  });
});
