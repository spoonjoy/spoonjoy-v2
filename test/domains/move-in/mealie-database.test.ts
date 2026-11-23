import { describe, expect, it } from "vitest";
import {
  chooseGroup,
  inspectGroup,
  listGroups,
  readMealieDatabase,
  recipeDrafts,
} from "~/domains/move-in/adapters/sources/mealie-backup/database";
import { MoveInError } from "~/domains/move-in/model/move-in-error";
import { mealieDatabase } from "./support/mealie-database";

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof MoveInError) return error.code;
    throw error;
  }
  throw new Error("expected a MoveInError");
}

describe("readMealieDatabase", () => {
  it.each([1, 2, 3] as const)("reads the version of a %s.x backup from its schema revision", (major) => {
    const db = readMealieDatabase(mealieDatabase({ major }).tables);
    expect(db.version).toEqual({ label: { 1: "v1.12.0", 2: "v2.8.0", 3: "v3.31.0" }[major], major, known: true });
  });

  it("treats an unknown revision as a newer server, judged by its tables", () => {
    const { tables } = mealieDatabase({ major: 3 });
    tables.alembic_version = [{ version_num: "0123456789ab" }];
    expect(readMealieDatabase(tables).version).toEqual({ label: "newer than v3.31.0", major: 2, known: false });
    tables.ai_providers = [];
    expect(readMealieDatabase(tables).version.major).toBe(3);
    delete tables.ai_providers;
    delete tables.households;
    expect(readMealieDatabase(tables).version.major).toBe(1);
    tables.alembic_version = [];
    tables.households = [];
    expect(readMealieDatabase(tables).version).toEqual({ label: "newer than v3.31.0", major: 2, known: false });
  });

  it.each([
    ["a list", []],
    ["a string", "hello"],
    ["null", null],
    ["an object without recipes", { alembic_version: [] }],
    ["recipes that are not a list", { recipes: {} }],
  ])("calls %s not a backup", (_name, json) => {
    expect(codeOf(() => readMealieDatabase(json))).toBe("not-a-backup");
  });

  it("reads a table that is missing or not a list as empty", () => {
    const { tables } = mealieDatabase();
    (tables as Record<string, unknown>).tags = "nope";
    const db = readMealieDatabase(tables);
    expect(db.rows("tags")).toEqual([]);
    expect(db.rows("no_such_table")).toEqual([]);
  });
});

describe("groups", () => {
  const db = readMealieDatabase(mealieDatabase({ style: "sqlite" }).tables);
  const { keys } = mealieDatabase();

  it("lists each group with its recipes and members", () => {
    expect(listGroups(db)).toEqual([
      { key: keys.group, name: "Home", recipes: 3, members: 2 },
      { key: keys.otherGroup, name: "Neighbours", recipes: 1, members: 1 },
    ]);
  });

  it("picks the group that holds the importer's email, ignoring case", () => {
    expect(chooseGroup(db, "cook@EXAMPLE.com")).toBe(keys.group);
    expect(chooseGroup(db, "pat@example.com")).toBe(keys.otherGroup);
  });

  it("picks nothing when the email is in no group and there are several", () => {
    expect(chooseGroup(db, "nobody@example.com")).toBeNull();
    expect(chooseGroup(db, null)).toBeNull();
  });

  it("picks the only group whatever the email", () => {
    const { tables } = mealieDatabase();
    tables.groups = tables.groups.slice(0, 1);
    expect(chooseGroup(readMealieDatabase(tables), null)).toBe(keys.group);
  });

  it("picks the only group with recipes, passing over the empty group every backup starts with", () => {
    const { tables } = mealieDatabase();
    tables.recipes = tables.recipes.filter((recipe: { group_id: string }) => recipe.group_id === tables.groups[0].id);
    const backup = readMealieDatabase(tables);
    expect(chooseGroup(backup, null)).toBe(keys.group);
    expect(chooseGroup(backup, "pat@example.com")).toBe(keys.group);
  });

  it("chooses among every group when none has recipes yet", () => {
    const { tables } = mealieDatabase();
    tables.recipes = [];
    const backup = readMealieDatabase(tables);
    expect(chooseGroup(backup, "pat@example.com")).toBe(keys.otherGroup);
    expect(chooseGroup(backup, null)).toBeNull();
  });

  it("skips a group row with no id and names an unnamed group", () => {
    const { tables } = mealieDatabase();
    tables.groups = [{ id: null, name: "Broken" }, { id: tables.groups[0].id, name: null }];
    expect(listGroups(readMealieDatabase(tables))).toEqual([{ key: keys.group, name: "Kitchen", recipes: 3, members: 2 }]);
  });
});

describe("inspectGroup", () => {
  it("counts what the group holds before anything is written", () => {
    const { tables, keys } = mealieDatabase();
    expect(inspectGroup(readMealieDatabase(tables), keys.group)).toEqual({
      users: 2,
      recipes: 3,
      recipesByMember: { [keys.owner]: 2, [keys.member]: 1 },
      recipeNotes: 2,
      ingredients: 5,
      ingredientsWithFood: 1,
      ingredientsWithUnit: 1,
      steps: 3,
      stepIngredientReferences: 3,
      foods: 1,
      units: 1,
      tags: 1,
      categories: 1,
      tools: 1,
      recipeTags: 1,
      recipeCategories: 1,
      recipeTools: 1,
    });
  });
});

describe("recipeDrafts", () => {
  it.each(["sqlite", "postgres"] as const)("maps the group's recipes the same from a %s backup", (style) => {
    const { tables, keys } = mealieDatabase({ style });
    const drafts = recipeDrafts(readMealieDatabase(tables), keys.group);
    expect(drafts.map((draft) => draft.sourceKey)).toEqual([keys.pancakes, keys.soup, keys.untitled]);
    const [pancakes, soup, untitled] = drafts;
    expect(pancakes).toEqual({
      sourceKey: keys.pancakes,
      ownerKey: keys.owner,
      sourceUpdatedAt: "2026-01-05T10:00:00.123456",
      title: "Pancakes",
      description: "Fluffy ones.",
      servings: "4 servings",
      sourceUrl: "https://example.com/pancakes",
      photoPath: `data/recipes/${keys.pancakes}/images/original.webp`,
      steps: [
        {
          sourceKey: keys.step1,
          title: "Batter",
          text: "Whisk the flour and milk.",
          ingredientKeys: [`${keys.pancakes}|${"00000000-0000-0000-0000-00000000012c"}`, `${keys.pancakes}|00000000-0000-0000-0000-00000000012d`],
        },
        {
          sourceKey: keys.step2,
          title: null,
          text: "Cook on the skillet.",
          ingredientKeys: [`${keys.pancakes}|00000000-0000-0000-0000-00000000012c`],
        },
      ],
      ingredients: [
        {
          sourceKey: `${keys.pancakes}|00000000-0000-0000-0000-00000000012c`,
          section: "For the batter",
          quantity: 1.5,
          unit: "cup",
          food: "flour",
          note: "sifted",
          originalText: "1 1/2 cups flour, sifted",
          plainText: false,
        },
        {
          sourceKey: `${keys.pancakes}|00000000-0000-0000-0000-00000000012d`,
          section: null,
          quantity: null,
          unit: null,
          food: null,
          note: "1 cup milk",
          originalText: null,
          plainText: true,
        },
        {
          sourceKey: `${keys.pancakes}|00000000-0000-0000-0000-00000000012e`,
          section: null,
          quantity: null,
          unit: null,
          food: null,
          note: null,
          originalText: "salt to taste",
          plainText: true,
        },
      ],
      notes: [{ title: "Storage", text: "Freezes well." }],
      tags: ["Quick"],
      categories: ["Dinner"],
      tools: [],
      warnings: [],
    });
    expect(soup).toMatchObject({
      ownerKey: keys.member,
      sourceUpdatedAt: null,
      description: null,
      servings: "6",
      sourceUrl: null,
      tools: ["Skillet"],
      steps: [{ sourceKey: keys.soupStep, title: null, text: "Simmer everything.", ingredientKeys: [] }],
      ingredients: [{ sourceKey: `${keys.soup}|00000000-0000-0000-0000-00000000012f`, note: "2 cups stock", quantity: 1, plainText: true }],
      warnings: ["An ingredient line had no text, so it was left out."],
    });
    expect(untitled).toMatchObject({
      title: "Untitled recipe",
      description: null,
      servings: null,
      steps: [],
      ingredients: [],
      warnings: ["This recipe had no name, so it's called \"Untitled recipe\"."],
    });
  });

  it("falls back to an ingredient's position when it has no reference id", () => {
    const { tables, keys } = mealieDatabase();
    tables.recipes_ingredients = [{ id: 9, recipe_id: tables.recipes[1].id, position: 3, food_id: null, note: "water" }];
    const [, soup] = recipeDrafts(readMealieDatabase(tables), keys.group);
    expect(soup.ingredients.map((ingredient) => ingredient.sourceKey)).toEqual([`${keys.soup}|position:3`]);
  });

  it("orders rows without a position last and keeps their order", () => {
    const { tables, keys } = mealieDatabase();
    tables.recipe_instructions = [
      { id: tables.recipe_instructions[0].id, recipe_id: tables.recipes[0].id, position: null, text: "Last" },
      { id: tables.recipe_instructions[1].id, recipe_id: tables.recipes[0].id, position: 0, text: "First" },
    ];
    const [pancakes] = recipeDrafts(readMealieDatabase(tables), keys.group);
    expect(pancakes.steps.map((step) => step.text)).toEqual(["First", "Last"]);
  });

  it("reads a numeric string servings count and ignores zero servings", () => {
    const { tables, keys } = mealieDatabase();
    tables.recipes[1].recipe_servings = 0;
    tables.recipes[1].recipe_yield_quantity = 2.5;
    const [, soup] = recipeDrafts(readMealieDatabase(tables), keys.group);
    expect(soup.servings).toBe("2.5");
    tables.recipes[1].recipe_yield_quantity = 0;
    expect(recipeDrafts(readMealieDatabase(tables), keys.group)[1].servings).toBeNull();
  });

  it("names a food by its name and a unit by its name or abbreviation", () => {
    const { tables, keys } = mealieDatabase();
    tables.ingredient_units[0].name = null;
    tables.ingredient_foods[0].name = null;
    const [pancakes] = recipeDrafts(readMealieDatabase(tables), keys.group);
    expect(pancakes.ingredients[0]).toMatchObject({ unit: "c", food: null, plainText: true });
  });

  it("drops a step with no text and no title, and keeps a step with only a title", () => {
    const { tables, keys } = mealieDatabase();
    tables.recipe_instructions[2] = { ...tables.recipe_instructions[2], text: "   ", title: null };
    tables.recipe_instructions.push({ id: "77777777777777777777777777777777", recipe_id: tables.recipes[1].id, position: 1, title: "Serve", text: null });
    const [, soup] = recipeDrafts(readMealieDatabase(tables), keys.group);
    expect(soup.steps).toEqual([{ sourceKey: "77777777-7777-7777-7777-777777777777", title: "Serve", text: "Serve", ingredientKeys: [] }]);
  });

  it("skips rows whose ids are not GUIDs", () => {
    const { tables, keys } = mealieDatabase();
    tables.recipes.push({ id: "not-a-guid", group_id: tables.groups[0].id, name: "Ghost" });
    tables.recipe_instructions.push({ id: "bad", recipe_id: tables.recipes[0].id, position: 5, text: "Ghost step" });
    const drafts = recipeDrafts(readMealieDatabase(tables), keys.group);
    expect(drafts.map((draft) => draft.title)).toEqual(["Pancakes", "Soup", "Untitled recipe"]);
    expect(drafts[0].steps).toHaveLength(2);
  });

  it("passes over child rows with no recipe, organizers with no id, and owners it can't name", () => {
    const { tables, keys } = mealieDatabase();
    tables.notes.push({ id: 3, recipe_id: null, text: "Orphan" });
    tables.tags.push({ id: null, group_id: tables.groups[0].id, name: "Broken" });
    tables.recipes[2].user_id = null;
    tables.recipe_instructions.push(
      { id: "88888888888888888888888888888888", recipe_id: tables.recipes[1].id, position: null, text: "Tie one" },
      { id: "99999999999999999999999999999999", recipe_id: tables.recipes[1].id, position: null, text: "Tie two" },
    );
    const db = readMealieDatabase(tables);
    const counts = inspectGroup(db, keys.group);
    expect(counts).toMatchObject({ recipeNotes: 2, tags: 1, recipesByMember: { [keys.owner]: 1, [keys.member]: 1, unknown: 1 } });
    expect(recipeDrafts(db, keys.group)[1].steps.map((step) => step.text)).toEqual(["Simmer everything.", "Tie one", "Tie two"]);
  });

  it("links no ingredient through a link with no reference id", () => {
    const { tables, keys } = mealieDatabase();
    tables.recipe_ingredient_ref_link.push({ id: "66666666666666666666666666666666", instruction_id: tables.recipe_instructions[2].id, reference_id: null });
    const db = readMealieDatabase(tables);
    expect(recipeDrafts(db, keys.group)[1].steps[0].ingredientKeys).toEqual([]);
    expect(inspectGroup(db, keys.group).stepIngredientReferences).toBe(3);
  });
});
