import { faker } from "@faker-js/faker";
import { db } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { sessionStorage } from "~/lib/session.server";
import { getOrCreateIngredientRef } from "../utils";

export async function createDrawerUser(label: string) {
  const suffix = `${label}-${faker.string.alphanumeric(8)}`.toLowerCase();
  return createUser(
    db,
    `${suffix}@example.com`,
    suffix,
    "testPassword123",
  );
}

export async function sessionHeaders(userId: string) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  const cookieValue = (await sessionStorage.commitSession(session)).split(";")[0];
  return new Headers({ Cookie: cookieValue });
}

export async function createDrawerRecipe({
  chefId,
  title,
  description = null,
  servings = null,
  updatedAt,
  createdAt,
  deletedAt = null,
  sourceRecipeId = null,
}: {
  chefId: string;
  title: string;
  description?: string | null;
  servings?: string | null;
  updatedAt?: Date;
  createdAt?: Date;
  deletedAt?: Date | null;
  sourceRecipeId?: string | null;
}) {
  return db.recipe.create({
    data: {
      chefId,
      title,
      description,
      servings,
      createdAt,
      updatedAt,
      deletedAt,
      sourceRecipeId,
    },
  });
}

export async function addIngredientToRecipe(recipeId: string, ingredientName: string) {
  const recipeStep = await db.recipeStep.create({
    data: {
      recipeId,
      stepNum: 1,
      stepTitle: "Prep",
      description: `Use ${ingredientName}`,
    },
  });
  const unit = await db.unit.create({
    data: { name: `unit-${ingredientName}-${faker.string.alphanumeric(6)}` },
  });
  const ingredientRef = await getOrCreateIngredientRef(db, ingredientName);
  return db.ingredient.create({
    data: {
      recipeId,
      stepNum: recipeStep.stepNum,
      quantity: 1,
      unitId: unit.id,
      ingredientRefId: ingredientRef.id,
    },
  });
}
