import { faker } from "@faker-js/faker";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { cleanupDatabase } from "../helpers/cleanup";

const mocks = vi.hoisted(() => {
  return {
    create: vi.fn(async (_element: unknown, options: { headers?: Record<string, string>; width?: number; height?: number }) =>
      new Response("PNG", {
        headers: {
          "Content-Type": "image/png",
          "X-OG-Width": String(options.width),
          "X-OG-Height": String(options.height),
          ...options.headers,
        },
      }),
    ),
    setExecutionContext: vi.fn(),
    GoogleFont: vi.fn(function GoogleFont(
      this: { name: string; data: Promise<ArrayBuffer>; weight?: number; style?: string },
      family: string,
      options?: { weight?: number; style?: string },
    ) {
      this.name = family;
      this.data = Promise.resolve(new ArrayBuffer(0));
      this.weight = options?.weight;
      this.style = options?.style;
    }),
  };
});

vi.mock("cf-workers-og/workerd", () => ({
  ImageResponse: { create: mocks.create },
  cache: { setExecutionContext: mocks.setExecutionContext },
  GoogleFont: mocks.GoogleFont,
}));

import { loader as recipeOgLoader } from "~/routes/og.recipes.$id.png";
import { loader as cookbookOgLoader } from "~/routes/og.cookbooks.$id.png";

function uniqueEmail(prefix: string) {
  return `${prefix}-${faker.string.alphanumeric(8).toLowerCase()}@example.com`;
}

describe("dynamic OG image routes", () => {
  let userId: string;

  beforeEach(async () => {
    mocks.create.mockClear();
    mocks.setExecutionContext.mockClear();
    mocks.GoogleFont.mockClear();
    await cleanupDatabase();
    const user = await createUser(
      db,
      uniqueEmail("og"),
      `og_${faker.string.alphanumeric(8).toLowerCase()}`,
      "testPassword123",
    );
    userId = user.id;
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("renders an on-demand PNG card for a public recipe", async () => {
    const recipe = await db.recipe.create({
      data: {
        title: "OG Tomato Toast",
        description: "Tomatoes, toast, and just enough oil.",
        servings: "2",
        chefId: userId,
      },
    });
    await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/tomato.jpg",
        sourceType: "chef-upload",
      },
    });

    const response = await recipeOgLoader({
      request: new Request(`https://spoonjoy.app/og/recipes/${recipe.id}.png`),
      params: { id: recipe.id },
      context: { cloudflare: { env: null, ctx: { waitUntil: vi.fn() } } },
    } as any);

    expect(await response.text()).toBe("PNG");
    expect(response.headers.get("Content-Type")).toContain("image/png");
    expect(response.headers.get("X-OG-Width")).toBe("1200");
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("404s recipe OG cards for missing or deleted recipes", async () => {
    const deletedRecipe = await db.recipe.create({
      data: {
        title: "Deleted Toast",
        chefId: userId,
        deletedAt: new Date(),
      },
    });

    await expect(
      recipeOgLoader({
        request: new Request(`https://spoonjoy.app/og/recipes/${deletedRecipe.id}.png`),
        params: { id: deletedRecipe.id },
        context: { cloudflare: { env: null } },
      } as any),
    ).rejects.toMatchObject({ status: 404 });

    await expect(
      recipeOgLoader({
        request: new Request("https://spoonjoy.app/og/recipes/missing.png"),
        params: { id: "missing" },
        context: { cloudflare: { env: null } },
      } as any),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("renders an on-demand PNG card for a cookbook with active recipe covers", async () => {
    const cookbook = await db.cookbook.create({
      data: { title: "OG Weeknights", authorId: userId },
    });
    const activeRecipe = await db.recipe.create({
      data: { title: "Active Supper", chefId: userId },
    });
    const deletedRecipe = await db.recipe.create({
      data: { title: "Deleted Supper", chefId: userId, deletedAt: new Date() },
    });
    await db.recipeCover.create({
      data: {
        recipeId: activeRecipe.id,
        imageUrl: "https://cdn.example.com/supper.jpg",
        sourceType: "chef-upload",
      },
    });
    await db.recipeInCookbook.createMany({
      data: [
        { cookbookId: cookbook.id, recipeId: activeRecipe.id, addedById: userId },
        { cookbookId: cookbook.id, recipeId: deletedRecipe.id, addedById: userId },
      ],
    });

    const response = await cookbookOgLoader({
      request: new Request(`https://spoonjoy.app/og/cookbooks/${cookbook.id}.png`),
      params: { id: cookbook.id },
      context: { cloudflare: { env: null } },
    } as any);

    expect(response.headers.get("Content-Type")).toContain("image/png");
    expect(await response.text()).toBe("PNG");
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("404s cookbook OG cards for missing cookbooks", async () => {
    await expect(
      cookbookOgLoader({
        request: new Request("https://spoonjoy.app/og/cookbooks/missing.png"),
        params: { id: "missing" },
        context: { cloudflare: { env: null } },
      } as any),
    ).rejects.toMatchObject({ status: 404 });
  });
});
