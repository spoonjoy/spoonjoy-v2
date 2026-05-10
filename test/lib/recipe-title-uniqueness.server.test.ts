import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "~/lib/db.server";
import {
  ACTIVE_RECIPE_TITLE_CONFLICT_ERROR,
  findActiveRecipeTitleConflict,
  validateActiveRecipeTitleUnique,
} from "~/lib/recipe-title-uniqueness.server";
import { createTestUser } from "../utils";
import { cleanupDatabase } from "../helpers/cleanup";

describe("recipe title uniqueness", () => {
  let chefId: string;
  let otherChefId: string;

  beforeEach(async () => {
    await cleanupDatabase();
    const chef = await db.user.create({ data: createTestUser() });
    const otherChef = await db.user.create({ data: createTestUser() });
    chefId = chef.id;
    otherChefId = otherChef.id;
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("finds active title conflicts for the same chef after trimming", async () => {
    const recipe = await db.recipe.create({
      data: {
        title: "Sunday Sauce",
        chefId,
      },
    });

    await expect(findActiveRecipeTitleConflict(db, {
      chefId,
      title: "  Sunday Sauce  ",
    })).resolves.toEqual({ id: recipe.id, title: "Sunday Sauce" });
  });

  it("ignores the current recipe and other chefs when checking conflicts", async () => {
    const recipe = await db.recipe.create({
      data: {
        title: "Shared Name",
        chefId,
      },
    });
    await db.recipe.create({
      data: {
        title: "Shared Name",
        chefId: otherChefId,
      },
    });

    await expect(findActiveRecipeTitleConflict(db, {
      chefId,
      title: "Shared Name",
      excludeRecipeId: recipe.id,
    })).resolves.toBeNull();
  });

  it("ignores soft-deleted recipes", async () => {
    await db.recipe.create({
      data: {
        title: "Archived Pie",
        chefId,
        deletedAt: new Date(),
      },
    });

    await expect(validateActiveRecipeTitleUnique(db, {
      chefId,
      title: "Archived Pie",
    })).resolves.toEqual({ valid: true });
  });

  it("returns a validation error when an active conflict exists", async () => {
    await db.recipe.create({
      data: {
        title: "Conflict Cake",
        chefId,
      },
    });

    await expect(validateActiveRecipeTitleUnique(db, {
      chefId,
      title: "Conflict Cake",
    })).resolves.toEqual({
      valid: false,
      error: ACTIVE_RECIPE_TITLE_CONFLICT_ERROR,
    });
  });
});
