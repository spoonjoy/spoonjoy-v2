import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "~/lib/db.server";
import {
  ACTIVE_RECIPE_TITLE_CONFLICT_ERROR,
  ACTIVE_RECIPE_TITLE_UNIQUE_INDEX,
  findActiveRecipeTitleConflict,
  isActiveRecipeTitleConflictError,
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

  it.each([
    {
      label: "Prisma field target",
      error: Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
        meta: { modelName: "Recipe", target: ["chefId", "title"] },
      }),
    },
    {
      label: "Prisma named target",
      error: Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
        meta: { target: ACTIVE_RECIPE_TITLE_UNIQUE_INDEX },
      }),
    },
    {
      label: "native D1 column signature",
      error: new Error(
        "D1_ERROR: UNIQUE constraint failed: Recipe.chefId, Recipe.title: SQLITE_CONSTRAINT",
      ),
    },
    {
      label: "native D1 extended column signature",
      error: new Error(
        "D1_ERROR: UNIQUE constraint failed: Recipe.chefId, Recipe.title: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)",
      ),
    },
    {
      label: "Prisma raw-query SQLite signature",
      error: Object.assign(new Error("Raw query failed"), {
        code: "P2010",
        meta: {
          code: "2067",
          message: "UNIQUE constraint failed: Recipe.chefId, Recipe.title",
        },
      }),
    },
    {
      label: "nested native named-index signature",
      error: Object.assign(new Error("D1 batch failed"), {
        cause: new Error(
          `UNIQUE constraint failed: index '${ACTIVE_RECIPE_TITLE_UNIQUE_INDEX}'`,
        ),
      }),
    },
    {
      label: "nested native extended named-index signature",
      error: Object.assign(new Error("D1 batch failed"), {
        cause: new Error(
          `UNIQUE constraint failed: index '${ACTIVE_RECIPE_TITLE_UNIQUE_INDEX}': SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)`,
        ),
      }),
    },
  ])("recognizes the exact $label race error", ({ error }) => {
    expect(isActiveRecipeTitleConflictError(error)).toBe(true);
  });

  it("recognizes the actual Prisma raw-query error emitted by the partial index", async () => {
    const existingIndex = await db.$queryRawUnsafe<Array<{ present: number }>>(`
      SELECT 1 AS "present" FROM sqlite_master
      WHERE type = 'index' AND name = '${ACTIVE_RECIPE_TITLE_UNIQUE_INDEX}'
    `);
    if (existingIndex.length === 0) {
      await db.$executeRawUnsafe(`
        CREATE UNIQUE INDEX "${ACTIVE_RECIPE_TITLE_UNIQUE_INDEX}"
        ON "Recipe"("chefId", "title") WHERE "deletedAt" IS NULL
      `);
    }
    await db.recipe.create({ data: { chefId, title: "Raw Query Race" } });

    try {
      let conflict: unknown;
      try {
        await db.$queryRawUnsafe(
          `INSERT INTO "Recipe" ("id", "title", "chefId", "createdAt", "updatedAt")
           VALUES (?, ?, ?, ?, ?)`,
          "raw-query-race-recipe",
          "Raw Query Race",
          chefId,
          new Date().toISOString(),
          new Date().toISOString(),
        );
      } catch (error) {
        conflict = error;
      }

      expect(conflict).toMatchObject({
        code: "P2010",
        meta: {
          code: "2067",
          message: "UNIQUE constraint failed: Recipe.chefId, Recipe.title",
        },
      });
      expect(isActiveRecipeTitleConflictError(conflict)).toBe(true);
    } finally {
      if (existingIndex.length === 0) {
        await db.$executeRawUnsafe(`DROP INDEX "${ACTIVE_RECIPE_TITLE_UNIQUE_INDEX}"`);
      }
    }
  });

  it.each([
    {
      label: "another Prisma model with the same field names",
      error: Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
        meta: { modelName: "Draft", target: ["chefId", "title"] },
      }),
    },
    {
      label: "a Prisma conflict without metadata",
      error: Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
        meta: null,
      }),
    },
    {
      label: "the legacy three-column Recipe target",
      error: Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
        meta: {
          modelName: "Recipe",
          target: ["chefId", "title", "deletedAt"],
        },
      }),
    },
    {
      label: "another Recipe constraint",
      error: new Error(
        "D1_ERROR: UNIQUE constraint failed: Recipe.id: SQLITE_CONSTRAINT",
      ),
    },
    {
      label: "a Prisma raw-query failure for another constraint",
      error: Object.assign(new Error("Raw query failed"), {
        code: "P2010",
        meta: {
          code: "2067",
          message: "UNIQUE constraint failed: Recipe.id",
        },
      }),
    },
    {
      label: "a Prisma raw-query failure without SQLite metadata",
      error: Object.assign(new Error("Raw query failed"), {
        code: "P2010",
        meta: { code: "N/A", message: "database unavailable" },
      }),
    },
    {
      label: "a longer Recipe constraint with the same prefix",
      error: new Error(
        "D1_ERROR: UNIQUE constraint failed: Recipe.chefId, Recipe.title, Recipe.deletedAt: SQLITE_CONSTRAINT",
      ),
    },
    {
      label: "a different extended SQLite constraint",
      error: new Error(
        "D1_ERROR: UNIQUE constraint failed: Recipe.chefId, Recipe.title: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)",
      ),
    },
    { label: "an unrelated failure", error: new Error("database unavailable") },
    { label: "an object without a message", error: {} },
    { label: "a primitive", error: "Recipe_active_chefId_title_key" },
  ])("rejects $label", ({ error }) => {
    expect(isActiveRecipeTitleConflictError(error)).toBe(false);
  });

  it("terminates safely when an error cause cycle is unrelated", () => {
    const error = new Error("cyclic failure") as Error & { cause?: unknown };
    error.cause = error;

    expect(isActiveRecipeTitleConflictError(error)).toBe(false);
  });
});
