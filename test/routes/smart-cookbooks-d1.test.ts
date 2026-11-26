// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { db } from "~/lib/db.server";
import { d1OrganizerReader, d1SmartCookbookStore } from "~/domains/kitchen/adapters/d1-smart-cookbook-store";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createDrawerRecipe, createDrawerUser, sessionHeaders } from "./kitchen-drawer-test-utils";

// The request's Prisma client, held: on Journeys runs 45741582394 and 45743957382 the smart cookbook page was canceled
// as hung after a rename and a delete, as every Prisma page in an isolate is once its Prisma engine wedges (merge-group
// run 45528383350). With a D1 binding the smart cookbook pages, their forms and Cookbooks' list must not build one.
const platform = vi.hoisted(() => ({ getRequestDb: vi.fn() }));
vi.mock("~/lib/route-platform.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/route-platform.server")>()),
  getRequestDb: platform.getRequestDb,
}));

import { action as newAction, loader as newLoader } from "~/routes/cookbooks.smart.new";
import { action as pageAction, loader as pageLoader } from "~/routes/cookbooks.smart.$id";
import { loader as cookbooksLoader } from "~/routes/cookbooks._index";

async function signedIn(path: string, userId: string, init: RequestInit = {}) {
  return new UndiciRequest(`http://localhost:3000${path}`, { ...init, headers: await sessionHeaders(userId) }) as unknown as Request;
}

async function settle(promise: unknown): Promise<unknown> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}

function redirectedTo(result: unknown): string | null {
  return result instanceof Response && result.status >= 300 && result.status < 400 ? result.headers.get("Location") : null;
}

describe("smart cookbooks on a D1 binding", () => {
  let d1: SqliteD1;
  let context: object;

  beforeEach(async () => {
    await cleanupDatabase();
    platform.getRequestDb.mockReset();
    platform.getRequestDb.mockImplementation(() => new Promise(() => {}));
    d1 = sqliteD1();
    context = { cloudflare: { env: { DB: d1.binding } } };
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  it("make, fill, list, rename, change the rules of and delete one while Prisma never answers", async () => {
    const cook = await createDrawerUser("smart-d1");
    const salad = await createDrawerRecipe({ chefId: cook.id, title: "Quick salad", updatedAt: new Date("2026-01-02") });
    const cake = await createDrawerRecipe({ chefId: cook.id, title: "Quick cake", updatedAt: new Date("2026-01-03") });
    const quick = await db.organizer.create({ data: { ownerId: cook.id, kind: "tag", name: "Quick", slug: "quick" } });
    const mixer = await db.organizer.create({ data: { ownerId: cook.id, kind: "tool", name: "Mixer", slug: "mixer" } });
    await db.recipeOrganizer.createMany({
      data: [
        { recipeId: salad.id, organizerId: quick.id },
        { recipeId: cake.id, organizerId: quick.id },
        { recipeId: cake.id, organizerId: mixer.id },
      ],
    });
    const post = async (path: string, fields: [string, string][]) => signedIn(path, cook.id, { method: "POST", body: new URLSearchParams(fields) });

    const form = await newLoader({ request: await signedIn("/cookbooks/smart/new", cook.id), context, params: {} } as never);
    expect(form.choices.map((choice: { label: string }) => choice.label)).toEqual(["Quick", "Mixer"]);

    const made = await settle(newAction({
      request: await post("/cookbooks/smart/new", [["title", "Quick, no mixer"], ["with", quick.id], ["without", mixer.id]]),
      context,
      params: {},
    } as never));
    const id = redirectedTo(made)!.split("/").pop()!;
    const taken = await newAction({
      request: await post("/cookbooks/smart/new", [["title", "Quick, no mixer"], ["with", quick.id]]),
      context,
      params: {},
    } as never);
    expect(taken).toMatchObject({ data: { error: "You already have a smart cookbook with this title." }, init: { status: 400 } });

    const load = async () => pageLoader({ request: await signedIn(`/cookbooks/smart/${id}`, cook.id), context, params: { id } } as never);
    expect(await load()).toMatchObject({
      cookbook: { id, title: "Quick, no mixer" },
      rules: [{ side: "with", name: "Quick" }, { side: "without", name: "Mixer" }],
      ruleForm: { chosen: { with: [quick.id], without: [mixer.id] } },
      total: 1,
      recipes: [{ id: salad.id }],
    });
    const listed = await cookbooksLoader({ request: await signedIn("/cookbooks", cook.id), context, params: {} } as never);
    expect(listed).toMatchObject({ smartCookbooks: [{ id, title: "Quick, no mixer" }] });

    const change = async (fields: [string, string][]) => settle(pageAction({ request: await post(`/cookbooks/smart/${id}`, fields), context, params: { id } } as never));
    expect(await change([["intent", "rename"], ["title", "Speedy"]])).toEqual({ renamed: "Speedy" });
    expect(await change([["intent", "rules"], ["with", quick.id]])).toEqual({ rulesSaved: true });
    expect(await load()).toMatchObject({
      cookbook: { title: "Speedy" },
      rules: [{ side: "with", name: "Quick" }],
      total: 2,
      recipes: [{ id: cake.id }, { id: salad.id }],
    });

    expect(redirectedTo(await change([["intent", "delete"]]))).toBe("/cookbooks");
    expect(await db.smartCookbook.count()).toBe(0);
    expect(await db.smartCookbookRule.count()).toBe(0);
    expect(await settle(load())).toMatchObject({ status: 404 });
    expect(platform.getRequestDb).not.toHaveBeenCalled();
  });
});

describe("the D1 smart cookbook store", () => {
  let d1: SqliteD1;

  beforeEach(async () => {
    await cleanupDatabase();
    d1 = sqliteD1();
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  it("keeps a cookbook's rules, or makes no cookbook, when one of the rules can't go in", async () => {
    const cook = await createDrawerUser("smart-d1-store");
    const store = d1SmartCookbookStore(d1.binding);
    const rule = { side: "with", organizerId: "quick" } as const;

    // The same rule twice breaks the rules' key, so the batch stops and nothing of it stays.
    await expect(store.create(cook.id, "Twice", [rule, rule])).rejects.toThrow(/UNIQUE constraint failed/);
    expect(await db.smartCookbook.count()).toBe(0);

    const made = await store.create(cook.id, "Quick", [rule]);
    expect(made).toMatchObject({ ok: true });
    const id = made.ok ? made.cookbook.id : "";
    expect(await store.create(cook.id, "Quick", [])).toEqual({ ok: false, reason: "taken" });
    await expect(store.replaceRules(id, [{ side: "without", organizerId: "mixer" }, { side: "without", organizerId: "mixer" }])).rejects.toThrow();
    expect(await store.find(id)).toEqual({ id, ownerId: cook.id, title: "Quick", rules: [rule] });

    await store.repoint(id, { side: "with", from: "quick", to: "fast" });
    expect(await store.listOf(cook.id)).toEqual([{ id, ownerId: cook.id, title: "Quick", rules: [{ side: "with", organizerId: "fast" }] }]);
    await store.repoint(id, { side: "with", from: "fast", to: null });
    expect((await store.find(id))!.rules).toEqual([]);

    await store.create(cook.id, "Taken", []);
    expect(await store.rename(id, "Taken")).toEqual({ ok: false, reason: "taken" });
    expect(await store.rename(id, "Fast")).toEqual({ ok: true });
    expect(await store.find(id)).toMatchObject({ title: "Fast" });
  });

  it("passes on a failure that isn't a taken title, and reads the organizers again after a failed read", async () => {
    let calls = 0;
    const failing = {
      prepare: d1.binding.prepare,
      batch: async (statements: Parameters<typeof d1.binding.batch>[0]) => {
        calls += 1;
        if (calls === 1) throw new Error("D1 is down");
        return d1.binding.batch(statements);
      },
    };
    await expect(d1SmartCookbookStore(failing).rename("any", "Title")).rejects.toThrow("D1 is down");

    const cook = await createDrawerUser("smart-d1-reader");
    await db.organizer.create({ data: { ownerId: cook.id, kind: "tag", name: "Quick", slug: "quick" } });
    calls = 0;
    const reader = d1OrganizerReader(failing);
    await expect(reader.organizersOf(cook.id, "tag")).rejects.toThrow("D1 is down");
    expect((await reader.organizersOf(cook.id, "tag")).map((organizer) => organizer.name)).toEqual(["Quick"]);
    // One read serves every kind.
    expect(await reader.organizersOf(cook.id, "tool")).toEqual([]);
    expect(calls).toBe(2);
  });
});
