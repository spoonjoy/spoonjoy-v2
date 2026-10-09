// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import { callSpoonjoyApiOperation, type SpoonjoyApiContext } from "~/lib/spoonjoy-api.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser } from "../utils";

// The legacy /api and MCP read operations answer anonymous callers, and the privacy policy
// promises an account email stays private. No recipe or cookbook payload may carry the
// chef's or author's email, wherever it sits in the response.

let db: PrismaClient;

function emailPaths(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => emailPaths(item, `${path}[${index}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) =>
      key.toLowerCase().includes("email") ? [`${path}.${key}`] : emailPaths(child, `${path}.${key}`)
    );
  }
  return [];
}

describe("public recipe and cookbook reads", () => {
  let email: string;
  let recipeId: string;
  let cookbookId: string;
  let context: SpoonjoyApiContext;

  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    const testUser = createTestUser();
    email = testUser.email.toLowerCase();
    const chef = await db.user.create({ data: { ...testUser, email } });
    const recipe = await db.recipe.create({ data: { title: "Private Chef Beans", chefId: chef.id } });
    const cookbook = await db.cookbook.create({ data: { title: "Private Chef Book", authorId: chef.id } });
    await db.recipeInCookbook.create({ data: { recipeId: recipe.id, cookbookId: cookbook.id, addedById: chef.id } });
    recipeId = recipe.id;
    cookbookId = cookbook.id;
    context = { db, principal: null, env: null };
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it.each([
    ["get_recipe", () => ({ id: recipeId })],
    ["search_recipes", () => ({ query: "Beans" })],
    ["search_recipes", () => ({})],
    ["get_cookbook", () => ({ ownerEmail: email, cookbookId })],
    ["list_cookbooks", () => ({ ownerEmail: email })],
  ] as const)("%s never returns an email", async (name, args) => {
    const result = await callSpoonjoyApiOperation(name, args(), context);
    expect(JSON.stringify(result)).toContain("Private Chef");
    expect(JSON.stringify(result)).not.toContain(email);
    expect(emailPaths(result)).toEqual([]);
  });
});
