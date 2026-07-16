import { beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { createUserSessionCookie } from "~/lib/session.server";

const mocks = vi.hoisted(() => ({
  getRequestDb: vi.fn(),
  queryRawUnsafe: vi.fn(),
  recipeFindMany: vi.fn(),
  ingredientFindMany: vi.fn(),
  userFindUniqueOrThrow: vi.fn(),
}));

vi.mock("~/lib/route-platform.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/route-platform.server")>()),
  getRequestDb: mocks.getRequestDb,
}));

import { loader } from "~/routes/my-recipes";

async function authedRequest(url: string, userId = "owner_query_boundary") {
  return new UndiciRequest(url, {
    headers: { Cookie: (await createUserSessionCookie(userId)).split(";")[0] },
  }) as unknown as Request;
}

describe("My Recipes loader query boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userFindUniqueOrThrow.mockResolvedValue({
      id: "owner_query_boundary",
      username: "owner_boundary",
    });
    mocks.queryRawUnsafe.mockResolvedValue([
      {
        id: "matched_recipe",
        title: "Matched Sumac",
        description: "Database-side match",
        servings: "2",
      },
    ]);
    mocks.recipeFindMany.mockResolvedValue(
      Array.from({ length: 250 }, (_, index) => ({
        id: `unbounded_${index}`,
        title: index === 249 ? "Matched Sumac" : `Recipe ${index}`,
        description: null,
        servings: null,
      })),
    );
    mocks.ingredientFindMany.mockResolvedValue([]);
    mocks.getRequestDb.mockResolvedValue({
      $queryRawUnsafe: mocks.queryRawUnsafe,
      user: { findUniqueOrThrow: mocks.userFindUniqueOrThrow },
      recipe: { findMany: mocks.recipeFindMany },
      ingredient: { findMany: mocks.ingredientFindMany },
    });
  });

  it("uses a bounded SQL search instead of materializing and filtering the full owner corpus", async () => {
    const result = await loader({
      request: await authedRequest("http://localhost/my-recipes?q=sumac&page=1"),
      context: { cloudflare: { env: null } },
      params: {},
    } as any);

    expect(result.recipes).toHaveLength(1);
    expect(result.recipes[0]).toMatchObject({ id: "matched_recipe", title: "Matched Sumac" });
    expect(mocks.queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(mocks.recipeFindMany).not.toHaveBeenCalled();
    expect(mocks.ingredientFindMany).not.toHaveBeenCalled();
  });
});
