// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { FormData as UndiciFormData, Request as UndiciRequest } from "undici";
import { createApiCredential, type ApiPrincipal } from "~/lib/api-auth.server";
import { getLocalDb } from "~/lib/db.server";
import { handleRecipeDetailAction } from "~/lib/recipe-detail.server";
import { createUserSessionCookie } from "~/lib/session.server";
import { callSpoonjoyApiOperation } from "~/lib/spoonjoy-api.server";
import { action as apiV1Action } from "~/routes/api.v1.$";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser } from "../utils";

// Regenerating a cover used to rewrite that cover's row: its stylized image was replaced by the
// new one, and its parentCoverId was set to itself, so the history kept no trace of the image
// before. Each regeneration now adds a child cover (parentCoverId = the regenerated cover) and
// leaves the regenerated cover as it was. This holds on the web, API v1 and MCP.

const FIRST_STYLE = "/photos/covers/first-style.png";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

let db: PrismaClient;
let chef: { id: string; email: string; username: string };
let recipeId: string;
let parentId: string;

function background() {
  const pending: Promise<unknown>[] = [];
  return { pending, ctx: { waitUntil: (promise: Promise<unknown>) => pending.push(promise.catch(() => undefined)) } };
}

async function parent() {
  return db.recipeCover.findUniqueOrThrow({ where: { id: parentId } });
}

async function children() {
  return db.recipeCover.findMany({ where: { parentCoverId: parentId, id: { not: parentId } } });
}

async function activeCover() {
  return db.recipe.findUniqueOrThrow({ where: { id: recipeId }, select: { activeCoverId: true, activeCoverVariant: true } });
}

/** The regenerated cover is exactly as it was: its images, status and lineage. */
async function expectParentUntouched() {
  expect(await parent()).toMatchObject({
    imageUrl: "/photos/covers/original.jpg",
    stylizedImageUrl: FIRST_STYLE,
    status: "ready",
    generationStatus: "succeeded",
    parentCoverId: null,
    promptAddition: null,
  });
}

describe("regenerating a recipe cover", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    chef = await db.user.create({ data: createTestUser() });
    recipeId = (await db.recipe.create({ data: { title: "Roast Chicken", chefId: chef.id } })).id;
    parentId = (await db.recipeCover.create({
      data: {
        recipeId,
        imageUrl: "/photos/covers/original.jpg",
        stylizedImageUrl: FIRST_STYLE,
        sourceType: "chef-upload",
        status: "ready",
        generationStatus: "succeeded",
        createdById: chef.id,
      },
    })).id;
    await db.recipe.update({ where: { id: recipeId }, data: { activeCoverId: parentId, activeCoverVariant: "stylized", coverMode: "manual" } });
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("on the web, adds a child cover and keeps the regenerated cover's image", async () => {
    const form = new UndiciFormData();
    form.append("intent", "regenerateRecipeCover");
    form.append("coverId", parentId);
    form.append("activateWhenReady", "true");
    form.append("promptAddition", "more golden");
    const cookie = (await createUserSessionCookie(chef.id)).split(";")[0]!;
    const { pending, ctx } = background();

    const result = await handleRecipeDetailAction({
      request: new UndiciRequest(`http://localhost/recipes/${recipeId}`, { method: "POST", headers: { Cookie: cookie }, body: form }) as unknown as Request,
      params: { id: recipeId },
      context: { cloudflare: { env: null, ctx } } as never,
    });

    const [child] = await children();
    expect(result).toEqual({ success: true, intent: "regenerateRecipeCover", coverId: child!.id });
    expect(child).toMatchObject({
      recipeId,
      imageUrl: "/photos/covers/original.jpg",
      sourceImageUrl: "/photos/covers/original.jpg",
      sourceType: "chef-upload",
      status: "processing",
      generationStatus: "processing",
      promptAddition: "more golden",
      createdById: chef.id,
      stylizedImageUrl: null,
    });
    await expectParentUntouched();

    // No image provider here, so the regeneration fails: it is marked failed (not left as a
    // usable copy of its parent), and the recipe keeps showing the regenerated cover.
    await Promise.all(pending);
    expect(await db.recipeCover.findUniqueOrThrow({ where: { id: child!.id } })).toMatchObject({ status: "failed", generationStatus: "failed" });
    await expectParentUntouched();
    expect(await activeCover()).toEqual({ activeCoverId: parentId, activeCoverVariant: "stylized" });
  });

  it("on API v1, answers the child as createdCover", async () => {
    const token = (await createApiCredential(db, chef.id, "regenerate", { scopes: ["kitchen:write"] })).token;
    const { pending, ctx } = background();

    const response = await apiV1Action({
      request: new UndiciRequest(`http://localhost/api/v1/recipes/${recipeId}/covers/regenerate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ clientMutationId: "regen-1", coverId: parentId, activateWhenReady: true }),
      }) as unknown as Request,
      params: { "*": `recipes/${recipeId}/covers/regenerate` },
      context: { cloudflare: { env: null, ctx } },
    } as never);
    const body = await response.json() as { data: { createdCover: { id: string; generationStatus: string }; activeCover: { id: string } } };

    const [child] = await children();
    expect(response.status).toBe(200);
    expect(body.data.createdCover).toMatchObject({ id: child!.id, generationStatus: "processing" });
    expect(body.data.activeCover.id).toBe(parentId);
    await Promise.all(pending);
    await expectParentUntouched();
  });

  it("on MCP, makes the finished child the recipe's cover and keeps the regenerated cover in the history", async () => {
    const principal: ApiPrincipal = { id: chef.id, email: chef.email, username: chef.username, source: "bearer", scopes: ["recipes:read", "kitchen:write"] };
    const runner = { textToImage: vi.fn(), imageToImage: vi.fn().mockResolvedValue({ bytes: PNG, contentType: "image/png" }) };
    // The stylizer reads the source photo itself; a data URL needs no bucket.
    await db.recipeCover.update({ where: { id: parentId }, data: { sourceImageUrl: `data:image/png;base64,${Buffer.from(PNG).toString("base64")}` } });

    const answer = await callSpoonjoyApiOperation(
      "regenerate_recipe_cover",
      { recipeId, coverId: parentId, activateWhenReady: true, idempotencyKey: "regen-mcp-1" },
      { db, principal, allowLocalImageFallback: true, imageGenRunner: runner },
    ) as { createdCover: { id: string }; activeCover: { id: string; activeVariant: string } };

    const [child] = await children();
    expect(answer.createdCover.id).toBe(child!.id);
    expect(answer.activeCover).toMatchObject({ id: child!.id, activeVariant: "stylized" });
    expect(child).toMatchObject({ status: "ready", generationStatus: "succeeded", stylizedImageUrl: expect.stringMatching(/^data:image\/png;base64,/) });
    await expectParentUntouched();

    // A second regeneration of the same cover is another child; the first one is kept too.
    await callSpoonjoyApiOperation(
      "regenerate_recipe_cover",
      { recipeId, coverId: parentId, activateWhenReady: false, idempotencyKey: "regen-mcp-2" },
      { db, principal, allowLocalImageFallback: true, imageGenRunner: runner },
    );
    expect(await children()).toHaveLength(2);
    expect(await activeCover()).toEqual({ activeCoverId: child!.id, activeCoverVariant: "stylized" });
  });

  it("regenerates a cover with no generated image in place, without pointing its lineage at itself", async () => {
    await db.recipeCover.update({ where: { id: parentId }, data: { stylizedImageUrl: null, generationStatus: "none" } });
    const token = (await createApiCredential(db, chef.id, "regenerate", { scopes: ["kitchen:write"] })).token;
    const { pending, ctx } = background();

    const response = await apiV1Action({
      request: new UndiciRequest(`http://localhost/api/v1/recipes/${recipeId}/covers/regenerate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ clientMutationId: "regen-plain", coverId: parentId, promptAddition: "brighter" }),
      }) as unknown as Request,
      params: { "*": `recipes/${recipeId}/covers/regenerate` },
      context: { cloudflare: { env: null, ctx } },
    } as never);
    const body = await response.json() as { data: { createdCover: { id: string } } };
    await Promise.all(pending);

    expect(body.data.createdCover.id).toBe(parentId);
    expect(await children()).toHaveLength(0);
    // Generation fails here (no provider); the photo is still usable and nothing was lost.
    expect(await parent()).toMatchObject({ imageUrl: "/photos/covers/original.jpg", status: "ready", generationStatus: "failed", promptAddition: "brighter", parentCoverId: null });
  });
});
