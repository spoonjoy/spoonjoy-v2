// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { FormData as UndiciFormData, Request as UndiciRequest } from "undici";
import { getLocalDb } from "~/lib/db.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";

// The recipe page starts cover stylization in the background. With the request's D1 binding,
// that stylization must write through its atomic D1 batches, so the page has to hand it the
// binding along with the image-generation settings.

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

const { handleRecipeDetailAction } = await import("~/lib/recipe-detail.server");

let db: PrismaClient;
let d1: SqliteD1;

async function authedPost(userId: string, recipeId: string, formData: UndiciFormData) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  const cookie = (await sessionStorage.commitSession(session)).split(";")[0];
  return new UndiciRequest(`http://localhost/recipes/${recipeId}`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: formData,
  });
}

describe("recipe page stylization on a D1 binding", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    mocked.db = db;
    await cleanupDatabase();
    d1 = sqliteD1();
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  it("hands the D1 binding to the background stylization a cover regeneration starts", async () => {
    const chef = await db.user.create({ data: { email: "page-d1@example.com", username: "page_d1" } });
    const recipe = await db.recipe.create({ data: { title: "D1 Regeneration", chefId: chef.id } });
    const cover = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/covers/d1-display.jpg",
        sourceImageUrl: "/photos/covers/d1-source.jpg",
        sourceType: "chef-upload",
        status: "ready",
      },
    });
    const formData = new UndiciFormData();
    formData.append("intent", "regenerateRecipeCover");
    formData.append("coverId", cover.id);
    const captured: Promise<unknown>[] = [];

    const result = await handleRecipeDetailAction({
      request: await authedPost(chef.id, recipe.id, formData) as unknown as Request,
      params: { id: recipe.id },
      context: {
        cloudflare: {
          env: { DB: d1.binding },
          ctx: { waitUntil: (promise: Promise<unknown>) => captured.push(promise) },
        },
      } as never,
    });
    expect(result).toEqual({ success: true, intent: "regenerateRecipeCover", coverId: cover.id });
    expect(captured).toHaveLength(1);
    await Promise.all(captured);

    // The request's own regeneration write, then the job's processing and failed updates (no image
    // provider is configured): each a D1 batch.
    const coverWrites = d1.statements.filter((statement) => statement.sql.includes('UPDATE "RecipeCover"'));
    expect(coverWrites.length).toBe(3);
    expect(coverWrites[0].sql).toContain('"generationStartedAt" = ?');
    await expect(db.recipeCover.findUniqueOrThrow({ where: { id: cover.id } })).resolves.toMatchObject({
      generationStatus: "failed",
    });
  });
});
