import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { ACCOUNT_EXPORT_FORMAT, accountExportFileName, buildAccountExport } from "~/lib/account-export.server";
import { cleanupDatabase } from "../helpers/cleanup";

const ORIGIN = "https://spoonjoy.app";
const NOW = new Date("2026-10-09T12:00:00.000Z");

beforeEach(async () => {
  await cleanupDatabase();
});

afterEach(async () => {
  await cleanupDatabase();
});

async function arrange() {
  const ada = await db.user.create({
    data: {
      email: "ada@example.com",
      username: "ada",
      hashedPassword: "hash",
      salt: "salt",
      photoUrl: "/photos/profiles/ada/me.jpg",
      OAuth: { create: { provider: "apple", providerUserId: "apple-ada", providerUsername: "ada" } },
      credentials: { create: { id: "passkey", publicKey: Buffer.from([0]), counter: 0 } },
    },
  });
  const grace = await db.user.create({ data: { email: "grace@example.com", username: "grace" } });
  const cup = await db.unit.create({ data: { name: "export-cup" } });
  const flour = await db.ingredientRef.create({ data: { name: "export-flour" } });

  const bread = await db.recipe.create({
    data: {
      title: "Bread",
      description: "Crusty",
      servings: "2",
      chefId: ada.id,
      sourceUrl: "https://example.com/bread",
      steps: {
        create: [
          { stepNum: 1, stepTitle: "Mix", description: "Mix flour", duration: 5 },
          { stepNum: 2, description: "Bake" },
        ],
      },
    },
  });
  await db.ingredient.create({ data: { recipeId: bread.id, stepNum: 1, quantity: 2, unitId: cup.id, ingredientRefId: flour.id } });
  await db.stepOutputUse.create({ data: { recipeId: bread.id, outputStepNum: 1, inputStepNum: 2 } });
  const cover = await db.recipeCover.create({
    data: { recipeId: bread.id, imageUrl: "/photos/recipes/bread.jpg", sourceType: "upload", stylizedImageUrl: "https://cdn.example.com/s.jpg" },
  });
  await db.recipeCover.create({ data: { recipeId: bread.id, imageUrl: "/photos/recipes/old.jpg", sourceType: "upload", status: "archived" } });
  await db.recipe.update({ where: { id: bread.id }, data: { activeCoverId: cover.id } });

  const graceDish = await db.recipe.create({ data: { title: "Soup", chefId: grace.id } });
  await db.recipe.create({ data: { title: "Not mine", chefId: grace.id } });
  await db.cookbook.create({
    data: {
      title: "Weeknights",
      authorId: ada.id,
      recipes: { create: [{ recipeId: bread.id, addedById: ada.id }, { recipeId: graceDish.id, addedById: ada.id }] },
    },
  });
  await db.shoppingList.create({
    data: {
      authorId: ada.id,
      items: {
        create: [
          { ingredientRefId: flour.id, unitId: cup.id, quantity: 3, categoryKey: "baking", sortIndex: 0 },
          { ingredientRefId: flour.id, quantity: null, checked: true, sortIndex: 1 },
          { ingredientRefId: flour.id, quantity: 1, unitId: null, deletedAt: new Date(), sortIndex: 2 },
        ],
      },
    },
  });
  await db.recipeSpoon.create({
    data: { chefId: ada.id, recipeId: graceDish.id, note: "Lovely", nextTime: "More salt", photoUrl: "/photos/spoons/ada/1.jpg", cookedAt: NOW },
  });
  await db.recipeSpoon.create({ data: { chefId: ada.id, recipeId: graceDish.id, deletedAt: NOW } });
  await db.recipeSpoon.create({ data: { chefId: grace.id, recipeId: bread.id } });
  return { ada, bread, cover, graceDish };
}

describe("buildAccountExport", () => {
  it("includes the account's recipes, cookbooks, shopping list and cooks, and no secrets", async () => {
    const { ada, bread, cover, graceDish } = await arrange();

    const exported = await buildAccountExport(db, ada.id, ORIGIN, NOW);

    expect(exported).toMatchObject({
      format: ACCOUNT_EXPORT_FORMAT,
      exportedAt: NOW.toISOString(),
      account: {
        id: ada.id,
        username: "ada",
        email: "ada@example.com",
        photoUrl: "https://spoonjoy.app/photos/profiles/ada/me.jpg",
        signInMethods: ["password", "passkey", "apple"],
      },
    });
    expect(exported!.recipes).toHaveLength(1);
    expect(exported!.recipes[0]).toMatchObject({
      id: bread.id,
      title: "Bread",
      description: "Crusty",
      servings: "2",
      sourceUrl: "https://example.com/bread",
      forkedFromRecipeId: null,
      deletedAt: null,
      url: `https://spoonjoy.app/recipes/${bread.id}`,
      steps: [
        { stepNum: 1, title: "Mix", description: "Mix flour", durationMinutes: 5, usesOutputOfSteps: [], ingredients: [{ quantity: 2, unit: "export-cup", name: "export-flour" }] },
        { stepNum: 2, title: null, description: "Bake", durationMinutes: null, usesOutputOfSteps: [1], ingredients: [] },
      ],
    });
    expect(exported!.recipes[0].covers).toEqual([
      expect.objectContaining({ id: cover.id, active: true, imageUrl: "https://spoonjoy.app/photos/recipes/bread.jpg", stylizedImageUrl: "https://cdn.example.com/s.jpg", sourceImageUrl: null }),
      expect.objectContaining({ active: false, status: "archived", imageUrl: "https://spoonjoy.app/photos/recipes/old.jpg" }),
    ]);
    expect(exported!.cookbooks).toEqual([
      expect.objectContaining({
        title: "Weeknights",
        recipes: [
          expect.objectContaining({ id: bread.id, title: "Bread", chef: "ada" }),
          expect.objectContaining({ id: graceDish.id, title: "Soup", chef: "grace" }),
        ],
      }),
    ]);
    expect(exported!.shoppingList).toEqual([
      { name: "export-flour", quantity: 3, unit: "export-cup", checked: false, category: "baking" },
      { name: "export-flour", quantity: null, unit: null, checked: true, category: null },
    ]);
    expect(exported!.cooks).toEqual([
      expect.objectContaining({ recipeId: graceDish.id, recipeTitle: "Soup", note: "Lovely", nextTime: "More salt", photoUrl: "https://spoonjoy.app/photos/spoons/ada/1.jpg", cookedAt: NOW.toISOString() }),
    ]);

    const text = JSON.stringify(exported);
    for (const secret of ["hash", "salt", "publicKey", "passkey\":"]) expect(text).not.toContain(`"${secret}`);
  });

  it("exports an empty account", async () => {
    const user = await db.user.create({ data: { email: "new@example.com", username: "new_chef" } });
    const exported = await buildAccountExport(db, user.id, ORIGIN);
    expect(exported).toMatchObject({
      account: { photoUrl: null, signInMethods: [] },
      recipes: [],
      cookbooks: [],
      shoppingList: [],
      cooks: [],
    });
    expect(Date.parse(exported!.exportedAt)).not.toBeNaN();
  });

  it("returns null for a missing account", async () => {
    await expect(buildAccountExport(db, "nobody", ORIGIN)).resolves.toBeNull();
  });
});

describe("accountExportFileName", () => {
  it("names the file after the username and the date", () => {
    expect(accountExportFileName("ada.lovelace", NOW)).toBe("spoonjoy-ada.lovelace-2026-10-09.json");
    expect(accountExportFileName("a/b c", NOW)).toBe("spoonjoy-a-b-c-2026-10-09.json");
  });
});
