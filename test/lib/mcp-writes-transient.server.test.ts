// @vitest-environment node
// MCP writes when D1's connection drops. After each outcome (the write never ran, it committed
// but its answer was lost, or it committed late, just before the retry) the rows are the ones a
// single successful write leaves and the answer is the one it would give; when every try is lost,
// the tool gives up with D1WriteUnavailableError, which MCP answers as the retryable -32002.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { ApiPrincipal } from "~/lib/api-auth.server";
import type { D1ReadDatabase } from "~/lib/d1-read.server";
import * as placeholderCoverModule from "~/lib/ai-placeholder-cover.server";
import { getLocalDb } from "~/lib/db.server";
import { D1WriteUnavailableError } from "~/lib/d1-write-retry.server";
import { runDedupedRecipeWrite } from "~/lib/recipe-write-dedupe.server";
import { callSpoonjoyApiOperation, type SpoonjoyApiContext } from "~/lib/spoonjoy-api.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { flakyD1, type FlakyOutcome } from "../helpers/flaky-d1";
import { flakyPrisma, type FlakyPrisma } from "../helpers/flaky-prisma";
import { createTestUser } from "../utils";

const OUTCOMES: FlakyOutcome[] = ["lost", "lost-answer", "late"];
const GIVE_UP: FlakyOutcome[] = ["lost", "lost", "lost", "lost"];

let db: PrismaClient;
let flaky: FlakyPrisma;
let d1: SqliteD1;
let principal: ApiPrincipal;

function context(DB?: D1ReadDatabase): SpoonjoyApiContext {
  return { db: flaky.db, principal, env: DB ? { DB } : null };
}

const call = (name: string, args: Record<string, unknown>, DB?: D1ReadDatabase) =>
  callSpoonjoyApiOperation(name, args, context(DB)) as Promise<Record<string, any>>;

beforeEach(async () => {
  db = await getLocalDb();
  await cleanupDatabase();
  flaky = flakyPrisma(db);
  d1 = sqliteD1();
  // MCP resolves the owner by lower-cased email.
  const testUser = createTestUser();
  const user = await db.user.create({ data: { ...testUser, email: testUser.email.toLowerCase() } });
  principal = { id: user.id, email: user.email, username: user.username, source: "bearer", scopes: ["kitchen:read", "kitchen:write", "shopping_list:read", "shopping_list:write"] };
});

afterEach(async () => {
  vi.restoreAllMocks();
  d1.close();
  await cleanupDatabase();
});

describe("MCP create_recipe on D1", () => {
  const steps = [{ description: "Simmer", ingredients: [{ name: "Water", quantity: 4, unit: "cup" }] }];
  const recipeBatch = /NOT EXISTS \(SELECT 1 FROM "Recipe" WHERE "chefId"/;

  beforeEach(() => {
    // The placeholder job has its own tests; stub it so only the create batch runs.
    vi.spyOn(placeholderCoverModule, "scheduleAiPlaceholderCover").mockResolvedValue(undefined);
  });

  it.each(OUTCOMES)("writes the recipe once when the batch is %s", async (outcome) => {
    const flakyBinding = flakyD1(d1.binding);
    flakyBinding.failNext(recipeBatch, outcome);

    const result = await call("create_recipe", { title: "Beans", steps }, flakyBinding.binding);

    expect(flakyBinding.failures()).toBe(1);
    const recipes = await db.recipe.findMany({ where: { chefId: principal.id }, include: { steps: true, covers: true } });
    expect(recipes.map((recipe) => recipe.id)).toEqual([result.recipe.id]);
    expect(recipes[0]!.steps).toHaveLength(1);
    expect(recipes[0]!.covers).toHaveLength(1);
  });

  it("gives up with a retryable error and writes nothing when every try is lost", async () => {
    const flakyBinding = flakyD1(d1.binding);
    flakyBinding.failNext(recipeBatch, ...GIVE_UP);

    await expect(call("create_recipe", { title: "Beans", steps }, flakyBinding.binding)).rejects.toBeInstanceOf(D1WriteUnavailableError);
    await expect(db.recipe.count({ where: { chefId: principal.id } })).resolves.toBe(0);
  });
});

describe("MCP create_cookbook", () => {
  const cookbooks = () => db.cookbook.findMany({ where: { authorId: principal.id } });

  it.each(OUTCOMES)("creates the cookbook once when the write is %s", async (outcome) => {
    flaky.failNext("cookbook", "create", outcome);

    const result = await call("create_cookbook", { title: "Weeknights" });

    expect(flaky.failures()).toBe(1);
    expect(result).toMatchObject({ created: true, cookbook: { title: "Weeknights" } });
    expect(result).not.toHaveProperty("mutation");
    expect((await cookbooks()).map((cookbook) => cookbook.id)).toEqual([result.cookbook.id]);
  });

  it("gives up with a retryable error and creates nothing when every try is lost", async () => {
    flaky.failNext("cookbook", "create", ...GIVE_UP);

    await expect(call("create_cookbook", { title: "Weeknights" })).rejects.toBeInstanceOf(D1WriteUnavailableError);
    await expect(cookbooks()).resolves.toEqual([]);
  });

  it("replays a repeat with the same key as the cookbook the first call made", async () => {
    const first = await call("create_cookbook", { title: "Weeknights", idempotencyKey: "cookbook-key-1" });
    const repeat = await call("create_cookbook", { title: "Weeknights", idempotencyKey: "cookbook-key-1" });

    expect(first).toMatchObject({ created: true, mutation: { idempotencyKey: "cookbook-key-1", replayed: false } });
    expect(repeat).toMatchObject({ created: true, mutation: { idempotencyKey: "cookbook-key-1", replayed: true } });
    expect(repeat.cookbook.id).toBe(first.cookbook.id);
    expect(await cookbooks()).toHaveLength(1);
  });

  it("answers a repeat after a lost answer as the cookbook the lost call made", async () => {
    // The create commits, then reading it back fails, so the client never sees the cookbook.
    flaky.failNext("cookbook", "findFirstOrThrow", "lost");
    await expect(call("create_cookbook", { title: "Weeknights", idempotencyKey: "cookbook-key-2" })).rejects.toThrow("Network connection lost");

    const repeat = await call("create_cookbook", { title: "Weeknights", idempotencyKey: "cookbook-key-2" });
    expect(repeat).toMatchObject({ created: true, mutation: { idempotencyKey: "cookbook-key-2", replayed: true } });
    expect((await cookbooks()).map((cookbook) => cookbook.id)).toEqual([repeat.cookbook.id]);
  });

  it("answers an existing cookbook with that title, made without the key, as not created", async () => {
    const plain = await call("create_cookbook", { title: "Weeknights" });

    const keyed = await call("create_cookbook", { title: "Weeknights", idempotencyKey: "cookbook-key-3" });

    expect(keyed).toMatchObject({ created: false, mutation: { idempotencyKey: "cookbook-key-3", replayed: false } });
    expect(keyed.cookbook.id).toBe(plain.cookbook.id);
  });

  it("refuses a key reused for a different title, and a malformed key", async () => {
    await call("create_cookbook", { title: "Weeknights", idempotencyKey: "cookbook-key-4" });

    await expect(call("create_cookbook", { title: "Weekends", idempotencyKey: "cookbook-key-4" }))
      .rejects.toMatchObject({ status: 409, message: "idempotencyKey was already used for a different request" });
    await expect(call("create_cookbook", { title: "Weekends", idempotencyKey: "short" }))
      .rejects.toThrow("idempotencyKey must be 8-100 letters, digits, '_' or '-'");
    expect((await cookbooks()).map((cookbook) => cookbook.title)).toEqual(["Weeknights"]);
  });
});

describe("MCP shopping list writes", () => {
  const items = () => db.shoppingListItem.findMany({ where: { shoppingList: { authorId: principal.id } } });

  it.each([
    ["shoppingList", "the list"],
    ["ingredientRef", "the ingredient"],
    ["unit", "the unit"],
  ] as const)("creates %s once when its create drops", async (model) => {
    for (const outcome of OUTCOMES) {
      await cleanupDatabase();
      const testUser = createTestUser();
      const user = await db.user.create({ data: { ...testUser, email: testUser.email.toLowerCase() } });
      principal = { ...principal, id: user.id, email: user.email, username: user.username };
      flaky.failNext(model, "create", outcome);

      await call("add_shopping_list_item", { name: "Limes", quantity: 2, unit: "whole" });

      await expect(db.shoppingList.count({ where: { authorId: user.id } })).resolves.toBe(1);
      await expect(db.ingredientRef.count({ where: { name: "limes" } })).resolves.toBe(1);
      await expect(db.unit.count({ where: { name: "whole" } })).resolves.toBe(1);
      expect(await items()).toHaveLength(1);
    }
    expect(flaky.failures()).toBe(3);
  });

  it.each(["shoppingList", "ingredientRef", "unit"])("gives up with a retryable error when every %s create is lost", async (model) => {
    flaky.failNext(model, "create", ...GIVE_UP);

    await expect(call("add_shopping_list_item", { name: "Limes", quantity: 2, unit: "whole" })).rejects.toBeInstanceOf(D1WriteUnavailableError);
    expect(await items()).toEqual([]);
  });

  async function addItem() {
    await call("add_shopping_list_item", { name: "Limes", quantity: 2 });
    return (await items())[0]!.id;
  }

  it.each(OUTCOMES)("checks and unchecks an item when the update is %s", async (outcome) => {
    const itemId = await addItem();

    flaky.failNext("shoppingListItem", "update", outcome);
    await call("set_shopping_list_item_checked", { itemId, checked: true });
    const checked = await db.shoppingListItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(checked.checked).toBe(true);
    expect(checked.checkedAt).not.toBeNull();

    flaky.failNext("shoppingListItem", "update", outcome);
    await call("set_shopping_list_item_checked", { itemId, checked: false });
    await expect(db.shoppingListItem.findUniqueOrThrow({ where: { id: itemId } })).resolves.toMatchObject({ checked: false, checkedAt: null });
    expect(flaky.failures()).toBe(2);
  });

  it.each(OUTCOMES)("removes an item when the update is %s", async (outcome) => {
    const itemId = await addItem();
    flaky.failNext("shoppingListItem", "update", outcome);

    await call("remove_shopping_list_item", { itemId });

    expect(flaky.failures()).toBe(1);
    expect((await db.shoppingListItem.findUniqueOrThrow({ where: { id: itemId } })).deletedAt).not.toBeNull();
  });

  it("gives up checking or removing with a retryable error when every try is lost", async () => {
    const itemId = await addItem();

    flaky.failNext("shoppingListItem", "update", ...GIVE_UP);
    await expect(call("set_shopping_list_item_checked", { itemId, checked: true })).rejects.toBeInstanceOf(D1WriteUnavailableError);
    flaky.failNext("shoppingListItem", "update", ...GIVE_UP);
    await expect(call("remove_shopping_list_item", { itemId })).rejects.toBeInstanceOf(D1WriteUnavailableError);

    await expect(db.shoppingListItem.findUniqueOrThrow({ where: { id: itemId } })).resolves.toMatchObject({ checked: false, deletedAt: null });
  });
});

describe("releasing an idempotency key after a failed write", () => {
  it.each(OUTCOMES)("releases an MCP cover key when the release is %s, and rethrows the write's error", async (outcome) => {
    const recipeId = (await db.recipe.create({ data: { title: "Covered", chefId: principal.id } })).id;
    // The no-cover write fails on D1 after the key is reserved.
    const failing: D1ReadDatabase = {
      prepare: (sql) => d1.binding.prepare(sql),
      async batch(statements) {
        const sql = (statements as unknown as Array<{ sql: string }>).map((statement) => statement.sql).join("\n");
        if (sql.includes(`"coverMode"`)) throw new Error("cover write failed");
        return d1.binding.batch(statements as never);
      },
    };
    flaky.failNext("apiIdempotencyKey", "deleteMany", outcome);

    await expect(call("set_recipe_no_cover", { recipeId, confirmNoCover: true, idempotencyKey: "no-cover-release" }, failing))
      .rejects.toThrow("cover write failed");

    expect(flaky.failures()).toBe(1);
    await expect(db.apiIdempotencyKey.count({ where: { userId: principal.id } })).resolves.toBe(0);
  });

  it.each(OUTCOMES)("forgets a recipe write key when the forget is %s, so a retry writes", async (outcome) => {
    const write = (fail: boolean) => runDedupedRecipeWrite({
      db: flaky.db,
      chefId: principal.id,
      operation: "test.write",
      key: "forget-key",
      request: { source: "a" },
      write: async () => {
        if (fail) throw new Error("import provider down");
        return { recipeId: null };
      },
    });
    flaky.failNext("apiIdempotencyKey", "deleteMany", outcome);

    await expect(write(true)).rejects.toThrow("import provider down");
    expect(flaky.failures()).toBe(1);
    await expect(db.apiIdempotencyKey.count({ where: { userId: principal.id } })).resolves.toBe(0);
    await expect(write(false)).resolves.toEqual({ value: { recipeId: null }, replayed: false });
  });
});
