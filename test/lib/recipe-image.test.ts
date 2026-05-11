import { describe, it, expect } from "vitest";
import * as recipeImage from "~/lib/recipe-image";

describe("recipe-image module surface", () => {
  it("exports only the LEGACY_DEFAULT_RECIPE_IMAGE_TOKEN constant", () => {
    expect(Object.keys(recipeImage).sort()).toEqual(["LEGACY_DEFAULT_RECIPE_IMAGE_TOKEN"]);
    expect(recipeImage.LEGACY_DEFAULT_RECIPE_IMAGE_TOKEN).toBe("clbe7wr180009tkhggghtl1qd.png");
  });

  it("does not export the removed getDisplayRecipeImageUrl helper", () => {
    expect((recipeImage as Record<string, unknown>).getDisplayRecipeImageUrl).toBeUndefined();
  });
});
