import { beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { faker } from "@faker-js/faker";
import { action as apiAction } from "~/routes/api.$";
import { action as putAction, loader as putLoader } from "~/routes/api.photo-uploads.$uploadId";
import { createApiCredential } from "~/lib/api-auth.server";
import { getLocalDb } from "~/lib/db.server";
import { captureException } from "~/lib/analytics-server";
import { PHOTO_UPLOAD_REFUSAL } from "~/lib/photo-upload-link.server";
import { callSpoonjoyApiOperation } from "~/lib/spoonjoy-api.server";
import { cleanupDatabase } from "../helpers/cleanup";

vi.mock("~/lib/analytics-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/analytics-server")>()),
  captureEvent: vi.fn(async () => undefined),
  captureException: vi.fn(async () => undefined),
}));

// A synthetic JPEG's first bytes: the signature Spoonjoy checks, then an empty quantization table and the end marker.
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9]);

// What the tests read from an answer: Spoonjoy's tool envelope or a PUT link's body.
type Answer = { ok?: boolean; data?: Record<string, string> & { maxBytes?: number }; error?: { message?: string; code?: string } } & Record<string, unknown>;

function memoryBucket() {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    put: vi.fn(async (key: string, value: Blob | ArrayBuffer | ArrayBufferView) => {
      objects.set(key, value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : new Uint8Array(value as ArrayBuffer));
      return {};
    }),
    get: vi.fn(async (key: string) => {
      const bytes = objects.get(key);
      return bytes ? { body: bytes, size: bytes.byteLength, httpEtag: '"e"', httpMetadata: {} } : null;
    }),
    head: vi.fn(async (key: string) => (objects.has(key) ? { key } : null)),
    delete: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    }),
  };
}

describe("photo upload links over HTTP", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;
  let bucket: ReturnType<typeof memoryBucket>;
  let env: Record<string, unknown>;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
    bucket = memoryBucket();
    env = { PHOTOS: bucket, SPOONJOY_BASE_URL: "https://spoonjoy.test", SESSION_SECRET: "route-test-secret" };
  });

  function context() {
    return { cloudflare: { env, ctx: { waitUntil: vi.fn() } } };
  }

  async function chef() {
    const user = await db.user.create({
      data: { email: `photo-${faker.string.alphanumeric(8).toLowerCase()}@example.com`, username: `photo_${faker.string.alphanumeric(8).toLowerCase()}` },
    });
    const { token } = await createApiCredential(db, user.id, "Photo upload test", { scopes: ["kitchen:read", "kitchen:write"] });
    return { user, token };
  }

  async function tool(token: string, name: string, args: Record<string, unknown>) {
    const response = await apiAction({
      request: new UndiciRequest(`https://spoonjoy.test/api/tools/${name}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(args),
      }),
      params: { "*": `tools/${name}` },
      context: context(),
    } as never) as Response;
    return { status: response.status, body: await response.json() as Answer };
  }

  async function putPhoto(putUrl: string, bytes: Uint8Array) {
    const uploadId = new URL(putUrl).pathname.split("/").pop()!;
    // What `curl -T photo.jpg "$putUrl"` sends: the raw bytes, no Authorization and no Content-Type.
    const response = await putAction({
      request: new Request(putUrl, { method: "PUT", body: bytes }),
      params: { uploadId },
      context: context(),
    } as never);
    return { status: response.status, body: await response.json() as Answer };
  }

  it("starts an upload, takes the PUT, and turns it into a spoon photo and a recipe cover", async () => {
    const { user, token } = await chef();
    const recipe = await db.recipe.create({ data: { title: `Synthetic loaf ${faker.string.alphanumeric(6)}`, chefId: user.id } });

    const started = await tool(token, "start_photo_upload", {});
    expect(started.status).toBe(200);
    const link = started.body.data!;
    expect(link).toMatchObject({ uploadId: expect.stringMatching(/^pu_/), maxBytes: 5 * 1024 * 1024, mimeTypes: ["image/jpeg", "image/png", "image/webp"] });
    expect(link.putUrl).toMatch(new RegExp(`^https://spoonjoy\\.test/api/photo-uploads/${link.uploadId}\\?exp=\\d+&sig=`));

    await expect(putPhoto(link.putUrl, JPEG)).resolves.toEqual({ status: 200, body: { uploadId: link.uploadId, status: "uploaded", mimeType: "image/jpeg", sizeBytes: JPEG.length } });
    await expect(putPhoto(link.putUrl, JPEG)).resolves.toMatchObject({ status: 403 });

    const photo = await tool(token, "upload_spoon_photo", { uploadId: link.uploadId });
    expect(photo).toMatchObject({ status: 200, body: { ok: true, data: { mimeType: "image/jpeg", sizeBytes: JPEG.length } } });
    expect(photo.body.data!.imageUrl).toMatch(new RegExp(`^/photos/spoons/${user.id}/uploads/.+\\.jpg$`));

    const spoon = await tool(token, "create_spoon", { recipeId: recipe.id, photoUrl: photo.body.data!.imageUrl, note: "Synthetic cook" });
    expect(spoon).toMatchObject({ status: 200, body: { ok: true } });
    await expect(db.recipeSpoon.findFirstOrThrow({ where: { recipeId: recipe.id } })).resolves.toMatchObject({ photoUrl: photo.body.data!.imageUrl });

    // The same upload can't be used twice.
    await expect(tool(token, "upload_spoon_photo", { uploadId: link.uploadId })).resolves.toMatchObject({ status: 404, body: { ok: false, error: { message: PHOTO_UPLOAD_REFUSAL } } });

    const second = (await tool(token, "start_photo_upload", {})).body.data!;
    await putPhoto(second.putUrl, JPEG);
    const cover = await tool(token, "create_recipe_cover_from_upload", { recipeId: recipe.id, uploadId: second.uploadId, generateEditorial: false, activateWhenReady: true });
    expect(cover).toMatchObject({ status: 200, body: { ok: true } });
    const created = await db.recipeCover.findFirstOrThrow({ where: { recipeId: recipe.id, sourceType: "chef-upload" } });
    expect(created.imageUrl).toMatch(new RegExp(`^/photos/recipes/${user.id}/uploads/.+\\.jpg$`));
  });

  it("gives another chef's upload the same refusal as one that doesn't exist", async () => {
    const owner = await chef();
    const stranger = await chef();
    const link = (await tool(owner.token, "start_photo_upload", {})).body.data!;
    await putPhoto(link.putUrl, JPEG);

    const theirs = await tool(stranger.token, "upload_recipe_image", { uploadId: link.uploadId });
    const missing = await tool(stranger.token, "upload_recipe_image", { uploadId: "pu_ZZZZZZZZZZZZZZZZZZZZZZ" });
    expect(theirs).toEqual(missing);
    expect(theirs).toMatchObject({ status: 404, body: { ok: false, error: { message: PHOTO_UPLOAD_REFUSAL } } });

    const strangerRecipe = await db.recipe.create({ data: { title: `Stranger loaf ${faker.string.alphanumeric(6)}`, chefId: stranger.user.id } });
    const coverTheirs = await tool(stranger.token, "create_recipe_cover_from_upload", { recipeId: strangerRecipe.id, uploadId: link.uploadId, generateEditorial: false });
    const coverMissing = await tool(stranger.token, "create_recipe_cover_from_upload", { recipeId: strangerRecipe.id, uploadId: "pu_ZZZZZZZZZZZZZZZZZZZZZZ", generateEditorial: false });
    expect(coverTheirs).toEqual(coverMissing);

    // Still the owner's to use.
    await expect(tool(owner.token, "upload_recipe_image", { uploadId: link.uploadId })).resolves.toMatchObject({ status: 200 });
  });

  it("checks an upload on a dry run without spending it, and keeps a spoon's original with the spoon", async () => {
    const { user, token } = await chef();
    const recipe = await db.recipe.create({ data: { title: `Dry run loaf ${faker.string.alphanumeric(6)}`, chefId: user.id } });
    const link = (await tool(token, "start_photo_upload", {})).body.data!;
    await putPhoto(link.putUrl, JPEG);

    const dry = await tool(token, "create_recipe_cover_from_upload", { recipeId: recipe.id, uploadId: link.uploadId, dryRun: true });
    expect(dry).toMatchObject({ status: 200, body: { ok: true, data: { generationStatus: "dry_run" } } });
    await expect(db.photoUpload.findUniqueOrThrow({ where: { id: link.uploadId } })).resolves.toMatchObject({ status: "uploaded" });

    const posted = await tool(token, "create_recipe_cover_from_upload", { recipeId: recipe.id, uploadId: link.uploadId, postAsSpoon: true, generateEditorial: false, note: "Synthetic cook" });
    expect(posted).toMatchObject({ status: 200, body: { ok: true } });
    const spoon = await db.recipeSpoon.findFirstOrThrow({ where: { recipeId: recipe.id } });
    expect(spoon.photoUrl).toMatch(new RegExp(`^/photos/spoons/${user.id}/uploads/.+\\.jpg$`));
    await expect(db.recipeCover.findFirstOrThrow({ where: { recipeId: recipe.id, sourceSpoonId: spoon.id } })).resolves.toMatchObject({ imageUrl: spoon.photoUrl });
  });

  it("links to spoonjoy.app when the deployment names no base URL", async () => {
    const { user } = await chef();
    const link = await callSpoonjoyApiOperation("start_photo_upload", {}, {
      db,
      principal: { id: user.id, email: user.email, username: user.username, source: "bearer", scopes: ["kitchen:write"] },
      bucket: bucket as unknown as R2Bucket,
    }) as { putUrl: string };
    expect(new URL(link.putUrl).origin).toBe("https://spoonjoy.app");
  });

  it("asks for exactly one photo source", async () => {
    const { token } = await chef();
    await expect(tool(token, "upload_spoon_photo", { uploadId: "pu_ZZZZZZZZZZZZZZZZZZZZZZ", imageBase64: "AAAA", mimeType: "image/png", filename: "a.png" }))
      .resolves.toMatchObject({ status: 400, body: { error: { message: "Pass uploadId or imageBase64, not both" } } });
    await expect(tool(token, "upload_spoon_photo", { filename: "a.png" }))
      .resolves.toMatchObject({ status: 400, body: { error: { message: "uploadId or imageBase64 is required" } } });
    await expect(tool(token, "upload_spoon_photo", { imageBase64: "iVBORw0KGgoBAgM=", filename: "a.png" }))
      .resolves.toMatchObject({ status: 400, body: { error: { message: "mimeType is required" } } });
  });

  it("rate-limits by IP before reading the link, and reports a storage failure as retryable", async () => {
    env.API_IP_RATE_LIMITER = { limit: vi.fn(async () => ({ success: false })) };
    const limited = await putAction({
      request: new Request("https://spoonjoy.test/api/photo-uploads/pu_ZZZZZZZZZZZZZZZZZZZZZZ", { method: "PUT", body: JPEG, headers: { "CF-Connecting-IP": "203.0.113.7" } }),
      params: { uploadId: "pu_ZZZZZZZZZZZZZZZZZZZZZZ" },
      context: context(),
    } as never);
    expect(limited.status).toBe(429);
    delete env.API_IP_RATE_LIMITER;

    const { token } = await chef();
    const link = (await tool(token, "start_photo_upload", {})).body.data!;
    bucket.put.mockRejectedValueOnce(new Error("R2 down"));
    await expect(putPhoto(link.putUrl, JPEG)).resolves.toEqual({
      status: 500,
      body: { error: { code: "upload_failed", message: "The photo couldn't be stored. Try the same link again." } },
    });
    expect(captureException).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ route: "/api/photo-uploads/{uploadId}", method: "PUT" }));
    await expect(putPhoto(link.putUrl, JPEG)).resolves.toMatchObject({ status: 200 });

    // Production with no signing secret fails closed; without a Worker context (no waitUntil, no env), and with
    // telemetry failing, the failure is still answered.
    vi.mocked(captureException).mockRejectedValueOnce(new Error("PostHog down"));
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", "");
    const bare = await putAction({
      request: new Request(link.putUrl, { method: "PUT", body: JPEG }),
      params: { uploadId: link.uploadId },
      context: {},
    } as never);
    vi.unstubAllEnvs();
    expect(bare.status).toBe(500);
  });

  it("answers anything but a PUT with 405, and a rejected link without touching storage", async () => {
    const post = await putAction({
      request: new Request("https://spoonjoy.test/api/photo-uploads/pu_ZZZZZZZZZZZZZZZZZZZZZZ", { method: "POST", body: JPEG }),
      params: { uploadId: "pu_ZZZZZZZZZZZZZZZZZZZZZZ" },
      context: context(),
    } as never);
    expect(post.status).toBe(405);

    const response = await putLoader();
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("PUT");

    const forged = await putPhoto("https://spoonjoy.test/api/photo-uploads/pu_ZZZZZZZZZZZZZZZZZZZZZZ?exp=99999999999999&sig=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", JPEG);
    expect(forged.status).toBe(403);
    expect(bucket.put).not.toHaveBeenCalled();
  });
});
