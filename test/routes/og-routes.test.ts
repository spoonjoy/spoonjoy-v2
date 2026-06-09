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
import { loader as pageOgLoader } from "~/routes/og.pages.$slug.png";

function uniqueEmail(prefix: string) {
  return `${prefix}-${faker.string.alphanumeric(8).toLowerCase()}@example.com`;
}

function imageSourcesIn(node: unknown): string[] {
  if (!node || typeof node !== "object") return [];
  const element = node as {
    type?: unknown;
    props?: { src?: unknown; children?: unknown };
  };
  const current = element.type === "img" && typeof element.props?.src === "string"
    ? [element.props.src]
    : [];
  const children = element.props?.children;
  if (Array.isArray(children)) {
    return [...current, ...children.flatMap(imageSourcesIn)];
  }
  return [...current, ...imageSourcesIn(children)];
}

function latestOgImageSources() {
  const element = mocks.create.mock.calls.at(-1)?.[0];
  return imageSourcesIn(element);
}

function expectDynamicOgFreshness(response: Response) {
  const coverKey = response.headers.get("X-Spoonjoy-OG-Cover-Key");
  expect(response.headers.get("Cache-Control")).toBe("public, no-cache, must-revalidate");
  expect(coverKey).toMatch(/^W\/"og-[a-f0-9]+-\d+"$/);
  expect(response.headers.get("ETag")).toBe(coverKey);
  return coverKey;
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

  it("renders on-demand PNG cards for developer pages", async () => {
    for (const slug of ["api", "api-playground"]) {
      mocks.create.mockClear();
      const response = await pageOgLoader({
        request: new Request(`https://spoonjoy.app/og/pages/${slug}.png`),
        params: { slug },
        context: { cloudflare: { env: null, ctx: { waitUntil: vi.fn() } } },
      } as any);

      expect(await response.text()).toBe("PNG");
      expect(response.headers.get("Content-Type")).toContain("image/png");
      expect(response.headers.get("X-OG-Width")).toBe("1200");
      expect(response.headers.get("X-OG-Height")).toBe("630");
      expect(mocks.create).toHaveBeenCalledTimes(1);
    }
  });

  it("404s unknown developer page OG cards", async () => {
    await expect(
      pageOgLoader({
        request: new Request("https://spoonjoy.app/og/pages/missing.png"),
        params: { slug: "missing" },
        context: { cloudflare: { env: null } },
      } as any),
    ).rejects.toMatchObject({ status: 404 });
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
    const activeCover = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/tomato.jpg",
        stylizedImageUrl: "/photos/tomato-editorial.jpg",
        sourceType: "chef-upload",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/tomato-newer-archived.jpg",
        sourceType: "import",
        status: "archived",
        archivedAt: new Date("2026-01-02T00:00:00.000Z"),
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    });
    await db.recipe.update({
      where: { id: recipe.id },
      data: { activeCoverId: activeCover.id, activeCoverVariant: "stylized", coverMode: "manual" },
    });

    const response = await recipeOgLoader({
      request: new Request(`https://spoonjoy.app/og/recipes/${recipe.id}.png`),
      params: { id: recipe.id },
      context: { cloudflare: { env: null, ctx: { waitUntil: vi.fn() } } },
    } as any);

    expect(await response.text()).toBe("PNG");
    expect(response.headers.get("Content-Type")).toContain("image/png");
    expect(response.headers.get("X-OG-Width")).toBe("1200");
    const firstCoverKey = expectDynamicOgFreshness(response);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(latestOgImageSources()).toContain("https://spoonjoy.app/photos/tomato-editorial.jpg");
    expect(latestOgImageSources()).not.toContain("https://spoonjoy.app/photos/tomato-newer-archived.jpg");

    mocks.create.mockClear();
    await db.recipe.update({
      where: { id: recipe.id },
      data: { activeCoverVariant: "image" },
    });
    const updatedResponse = await recipeOgLoader({
      request: new Request(`https://spoonjoy.app/og/recipes/${recipe.id}.png`),
      params: { id: recipe.id },
      context: { cloudflare: { env: null, ctx: { waitUntil: vi.fn() } } },
    } as any);

    const updatedCoverKey = expectDynamicOgFreshness(updatedResponse);
    expect(updatedCoverKey).not.toBe(firstCoverKey);
    expect(latestOgImageSources()).toContain("https://spoonjoy.app/photos/tomato.jpg");

    mocks.create.mockClear();
    await db.recipeCover.update({
      where: { id: activeCover.id },
      data: { status: "archived", archivedAt: new Date("2026-01-03T00:00:00.000Z") },
    });
    const archivedResponse = await recipeOgLoader({
      request: new Request(`https://spoonjoy.app/og/recipes/${recipe.id}.png`),
      params: { id: recipe.id },
      context: { cloudflare: { env: null, ctx: { waitUntil: vi.fn() } } },
    } as any);

    expect(expectDynamicOgFreshness(archivedResponse)).not.toBe(updatedCoverKey);
    expect(latestOgImageSources()).not.toContain("https://spoonjoy.app/photos/tomato.jpg");

    mocks.create.mockClear();
    await db.recipe.update({
      where: { id: recipe.id },
      data: { activeCoverId: null, activeCoverVariant: null, coverMode: "none" },
    });
    const noCoverResponse = await recipeOgLoader({
      request: new Request(`https://spoonjoy.app/og/recipes/${recipe.id}.png`),
      params: { id: recipe.id },
      context: { cloudflare: { env: null, ctx: { waitUntil: vi.fn() } } },
    } as any);

    expect(expectDynamicOgFreshness(noCoverResponse)).not.toBe(updatedCoverKey);
    expect(latestOgImageSources()).toEqual([]);
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
    const activeCover = await db.recipeCover.create({
      data: {
        recipeId: activeRecipe.id,
        imageUrl: "https://cdn.example.com/supper-raw.jpg",
        stylizedImageUrl: "https://cdn.example.com/supper-editorial.jpg",
        sourceType: "chef-upload",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    await db.recipeCover.create({
      data: {
        recipeId: activeRecipe.id,
        imageUrl: "https://cdn.example.com/supper-newer-empty.jpg",
        stylizedImageUrl: "",
        sourceType: "ai-placeholder",
        status: "archived",
        archivedAt: new Date("2026-01-02T00:00:00.000Z"),
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    });
    await db.recipe.update({
      where: { id: activeRecipe.id },
      data: { activeCoverId: activeCover.id, activeCoverVariant: "stylized", coverMode: "manual" },
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
    const firstCoverKey = expectDynamicOgFreshness(response);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(latestOgImageSources()).toContain("https://cdn.example.com/supper-editorial.jpg");
    expect(latestOgImageSources()).not.toContain("https://cdn.example.com/supper-newer-empty.jpg");

    mocks.create.mockClear();
    await db.recipe.update({
      where: { id: activeRecipe.id },
      data: { activeCoverVariant: "image" },
    });
    const updatedResponse = await cookbookOgLoader({
      request: new Request(`https://spoonjoy.app/og/cookbooks/${cookbook.id}.png`),
      params: { id: cookbook.id },
      context: { cloudflare: { env: null } },
    } as any);

    expect(expectDynamicOgFreshness(updatedResponse)).not.toBe(firstCoverKey);
    expect(latestOgImageSources()).toContain("https://cdn.example.com/supper-raw.jpg");

    mocks.create.mockClear();
    await db.recipe.update({
      where: { id: activeRecipe.id },
      data: { activeCoverId: null, activeCoverVariant: null, coverMode: "none" },
    });
    const noCoverResponse = await cookbookOgLoader({
      request: new Request(`https://spoonjoy.app/og/cookbooks/${cookbook.id}.png`),
      params: { id: cookbook.id },
      context: { cloudflare: { env: null } },
    } as any);

    expect(expectDynamicOgFreshness(noCoverResponse)).not.toBe(firstCoverKey);
    expect(latestOgImageSources()).toEqual([]);
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
