// @vitest-environment node
import { describe, expect, it } from "vitest";
import { normalizeRecipeSourceUrl, recipeSourceUrlCandidates } from "~/lib/recipe-source-url.server";

describe("normalizeRecipeSourceUrl", () => {
  it("gives every spelling of one link the same stored form", () => {
    const forms = [
      "https://Example.com/recipes/stew",
      " https://example.com/recipes/stew ",
      "HTTPS://EXAMPLE.COM/recipes/stew#ingredients",
      "https://example.com/recipes/stew?utm_source=pinterest&utm_campaign=fall&fbclid=abc",
      "https://example.com/recipes/stew?gclid=1&mc_cid=2&mc_eid=3&UTM_Term=x",
    ];
    expect(new Set(forms.map(normalizeRecipeSourceUrl))).toEqual(new Set(["https://example.com/recipes/stew"]));
  });

  it("keeps parameters that can identify the recipe, and the URL's own normalization", () => {
    expect(normalizeRecipeSourceUrl("https://example.com/r?recipe=123&utm_source=x&page=2"))
      .toBe("https://example.com/r?recipe=123&page=2");
    expect(normalizeRecipeSourceUrl("https://Example.com")).toBe("https://example.com/");
    expect(normalizeRecipeSourceUrl("https://example.com/crème brûlée")).toBe("https://example.com/cr%C3%A8me%20br%C3%BBl%C3%A9e");
    expect(normalizeRecipeSourceUrl("http://example.com:80/r")).toBe("http://example.com/r");
  });

  it("keeps text that is not an http(s) link as given, trimmed, and maps blank to null", () => {
    expect(normalizeRecipeSourceUrl("  Grandma's recipe card  ")).toBe("Grandma's recipe card");
    expect(normalizeRecipeSourceUrl("mailto:Chef@Example.com")).toBe("mailto:Chef@Example.com");
    expect(normalizeRecipeSourceUrl("   ")).toBeNull();
    expect(normalizeRecipeSourceUrl("")).toBeNull();
    expect(normalizeRecipeSourceUrl(null)).toBeNull();
    expect(normalizeRecipeSourceUrl(undefined)).toBeNull();
  });
});

describe("recipeSourceUrlCandidates", () => {
  it("matches the normalized link and the text as given", () => {
    expect(recipeSourceUrlCandidates(" https://Example.com/r#x ")).toEqual([
      "https://example.com/r",
      "https://Example.com/r#x",
      " https://Example.com/r#x ",
    ]);
    expect(recipeSourceUrlCandidates("https://example.com/r")).toEqual(["https://example.com/r"]);
    expect(recipeSourceUrlCandidates("  ")).toEqual([]);
    expect(recipeSourceUrlCandidates(null)).toEqual([]);
  });
});
