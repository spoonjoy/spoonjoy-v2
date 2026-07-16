import { describe, it, expect } from "vitest";
import {
  IMAGE_MAX_FILE_SIZE as STORAGE_IMAGE_MAX_FILE_SIZE,
  RECIPE_IMAGE_TYPES,
} from "~/lib/image-storage.server";
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

  it("is the authoritative boundary for normalized native recipe-cover uploads", () => {
    expect(recipeImage.IMAGE_MAX_FILE_SIZE).toBe(5 * 1024 * 1024);
    expect(recipeImage.FOOD_IMAGE_TYPES).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
    expect(recipeImage.FOOD_IMAGE_TYPES).not.toContain("image/heic");
    expect(recipeImage.FOOD_IMAGE_TYPES).not.toContain("image/heif");

    expect(STORAGE_IMAGE_MAX_FILE_SIZE).toBe(recipeImage.IMAGE_MAX_FILE_SIZE);
    expect(RECIPE_IMAGE_TYPES).toBe(recipeImage.FOOD_IMAGE_TYPES);
  });
});
