import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { faker } from "@faker-js/faker";
import { db } from "~/lib/db.server";
import {
  normalizeSearchLimit,
  normalizeSearchScope,
  ensureSearchIndexFresh,
  rebuildSearchIndex,
  searchSpoonjoy,
  tokenizeSearchQuery,
  toFtsQuery,
} from "~/lib/search.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser, getOrCreateIngredientRef, getOrCreateUnit } from "../utils";

async function createChef(usernamePrefix: string) {
  return db.user.create({
    data: {
      ...createTestUser(),
      username: `${usernamePrefix}_${faker.string.alphanumeric(8).toLowerCase()}`,
    },
  });
}

async function createSearchableRecipe(chefId: string, title: string, ingredientName: string) {
  const recipe = await db.recipe.create({
    data: {
      title,
      description: "Bright breakfast with a quiet robot pantry note",
      servings: "4",
      chefId,
    },
  });
  await db.recipeStep.create({
    data: {
      recipeId: recipe.id,
      stepNum: 1,
      stepTitle: "Mix the batter",
      description: `Fold in ${ingredientName} and rest the bowl`,
    },
  });
  const unit = await getOrCreateUnit(db, `cup_${faker.string.alphanumeric(5).toLowerCase()}`);
  const ingredientRef = await getOrCreateIngredientRef(db, ingredientName);
  await db.ingredient.create({
    data: {
      recipeId: recipe.id,
      stepNum: 1,
      quantity: 2,
      unitId: unit.id,
      ingredientRefId: ingredientRef.id,
    },
  });
  return recipe;
}

async function createShoppingItem(ownerId: string, name: string, checked: boolean, quantity: number | null) {
  const shoppingList = await db.shoppingList.upsert({
    where: { authorId: ownerId },
    update: {},
    create: { authorId: ownerId },
  });
  const ingredientRef = await getOrCreateIngredientRef(db, name);
  const unit = quantity === null ? null : await getOrCreateUnit(db, `bag_${faker.string.alphanumeric(5).toLowerCase()}`);

  return db.shoppingListItem.create({
    data: {
      shoppingListId: shoppingList.id,
      ingredientRefId: ingredientRef.id,
      unitId: unit?.id ?? null,
      quantity,
      checked,
      checkedAt: checked ? new Date() : null,
      categoryKey: checked ? "bakery" : "dairy",
      iconKey: checked ? "bread" : "milk",
    },
  });
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function sourceFingerprint() {
  const rows = await db.$queryRawUnsafe<Array<{ sourceFingerprint: string }>>(
    `SELECT "sourceFingerprint" FROM "SearchIndexMetadata" WHERE "id" = 'current' LIMIT 1`,
  );
  return JSON.parse(rows[0]!.sourceFingerprint) as Array<{
    tableName: string;
    rowCount: number;
    latestAt: string | null;
    contentHash: string | null;
  }>;
}

describe("search.server", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("normalizes search inputs for UI and MCP callers", () => {
    expect(normalizeSearchScope("recipes")).toBe("recipes");
    expect(normalizeSearchScope("cookbooks")).toBe("cookbooks");
    expect(normalizeSearchScope("chefs")).toBe("chefs");
    expect(normalizeSearchScope("shopping-list")).toBe("shopping-list");
    expect(normalizeSearchScope("shopping")).toBe("shopping-list");
    expect(normalizeSearchScope("unknown")).toBe("all");
    expect(normalizeSearchScope(null)).toBe("all");

    expect(normalizeSearchLimit(undefined)).toBe(20);
    expect(normalizeSearchLimit(null)).toBe(20);
    expect(normalizeSearchLimit(Number.NaN)).toBe(20);
    expect(normalizeSearchLimit(0)).toBe(1);
    expect(normalizeSearchLimit(2.8)).toBe(2);
    expect(normalizeSearchLimit(999)).toBe(50);

    expect(tokenizeSearchQuery("Creme brulee, beans-2!")).toEqual(["creme", "brulee", "beans", "2"]);
    expect(toFtsQuery("Creme brulee")).toBe("creme* AND brulee*");
    expect(toFtsQuery("!!!")).toBeNull();
  });

  it("indexes recipes, cookbooks, chefs, and active cookbook recipes for full-text search", async () => {
    const chef = await createChef("citruschef");
    const recipe = await createSearchableRecipe(chef.id, "Citrus Robot Pancakes", "meyer lemon");
    const extraUnit = await getOrCreateUnit(db, `pinch_${faker.string.alphanumeric(5).toLowerCase()}`);
    const extraIngredientRef = await getOrCreateIngredientRef(db, "zesty orange");
    await db.ingredient.create({
      data: {
        recipeId: recipe.id,
        stepNum: 1,
        quantity: 1,
        unitId: extraUnit.id,
        ingredientRefId: extraIngredientRef.id,
      },
    });
    const activeCover = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "https://images.example/citrus-robot-pancakes-raw.jpg",
        stylizedImageUrl: "https://images.example/citrus-robot-pancakes-editorial.jpg",
        sourceType: "spoon",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "",
        sourceType: "ai-placeholder",
        createdAt: new Date("2026-02-01T00:00:00.000Z"),
      },
    });
    await db.recipe.update({
      where: { id: recipe.id },
      data: {
        activeCoverId: activeCover.id,
        activeCoverVariant: "stylized",
        coverMode: "manual",
      },
    });
    const cookbook = await db.cookbook.create({ data: { title: "Citrus Brunch", authorId: chef.id } });
    await db.recipeInCookbook.create({ data: { cookbookId: cookbook.id, recipeId: recipe.id, addedById: chef.id } });
    const emptyCookbook = await db.cookbook.create({ data: { title: "Empty Shelf", authorId: chef.id } });
    const noteOnlyRecipe = await db.recipe.create({
      data: {
        title: "Ingredient-Free Tomato Notes",
        description: "A holding recipe before the pantry is measured",
        chefId: chef.id,
      },
    });
    await db.recipeStep.create({
      data: {
        recipeId: noteOnlyRecipe.id,
        stepNum: 1,
        stepTitle: "Warm the pan",
        description: "No ingredients yet, just listen for the sizzle",
      },
    });

    const deletedRecipe = await db.recipe.create({
      data: { title: "Deleted Citrus Ghost", chefId: chef.id, deletedAt: new Date() },
    });
    await db.recipeInCookbook.create({ data: { cookbookId: cookbook.id, recipeId: deletedRecipe.id, addedById: chef.id } });

    await expect(rebuildSearchIndex(db)).resolves.toBe(5);

    const citrusResults = await searchSpoonjoy(db, { query: "citrus", scope: "all" });
    expect(citrusResults.map((result) => result.type)).toEqual(expect.arrayContaining(["chef", "cookbook", "recipe"]));
    expect(citrusResults.find((result) => result.type === "cookbook")?.metadata).toMatchObject({
      recipeCount: 1,
      recipeTitles: ["Citrus Robot Pancakes"],
    });

    const ingredientResults = await searchSpoonjoy(db, { query: "meyer lemon", scope: "recipes" });
    expect(ingredientResults).toHaveLength(1);
    expect(ingredientResults[0]).toMatchObject({
      type: "recipe",
      id: recipe.id,
      title: "Citrus Robot Pancakes",
      href: `/recipes/${recipe.id}`,
      imageUrl: "https://images.example/citrus-robot-pancakes-editorial.jpg",
    });
    expect(ingredientResults[0].metadata).toMatchObject({
      servings: "4",
      chefUsername: chef.username,
      ingredientNames: ["meyer lemon", "zesty orange"],
      stepCount: 1,
      cookbookTitles: ["Citrus Brunch"],
      coverProvenanceLabel: "Editorial photo",
      coverSourceType: "spoon",
      coverVariant: "stylized",
    });

    const noteOnlyResults = await searchSpoonjoy(db, { query: "sizzle", scope: "recipes" });
    expect(noteOnlyResults).toHaveLength(1);
    expect(noteOnlyResults[0]).toMatchObject({
      id: noteOnlyRecipe.id,
      title: "Ingredient-Free Tomato Notes",
      metadata: { ingredientNames: [], stepCount: 1 },
    });

    const emptyCookbookResults = await searchSpoonjoy(db, { query: "empty shelf", scope: "cookbooks" });
    expect(emptyCookbookResults).toHaveLength(1);
    expect(emptyCookbookResults[0]).toMatchObject({
      id: emptyCookbook.id,
      metadata: { recipeCount: 0, recipeTitles: [] },
    });
  });

  it("uses recent public results, owner filters, and safe empty-query handling", async () => {
    const firstChef = await createChef("firstchef");
    const secondChef = await createChef("secondchef");
    const firstRecipe = await createSearchableRecipe(firstChef.id, "Tuesday Tomato Toast", "tomato");
    await createSearchableRecipe(secondChef.id, "Wednesday Tomato Toast", "tomato");

    const defaultResults = await searchSpoonjoy(db);
    expect(defaultResults.map((result) => result.type)).toEqual(expect.arrayContaining(["chef", "recipe"]));

    const ownerResults = await searchSpoonjoy(db, {
      query: "",
      scope: "recipes",
      ownerId: firstChef.id,
      limit: 10,
    });
    expect(ownerResults).toHaveLength(1);
    expect(ownerResults[0]).toMatchObject({ id: firstRecipe.id, score: 0 });

    const limitedResults = await searchSpoonjoy(db, { query: "tomato", scope: "recipes", limit: 1 });
    expect(limitedResults).toHaveLength(1);

    await expect(searchSpoonjoy(db, { query: "!!!", scope: "all" })).resolves.toEqual([]);
  });

  it("rebuilds recipe documents in small D1-safe batches", async () => {
    const chef = await createChef("batchchef");

    for (let index = 0; index < 12; index += 1) {
      await db.recipe.create({
        data: {
          title: `Batchable Lentil Stew ${index}`,
          description: "Batch search coverage",
          chefId: chef.id,
        },
      });
    }

    await expect(rebuildSearchIndex(db)).resolves.toBe(13);

    const results = await searchSpoonjoy(db, { query: "batchable", scope: "recipes", limit: 20 });
    expect(results).toHaveLength(12);
    expect(results.every((result) => result.type === "recipe")).toBe(true);
  });

  it("stores ordered neutral metadata only on active recipe search documents", async () => {
    const chef = await createChef("metadatachef");
    const recipe = await createSearchableRecipe(chef.id, "Metadata Citrus Noodles", "citrus");
    await db.recipe.update({ where: { id: recipe.id }, data: { course: "side" } });
    await db.recipeTag.createMany({
      data: [
        { id: "tag-search-accent", recipeId: recipe.id, label: "Accent Apple", normalizedLabel: "\u00e4pfel" },
        { id: "tag-search-zebra", recipeId: recipe.id, label: "Zebra", normalizedLabel: "zebra" },
      ],
    });
    const deleted = await db.recipe.create({
      data: { title: "Deleted Metadata Noodles", chefId: chef.id, course: "dessert", deletedAt: new Date() },
    });
    await db.recipeTag.create({
      data: { id: "tag-search-deleted", recipeId: deleted.id, label: "Deleted", normalizedLabel: "deleted" },
    });

    await rebuildSearchIndex(db);

    const results = await searchSpoonjoy(db, { query: "metadata", scope: "all" });
    const recipeResult = results.find((result) => result.type === "recipe");
    expect(recipeResult).toBeDefined();
    expect(Object.keys(recipeResult!.metadata).sort()).toEqual([
      "chefUsername", "cookbookTitles", "course", "coverProvenanceLabel", "coverSourceType",
      "coverVariant", "ingredientNames", "servings", "stepCount", "tags",
    ].sort());
    expect(recipeResult!.metadata).toMatchObject({ course: "side", tags: ["Zebra", "Accent Apple"] });

    const rows = await db.$queryRawUnsafe<Array<{ entityId: string; metadata: string }>>(
      `SELECT "entityId", "metadata" FROM "SearchDocument" WHERE "entityType" = 'recipe' ORDER BY "entityId" ASC`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.entityId).toBe(recipe.id);
    expect(JSON.parse(rows[0]!.metadata)).toEqual(recipeResult!.metadata);
  });

  it("stores null course and empty tags on recipe search documents", async () => {
    const chef = await createChef("emptymetadatachef");
    const recipe = await createSearchableRecipe(chef.id, "Empty Metadata Soup", "broth");

    await rebuildSearchIndex(db);
    const rows = await db.$queryRawUnsafe<Array<{ metadata: string }>>(
      `SELECT "metadata" FROM "SearchDocument" WHERE "entityType" = 'recipe' AND "entityId" = ?`,
      recipe.id,
    );

    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.metadata)).toMatchObject({ course: null, tags: [] });
  });

  it("fingerprints multiple active recipes and cross-recipe tags in canonical fixed-key order", async () => {
    const fixedAt = new Date("2026-07-22T12:34:56.789Z");
    const chef = await createChef("fingerprintchef");
    const recipeZ = await db.recipe.create({
      data: {
        id: "recipe-z-fingerprint",
        title: "Z Metadata Fingerprint Soup",
        chefId: chef.id,
        course: "main",
        createdAt: fixedAt,
        updatedAt: fixedAt,
      },
    });
    const recipeA = await db.recipe.create({
      data: {
        id: "recipe-\u00e4-fingerprint",
        title: "A Metadata Fingerprint Soup",
        chefId: chef.id,
        course: null,
        createdAt: fixedAt,
        updatedAt: fixedAt,
      },
    });
    await db.recipeTag.createMany({
      data: [
        {
          id: "tag-z-beta",
          recipeId: recipeZ.id,
          label: "Accent Apple",
          normalizedLabel: "\u00e4pfel",
          createdAt: fixedAt,
          updatedAt: fixedAt,
        },
        {
          id: "tag-a-zeta",
          recipeId: recipeA.id,
          label: "Zeta",
          normalizedLabel: "zeta",
          createdAt: fixedAt,
          updatedAt: fixedAt,
        },
        {
          id: "tag-a-alpha",
          recipeId: recipeA.id,
          label: "Alpha",
          normalizedLabel: "alpha",
          createdAt: fixedAt,
          updatedAt: fixedAt,
        },
        {
          id: "tag-z-alpha",
          recipeId: recipeZ.id,
          label: "Zebra",
          normalizedLabel: "zebra",
          createdAt: fixedAt,
          updatedAt: fixedAt,
        },
      ],
    });
    const deleted = await db.recipe.create({
      data: {
        id: "recipe-metadata-deleted-fingerprint",
        title: "Deleted Metadata Fingerprint",
        chefId: chef.id,
        course: "dessert",
        deletedAt: fixedAt,
        createdAt: fixedAt,
        updatedAt: fixedAt,
      },
    });
    await db.recipeTag.create({
      data: {
        id: "tag-fingerprint-deleted",
        recipeId: deleted.id,
        label: "Deleted",
        normalizedLabel: "deleted",
        createdAt: fixedAt,
        updatedAt: fixedAt,
      },
    });

    await rebuildSearchIndex(db);
    const fingerprint = await sourceFingerprint();

    expect(fingerprint.find((row) => row.tableName === "Recipe")?.contentHash).toBe(sha256(JSON.stringify([
      { recipeId: recipeZ.id, course: "main" },
      { recipeId: recipeA.id, course: null },
    ])));
    expect(fingerprint.find((row) => row.tableName === "RecipeTag")?.contentHash).toBe(sha256(JSON.stringify([
      {
        id: "tag-z-alpha",
        recipeId: recipeZ.id,
        label: "Zebra",
        normalizedLabel: "zebra",
        createdAt: fixedAt.toISOString(),
        updatedAt: fixedAt.toISOString(),
      },
      {
        id: "tag-z-beta",
        recipeId: recipeZ.id,
        label: "Accent Apple",
        normalizedLabel: "\u00e4pfel",
        createdAt: fixedAt.toISOString(),
        updatedAt: fixedAt.toISOString(),
      },
      {
        id: "tag-a-alpha",
        recipeId: recipeA.id,
        label: "Alpha",
        normalizedLabel: "alpha",
        createdAt: fixedAt.toISOString(),
        updatedAt: fixedAt.toISOString(),
      },
      {
        id: "tag-a-zeta",
        recipeId: recipeA.id,
        label: "Zeta",
        normalizedLabel: "zeta",
        createdAt: fixedAt.toISOString(),
        updatedAt: fixedAt.toISOString(),
      },
    ])));
  });

  it("rebuilds after a same-timestamp course replacement", async () => {
    const fixedAt = new Date("2026-07-22T13:00:00.000Z");
    const chef = await createChef("substitutionchef");
    const recipe = await db.recipe.create({
      data: {
        title: "Metadata Substitution Stew",
        chefId: chef.id,
        course: "main",
        createdAt: fixedAt,
        updatedAt: fixedAt,
      },
    });
    await db.recipeTag.create({
      data: {
        recipeId: recipe.id,
        label: "Weeknight",
        normalizedLabel: "weeknight",
        createdAt: fixedAt,
        updatedAt: fixedAt,
      },
    });
    await rebuildSearchIndex(db);

    await db.$executeRawUnsafe(
      `UPDATE "Recipe" SET "course" = 'side', "updatedAt" = ? WHERE "id" = ?`,
      fixedAt,
      recipe.id,
    );
    await ensureSearchIndexFresh(db);
    await expect(searchSpoonjoy(db, { query: "metadata substitution", scope: "recipes" }))
      .resolves.toMatchObject([{ id: recipe.id, metadata: { course: "side", tags: ["Weeknight"] } }]);
  });

  it("rebuilds after a same-timestamp display-label-only replacement", async () => {
    const fixedAt = new Date("2026-07-22T13:10:00.000Z");
    const chef = await createChef("labelsubstitutionchef");
    const recipe = await db.recipe.create({
      data: { title: "Display Label Substitution", chefId: chef.id, createdAt: fixedAt, updatedAt: fixedAt },
    });
    const tag = await db.recipeTag.create({
      data: {
        recipeId: recipe.id,
        label: "Weeknight",
        normalizedLabel: "weeknight",
        createdAt: fixedAt,
        updatedAt: fixedAt,
      },
    });
    await rebuildSearchIndex(db);

    await db.$executeRawUnsafe(
      `UPDATE "RecipeTag" SET "label" = 'WEEKNIGHT', "updatedAt" = ? WHERE "id" = ?`,
      fixedAt,
      tag.id,
    );
    await ensureSearchIndexFresh(db);
    await expect(searchSpoonjoy(db, { query: "display label substitution", scope: "recipes" }))
      .resolves.toMatchObject([{ id: recipe.id, metadata: { tags: ["WEEKNIGHT"] } }]);
  });

  it("rebuilds after a same-timestamp normalized-label replacement", async () => {
    const fixedAt = new Date("2026-07-22T13:20:00.000Z");
    const chef = await createChef("normalizedsubstitutionchef");
    const recipe = await db.recipe.create({
      data: { title: "Normalized Label Substitution", chefId: chef.id, createdAt: fixedAt, updatedAt: fixedAt },
    });
    const target = await db.recipeTag.create({
      data: {
        recipeId: recipe.id,
        label: "Beta Display",
        normalizedLabel: "beta",
        createdAt: fixedAt,
        updatedAt: fixedAt,
      },
    });
    await db.recipeTag.create({
      data: {
        recipeId: recipe.id,
        label: "Alpha Display",
        normalizedLabel: "alpha",
        createdAt: fixedAt,
        updatedAt: fixedAt,
      },
    });
    await rebuildSearchIndex(db);

    await db.$executeRawUnsafe(
      `UPDATE "RecipeTag" SET "normalizedLabel" = 'aardvark', "updatedAt" = ? WHERE "id" = ?`,
      fixedAt,
      target.id,
    );
    await ensureSearchIndexFresh(db);
    await expect(searchSpoonjoy(db, { query: "normalized label substitution", scope: "recipes" }))
      .resolves.toMatchObject([{ id: recipe.id, metadata: { tags: ["Beta Display", "Alpha Display"] } }]);
  });

  it("reuses a fresh search index and rebuilds after source data changes", async () => {
    const chef = await createChef("freshchef");
    const recipe = await createSearchableRecipe(chef.id, "Quiet Pear Toast", "pear");

    await expect(ensureSearchIndexFresh(db)).resolves.toBe(2);
    await db.$executeRawUnsafe(
      `UPDATE "SearchDocument" SET "title" = ? WHERE "entityType" = 'recipe' AND "entityId" = ?`,
      "Cached Marker Toast",
      recipe.id
    );

    const cachedResults = await searchSpoonjoy(db, { query: "cached marker", scope: "recipes" });
    expect(cachedResults).toHaveLength(1);
    expect(cachedResults[0]).toMatchObject({ id: recipe.id, title: "Cached Marker Toast" });

    await db.recipe.update({
      where: { id: recipe.id },
      data: { title: "Bright Plum Toast", description: "Plum notes for a fresh index" },
    });

    const freshResults = await searchSpoonjoy(db, { query: "plum", scope: "recipes" });
    expect(freshResults).toHaveLength(1);
    expect(freshResults[0]).toMatchObject({ id: recipe.id, title: "Bright Plum Toast" });

    const staleMarkerResults = await searchSpoonjoy(db, { query: "cached marker", scope: "recipes" });
    expect(staleMarkerResults).toEqual([]);
  });

  it("refreshes recipe search image URLs when cover URL fields change in place", async () => {
    const chef = await createChef("coverfreshchef");
    const noCoverRecipe = await db.recipe.create({
      data: {
        title: "Bare Cover Freshness Salad",
        description: "Search cover freshness for recipes without cover rows",
        chefId: chef.id,
      },
    });
    const maskedRecipe = await db.recipe.create({
      data: {
        title: "Masked Cover Freshness Gratin",
        description: "Search cover freshness for latest empty covers",
        chefId: chef.id,
      },
    });
    const maskedCover = await db.recipeCover.create({
      data: {
        recipeId: maskedRecipe.id,
        imageUrl: "/photos/recipes/chef/older-gratin.jpg",
        sourceType: "chef-upload",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    });
    await db.recipeCover.create({
      data: {
        recipeId: maskedRecipe.id,
        imageUrl: "",
        sourceType: "ai-placeholder",
        createdAt: new Date("2026-01-02T00:00:00Z"),
      },
    });
    await db.recipe.update({
      where: { id: maskedRecipe.id },
      data: {
        activeCoverId: maskedCover.id,
        activeCoverVariant: "image",
        coverMode: "manual",
      },
    });
    const pendingRecipe = await db.recipe.create({
      data: {
        title: "Pending Cover Freshness Tart",
        description: "Search cover freshness for generated placeholders",
        chefId: chef.id,
      },
    });
    const pendingCover = await db.recipeCover.create({
      data: {
        recipeId: pendingRecipe.id,
        imageUrl: "",
        sourceType: "ai-placeholder",
      },
    });
    await db.recipe.update({
      where: { id: pendingRecipe.id },
      data: {
        activeCoverId: pendingCover.id,
        activeCoverVariant: "image",
        coverMode: "auto",
      },
    });
    const stylizedRecipe = await db.recipe.create({
      data: {
        title: "Stylized Cover Freshness Toast",
        description: "Search cover freshness for stylized uploads",
        chefId: chef.id,
      },
    });
    const stylizedCover = await db.recipeCover.create({
      data: {
        recipeId: stylizedRecipe.id,
        imageUrl: "/photos/recipes/chef/raw-toast.jpg",
        sourceType: "chef-upload",
      },
    });
    await db.recipe.update({
      where: { id: stylizedRecipe.id },
      data: {
        activeCoverId: stylizedCover.id,
        activeCoverVariant: "stylized",
        coverMode: "manual",
      },
    });
    const provenanceRecipe = await db.recipe.create({
      data: {
        title: "Provenance Cover Freshness Beans",
        description: "Search cover freshness for provenance-only updates",
        chefId: chef.id,
      },
    });
    const provenanceCover = await db.recipeCover.create({
      data: {
        recipeId: provenanceRecipe.id,
        imageUrl: "/photos/covers/provenance-beans.jpg",
        sourceType: "chef-upload",
      },
    });
    await db.recipe.update({
      where: { id: provenanceRecipe.id },
      data: {
        activeCoverId: provenanceCover.id,
        activeCoverVariant: "image",
        coverMode: "manual",
      },
    });
    const variantRecipe = await db.recipe.create({
      data: {
        title: "Variant Cover Freshness Soup",
        description: "Search cover freshness for active variant updates",
        chefId: chef.id,
      },
    });
    const variantCover = await db.recipeCover.create({
      data: {
        recipeId: variantRecipe.id,
        imageUrl: "/photos/covers/variant-soup-raw.jpg",
        stylizedImageUrl: "/photos/covers/variant-soup-editorial.jpg",
        sourceType: "spoon",
      },
    });
    await db.recipe.update({
      where: { id: variantRecipe.id },
      data: {
        activeCoverId: variantCover.id,
        activeCoverVariant: "image",
        coverMode: "manual",
      },
    });

    await expect(rebuildSearchIndex(db)).resolves.toBe(7);

    await expect(searchSpoonjoy(db, { query: "bare cover freshness", scope: "recipes" }))
      .resolves.toMatchObject([{ id: noCoverRecipe.id, imageUrl: null }]);
    await expect(searchSpoonjoy(db, { query: "masked cover freshness", scope: "recipes" }))
      .resolves.toMatchObject([{
        id: maskedRecipe.id,
        imageUrl: "/photos/recipes/chef/older-gratin.jpg",
        metadata: { coverProvenanceLabel: "Original photo", coverSourceType: "chef-upload", coverVariant: "image" },
      }]);
    await expect(searchSpoonjoy(db, { query: "pending cover freshness", scope: "recipes" }))
      .resolves.toMatchObject([{ id: pendingRecipe.id, imageUrl: null }]);
    await expect(searchSpoonjoy(db, { query: "stylized cover freshness", scope: "recipes" }))
      .resolves.toMatchObject([{ id: stylizedRecipe.id, imageUrl: null }]);
    await expect(searchSpoonjoy(db, { query: "provenance cover freshness", scope: "recipes" }))
      .resolves.toMatchObject([{
        id: provenanceRecipe.id,
        imageUrl: "/photos/covers/provenance-beans.jpg",
        metadata: { coverProvenanceLabel: "Original photo", coverSourceType: "chef-upload", coverVariant: "image" },
      }]);
    await expect(searchSpoonjoy(db, { query: "variant cover freshness", scope: "recipes" }))
      .resolves.toMatchObject([{
        id: variantRecipe.id,
        imageUrl: "/photos/covers/variant-soup-raw.jpg",
        metadata: { coverProvenanceLabel: "Original photo", coverSourceType: "spoon", coverVariant: "image" },
      }]);

    await db.recipeCover.update({
      where: { id: pendingCover.id },
      data: { imageUrl: "/photos/covers/generated-tart.png" },
    });
    await db.recipeCover.update({
      where: { id: stylizedCover.id },
      data: { stylizedImageUrl: "/photos/covers/stylized-toast.png" },
    });

    await expect(searchSpoonjoy(db, { query: "pending cover freshness", scope: "recipes" }))
      .resolves.toMatchObject([{
        id: pendingRecipe.id,
        imageUrl: "/photos/covers/generated-tart.png",
        metadata: { coverProvenanceLabel: "AI generated", coverSourceType: "ai-placeholder", coverVariant: "image" },
      }]);
    await expect(searchSpoonjoy(db, { query: "stylized cover freshness", scope: "recipes" }))
      .resolves.toMatchObject([{
        id: stylizedRecipe.id,
        imageUrl: "/photos/covers/stylized-toast.png",
        metadata: { coverProvenanceLabel: "Editorial photo", coverSourceType: "chef-upload", coverVariant: "stylized" },
      }]);
    await db.recipeCover.update({
      where: { id: provenanceCover.id },
      data: { sourceType: "import" },
    });
    await expect(searchSpoonjoy(db, { query: "provenance cover freshness", scope: "recipes" }))
      .resolves.toMatchObject([{
        id: provenanceRecipe.id,
        imageUrl: "/photos/covers/provenance-beans.jpg",
        metadata: { coverProvenanceLabel: "Imported photo", coverSourceType: "import", coverVariant: "image" },
      }]);
    await db.recipeCover.update({
      where: { id: provenanceCover.id },
      data: { status: "archived", archivedAt: new Date("2026-03-01T00:00:00.000Z") },
    });
    await expect(searchSpoonjoy(db, { query: "provenance cover freshness", scope: "recipes" }))
      .resolves.toMatchObject([{
        id: provenanceRecipe.id,
        imageUrl: null,
        metadata: { coverProvenanceLabel: null, coverSourceType: null, coverVariant: null },
      }]);
    await db.$executeRawUnsafe(
      `UPDATE "Recipe" SET "activeCoverVariant" = ? WHERE "id" = ?`,
      "stylized",
      variantRecipe.id,
    );
    await expect(searchSpoonjoy(db, { query: "variant cover freshness", scope: "recipes" }))
      .resolves.toMatchObject([{
        id: variantRecipe.id,
        imageUrl: "/photos/covers/variant-soup-editorial.jpg",
        metadata: { coverProvenanceLabel: "Editorial photo", coverSourceType: "spoon", coverVariant: "stylized" },
      }]);

    const metadataRows = await db.$queryRawUnsafe<Array<{ sourceFingerprint: string }>>(
      `SELECT "sourceFingerprint" FROM "SearchIndexMetadata" WHERE "id" = 'current' LIMIT 1`,
    );
    expect(metadataRows[0]!.sourceFingerprint).toContain("contentHash");
    expect(metadataRows[0]!.sourceFingerprint).not.toContain("/photos/covers/generated-tart.png");
    expect(metadataRows[0]!.sourceFingerprint).not.toContain("/photos/covers/stylized-toast.png");
    expect(metadataRows[0]!.sourceFingerprint).not.toContain("/photos/recipes/chef/older-gratin.jpg");
  });

  it("keeps shopping-list search private to the signed-in owner", async () => {
    const owner = await createChef("shopper");
    const otherOwner = await createChef("other_shopper");
    const ownerItem = await createShoppingItem(owner.id, "oat milk", false, 2);
    await createShoppingItem(owner.id, "sourdough loaf", true, null);
    await createShoppingItem(otherOwner.id, "oat milk", false, 1);

    const publicResults = await searchSpoonjoy(db, { query: "oat milk", scope: "all" });
    expect(publicResults.some((result) => result.type === "shopping-list-item")).toBe(false);

    const privateResults = await searchSpoonjoy(db, {
      query: "oat milk",
      scope: "all",
      viewerId: owner.id,
    });
    expect(privateResults.filter((result) => result.type === "shopping-list-item")).toHaveLength(1);
    expect(privateResults.find((result) => result.type === "shopping-list-item")).toMatchObject({
      id: ownerItem.id,
      ownerId: owner.id,
      title: "oat milk",
      href: "/shopping-list",
      metadata: {
        quantity: 2,
        checked: false,
        categoryKey: "dairy",
        iconKey: "milk",
      },
    });

    const ownerOnlyResults = await searchSpoonjoy(db, {
      query: "sourdough",
      scope: "shopping-list",
      viewerId: owner.id,
      ownerId: owner.id,
    });
    expect(ownerOnlyResults).toHaveLength(1);
    expect(ownerOnlyResults[0].metadata).toMatchObject({
      quantity: null,
      unit: null,
      checked: true,
      categoryKey: "bakery",
      iconKey: "bread",
    });

    await expect(searchSpoonjoy(db, { query: "oat milk", scope: "shopping-list" })).resolves.toEqual([]);
  });
});
