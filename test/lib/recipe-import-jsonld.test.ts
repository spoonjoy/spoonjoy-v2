import { describe, it, expect } from "vitest";
import { extractRecipeJsonLd } from "~/lib/recipe-import-jsonld.server";

function ldScript(payload: unknown): string {
  return `<html><head><script type="application/ld+json">${JSON.stringify(payload)}</script></head><body/></html>`;
}

describe("extractRecipeJsonLd — no JSON-LD", () => {
  it("returns null draft when no script tags", () => {
    const result = extractRecipeJsonLd("<html><head></head></html>");
    expect(result).toEqual({ draft: null, multipleRecipes: false });
  });

  it("returns null draft when script tag has wrong type", () => {
    const html =
      '<html><head><script type="application/javascript">var x=1;</script></head></html>';
    const result = extractRecipeJsonLd(html);
    expect(result.draft).toBeNull();
  });

  it("returns null draft when JSON is malformed", () => {
    const html =
      '<html><head><script type="application/ld+json">{ broken }</script></head></html>';
    const result = extractRecipeJsonLd(html);
    expect(result.draft).toBeNull();
    expect(result.multipleRecipes).toBe(false);
  });

  it("returns null draft when JSON-LD has no @type Recipe", () => {
    const html = ldScript({ "@type": "Article", headline: "x" });
    const result = extractRecipeJsonLd(html);
    expect(result.draft).toBeNull();
  });
});

describe("extractRecipeJsonLd — basic fields", () => {
  it("extracts title from name field", () => {
    const html = ldScript({ "@type": "Recipe", name: "Pasta" });
    const result = extractRecipeJsonLd(html);
    expect(result.draft?.title).toBe("Pasta");
  });

  it("extracts description from description field", () => {
    const html = ldScript({ "@type": "Recipe", name: "Pasta", description: "Tasty" });
    const result = extractRecipeJsonLd(html);
    expect(result.draft?.description).toBe("Tasty");
  });

  it("returns description=null when missing", () => {
    const html = ldScript({ "@type": "Recipe", name: "Pasta" });
    const result = extractRecipeJsonLd(html);
    expect(result.draft?.description).toBeNull();
  });

  it("extracts servings from recipeYield string", () => {
    const html = ldScript({ "@type": "Recipe", name: "Pasta", recipeYield: "4 servings" });
    const result = extractRecipeJsonLd(html);
    expect(result.draft?.servings).toBe("4 servings");
  });

  it("extracts servings from recipeYield number (coerces to string)", () => {
    const html = ldScript({ "@type": "Recipe", name: "Pasta", recipeYield: 4 });
    const result = extractRecipeJsonLd(html);
    expect(result.draft?.servings).toBe("4");
  });

  it("returns servings=null when recipeYield missing", () => {
    const html = ldScript({ "@type": "Recipe", name: "Pasta" });
    const result = extractRecipeJsonLd(html);
    expect(result.draft?.servings).toBeNull();
  });
});

describe("extractRecipeJsonLd — ingredients", () => {
  it("extracts ingredients from recipeIngredient string array", () => {
    const html = ldScript({
      "@type": "Recipe",
      name: "Pasta",
      recipeIngredient: ["1 cup flour", "2 eggs"],
    });
    const result = extractRecipeJsonLd(html);
    expect(result.draft?.ingredients).toEqual(["1 cup flour", "2 eggs"]);
  });

  it("returns ingredients=[] when recipeIngredient missing", () => {
    const html = ldScript({ "@type": "Recipe", name: "Pasta" });
    const result = extractRecipeJsonLd(html);
    expect(result.draft?.ingredients).toEqual([]);
  });

  it("filters out non-string entries in recipeIngredient", () => {
    const html = ldScript({
      "@type": "Recipe",
      name: "Pasta",
      recipeIngredient: ["1 cup flour", 42, null, "2 eggs"],
    });
    const result = extractRecipeJsonLd(html);
    expect(result.draft?.ingredients).toEqual(["1 cup flour", "2 eggs"]);
  });
});

describe("extractRecipeJsonLd — instructions", () => {
  it("extracts steps from recipeInstructions string (splits on newline)", () => {
    const html = ldScript({
      "@type": "Recipe",
      name: "Pasta",
      recipeInstructions: "Boil water.\nAdd pasta.\nCook 10 minutes.",
    });
    const result = extractRecipeJsonLd(html);
    expect(result.draft?.steps).toEqual(["Boil water.", "Add pasta.", "Cook 10 minutes."]);
  });

  it("extracts steps from HowToStep[]", () => {
    const html = ldScript({
      "@type": "Recipe",
      name: "Pasta",
      recipeInstructions: [
        { "@type": "HowToStep", text: "Step 1" },
        { "@type": "HowToStep", text: "Step 2" },
      ],
    });
    const result = extractRecipeJsonLd(html);
    expect(result.draft?.steps).toEqual(["Step 1", "Step 2"]);
  });

  it("flattens HowToSection itemListElement", () => {
    const html = ldScript({
      "@type": "Recipe",
      name: "Pasta",
      recipeInstructions: [
        {
          "@type": "HowToSection",
          name: "Prep",
          itemListElement: [
            { "@type": "HowToStep", text: "Chop onion" },
            { "@type": "HowToStep", text: "Mince garlic" },
          ],
        },
        {
          "@type": "HowToSection",
          name: "Cook",
          itemListElement: [{ "@type": "HowToStep", text: "Saute" }],
        },
      ],
    });
    const result = extractRecipeJsonLd(html);
    expect(result.draft?.steps).toEqual(["Chop onion", "Mince garlic", "Saute"]);
  });

  it("handles mixed HowToStep and HowToSection", () => {
    const html = ldScript({
      "@type": "Recipe",
      name: "Pasta",
      recipeInstructions: [
        { "@type": "HowToStep", text: "Top step" },
        {
          "@type": "HowToSection",
          itemListElement: [{ "@type": "HowToStep", text: "Inner" }],
        },
      ],
    });
    const result = extractRecipeJsonLd(html);
    expect(result.draft?.steps).toEqual(["Top step", "Inner"]);
  });

  it("filters HowToStep entries with no text", () => {
    const html = ldScript({
      "@type": "Recipe",
      name: "Pasta",
      recipeInstructions: [
        { "@type": "HowToStep", text: "" },
        { "@type": "HowToStep" },
        { "@type": "HowToStep", text: "OK" },
      ],
    });
    const result = extractRecipeJsonLd(html);
    expect(result.draft?.steps).toEqual(["OK"]);
  });

  it("returns steps=[] when recipeInstructions missing or unrecognized shape", () => {
    const html = ldScript({ "@type": "Recipe", name: "Pasta", recipeInstructions: 42 });
    const result = extractRecipeJsonLd(html);
    expect(result.draft?.steps).toEqual([]);
  });

  it("returns steps=[] when recipeInstructions absent", () => {
    const html = ldScript({ "@type": "Recipe", name: "Pasta" });
    const result = extractRecipeJsonLd(html);
    expect(result.draft?.steps).toEqual([]);
  });
});

describe("extractRecipeJsonLd — image", () => {
  it("extracts imageUrl from image string", () => {
    const html = ldScript({
      "@type": "Recipe",
      name: "Pasta",
      image: "https://cdn.example.com/p.jpg",
    });
    const result = extractRecipeJsonLd(html);
    expect(result.draft?.imageUrl).toBe("https://cdn.example.com/p.jpg");
  });

  it("extracts imageUrl from image object with url property", () => {
    const html = ldScript({
      "@type": "Recipe",
      name: "Pasta",
      image: { "@type": "ImageObject", url: "https://cdn.example.com/p.jpg" },
    });
    const result = extractRecipeJsonLd(html);
    expect(result.draft?.imageUrl).toBe("https://cdn.example.com/p.jpg");
  });

  it("extracts imageUrl from image array (first entry)", () => {
    const html = ldScript({
      "@type": "Recipe",
      name: "Pasta",
      image: ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"],
    });
    const result = extractRecipeJsonLd(html);
    expect(result.draft?.imageUrl).toBe("https://cdn.example.com/a.jpg");
  });

  it("extracts imageUrl from image array of ImageObjects (first entry url)", () => {
    const html = ldScript({
      "@type": "Recipe",
      name: "Pasta",
      image: [
        { "@type": "ImageObject", url: "https://cdn.example.com/a.jpg" },
        { "@type": "ImageObject", url: "https://cdn.example.com/b.jpg" },
      ],
    });
    const result = extractRecipeJsonLd(html);
    expect(result.draft?.imageUrl).toBe("https://cdn.example.com/a.jpg");
  });

  it("returns imageUrl=null when image missing", () => {
    const html = ldScript({ "@type": "Recipe", name: "Pasta" });
    const result = extractRecipeJsonLd(html);
    expect(result.draft?.imageUrl).toBeNull();
  });

  it("returns imageUrl=null when image is an empty array", () => {
    const html = ldScript({ "@type": "Recipe", name: "Pasta", image: [] });
    const result = extractRecipeJsonLd(html);
    expect(result.draft?.imageUrl).toBeNull();
  });

  it("returns imageUrl=null when image is an unrecognized shape", () => {
    const html = ldScript({ "@type": "Recipe", name: "Pasta", image: 42 });
    const result = extractRecipeJsonLd(html);
    expect(result.draft?.imageUrl).toBeNull();
  });
});

describe("extractRecipeJsonLd — @graph and multi-Recipe", () => {
  it("walks @graph array to find nested Recipe", () => {
    const html = ldScript({
      "@graph": [
        { "@type": "Organization", name: "Big Co" },
        { "@type": "Recipe", name: "Soup" },
      ],
    });
    const result = extractRecipeJsonLd(html);
    expect(result.draft?.title).toBe("Soup");
    expect(result.multipleRecipes).toBe(false);
  });

  it("returns multipleRecipes=true when @graph has two Recipe blocks", () => {
    const html = ldScript({
      "@graph": [
        { "@type": "Recipe", name: "First" },
        { "@type": "Recipe", name: "Second" },
      ],
    });
    const result = extractRecipeJsonLd(html);
    expect(result.multipleRecipes).toBe(true);
    expect(result.draft?.title).toBe("First");
  });

  it("returns multipleRecipes=true when two script tags each contain a Recipe", () => {
    const html =
      "<html><head>" +
      `<script type="application/ld+json">${JSON.stringify({
        "@type": "Recipe",
        name: "First",
      })}</script>` +
      `<script type="application/ld+json">${JSON.stringify({
        "@type": "Recipe",
        name: "Second",
      })}</script>` +
      "</head></html>";
    const result = extractRecipeJsonLd(html);
    expect(result.multipleRecipes).toBe(true);
    expect(result.draft?.title).toBe("First");
  });

  it("handles @type as array containing Recipe", () => {
    const html = ldScript({ "@type": ["Recipe", "Article"], name: "Pasta" });
    const result = extractRecipeJsonLd(html);
    expect(result.draft?.title).toBe("Pasta");
  });

  it("tolerates type attribute application/ld+json; charset=utf-8", () => {
    const html =
      '<html><head><script type="application/ld+json; charset=utf-8">' +
      JSON.stringify({ "@type": "Recipe", name: "Pasta" }) +
      "</script></head></html>";
    const result = extractRecipeJsonLd(html);
    expect(result.draft?.title).toBe("Pasta");
  });

  it("tolerates whitespace and comments inside script tag", () => {
    const payload = JSON.stringify({ "@type": "Recipe", name: "Pasta" });
    const html =
      '<html><head><script type="application/ld+json">\n  \n' +
      payload +
      "\n  \n</script></head></html>";
    const result = extractRecipeJsonLd(html);
    expect(result.draft?.title).toBe("Pasta");
  });

  it("returns null draft when title (name) is empty/whitespace", () => {
    const html = ldScript({ "@type": "Recipe", name: "   " });
    const result = extractRecipeJsonLd(html);
    expect(result.draft).toBeNull();
  });
});
