import { beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";

const mocks = vi.hoisted(() => ({
  recipeFindMany: vi.fn(),
  getRequestDb: vi.fn(),
}));

vi.mock("~/lib/route-platform.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/route-platform.server")>()),
  getRequestDb: mocks.getRequestDb,
}));

import { handleApiV1Request } from "~/lib/api-v1.server";

async function readJson(response: Response) {
  return await response.json() as any;
}

describe("API v1 recipe list query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recipeFindMany.mockResolvedValue([
      {
        id: "recipe_1",
        title: "Tiny-device pasta",
        description: "Summary-safe recipe",
        servings: "2",
        sourceUrl: null,
        sourceRecipe: null,
        activeCover: null,
        chef: { id: "chef_1", username: "ari" },
        createdAt: new Date("2026-06-01T12:00:00.000Z"),
        updatedAt: new Date("2026-06-01T12:30:00.000Z"),
      },
    ]);
    mocks.getRequestDb.mockResolvedValue({
      recipe: { findMany: mocks.recipeFindMany },
    });
  });

  it("uses a summary-only select instead of loading detail relations", async () => {
    const response = await handleApiV1Request({
      request: new UndiciRequest("http://localhost/api/v1/recipes?limit=1", {
        headers: { "X-Request-Id": "req_recipe_summary_query" },
      }) as unknown as Request,
      params: { "*": "recipes" },
      context: { cloudflare: { env: null } },
    });

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toMatchObject({
      ok: true,
      requestId: "req_recipe_summary_query",
      data: {
        recipes: [{
          id: "recipe_1",
          title: "Tiny-device pasta",
          chef: { id: "chef_1", username: "ari" },
        }],
      },
    });
    expect(mocks.recipeFindMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        id: true,
        title: true,
        description: true,
        servings: true,
        sourceUrl: true,
        createdAt: true,
        updatedAt: true,
        chef: { select: { id: true, username: true } },
        sourceRecipe: {
          select: {
            id: true,
            title: true,
            deletedAt: true,
            chef: { select: { id: true, username: true } },
          },
        },
        activeCover: {
          select: expect.objectContaining({
            id: true,
            recipeId: true,
            imageUrl: true,
            stylizedImageUrl: true,
            status: true,
            archivedAt: true,
          }),
        },
      }),
    }));
    expect(mocks.recipeFindMany.mock.calls[0][0]).not.toHaveProperty("include");
  });
});
