// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import {
  RecipeWriteInFlightError,
  RecipeWriteKeyConflictError,
  runDedupedRecipeWrite,
} from "~/lib/recipe-write-dedupe.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser } from "../utils";

let db: PrismaClient;
let chefId: string;

async function newRecipe() {
  return (await db.recipe.create({ data: { title: `Made ${crypto.randomUUID()}`, chefId } })).id;
}

function run(write: () => Promise<{ recipeId: string | null }>, options: { key?: string; request?: unknown; waitForInFlightMs?: number } = {}) {
  return runDedupedRecipeWrite({
    db,
    chefId,
    operation: "test.write",
    key: options.key,
    request: options.request ?? { source: "a" },
    write,
    waitForInFlightMs: options.waitForInFlightMs,
    pollMs: 5,
  });
}

describe("runDedupedRecipeWrite", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    chefId = (await db.user.create({ data: createTestUser() })).id;
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("writes once per key and answers a repeat with the first answer", async () => {
    const write = vi.fn(async () => ({ recipeId: await newRecipe(), note: "first" }));

    const first = await run(write, { key: "k1" });
    const repeat = await run(write, { key: "k1" });

    expect(write).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ value: { recipeId: expect.any(String), note: "first" }, replayed: false });
    expect(repeat).toEqual({ value: first.value, replayed: true });
  });

  it("treats an identical request without a key as a repeat, and a different one as new", async () => {
    const write = vi.fn(async () => ({ recipeId: await newRecipe() }));

    const first = await run(write);
    const repeat = await run(write);
    const other = await run(write, { request: { source: "b" } });

    expect(write).toHaveBeenCalledTimes(2);
    expect(repeat).toEqual({ value: first.value, replayed: true });
    expect(other.value.recipeId).not.toBe(first.value.recipeId);
  });

  it("refuses a key reused for a different request", async () => {
    await run(async () => ({ recipeId: await newRecipe() }), { key: "k2" });

    await expect(run(async () => ({ recipeId: await newRecipe() }), { key: "k2", request: { source: "b" } }))
      .rejects.toBeInstanceOf(RecipeWriteKeyConflictError);
  });

  it("writes again when the recipe the first answer made was deleted or is gone", async () => {
    const first = await run(async () => ({ recipeId: await newRecipe() }), { key: "k3" });
    await db.recipe.update({ where: { id: first.value.recipeId! }, data: { deletedAt: new Date() } });

    const again = await run(async () => ({ recipeId: await newRecipe() }), { key: "k3" });
    expect(again.replayed).toBe(false);
    expect(again.value.recipeId).not.toBe(first.value.recipeId);

    const empty = await run(async () => ({ recipeId: null }), { key: "k4" });
    const afterEmpty = await run(async () => ({ recipeId: "made-now" }), { key: "k4" });
    expect(empty.replayed).toBe(false);
    expect(afterEmpty).toEqual({ value: { recipeId: "made-now" }, replayed: false });
  });

  it("forgets a write that failed, so a retry writes", async () => {
    await expect(run(async () => { throw new Error("import provider down"); }, { key: "k5" })).rejects.toThrow("import provider down");

    const retry = await run(async () => ({ recipeId: await newRecipe() }), { key: "k5" });
    expect(retry.replayed).toBe(false);
  });

  it("answers a repeat of a write still running as in progress, or waits for it", async () => {
    let finish!: (value: { recipeId: string }) => void;
    const running = run(() => new Promise((resolve) => { finish = resolve; }), { key: "k6" });
    await vi.waitFor(async () => expect(await db.apiIdempotencyKey.count()).toBe(1));

    await expect(run(async () => ({ recipeId: await newRecipe() }), { key: "k6" })).rejects.toBeInstanceOf(RecipeWriteInFlightError);

    const waiting = run(async () => ({ recipeId: "never" }), { key: "k6", waitForInFlightMs: 5_000 });
    const recipeId = await newRecipe();
    finish({ recipeId });
    await expect(running).resolves.toEqual({ value: { recipeId }, replayed: false });
    await expect(waiting).resolves.toEqual({ value: { recipeId }, replayed: true });
  });

  it("gives up waiting for a write that does not finish", async () => {
    void run(() => new Promise(() => {}), { key: "k7" });
    await vi.waitFor(async () => expect(await db.apiIdempotencyKey.count()).toBe(1));

    await expect(run(async () => ({ recipeId: "never" }), { key: "k7", waitForInFlightMs: 30 }))
      .rejects.toBeInstanceOf(RecipeWriteInFlightError);
  });
});
