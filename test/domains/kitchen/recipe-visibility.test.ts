// @vitest-environment node
import DatabaseSync from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RECIPE_VISIBILITY,
  RECIPE_VISIBILITIES,
  SELECTABLE_RECIPE_VISIBILITIES,
  canRead,
  newRecipeVisibility,
  parseRecipeVisibility,
  readableRecipeSql,
  readableRecipeSqlForViewerColumn,
  readableRecipeWhere,
  type RecipeViewer,
} from "~/domains/kitchen";

const CHEF = "chef-1";
const HOUSEMATE = "chef-2";
const STRANGER = "chef-3";

describe("recipe visibility", () => {
  it("has three levels, and new recipes are public unless the cook chooses otherwise", () => {
    expect(RECIPE_VISIBILITIES).toEqual(["private", "household", "public"]);
    expect(DEFAULT_RECIPE_VISIBILITY).toBe("public");
  });

  it("parses only the three levels, ignoring case and spaces", () => {
    expect(parseRecipeVisibility("private")).toBe("private");
    expect(parseRecipeVisibility(" Household ")).toBe("household");
    expect(parseRecipeVisibility("PUBLIC")).toBe("public");
    for (const value of ["", "friends", null, undefined, 1, {}, ["public"]]) {
      expect(parseRecipeVisibility(value)).toBeNull();
    }
  });
});

describe("a new recipe's visibility", () => {
  it("offers public and private until households ship", () => {
    expect(SELECTABLE_RECIPE_VISIBILITIES).toEqual(["public", "private"]);
  });

  it("takes the cook's choice, then their default, then public", () => {
    expect(newRecipeVisibility("private", "public")).toBe("private");
    expect(newRecipeVisibility(null, "private")).toBe("private");
    expect(newRecipeVisibility("", undefined)).toBe("public");
    expect(newRecipeVisibility("friends", "nonsense")).toBe("public");
  });

  it("does not take household while it cannot be chosen", () => {
    expect(newRecipeVisibility("household", "private")).toBe("private");
    expect(newRecipeVisibility(undefined, "household")).toBe("public");
  });
});

describe("canRead", () => {
  const housemates: RecipeViewer = { id: HOUSEMATE, householdChefIds: new Set([CHEF]) };

  it("lets anyone, signed in or not, read a public recipe", () => {
    const recipe = { chefId: CHEF, visibility: "public" };
    expect(canRead(null, recipe)).toBe(true);
    expect(canRead(undefined, recipe)).toBe(true);
    expect(canRead({ id: STRANGER }, recipe)).toBe(true);
  });

  it("lets only its cook read a private recipe", () => {
    const recipe = { chefId: CHEF, visibility: "private" };
    expect(canRead({ id: CHEF }, recipe)).toBe(true);
    expect(canRead({ id: STRANGER }, recipe)).toBe(false);
    expect(canRead(housemates, recipe)).toBe(false);
    expect(canRead(null, recipe)).toBe(false);
  });

  it("lets the cook and their household read a household recipe", () => {
    const recipe = { chefId: CHEF, visibility: "household" };
    expect(canRead({ id: CHEF }, recipe)).toBe(true);
    expect(canRead(housemates, recipe)).toBe(true);
    expect(canRead({ id: STRANGER }, recipe)).toBe(false);
    expect(canRead({ id: STRANGER, householdChefIds: new Set([HOUSEMATE]) }, recipe)).toBe(false);
    expect(canRead(null, recipe)).toBe(false);
  });

  it("treats a missing or unknown stored level as private, so a bad row never leaks", () => {
    for (const visibility of [null, undefined, "", "friends"]) {
      const recipe = { chefId: CHEF, visibility };
      expect(canRead({ id: CHEF }, recipe)).toBe(true);
      expect(canRead({ id: STRANGER }, recipe)).toBe(false);
      expect(canRead(housemates, recipe)).toBe(false);
      expect(canRead(null, recipe)).toBe(false);
    }
  });

  it("reads an empty viewer id as signed out", () => {
    expect(canRead({ id: "" }, { chefId: "", visibility: "private" })).toBe(false);
  });
});

describe("readable recipe queries", () => {
  const visibilities = ["public", "private", "household", "friends", null];
  const chefs = [CHEF, HOUSEMATE, STRANGER];
  const viewers: RecipeViewer[] = [
    null,
    { id: CHEF },
    { id: STRANGER },
    { id: HOUSEMATE, householdChefIds: new Set([CHEF]) },
    { id: HOUSEMATE, householdChefIds: new Set() },
    { id: "" },
  ];
  const recipes = chefs.flatMap((chefId) =>
    visibilities.map((visibility, index) => ({ id: `${chefId}-${index}`, chefId, visibility })),
  );

  function database(): DatabaseSync.Database {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE "Recipe" ("id" TEXT PRIMARY KEY, "chefId" TEXT NOT NULL, "visibility" TEXT)`);
    const insert = db.prepare(`INSERT INTO "Recipe" ("id", "chefId", "visibility") VALUES (?, ?, ?)`);
    for (const recipe of recipes) insert.run(recipe.id, recipe.chefId, recipe.visibility);
    return db;
  }

  it("select in SQL exactly the recipes canRead allows", () => {
    const db = database();
    for (const viewer of viewers) {
      const readable = readableRecipeSql("r", viewer);
      const rows = db
        .prepare(`SELECT r."id" FROM "Recipe" r WHERE ${readable.sql} ORDER BY r."id"`)
        .all(...readable.params) as Array<{ id: string }>;
      const expected = recipes.filter((recipe) => canRead(viewer, recipe)).map((recipe) => recipe.id).sort();
      expect(rows.map((row) => row.id)).toEqual(expected);
    }
  });

  it("select in SQL, for a viewer named by a column, exactly the recipes canRead allows that viewer and their household", () => {
    const db = database();
    db.exec(`CREATE TABLE "Viewer" ("userId" TEXT NOT NULL)`);
    db.exec(`CREATE TABLE "HouseholdMember" ("householdId" TEXT NOT NULL, "userId" TEXT NOT NULL, PRIMARY KEY ("householdId", "userId"))`);
    // CHEF and HOUSEMATE share one household; STRANGER is alone in another.
    for (const [householdId, userId] of [["home", CHEF], ["home", HOUSEMATE], ["away", STRANGER]]) {
      db.prepare(`INSERT INTO "HouseholdMember" ("householdId", "userId") VALUES (?, ?)`).run(householdId, userId);
    }
    const householdOf: Record<string, string[]> = { [CHEF]: [HOUSEMATE], [HOUSEMATE]: [CHEF], [STRANGER]: [] };
    for (const viewerId of [CHEF, STRANGER, HOUSEMATE]) {
      db.exec(`DELETE FROM "Viewer"`);
      db.prepare(`INSERT INTO "Viewer" ("userId") VALUES (?)`).run(viewerId);
      const readable = readableRecipeSqlForViewerColumn("r", `v."userId"`);
      const rows = db
        .prepare(`SELECT r."id" FROM "Recipe" r JOIN "Viewer" v ON ${readable} ORDER BY r."id"`)
        .all() as Array<{ id: string }>;
      const viewer = { id: viewerId, householdChefIds: new Set(householdOf[viewerId]) };
      const expected = recipes.filter((recipe) => canRead(viewer, recipe)).map((recipe) => recipe.id).sort();
      expect(rows.map((row) => row.id)).toEqual(expected);
    }
  });

  it("name the table by alias, or by its own name when there is none", () => {
    expect(readableRecipeSql("r", null).sql).toBe(`r."visibility" = 'public'`);
    expect(readableRecipeSql(undefined, null).sql).toBe(`"Recipe"."visibility" = 'public'`);
  });

  it("give Prisma the same rule", () => {
    expect(readableRecipeWhere(null)).toEqual({ visibility: "public" });
    expect(readableRecipeWhere({ id: "" })).toEqual({ visibility: "public" });
    expect(readableRecipeWhere({ id: CHEF })).toEqual({ OR: [{ visibility: "public" }, { chefId: CHEF }] });
    expect(readableRecipeWhere({ id: HOUSEMATE, householdChefIds: new Set([CHEF]) })).toEqual({
      OR: [{ visibility: "public" }, { chefId: HOUSEMATE }, { visibility: "household", chefId: { in: [CHEF] } }],
    });
    expect(readableRecipeWhere({ id: HOUSEMATE, householdChefIds: new Set() })).toEqual({
      OR: [{ visibility: "public" }, { chefId: HOUSEMATE }],
    });
  });
});
