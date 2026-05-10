import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "~/lib/db.server";
import { createTestUser, createTestRecipe } from "../utils";
import { cleanupDatabase } from "../helpers/cleanup";

describe("Recipe Model", () => {
  let testUserId: string;

  beforeEach(async () => {
    // Create a test user with unique data
    const user = await db.user.create({
      data: createTestUser(),
    });
    testUserId = user.id;
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("create", () => {
    it("should create a recipe with required fields", async () => {
      const recipeData = createTestRecipe(testUserId);
      const recipe = await db.recipe.create({
        data: {
          title: recipeData.title,
          chefId: testUserId,
        },
      });

      expect(recipe).toBeDefined();
      expect(recipe.title).toBe(recipeData.title);
      expect(recipe.chefId).toBe(testUserId);
      expect(recipe.imageUrl).toBeDefined();
      expect(recipe.deletedAt).toBeNull();
    });

    it("should create a recipe with optional fields", async () => {
      const recipeData = createTestRecipe(testUserId);
      const recipe = await db.recipe.create({
        data: {
          ...recipeData,
          imageUrl: "https://example.com/image.jpg",
        },
      });

      expect(recipe.description).toBe(recipeData.description);
      expect(recipe.servings).toBe(recipeData.servings);
      expect(recipe.imageUrl).toBe("https://example.com/image.jpg");
    });

  });

  describe("read", () => {
    it("should find recipe by id", async () => {
      const recipeData = createTestRecipe(testUserId);
      const created = await db.recipe.create({
        data: {
          title: recipeData.title,
          chefId: testUserId,
        },
      });

      const found = await db.recipe.findUnique({
        where: { id: created.id },
      });

      expect(found).toBeDefined();
      expect(found?.title).toBe(recipeData.title);
    });

    it("should find recipes by chef", async () => {
      const recipe1 = createTestRecipe(testUserId);
      const recipe2 = createTestRecipe(testUserId);
      await db.recipe.createMany({
        data: [
          { title: recipe1.title, chefId: testUserId },
          { title: recipe2.title, chefId: testUserId },
        ],
      });

      const recipes = await db.recipe.findMany({
        where: { chefId: testUserId, deletedAt: null },
      });

      expect(recipes).toHaveLength(2);
    });

    it("should exclude soft-deleted recipes", async () => {
      const recipeData = createTestRecipe(testUserId);
      const recipe = await db.recipe.create({
        data: {
          title: recipeData.title,
          chefId: testUserId,
        },
      });

      await db.recipe.update({
        where: { id: recipe.id },
        data: { deletedAt: new Date() },
      });

      const found = await db.recipe.findFirst({
        where: { id: recipe.id, deletedAt: null },
      });

      expect(found).toBeNull();
    });
  });

  describe("update", () => {
    it("should update recipe fields", async () => {
      const recipeData = createTestRecipe(testUserId);
      const recipe = await db.recipe.create({
        data: {
          title: recipeData.title,
          chefId: testUserId,
        },
      });

      const updatedTitle = createTestRecipe(testUserId).title;
      const updated = await db.recipe.update({
        where: { id: recipe.id },
        data: {
          title: updatedTitle,
          description: "New description",
        },
      });

      expect(updated.title).toBe(updatedTitle);
      expect(updated.description).toBe("New description");
    });
  });

  describe("delete", () => {
    it("should soft delete recipe", async () => {
      const recipeData = createTestRecipe(testUserId);
      const recipe = await db.recipe.create({
        data: {
          title: recipeData.title,
          chefId: testUserId,
        },
      });

      await db.recipe.update({
        where: { id: recipe.id },
        data: { deletedAt: new Date() },
      });

      const found = await db.recipe.findUnique({
        where: { id: recipe.id },
      });

      expect(found?.deletedAt).not.toBeNull();
    });

    it("should cascade delete steps when recipe is deleted", async () => {
      const recipeData = createTestRecipe(testUserId);
      const recipe = await db.recipe.create({
        data: {
          title: recipeData.title,
          chefId: testUserId,
          steps: {
            create: {
              stepNum: 1,
              description: "Step 1",
            },
          },
        },
      });

      await db.recipe.delete({
        where: { id: recipe.id },
      });

      const steps = await db.recipeStep.findMany({
        where: { recipeId: recipe.id },
      });

      expect(steps).toHaveLength(0);
    });
  });
});
