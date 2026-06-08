import { describe, expect, it, beforeEach, vi } from "vitest";

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

describe("OG image helpers", () => {
  beforeEach(() => {
    mocks.create.mockClear();
    mocks.setExecutionContext.mockClear();
    mocks.GoogleFont.mockClear();
  });

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

  it("creates recipe OG responses with recipe photos and Workers font caching", async () => {
    const ctx = { waitUntil: vi.fn() };

    const response = await createRecipeOgImageResponse(
      {
        title: "Charred Tomato Toast",
        description: "A fast lunch with real crunch.",
        chefUsername: "ari",
        servingsLabel: "4 servings",
        coverImageUrl: "https://cdn.example.com/tomato.jpg",
      },
      ctx,
    );

    expect(await response.text()).toBe("PNG");
    expect(response.headers.get("X-OG-Width")).toBe(String(OG_IMAGE_WIDTH));
    expect(response.headers.get("X-OG-Height")).toBe(String(OG_IMAGE_HEIGHT));
    expect(response.headers.get("Cache-Control")).toContain("s-maxage=86400");
    expect(mocks.setExecutionContext).toHaveBeenCalledWith(ctx);
    expect(mocks.GoogleFont).toHaveBeenCalledTimes(3);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        width: OG_IMAGE_WIDTH,
        height: OG_IMAGE_HEIGHT,
      }),
    );
  });

  it("creates recipe OG elements without photos or serving labels", () => {
    const element = createRecipeOgElement(
      {
        title: "Plain Rice",
        description: null,
        chefUsername: "rowan",
        servingsLabel: null,
        coverImageUrl: null,
      },
      "A Spoonjoy recipe by rowan.",
    );

    expect(element.type).toBe("div");
  });

  it("creates cookbook OG responses and exercises fallback execution context", async () => {
    const response = await createCookbookOgImageResponse({
      title: "Weeknight Book",
      authorUsername: "ari",
      recipeCount: 2,
      coverImageUrls: ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"],
    });

    expect(response.headers.get("Content-Type")).toContain("image/png");
    expect(mocks.setExecutionContext).toHaveBeenCalledTimes(1);
    const fallbackContext = mocks.setExecutionContext.mock.calls[0][0] as { waitUntil(promise: Promise<unknown>): void };
    expect(() => fallbackContext.waitUntil(Promise.resolve())).not.toThrow();
    expect(mocks.GoogleFont).toHaveBeenCalledTimes(3);
  });

  it("creates cookbook OG elements with and without cover photos", () => {
    expect(
      createCookbookOgElement(
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
      ).type,
    ).toBe("div");

    expect(
      createCookbookOgElement(
        {
          title: "Empty Book",
          authorUsername: "ari",
          recipeCount: 0,
          coverImageUrls: [],
        },
        "0 recipes",
      ).type,
    ).toBe("div");

    expect(
      createCookbookOgElement(
        {
          title: "Null Cover Book",
          authorUsername: "ari",
          recipeCount: 2,
          coverImageUrls: [null, "", "https://cdn.example.com/real.jpg"],
        },
        "2 recipes",
      ).type,
    ).toBe("div");
  });

  it("creates page OG responses and elements for developer surfaces", async () => {
    const input = pageOgInput("api-playground")!;
    const response = await createPageOgImageResponse(input);

    expect(await response.text()).toBe("PNG");
    expect(response.headers.get("X-OG-Width")).toBe(String(OG_IMAGE_WIDTH));
    expect(response.headers.get("X-OG-Height")).toBe(String(OG_IMAGE_HEIGHT));
    expect(mocks.GoogleFont).toHaveBeenCalledTimes(3);
    expect(createPageOgElement(input).type).toBe("div");
    expect(createPageOgElement(pageOgInput("api")!).type).toBe("div");
  });

  it("creates page OG responses and elements for developer surfaces", async () => {
    const input = pageOgInput("api-playground")!;
    const response = await createPageOgImageResponse(input);

    expect(await response.text()).toBe("PNG");
    expect(response.headers.get("X-OG-Width")).toBe(String(OG_IMAGE_WIDTH));
    expect(response.headers.get("X-OG-Height")).toBe(String(OG_IMAGE_HEIGHT));
    expect(mocks.GoogleFont).toHaveBeenCalledTimes(3);
    expect(createPageOgElement(input).type).toBe("div");
  });
});
