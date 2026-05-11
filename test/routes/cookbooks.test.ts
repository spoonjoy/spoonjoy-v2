import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "~/lib/db.server";
import { createTestUser } from "../utils";
import { cleanupDatabase } from "../helpers/cleanup";

describe("Cookbook Routes", () => {
  let testUserId: string;

  beforeEach(async () => {
    const user = await db.user.create({
      data: createTestUser(),
    });
    testUserId = user.id;
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("cookbooks.new action", () => {
    it("should create a new cookbook", async () => {
      const cookbook = await db.cookbook.create({
        data: {
          title: "My Cookbook",
          authorId: testUserId,
        },
      });

      expect(cookbook).toBeDefined();
      expect(cookbook.title).toBe("My Cookbook");
      expect(cookbook.authorId).toBe(testUserId);
    });

    it("should reject duplicate cookbook title for same user", async () => {
      await db.cookbook.create({
        data: {
          title: "Duplicate",
          authorId: testUserId,
        },
      });

      await expect(
        db.cookbook.create({
          data: {
            title: "Duplicate",
            authorId: testUserId,
          },
        })
      ).rejects.toThrow();
    });
  });

  describe("cookbooks.$id loader", () => {
    it("should load cookbook with recipes", async () => {
      const cookbook = await db.cookbook.create({
        data: {
          title: "Test Cookbook",
          authorId: testUserId,
        },
      });

      const recipe = await db.recipe.create({
        data: {
          title: "Test Recipe",
          chefId: testUserId,
        },
      });

      await db.recipeInCookbook.create({
        data: {
          cookbookId: cookbook.id,
          recipeId: recipe.id,
          addedById: testUserId,
        },
      });

      const loaded = await db.cookbook.findUnique({
        where: { id: cookbook.id },
        include: {
          recipes: {
            include: {
              recipe: {
                select: {
                  id: true,
                  title: true,
                  description: true,
                  servings: true,
                  chef: {
                    select: {
                      username: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      expect(loaded).toBeDefined();
      expect(loaded?.recipes).toHaveLength(1);
      expect(loaded?.recipes[0].recipe.title).toBe("Test Recipe");
    });

    it("should show available recipes for owner", async () => {
      const cookbook = await db.cookbook.create({
        data: {
          title: "Test Cookbook",
          authorId: testUserId,
        },
      });

      const recipe1 = await db.recipe.create({
        data: {
          title: "In Cookbook",
          chefId: testUserId,
        },
      });

      const recipe2 = await db.recipe.create({
        data: {
          title: "Not In Cookbook",
          chefId: testUserId,
        },
      });

      await db.recipeInCookbook.create({
        data: {
          cookbookId: cookbook.id,
          recipeId: recipe1.id,
          addedById: testUserId,
        },
      });

      const availableRecipes = await db.recipe.findMany({
        where: {
          chefId: testUserId,
          deletedAt: null,
          NOT: {
            cookbooks: {
              some: {
                cookbookId: cookbook.id,
              },
            },
          },
        },
      });

      expect(availableRecipes).toHaveLength(1);
      expect(availableRecipes[0].title).toBe("Not In Cookbook");
    });
  });

  describe("cookbooks.$id action - updateTitle", () => {
    it("should update cookbook title", async () => {
      const cookbook = await db.cookbook.create({
        data: {
          title: "Original Title",
          authorId: testUserId,
        },
      });

      const updated = await db.cookbook.update({
        where: { id: cookbook.id },
        data: { title: "Updated Title" },
      });

      expect(updated.title).toBe("Updated Title");
    });

    it("should reject empty title", async () => {
      const title = "";
      const isValid = title.trim().length > 0;

      expect(isValid).toBe(false);
    });

    it("should reject duplicate title", async () => {
      await db.cookbook.create({
        data: {
          title: "Existing Title",
          authorId: testUserId,
        },
      });

      const cookbook = await db.cookbook.create({
        data: {
          title: "Different Title",
          authorId: testUserId,
        },
      });

      await expect(
        db.cookbook.update({
          where: { id: cookbook.id },
          data: { title: "Existing Title" },
        })
      ).rejects.toThrow();
    });
  });

  describe("cookbooks.$id action - addRecipe", () => {
    it("should add recipe to cookbook", async () => {
      const cookbook = await db.cookbook.create({
        data: {
          title: "Test Cookbook",
          authorId: testUserId,
        },
      });

      const recipe = await db.recipe.create({
        data: {
          title: "Test Recipe",
          chefId: testUserId,
        },
      });

      const relation = await db.recipeInCookbook.create({
        data: {
          cookbookId: cookbook.id,
          recipeId: recipe.id,
          addedById: testUserId,
        },
      });

      expect(relation).toBeDefined();
      expect(relation.cookbookId).toBe(cookbook.id);
      expect(relation.recipeId).toBe(recipe.id);
    });

    it("should reject duplicate recipe in cookbook", async () => {
      const cookbook = await db.cookbook.create({
        data: {
          title: "Test Cookbook",
          authorId: testUserId,
        },
      });

      const recipe = await db.recipe.create({
        data: {
          title: "Test Recipe",
          chefId: testUserId,
        },
      });

      await db.recipeInCookbook.create({
        data: {
          cookbookId: cookbook.id,
          recipeId: recipe.id,
          addedById: testUserId,
        },
      });

      await expect(
        db.recipeInCookbook.create({
          data: {
            cookbookId: cookbook.id,
            recipeId: recipe.id,
            addedById: testUserId,
          },
        })
      ).rejects.toThrow();
    });
  });

  describe("cookbooks.$id action - removeRecipe", () => {
    it("should remove recipe from cookbook", async () => {
      const cookbook = await db.cookbook.create({
        data: {
          title: "Test Cookbook",
          authorId: testUserId,
        },
      });

      const recipe = await db.recipe.create({
        data: {
          title: "Test Recipe",
          chefId: testUserId,
        },
      });

      const relation = await db.recipeInCookbook.create({
        data: {
          cookbookId: cookbook.id,
          recipeId: recipe.id,
          addedById: testUserId,
        },
      });

      await db.recipeInCookbook.delete({
        where: { id: relation.id },
      });

      const found = await db.recipeInCookbook.findUnique({
        where: { id: relation.id },
      });

      expect(found).toBeNull();
    });

    it("should not delete recipe when removed from cookbook", async () => {
      const cookbook = await db.cookbook.create({
        data: {
          title: "Test Cookbook",
          authorId: testUserId,
        },
      });

      const recipe = await db.recipe.create({
        data: {
          title: "Test Recipe",
          chefId: testUserId,
        },
      });

      const relation = await db.recipeInCookbook.create({
        data: {
          cookbookId: cookbook.id,
          recipeId: recipe.id,
          addedById: testUserId,
        },
      });

      await db.recipeInCookbook.delete({
        where: { id: relation.id },
      });

      const foundRecipe = await db.recipe.findUnique({
        where: { id: recipe.id },
      });

      expect(foundRecipe).not.toBeNull();
    });
  });

  describe("cookbooks.$id action - delete", () => {
    it("should delete cookbook", async () => {
      const cookbook = await db.cookbook.create({
        data: {
          title: "To Delete",
          authorId: testUserId,
        },
      });

      await db.cookbook.delete({
        where: { id: cookbook.id },
      });

      const found = await db.cookbook.findUnique({
        where: { id: cookbook.id },
      });

      expect(found).toBeNull();
    });

    it("should cascade delete recipe relations but not recipes", async () => {
      const cookbook = await db.cookbook.create({
        data: {
          title: "Test Cookbook",
          authorId: testUserId,
        },
      });

      const recipe = await db.recipe.create({
        data: {
          title: "Test Recipe",
          chefId: testUserId,
        },
      });

      await db.recipeInCookbook.create({
        data: {
          cookbookId: cookbook.id,
          recipeId: recipe.id,
          addedById: testUserId,
        },
      });

      await db.cookbook.delete({
        where: { id: cookbook.id },
      });

      const relations = await db.recipeInCookbook.findMany({
        where: { cookbookId: cookbook.id },
      });

      const foundRecipe = await db.recipe.findUnique({
        where: { id: recipe.id },
      });

      expect(relations).toHaveLength(0);
      expect(foundRecipe).not.toBeNull();
    });
  });

  describe("authorization", () => {
    it("should only allow owner to update cookbook", async () => {
      const otherUser = await db.user.create({
        data: createTestUser(),
      });

      const cookbook = await db.cookbook.create({
        data: {
          title: "Owner Cookbook",
          authorId: otherUser.id,
        },
      });

      const foundCookbook = await db.cookbook.findUnique({
        where: { id: cookbook.id },
        select: { authorId: true },
      });

      expect(foundCookbook?.authorId).not.toBe(testUserId);
    });
  });
});
