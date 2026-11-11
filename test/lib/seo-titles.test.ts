import { describe, expect, it } from "vitest";
import { kitchenPageTitle, PUBLIC_RECIPES_TITLE, recipePageTitle } from "~/lib/seo-titles";

describe("page titles for search results", () => {
  it("answers '<dish> recipe' searches", () => {
    expect(recipePageTitle("Charred Tomato Toast")).toBe("Charred Tomato Toast Recipe - Spoonjoy");
  });

  it("never says Recipe twice", () => {
    expect(recipePageTitle("Grandma's Recipe for Latkes")).toBe("Grandma's Recipe for Latkes - Spoonjoy");
    expect(recipePageTitle(" 3 Lazy Pasta Recipes ")).toBe("3 Lazy Pasta Recipes - Spoonjoy");
    expect(recipePageTitle("Recipeless Rice")).toBe("Recipeless Rice Recipe - Spoonjoy");
  });

  it("names a chef's kitchen and what is in it", () => {
    expect(kitchenPageTitle("ari")).toBe("ari's Kitchen: Recipes & Cookbooks - Spoonjoy");
  });

  it("keeps fixed titles within what Google shows", () => {
    expect(PUBLIC_RECIPES_TITLE.length).toBeLessThanOrEqual(60);
  });
});
