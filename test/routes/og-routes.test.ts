import { faker } from "@faker-js/faker";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { cleanupDatabase } from "../helpers/cleanup";

import { loader as recipeOgLoader } from "~/routes/og.recipes.$id.png";
import { loader as cookbookOgLoader } from "~/routes/og.cookbooks.$id.png";
import { loader as pageOgLoader } from "~/routes/og.pages.$slug.png";

function uniqueEmail(prefix: string) {
  return `${prefix}-${faker.string.alphanumeric(8).toLowerCase()}@example.com`;
}

function expectDynamicOgFreshness(response: Response) {
  const coverKey = response.headers.get("X-Spoonjoy-OG-Cover-Key");
  expect(response.headers.get("Cache-Control")).toBe("public, no-cache, must-revalidate");
  expect(coverKey).toMatch(/^W\/"og-[a-f0-9]+-\d+"$/);
  expect(response.headers.get("ETag")).toBe(coverKey);
  return coverKey;
}

async function expectSvgResponse(response: Response) {
  const svg = await response.text();
  expect(response.headers.get("Content-Type")).toContain("image/svg+xml");
  expect(response.headers.get("X-OG-Width")).toBe("1200");
  expect(response.headers.get("X-OG-Height")).toBe("630");
  expect(svg).toContain("<svg");
  expect(svg).toContain("</svg>");
  return svg;
}

function imageHrefs(svg: string) {
  return [...svg.matchAll(/<image href="([^"]+)"/g)].map((match) => match[1]);
}

describe("dynamic OG image routes", () => {
  let userId: string;

  beforeEach(async () => {
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

  it("renders on-demand SVG cards for developer pages", async () => {
    for (const slug of ["api", "api-playground"]) {
      const response = await pageOgLoader({
        request: new Request(`https://spoonjoy.app/og/pages/${slug}.png`),
        params: { slug },
        context: { cloudflare: { env: null, ctx: { waitUntil: vi.fn() } } },
      } as any);

      const svg = await expectSvgResponse(response);
      expect(svg).toContain("SPOONJOY");
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

  it("renders an on-demand SVG card for a public recipe", async () => {
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

    const svg = await expectSvgResponse(response);
    const firstCoverKey = expectDynamicOgFreshness(response);
    expect(imageHrefs(svg)).toContain("https://spoonjoy.app/photos/tomato-editorial.jpg");
    expect(imageHrefs(svg)).not.toContain("https://spoonjoy.app/photos/tomato-newer-archived.jpg");

    await db.recipe.update({
      where: { id: recipe.id },
      data: { activeCoverVariant: "image" },
    });
    const updatedResponse = await recipeOgLoader({
      request: new Request(`https://spoonjoy.app/og/recipes/${recipe.id}.png`),
      params: { id: recipe.id },
      context: { cloudflare: { env: null, ctx: { waitUntil: vi.fn() } } },
    } as any);

    const updatedSvg = await expectSvgResponse(updatedResponse);
    const updatedCoverKey = expectDynamicOgFreshness(updatedResponse);
    expect(updatedCoverKey).not.toBe(firstCoverKey);
    expect(imageHrefs(updatedSvg)).toContain("https://spoonjoy.app/photos/tomato.jpg");

    await db.recipeCover.update({
      where: { id: activeCover.id },
      data: { status: "archived", archivedAt: new Date("2026-01-03T00:00:00.000Z") },
    });
    const archivedResponse = await recipeOgLoader({
      request: new Request(`https://spoonjoy.app/og/recipes/${recipe.id}.png`),
      params: { id: recipe.id },
      context: { cloudflare: { env: null, ctx: { waitUntil: vi.fn() } } },
    } as any);

    const archivedSvg = await expectSvgResponse(archivedResponse);
    expect(expectDynamicOgFreshness(archivedResponse)).not.toBe(updatedCoverKey);
    expect(imageHrefs(archivedSvg)).not.toContain("https://spoonjoy.app/photos/tomato.jpg");

    await db.recipe.update({
      where: { id: recipe.id },
      data: { activeCoverId: null, activeCoverVariant: null, coverMode: "none" },
    });
    const noCoverResponse = await recipeOgLoader({
      request: new Request(`https://spoonjoy.app/og/recipes/${recipe.id}.png`),
      params: { id: recipe.id },
      context: { cloudflare: { env: null, ctx: { waitUntil: vi.fn() } } },
    } as any);

    const noCoverSvg = await expectSvgResponse(noCoverResponse);
    expect(expectDynamicOgFreshness(noCoverResponse)).not.toBe(updatedCoverKey);
    expect(imageHrefs(noCoverSvg)).toEqual([]);
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

  it("renders an on-demand SVG card for a cookbook with active recipe covers", async () => {
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

    const svg = await expectSvgResponse(response);
    const firstCoverKey = expectDynamicOgFreshness(response);
    expect(imageHrefs(svg)).toContain("https://cdn.example.com/supper-editorial.jpg");
    expect(imageHrefs(svg)).not.toContain("https://cdn.example.com/supper-newer-empty.jpg");

    await db.recipe.update({
      where: { id: activeRecipe.id },
      data: { activeCoverVariant: "image" },
    });
    const updatedResponse = await cookbookOgLoader({
      request: new Request(`https://spoonjoy.app/og/cookbooks/${cookbook.id}.png`),
      params: { id: cookbook.id },
      context: { cloudflare: { env: null } },
    } as any);

    const updatedSvg = await expectSvgResponse(updatedResponse);
    expect(expectDynamicOgFreshness(updatedResponse)).not.toBe(firstCoverKey);
    expect(imageHrefs(updatedSvg)).toContain("https://cdn.example.com/supper-raw.jpg");

    await db.recipe.update({
      where: { id: activeRecipe.id },
      data: { activeCoverId: null, activeCoverVariant: null, coverMode: "none" },
    });
    const noCoverResponse = await cookbookOgLoader({
      request: new Request(`https://spoonjoy.app/og/cookbooks/${cookbook.id}.png`),
      params: { id: cookbook.id },
      context: { cloudflare: { env: null } },
    } as any);

    const noCoverSvg = await expectSvgResponse(noCoverResponse);
    expect(expectDynamicOgFreshness(noCoverResponse)).not.toBe(firstCoverKey);
    expect(imageHrefs(noCoverSvg)).toEqual([]);
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
