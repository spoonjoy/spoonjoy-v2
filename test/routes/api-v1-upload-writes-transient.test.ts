// @vitest-environment node
// A recipe image upload's own writes when D1's connection drops: linking the cover to the cook
// it was posted as, the upload's finished marker, removing that marker and undoing the upload
// when a later step fails, and releasing an upload whose Worker died. After each outcome (the
// write never ran, it committed but its answer was lost, or it committed late) the rows are the
// ones a single clean run leaves.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { FormData as UndiciFormData, Request as UndiciRequest } from "undici";
import type { PrismaClient } from "@prisma/client";
import { action } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import { hashIdempotencyRequest, reserveIdempotencyKey } from "~/lib/api-idempotency.server";
import * as placeholderCoverModule from "~/lib/ai-placeholder-cover.server";
import { getLocalDb } from "~/lib/db.server";
import * as recipeCoverModule from "~/lib/recipe-cover.server";
import * as recipeCoverServiceModule from "~/lib/recipe-cover-service.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { NETWORK_LOST_MESSAGE, type FlakyOutcome } from "../helpers/flaky-d1";
import { createTestRecipe, createTestUser } from "../utils";
import { expectConsoleError } from "../warning-policy";

const OUTCOMES: FlakyOutcome[] = ["lost", "lost-answer", "late"];
const GIVE_UP: FlakyOutcome[] = ["lost", "lost", "lost", "lost"];
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type Delegate = Record<string, (...args: unknown[]) => Promise<unknown>>;
const restores: Array<() => void> = [];

/**
 * Fails the next calls of `model.method` whose argument `matches`, one outcome each, as
 * test/helpers/flaky-prisma.ts does for every call: before the call ran ("lost"), after it
 * committed ("lost-answer"), or committing just before the next call of the method ("late"). The
 * argument check tells the upload's own write apart from the idempotency runner's calls of the
 * same method.
 */
function failNext(db: PrismaClient, model: string, method: string, matches: (args: any) => boolean, ...outcomes: FlakyOutcome[]) {
  const delegate = (db as unknown as Record<string, Delegate>)[model]!;
  const original = delegate[method]!;
  const call = (args: unknown[]) => original.apply(delegate, args);
  let late: (() => Promise<unknown>) | null = null;
  let failed = 0;
  delegate[method] = async (...args: unknown[]) => {
    if (late) {
      const landing = late;
      late = null;
      await landing();
    }
    if (outcomes.length === 0 || !matches(args[0])) return call(args);
    const outcome = outcomes.shift()!;
    failed += 1;
    if (outcome === "lost-answer") await call(args);
    if (outcome === "late") late = () => call(args);
    throw new Error(NETWORK_LOST_MESSAGE);
  };
  restores.push(() => {
    delegate[method] = original;
  });
  return { failures: () => failed };
}

const any = () => true;

function photoBucket() {
  const keys = new Set<string>();
  return {
    keys,
    bucket: {
      put: vi.fn(async (key: string) => {
        keys.add(key);
      }),
      get: vi.fn(async (key: string) => (keys.has(key) ? { key } : null)),
      delete: vi.fn(async (key: string) => {
        keys.delete(key);
      }),
    } as unknown as R2Bucket,
  };
}

let db: PrismaClient;
let recipeId: string;
let token: string;

function upload(requestId: string, clientMutationId: string, bucket: R2Bucket, fields: Record<string, string> = {}) {
  const formData = new UndiciFormData();
  formData.append("clientMutationId", clientMutationId);
  formData.append("photo", new File([PNG_BYTES], "dish.png", { type: "image/png" }));
  formData.append("postAsSpoon", "true");
  formData.append("note", "Posted dinner");
  formData.append("activate", "false");
  formData.append("generateEditorial", "false");
  for (const [name, value] of Object.entries(fields)) formData.set(name, value);
  const request = new UndiciRequest(`http://localhost/api/v1/recipes/${recipeId}/image`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "X-Request-Id": requestId },
    body: formData,
    duplex: "half",
  }) as unknown as Request;
  const context = {
    cloudflare: {
      env: { PHOTOS: bucket },
      ctx: { waitUntil: (promise: Promise<unknown>) => void promise.catch(() => undefined) },
    },
  };
  return action({ request, params: { "*": `recipes/${recipeId}/image` }, context } as any);
}

async function rows() {
  return {
    covers: await db.recipeCover.findMany({ where: { recipeId }, select: { id: true, sourceSpoonId: true } }),
    spoons: await db.recipeSpoon.findMany({ where: { recipeId }, select: { id: true } }),
    markers: await db.apiMutationTombstone.count(),
  };
}

beforeEach(async () => {
  await cleanupDatabase();
  db = await getLocalDb();
  const owner = await db.user.create({ data: createTestUser() });
  recipeId = (await db.recipe.create({
    data: { ...createTestRecipe(owner.id), title: `Upload retry ${faker.string.alphanumeric(8)}` },
  })).id;
  token = (await createApiCredential(db, owner.id, "Upload retry", { scopes: ["kitchen:write"] })).token;
});

afterEach(async () => {
  while (restores.length > 0) restores.pop()!();
  vi.restoreAllMocks();
  await cleanupDatabase();
});

describe("recipe image upload writes after a transient D1 error", () => {
  it.each(OUTCOMES)("links the cover to its cook once (%s)", async (outcome) => {
    const flaky = failNext(db, "recipeCover", "update", (args) => args?.data?.sourceSpoonId !== undefined, outcome);
    const response = await upload(`req_link_${outcome}`, `link-${outcome}`, photoBucket().bucket);

    expect(response.status).toBe(201);
    expect(flaky.failures()).toBe(1);
    const { covers, spoons } = await rows();
    expect(spoons).toHaveLength(1);
    expect(covers).toEqual([{ id: expect.any(String), sourceSpoonId: spoons[0]!.id }]);
  });

  it.each(OUTCOMES)("writes the upload's finished marker once (%s)", async (outcome) => {
    const flaky = failNext(db, "apiMutationTombstone", "create", any, outcome);
    const response = await upload(`req_mark_${outcome}`, `mark-${outcome}`, photoBucket().bucket);

    expect(response.status).toBe(201);
    expect(flaky.failures()).toBe(1);
    await expect(rows()).resolves.toMatchObject({ markers: 1, covers: [expect.anything()], spoons: [expect.anything()] });
  });

  it("still answers the upload when its marker cannot be written, and logs it", async () => {
    expectConsoleError("[api-v1] write_finished_mark_failed", {
      operation: "recipes.image.upload",
      error: "The database was briefly unavailable, so api_marker.finish was not saved",
    });
    failNext(db, "apiMutationTombstone", "create", any, ...GIVE_UP);
    const response = await upload("req_mark_give_up", "mark-give-up", photoBucket().bucket);

    expect(response.status).toBe(201);
    await expect(rows()).resolves.toMatchObject({ markers: 0, covers: [expect.anything()], spoons: [expect.anything()] });
  });

  it.each(OUTCOMES)("removes the marker and undoes the upload when a later step fails (%s)", async (outcome) => {
    const queueError = new Error("queue failed");
    vi.spyOn(recipeCoverServiceModule, "scheduleRecipeCoverStylization").mockRejectedValue(queueError);
    expectConsoleError("[api-v1] internal_error", {
      requestId: `req_undo_${outcome}`,
      method: "POST",
      path: `/api/v1/recipes/${recipeId}/image`,
      error: { name: queueError.name, message: queueError.message, stack: queueError.stack },
    });
    const recipeBefore = await db.recipe.findUniqueOrThrow({ where: { id: recipeId }, select: { activeCoverId: true, coverMode: true } });
    const unmark = failNext(db, "apiMutationTombstone", "deleteMany", any, outcome);
    const coverDelete = failNext(db, "recipeCover", "deleteMany", any, outcome);
    const spoonDelete = failNext(db, "recipeSpoon", "deleteMany", any, outcome);
    const restore = failNext(db, "recipe", "update", (args) => "coverMode" in (args?.data ?? {}), outcome);
    const photos = photoBucket();

    const response = await upload(`req_undo_${outcome}`, `undo-${outcome}`, photos.bucket, { generateEditorial: "true" });

    expect(response.status).toBe(500);
    expect([unmark.failures(), coverDelete.failures(), spoonDelete.failures(), restore.failures()]).toEqual([1, 1, 1, 1]);
    await expect(rows()).resolves.toEqual({ covers: [], spoons: [], markers: 0 });
    await expect(db.recipe.findUniqueOrThrow({ where: { id: recipeId }, select: { activeCoverId: true, coverMode: true } }))
      .resolves.toEqual(recipeBefore);
    expect(photos.keys.size).toBe(0);
  });

  it("keeps the upload whole when the marker cannot be removed, and still answers a failed undo", async () => {
    vi.spyOn(recipeCoverServiceModule, "scheduleRecipeCoverStylization").mockRejectedValue(new Error("queue failed"));
    expectConsoleError("[api-v1] write_finished_unmark_failed", {
      operation: "recipes.image.upload",
      error: "The database was briefly unavailable, so api_marker.unmark was not saved",
    });
    failNext(db, "apiMutationTombstone", "deleteMany", any, ...GIVE_UP);

    const response = await upload("req_unmark_give_up", "unmark-give-up", photoBucket().bucket, { generateEditorial: "true" });

    expect(response.status).toBe(201);
    await expect(rows()).resolves.toMatchObject({ markers: 1, covers: [expect.anything()], spoons: [expect.anything()] });
  });

  it.each(OUTCOMES)("releases an upload whose Worker died, once (%s)", async (outcome) => {
    let reached = false;
    vi.spyOn(recipeCoverModule, "setActiveRecipeCover").mockImplementationOnce(() => {
      reached = true;
      return new Promise<never>(() => undefined);
    });
    const photos = photoBucket();
    const clientMutationId = `release-${outcome}`;
    void upload(`req_release_${outcome}_first`, clientMutationId, photos.bucket, { activate: "true" });
    await vi.waitFor(() => expect(reached).toBe(true));
    await db.apiIdempotencyKey.updateMany({ where: { key: clientMutationId }, data: { createdAt: new Date(Date.now() - 6 * 60_000) } });
    const spoonDelete = failNext(db, "recipeSpoon", "deleteMany", any, outcome);
    const coverDelete = failNext(db, "recipeCover", "deleteMany", any, outcome);
    const keyDelete = failNext(db, "apiIdempotencyKey", "deleteMany", (args) => args?.where?.responseStatus === null, outcome);

    const release = await upload(`req_release_${outcome}_release`, clientMutationId, photos.bucket, { activate: "true" });

    expect(release.status).toBe(409);
    expect([spoonDelete.failures(), coverDelete.failures(), keyDelete.failures()]).toEqual([1, 1, 1]);
    await expect(rows()).resolves.toMatchObject({ covers: [], spoons: [] });
    await expect(db.apiIdempotencyKey.count({ where: { key: clientMutationId } })).resolves.toBe(0);
  });

  it("answers a cook link the database never takes as a failure, and undoes the upload", async () => {
    failNext(db, "recipeCover", "update", (args) => args?.data?.sourceSpoonId !== undefined, ...GIVE_UP);
    // The logged error carries its stack; a fixed stack lets the warning policy match the line.
    const prepareStackTrace = Error.prepareStackTrace;
    Error.prepareStackTrace = () => "stack";
    expectConsoleError("[api-v1] internal_error", {
      requestId: "req_link_give_up",
      method: "POST",
      path: `/api/v1/recipes/${recipeId}/image`,
      error: {
        name: "D1WriteUnavailableError",
        message: "The database was briefly unavailable, so cover.link_spoon was not saved",
        stack: "stack",
      },
    });
    const photos = photoBucket();

    try {
      const response = await upload("req_link_give_up", "link-give-up", photos.bucket);

      expect(response.status).toBeGreaterThanOrEqual(500);
    } finally {
      Error.prepareStackTrace = prepareStackTrace;
    }
    await expect(rows()).resolves.toEqual({ covers: [], spoons: [], markers: 0 });
    expect(photos.keys.size).toBe(0);
  });
});

describe("recovering a stopped recipe create after a transient D1 error", () => {
  // A create whose recipe committed but whose Worker stopped before it scheduled the placeholder
  // and wrote its finished marker; a retry past the cutoff claims the marker and schedules it.
  async function stoppedCreate(clientMutationId: string) {
    const owner = await db.recipe.findUniqueOrThrow({ where: { id: recipeId }, select: { chefId: true } });
    const credential = await db.apiCredential.findFirstOrThrow({ where: { userId: owner.chefId } });
    const body = {
      clientMutationId,
      title: `Placeholder Soup ${faker.string.alphanumeric(8)}`,
      description: "A soup",
      steps: [{ stepTitle: null, description: "Simmer", duration: null, ingredients: [] }],
    };
    const reserved = await reserveIdempotencyKey(db, {
      userId: owner.chefId,
      credentialId: credential.id,
      clientKey: `chef:${owner.chefId}`,
      key: clientMutationId,
      operation: "recipes.create",
      requestHash: await hashIdempotencyRequest({ method: "POST", path: "/api/v1/recipes", body }),
    });
    if (reserved.status !== "reserved") throw new Error("expected idempotency reservation");
    const id = reserved.record.id;
    await db.recipe.create({ data: { id, chefId: owner.chefId, title: body.title, description: body.description } });
    await db.recipeCover.create({
      data: { recipeId: id, imageUrl: "", sourceType: "ai-placeholder", status: "processing", generationStatus: "processing", createdById: owner.chefId },
    });
    await db.apiIdempotencyKey.update({ where: { id }, data: { createdAt: new Date(Date.now() - 60_000) } });
    return { body, id };
  }

  function retryCreate(requestId: string, body: unknown) {
    const request = new UndiciRequest("http://localhost/api/v1/recipes", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Request-Id": requestId },
      body: JSON.stringify(body),
    }) as unknown as Request;
    return action({ request, params: { "*": "recipes" }, context: { cloudflare: { env: null } } } as any);
  }

  it.each(OUTCOMES)("claims the marker once and schedules the placeholder once (%s)", async (outcome) => {
    const placeholder = vi.spyOn(placeholderCoverModule, "scheduleAiPlaceholderCover").mockResolvedValue(undefined);
    const { body, id } = await stoppedCreate(`claim-${outcome}`);
    const flaky = failNext(db, "apiMutationTombstone", "create", any, outcome);

    const retry = await retryCreate(`req_claim_${outcome}`, body);

    expect(retry.status).toBe(201);
    expect(flaky.failures()).toBe(1);
    expect(placeholder).toHaveBeenCalledTimes(1);
    await expect(db.apiMutationTombstone.count({ where: { idempotencyKeyId: id } })).resolves.toBe(1);
  });

  it("schedules the placeholder without the marker when the claim cannot be written, and logs it", async () => {
    const placeholder = vi.spyOn(placeholderCoverModule, "scheduleAiPlaceholderCover").mockResolvedValue(undefined);
    expectConsoleError("[api-v1] write_finished_mark_failed", {
      operation: "recipes.create",
      error: "The database was briefly unavailable, so api_marker.claim was not saved",
    });
    const { body, id } = await stoppedCreate("claim-give-up");
    failNext(db, "apiMutationTombstone", "create", any, ...GIVE_UP);

    const retry = await retryCreate("req_claim_give_up", body);

    expect(retry.status).toBe(201);
    expect(placeholder).toHaveBeenCalledTimes(1);
    await expect(db.apiMutationTombstone.count({ where: { idempotencyKeyId: id } })).resolves.toBe(0);
  });
});
