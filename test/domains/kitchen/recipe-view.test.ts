import { describe, expect, it } from "vitest";
import { RECIPE_VIEW_COOKIE, parseRecipeView, recipeViewCookie, recipeViewFromCookie } from "~/domains/kitchen";

describe("the recipe view a cook picks", () => {
  it("is pictures unless list was picked", () => {
    expect(parseRecipeView("list")).toBe("list");
    expect(parseRecipeView("pictures")).toBe("pictures");
    expect(parseRecipeView("grid")).toBe("pictures");
    expect(parseRecipeView(undefined)).toBe("pictures");
  });

  it("is read from the request's cookie, among others", () => {
    expect(RECIPE_VIEW_COOKIE).toBe("sj_recipe_view");
    expect(recipeViewFromCookie("sj_units=metric; sj_recipe_view=list")).toBe("list");
    expect(recipeViewFromCookie("sj_recipe_view=table")).toBe("pictures");
    expect(recipeViewFromCookie(null)).toBe("pictures");
  });

  it("is kept for a year across the site", () => {
    expect(recipeViewCookie("list")).toBe("sj_recipe_view=list; Path=/; Max-Age=31536000; SameSite=Lax");
  });
});
