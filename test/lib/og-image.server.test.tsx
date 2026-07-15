import { describe, expect, it } from "vitest";

import {
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  absoluteUrlFromPreferredBase,
  absoluteUrlFromRequest,
  cookbookOgPath,
  cookbookRecipeLabel,
  createCookbookOgElement,
  createCookbookOgImageResponse,
  createPageOgElement,
  createPageOgImageResponse,
  createRecipeOgElement,
  createRecipeOgImageResponse,
  pageOgInput,
  pageOgPath,
  recipeOgDescription,
  recipeOgPath,
} from "~/lib/og-image.server";

async function expectSvgResponse(response: Response) {
  const svg = await response.text();
  expect(response.headers.get("Content-Type")).toContain("image/svg+xml");
  expect(response.headers.get("X-OG-Width")).toBe(String(OG_IMAGE_WIDTH));
  expect(response.headers.get("X-OG-Height")).toBe(String(OG_IMAGE_HEIGHT));
  expect(svg).toContain("<svg");
  expect(svg).toContain("</svg>");
  return svg;
}

function imageHrefs(svg: string) {
  return [...svg.matchAll(/<image href="([^"]+)"/g)].map((match) => match[1]);
}

describe("OG image helpers", () => {
  it("builds absolute image and card URLs from the current request", () => {
    expect(absoluteUrlFromRequest("https://spoonjoy.app/recipes/r1", "/photos/r1.jpg")).toBe("https://spoonjoy.app/photos/r1.jpg");
    expect(absoluteUrlFromRequest("https://spoonjoy.app/recipes/r1", "https://cdn.example.com/r1.jpg")).toBe("https://cdn.example.com/r1.jpg");
    expect(absoluteUrlFromRequest("https://spoonjoy.app/recipes/r1", null)).toBeNull();
    expect(absoluteUrlFromRequest("https://spoonjoy.app/recipes/r1", "http://[")).toBe("http://[");
    expect(absoluteUrlFromPreferredBase({
      requestUrl: "https://spoonjoy-v2.mendelow-studio.workers.dev/api",
      baseUrl: "https://spoonjoy.app",
      path: "/api",
    })).toBe("https://spoonjoy.app/api");
    expect(recipeOgPath("recipe 1")).toBe("/og/recipes/recipe%201.png");
    expect(cookbookOgPath("book 1")).toBe("/og/cookbooks/book%201.png");
    expect(pageOgPath("api playground")).toBe("/og/pages/api%20playground.png");
  });

  it("formats recipe and cookbook copy for share cards", () => {
    expect(recipeOgDescription({ description: "  bright and crunchy  ", chefUsername: "ari" })).toBe("bright and crunchy");
    expect(recipeOgDescription({ description: "   ", chefUsername: "ari" })).toBe("A Spoonjoy recipe by ari.");
    expect(recipeOgDescription({ description: null, chefUsername: "ari" })).toBe("A Spoonjoy recipe by ari.");
    expect(cookbookRecipeLabel(1)).toBe("1 recipe");
    expect(cookbookRecipeLabel(3)).toBe("3 recipes");
    expect(pageOgInput("api")).toMatchObject({ title: "Spoonjoy Developer Platform" });
    expect(pageOgInput("missing")).toBeNull();
  });

  it("creates recipe OG responses with recipe photos", async () => {
    const response = await createRecipeOgImageResponse(
      {
        title: "Charred Tomato Toast",
        description: "A fast lunch with real crunch.",
        chefUsername: "ari",
        servingsLabel: "4 servings",
        coverImageUrl: "https://cdn.example.com/tomato.jpg",
      },
      { waitUntil() {} },
    );

    const svg = await expectSvgResponse(response);
    expect(response.headers.get("Cache-Control")).toContain("s-maxage=86400");
    expect(svg).toContain("SPOONJOY RECIPE");
    expect(svg).toContain("Charred");
    expect(imageHrefs(svg)).toContain("https://cdn.example.com/tomato.jpg");
  });

  it("creates recipe OG elements without photos or serving labels", () => {
    const svg = createRecipeOgElement(
      {
        title: "Plain Rice",
        description: null,
        chefUsername: "rowan",
        servingsLabel: null,
        coverImageUrl: null,
      },
      "A Spoonjoy recipe by rowan.",
    );

    expect(svg).toContain("Plain Rice");
    expect(imageHrefs(svg)).toEqual([]);
  });

  it("escapes and truncates oversized SVG recipe copy", () => {
    const svg = createRecipeOgElement(
      {
        title: "Antidisestablishmentarianism & toast",
        description: null,
        chefUsername: "rowan",
        servingsLabel: null,
        coverImageUrl: "https://cdn.example.com/a.jpg?caption=\"fish&chips\"",
      },
      "bright crunchy acidic salty sweet spicy savory smoky tender juicy buttery herbaceous citrusy peppery briny floral",
    );

    expect(svg).toContain("Antidisesta...");
    expect(svg).toContain("fish&amp;chips");
    expect(svg).toContain("&quot;");
    expect(svg).not.toContain("floral");
  });

  it("keeps empty SVG text nodes stable for incomplete records", () => {
    const svg = createRecipeOgElement(
      {
        title: "   ",
        description: null,
        chefUsername: "rowan",
        servingsLabel: null,
        coverImageUrl: null,
      },
      "",
    );

    expect(svg).toContain('aria-label=""');
    expect(svg).toContain('<tspan x="686" dy="0"></tspan>');
  });

  it("creates cookbook OG responses", async () => {
    const response = await createCookbookOgImageResponse({
      title: "Weeknight Book",
      authorUsername: "ari",
      recipeCount: 2,
      coverImageUrls: ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"],
    });

    const svg = await expectSvgResponse(response);
    expect(svg).toContain("Weeknight");
    expect(svg).toContain("BY ARI");
    expect(svg).toContain("2 RECIPES");
    expect(imageHrefs(svg)).toEqual(["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"]);
  });

  it("creates cookbook OG elements with and without cover photos", () => {
    const cookbookSvg = createCookbookOgElement(
      {
        title: "Sunday Sauces",
        authorUsername: "ari",
        recipeCount: 4,
        coverImageUrls: [
          "https://cdn.example.com/a.jpg",
          "https://cdn.example.com/b.jpg",
          "https://cdn.example.com/c.jpg",
          "https://cdn.example.com/d.jpg",
          "https://cdn.example.com/e.jpg",
        ],
      },
      "4 recipes",
    );
    expect(cookbookSvg).toContain("Sunday");
    expect(cookbookSvg).not.toContain("Spoonjoy cookbook");
    expect(imageHrefs(cookbookSvg)).toHaveLength(4);

    expect(
      createCookbookOgElement(
        {
          title: "Empty Book",
          authorUsername: "ari",
          recipeCount: 0,
          coverImageUrls: [],
        },
        "0 recipes",
      ),
    ).toContain("Empty Book");

    expect(
      createCookbookOgElement(
        {
          title: "Null Cover Book",
          authorUsername: "ari",
          recipeCount: 2,
          coverImageUrls: [null, "", "https://cdn.example.com/real.jpg"],
        },
        "2 recipes",
      ),
    ).toContain("https://cdn.example.com/real.jpg");
  });

  it("creates page OG responses and elements for developer surfaces", async () => {
    const input = pageOgInput("api-playground")!;
    const response = await createPageOgImageResponse(input);

    const svg = await expectSvgResponse(response);
    expect(svg).toContain("Spoonjoy API");
    expect(createPageOgElement(input)).toContain("Playground");
    expect(createPageOgElement(pageOgInput("api")!)).toContain("REST API");
  });
});
