import { describe, it, expect } from "vitest";
import * as recipeImage from "~/lib/recipe-image";

describe("recipe-image module surface", () => {
  it("exports the legacy token and explicit image upload allow-lists", () => {
    expect(Object.keys(recipeImage).sort()).toEqual([
      "FOOD_IMAGE_ACCEPT",
      "FOOD_IMAGE_SIZE_MESSAGE",
      "FOOD_IMAGE_TYPES",
      "FOOD_IMAGE_TYPE_MESSAGE",
      "IMAGE_MAX_FILE_SIZE",
      "LEGACY_DEFAULT_RECIPE_IMAGE_TOKEN",
      "PROFILE_IMAGE_ACCEPT",
      "PROFILE_IMAGE_TYPES",
      "RECIPE_IMAGE_SIZE_MESSAGE",
      "RECIPE_IMAGE_TYPE_MESSAGE",
    ]);
    expect(recipeImage.LEGACY_DEFAULT_RECIPE_IMAGE_TOKEN).toBe("clbe7wr180009tkhggghtl1qd.png");
    expect(recipeImage.FOOD_IMAGE_TYPES).toEqual(["image/jpeg", "image/png", "image/webp"]);
    expect(recipeImage.PROFILE_IMAGE_TYPES).toContain("image/gif");
  });

  it("does not export the removed getDisplayRecipeImageUrl helper", () => {
    expect((recipeImage as Record<string, unknown>).getDisplayRecipeImageUrl).toBeUndefined();
  });
});
