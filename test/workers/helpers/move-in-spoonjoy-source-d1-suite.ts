import { env } from "cloudflare:test";
import { trackedExecutionContext } from "./execution-contexts";
import { beforeAll, describe, expect, it } from "vitest";

import { loader as apiV1Loader } from "../../../app/routes/api.v1.$";
import { hashApiToken } from "../../../app/lib/api-auth.server";
import { openServerSource } from "../../../app/domains/move-in/adapters/worker/server-sources";
import { writeMovedInRecipe } from "../../../app/domains/move-in/adapters/storage/recipe-writer.server";
import { MoveInError } from "../../../app/domains/move-in/model/move-in-error";
import { applyRepositoryMigrations } from "./repository-migrations";

// The Spoonjoy move-in source's own requests, answered by the real app: its REST API's health, account and export
// handlers over Wrangler's real D1, and the Worker's photo path over a real R2 bucket. The Move in journey replays a
// real server's recorded answers through a stand-in, so the runner, not the source, asks the real server there; this
// suite is where the source's path, token, query and photo requests meet a real Spoonjoy.

const OTHER = "https://other-spoonjoy.test";
const COOK = "move-out-cook";
const NEWCOMER = "move-in-cook";
const TOKEN = "sj_move_out_d1_test";
const STALE_TOKEN = "sj_move_out_d1_revoked";
const PHOTO_KEY = `recipes/${COOK}/focaccia.jpg`;
const PHOTO = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
const NOW = new Date("2026-11-26T12:00:00.000Z");

interface SuiteEnvironment {
  DB: D1Database;
  MOVE_IN_TEST_PHOTOS: R2Bucket;
}

function suiteEnv(): SuiteEnvironment {
  return env as unknown as SuiteEnvironment;
}

// The app's environment with the suite's own photo bucket in its PHOTOS place, so the other suites' photo-less
// environment stays as it is.
function appEnv(): Record<string, unknown> {
  return { ...(env as object), PHOTOS: suiteEnv().MOVE_IN_TEST_PHOTOS };
}

async function run(sql: string, ...values: unknown[]) {
  await suiteEnv().DB.prepare(sql).bind(...values).run();
}

interface Asked {
  path: string;
  authorization: string | null;
  redirect: RequestRedirect | undefined;
}

/**
 * A fetch that hands each request the source makes to the real app: /api/v1 to the REST API route, everything else
 * to the Worker, which answers /photos before React Router. It notes what was asked.
 */
function realSpoonjoy(asked: Asked[]): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    asked.push({ path: `${url.pathname}${url.search}`, authorization: request.headers.get("authorization"), redirect: init?.redirect });
    if (url.origin !== OTHER) throw new Error(`the source asked ${url.origin}, not the address it was given`);
    if (url.pathname.startsWith("/api/v1/")) {
      return apiV1Loader({
        request,
        params: { "*": url.pathname.slice("/api/v1/".length) },
        context: { cloudflare: { env: appEnv(), ctx: trackedExecutionContext() } },
      } as never) as Promise<Response>;
    }
    const worker = (await import("../../../workers/app")).default;
    return worker.fetch(request as never, appEnv() as never, trackedExecutionContext());
  };
}

describe("the Spoonjoy move-in source against a real Spoonjoy", () => {
  beforeAll(async () => {
    await applyRepositoryMigrations(suiteEnv().DB);
    for (const id of [COOK, NEWCOMER]) {
      await run(`INSERT INTO "User" ("id", "email", "username", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)`, id, `${id}@example.com`, id, NOW.toISOString(), NOW.toISOString());
    }
    // The cook's recipe there, written by the move-in's own writer for its exact shape, then with its move-in records
    // gone, as a recipe the cook wrote there has none.
    await run(`INSERT INTO "ImportSource" ("id", "ownerId", "kind", "instanceKey", "label") VALUES ('move-out-seed', ?, 'seed', 'seed', 'seed')`, COOK);
    const written = await writeMovedInRecipe({
      db: suiteEnv().DB as never,
      sourceId: "move-out-seed",
      jobId: "seed",
      chefId: COOK,
      now: NOW,
      draft: {
        sourceKey: "seed-1", ownerKey: "seed", sourceUpdatedAt: null, title: "Focaccia", description: "A tray bake.", servings: "8", sourceUrl: null, photoPath: "",
        steps: [
          { sourceKey: "s1", title: "Dough", text: "Stir the dough.", ingredientKeys: ["flour"], duration: 10 },
          { sourceKey: "s2", title: null, text: "Bake until golden.", ingredientKeys: [], duration: 25, usesOutputOf: [1] },
        ],
        ingredients: [{ sourceKey: "flour", section: null, quantity: 500, unit: "g", food: "bread flour", note: null, originalText: null, plainText: false }],
        notes: [], tags: [], categories: [], tools: [], warnings: [],
      },
    });
    await run(`DELETE FROM "SourceRecord" WHERE "sourceId" = 'move-out-seed'`);
    await run(`DELETE FROM "ImportSource" WHERE "id" = 'move-out-seed'`);
    const recipeId = (written as { recipeId: string }).recipeId;
    // Its photo, with the version query the app puts on a cover's address.
    await suiteEnv().MOVE_IN_TEST_PHOTOS.put(PHOTO_KEY, PHOTO, { httpMetadata: { contentType: "image/jpeg" } });
    await run(
      `INSERT INTO "RecipeCover" ("id", "recipeId", "imageUrl", "sourceType", "createdAt") VALUES ('move-out-cover', ?, ?, 'upload', ?)`,
      recipeId, `/photos/${PHOTO_KEY}?v=2`, NOW.toISOString(),
    );
    await run(`UPDATE "Recipe" SET "activeCoverId" = 'move-out-cover' WHERE "id" = ?`, recipeId);
    // The token a cook makes to move out: it reads the account and the kitchen, and changes nothing.
    for (const [id, token, revoked] of [["move-out-token", TOKEN, null], ["move-out-revoked", STALE_TOKEN, NOW.toISOString()]] as const) {
      await run(
        `INSERT INTO "ApiCredential" ("id", "userId", "name", "tokenHash", "tokenPrefix", "scopes", "revokedAt", "createdAt", "updatedAt")
         VALUES (?, ?, 'Moving my kitchen', ?, ?, 'account:read kitchen:read', ?, ?, ?)`,
        id, COOK, await hashApiToken(token), token.slice(0, 12), revoked, NOW.toISOString(), NOW.toISOString(),
      );
    }
  });

  it("reads the cook's kitchen and its photo through the app's own handlers", async () => {
    const asked: Asked[] = [];
    const source = await openServerSource("spoonjoy-api", { address: `${OTHER}/`, token: TOKEN, fetch: realSpoonjoy(asked) });
    expect(source).toMatchObject({ kind: "spoonjoy", serverUrl: OTHER });
    expect(source.version).toMatch(/^v1/);

    const kitchen = (await source.openKitchen(await source.chooseKitchen()))!;
    expect(kitchen).toMatchObject({ key: COOK, name: COOK, size: 1 });
    expect(await kitchen.count()).toEqual({ photos: 1, tags: 0, categories: 0, tools: 0 });
    const draft = await kitchen.draft(0);
    expect(draft).toMatchObject({
      title: "Focaccia",
      description: "A tray bake.",
      photoPath: `/photos/${PHOTO_KEY}?v=2`,
      steps: [
        expect.objectContaining({ title: "Dough", text: "Stir the dough.", duration: 10 }),
        expect.objectContaining({ title: null, text: "Bake until golden.", duration: 25, usesOutputOf: [1] }),
      ],
      ingredients: [expect.objectContaining({ quantity: 500, unit: "g", food: "bread flour" })],
    });
    expect(kitchen.hasPhoto(draft)).toBe(true);
    expect(await kitchen.readPhoto(draft)).toEqual(PHOTO);

    // Every request went to the address the cook gave, with the token, never following a redirect.
    expect(asked.map(({ path }) => path)).toEqual(["/api/v1/health", "/api/v1/me/export", `/photos/${PHOTO_KEY}?v=2`]);
    expect(asked.every(({ authorization, redirect }) => authorization === `Bearer ${TOKEN}` && redirect === "manual")).toBe(true);

    // And it moves into another cook's kitchen as a recipe of its own.
    await run(
      `INSERT INTO "ImportSource" ("id", "ownerId", "kind", "instanceKey", "label", "serverUrl") VALUES ('move-in-source', ?, 'spoonjoy', ?, ?, ?)`,
      NEWCOMER, COOK, COOK, OTHER,
    );
    expect(await writeMovedInRecipe({ db: suiteEnv().DB as never, sourceId: "move-in-source", jobId: "move-in-job", chefId: NEWCOMER, draft, now: NOW, there: "on your other Spoonjoy" }))
      .toEqual(expect.objectContaining({ outcome: "created" }));
  });

  it("stops at the first request with the token's own trouble when the token no longer works", async () => {
    const asked: Asked[] = [];
    const opening = openServerSource("spoonjoy-api", { address: OTHER, token: STALE_TOKEN, fetch: realSpoonjoy(asked) });
    await expect(opening).rejects.toBeInstanceOf(MoveInError);
    await expect(opening).rejects.toMatchObject({ code: "server-token" });
    // The app checks any token it is sent, on its health check too, so a revoked one is caught there.
    expect(asked.map(({ path }) => path)).toEqual(["/api/v1/health"]);
  });

  it("passes over a photo the app answers it doesn't have", async () => {
    const asked: Asked[] = [];
    const source = await openServerSource("spoonjoy-api", { address: OTHER, token: TOKEN, fetch: realSpoonjoy(asked) });
    const kitchen = (await source.openKitchen(COOK))!;
    const draft = { ...(await kitchen.draft(0)), photoPath: `/photos/recipes/${COOK}/gone.jpg` };
    await expect(kitchen.readPhoto(draft)).rejects.toThrow("the server has no photo for this recipe");
    expect(asked.at(-1)!.path).toBe(`/photos/recipes/${COOK}/gone.jpg`);
  });
});
