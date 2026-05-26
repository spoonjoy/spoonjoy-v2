import { describe, expect, it } from "vitest";
import {
  buildD1ImportSql,
  buildMigrationReport,
  type V1Export,
} from "../../scripts/lib/v1-neon-to-d1";
import {
  normalizeNeonConnectionString,
  parseCliOptions,
} from "../../scripts/migrate-v1-neon-to-d1";

const t1 = "2026-01-01T00:00:00.000Z";
const t2 = "2026-01-02T00:00:00.000Z";
const t3 = "2026-01-03T00:00:00.000Z";

function makeFixture(): V1Export {
  return {
    users: [
      {
        id: "u1",
        email: "cook@example.com",
        username: "cook",
        hashedPassword: "hash'value",
        salt: "salt",
        resetToken: null,
        resetTokenExpiresAt: null,
        webAuthnChallenge: null,
        createdAt: t1,
        updatedAt: t2,
      },
      {
        id: "u2",
        email: "github-only@example.com",
        username: "github_only",
        hashedPassword: null,
        salt: null,
        resetToken: null,
        resetTokenExpiresAt: null,
        webAuthnChallenge: null,
        createdAt: t1,
        updatedAt: t2,
      },
    ],
    userCredentials: [
      {
        id: "cred1",
        userId: "u1",
        publicKey: Uint8Array.from([0, 15, 255]),
        transports: "internal",
        counter: "7",
      },
      {
        id: "orphan-cred",
        userId: "missing",
        publicKey: Uint8Array.from([1]),
        transports: null,
        counter: "0",
      },
    ],
    oauthAccounts: [
      {
        provider: "apple",
        providerUserId: "apple-1",
        providerUsername: "Apple User",
        userId: "u1",
        createdAt: t1,
      },
      {
        provider: "github",
        providerUserId: "github-1",
        providerUsername: "GitHub User",
        userId: "u2",
        createdAt: t1,
      },
    ],
    units: [{ id: "unit1", name: "cup", updatedAt: t1 }],
    ingredientRefs: [{ id: "ref1", name: "flour", updatedAt: t1 }],
    recipes: [
      {
        id: "recipe1",
        title: "Grandma's Soup",
        description: "Needs care",
        imageUrl: "https://images.example.com/soup.jpg",
        servings: "4",
        chefId: "u1",
        deletedAt: null,
        sourceRecipeId: null,
        sourceUrl: null,
        createdAt: t1,
        updatedAt: t2,
      },
      {
        id: "recipe2",
        title: "Stock placeholder",
        description: null,
        imageUrl: "https://res.cloudinary.com/dpjmyc4uz/image/upload/v1674541350/clbe7wr180009tkhggghtl1qd.png",
        servings: null,
        chefId: "u1",
        deletedAt: null,
        sourceRecipeId: null,
        sourceUrl: null,
        createdAt: t2,
        updatedAt: t2,
      },
      {
        id: "orphan-recipe",
        title: "Missing chef",
        description: null,
        imageUrl: "",
        servings: null,
        chefId: "missing",
        deletedAt: null,
        sourceRecipeId: null,
        sourceUrl: null,
        createdAt: t1,
        updatedAt: t1,
      },
    ],
    recipeSteps: [
      {
        id: "step1",
        recipeId: "recipe1",
        stepNum: 1,
        stepTitle: "Prep",
        description: "Mix",
        updatedAt: t2,
      },
      {
        id: "step-orphan",
        recipeId: "missing",
        stepNum: 1,
        stepTitle: null,
        description: "No recipe",
        updatedAt: t2,
      },
    ],
    stepOutputUses: [
      {
        id: "use-orphan",
        recipeId: "recipe1",
        outputStepNum: 1,
        inputStepNum: 2,
        updatedAt: t2,
      },
    ],
    ingredients: [
      {
        id: "ingredient1",
        recipeId: "recipe1",
        stepNum: 1,
        quantity: 1.5,
        unitId: "unit1",
        ingredientRefId: "ref1",
        updatedAt: t2,
      },
      {
        id: "ingredient-orphan-unit",
        recipeId: "recipe1",
        stepNum: 1,
        quantity: 2,
        unitId: "missing",
        ingredientRefId: "ref1",
        updatedAt: t2,
      },
    ],
    cookbooks: [
      {
        id: "cookbook1",
        title: "Weeknight",
        authorId: "u1",
        createdAt: t1,
        updatedAt: t2,
      },
    ],
    recipeInCookbooks: [
      {
        id: "ric1",
        cookbookId: "cookbook1",
        recipeId: "recipe1",
        addedById: "u1",
        createdAt: t1,
        updatedAt: t2,
      },
      {
        id: "ric-orphan-cookbook",
        cookbookId: "missing",
        recipeId: "recipe1",
        addedById: "u1",
        createdAt: t1,
        updatedAt: t2,
      },
    ],
    shoppingLists: [
      {
        id: "list1",
        authorId: "u1",
        createdAt: t1,
        updatedAt: t2,
      },
    ],
    shoppingListItems: [
      {
        id: "item-later",
        shoppingListId: "list1",
        quantity: null,
        unitId: null,
        ingredientRefId: "ref1",
        updatedAt: t3,
      },
      {
        id: "item-earlier",
        shoppingListId: "list1",
        quantity: 2,
        unitId: "unit1",
        ingredientRefId: "ref1",
        updatedAt: t1,
      },
      {
        id: "item-orphan-ref",
        shoppingListId: "list1",
        quantity: 2,
        unitId: "unit1",
        ingredientRefId: "missing",
        updatedAt: t1,
      },
    ],
  };
}

describe("v1 Neon to D1 migration planner", () => {
  it("reports planned inserts, skipped broken references, and auth coverage", () => {
    const report = buildMigrationReport(makeFixture());

    expect(report.sourceCounts).toMatchObject({
      User: 2,
      Recipe: 3,
      RecipeInCookbook: 2,
      ShoppingListItem: 3,
    });
    expect(report.plannedInsertCounts).toMatchObject({
      User: 2,
      Recipe: 2,
      RecipeCover: 1,
      RecipeInCookbook: 1,
      ShoppingListItem: 2,
    });
    expect(report.skipped).toMatchObject({
      userCredentialsMissingUser: 1,
      recipesMissingChef: 1,
      recipeStepsMissingRecipe: 1,
      stepOutputUsesMissingStep: 1,
      ingredientsMissingUnit: 1,
      recipeInCookbooksMissingCookbook: 1,
      shoppingListItemsMissingIngredientRef: 1,
    });
    expect(report.auth).toEqual({
      users: 2,
      passwordUsers: 1,
      passkeyUsers: 1,
      supportedOAuthUsers: 2,
      unsupportedLoginUsers: 0,
      oauthProviders: {
        apple: 1,
        github: 1,
      },
    });
  });

  it("builds D1-safe SQL with explicit replacement, escaped text, blobs, covers, and v2 defaults", () => {
    const sql = buildD1ImportSql(makeFixture(), {
      replaceTarget: true,
      generatedAt: "2026-05-25T00:00:00.000Z",
    });

    expect(sql).toContain("-- Spoonjoy v1 Neon -> v2 D1 import generated at 2026-05-25T00:00:00.000Z");
    expect(sql).toContain('DELETE FROM "SearchDocument";');
    expect(sql).toContain('DELETE FROM "SearchIndexMetadata";');
    expect(sql).toContain("hash''value");
    expect(sql).toContain("X'000fff'");
    expect(sql).toContain(
      'INSERT INTO "RecipeCover" ("id", "recipeId", "imageUrl", "stylizedImageUrl", "sourceType", "sourceSpoonId", "createdAt") VALUES (\'v1cover_recipe1\'',
    );
    expect(sql).not.toContain("v1cover_recipe2");
    expect(sql).toContain(
      'INSERT INTO "RecipeStep" ("id", "recipeId", "stepNum", "stepTitle", "description", "duration", "updatedAt") VALUES (\'step1\', \'recipe1\', 1, \'Prep\', \'Mix\', NULL',
    );
    expect(sql).toContain(
      'INSERT INTO "ShoppingListItem" ("id", "shoppingListId", "quantity", "unitId", "ingredientRefId", "checked", "checkedAt", "deletedAt", "sortIndex", "categoryKey", "iconKey", "updatedAt") VALUES (\'item-earlier\', \'list1\', 2, \'unit1\', \'ref1\', 0, NULL, NULL, 0, NULL, NULL',
    );
    expect(sql).toContain(
      'INSERT INTO "ShoppingListItem" ("id", "shoppingListId", "quantity", "unitId", "ingredientRefId", "checked", "checkedAt", "deletedAt", "sortIndex", "categoryKey", "iconKey", "updatedAt") VALUES (\'item-later\', \'list1\', NULL, NULL, \'ref1\', 0, NULL, NULL, 1, NULL, NULL',
    );
    expect(sql).not.toContain("orphan-recipe");
    expect(sql).not.toContain("ric-orphan-cookbook");
  });

  it("can build append-only SQL for local empty-database rehearsals", () => {
    const sql = buildD1ImportSql(makeFixture(), {
      replaceTarget: false,
      generatedAt: "2026-05-25T00:00:00.000Z",
    });

    expect(sql).not.toContain('DELETE FROM "User";');
    expect(sql).toContain('INSERT INTO "User"');
  });
});

describe("v1 Neon migration CLI helpers", () => {
  it("normalizes Neon sslmode=require to verify-full to avoid pg warnings", () => {
    const normalized = normalizeNeonConnectionString(
      "postgresql://u:p@example.neon.tech/db?sslmode=require&channel_binding=require",
    );

    expect(normalized).toBe("postgresql://u:p@example.neon.tech/db?sslmode=verify-full&channel_binding=require");
  });

  it("parses report and build-sql commands without exposing secrets", () => {
    expect(parseCliOptions(["report"], { SPOONJOY_V1_DATABASE_URL: "postgresql://u:p@example.neon.tech/db" }))
      .toMatchObject({
        command: "report",
        replaceTarget: false,
      });

    expect(
      parseCliOptions(
        ["build-sql", "--", "--out", "/tmp/import.sql", "--report-out", "/tmp/report.json", "--replace-target"],
        { SPOONJOY_V1_DATABASE_URL: "postgresql://u:p@example.neon.tech/db" },
      ),
    ).toMatchObject({
      command: "build-sql",
      out: "/tmp/import.sql",
      reportOut: "/tmp/report.json",
      replaceTarget: true,
    });
  });

  it("rejects missing database URLs and missing build-sql output paths", () => {
    expect(() => parseCliOptions(["report"], {})).toThrow(/Missing SPOONJOY_V1_DATABASE_URL/);
    expect(() =>
      parseCliOptions(["build-sql"], { SPOONJOY_V1_DATABASE_URL: "postgresql://u:p@example.neon.tech/db" }),
    ).toThrow(/requires --out/);
  });
});
