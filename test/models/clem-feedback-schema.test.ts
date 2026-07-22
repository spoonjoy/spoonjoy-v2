import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync(
  resolve(__dirname, "..", "..", "prisma", "schema.prisma"),
  "utf8",
);

function modelNames(): string[] {
  return Array.from(schema.matchAll(/^model\s+(\w+)\s*\{/gm), (match) => match[1]);
}

function modelBlock(name: string): string {
  const match = new RegExp(`^model\\s+${name}\\s*\\{`, "m").exec(schema);
  if (!match) return "";

  let depth = 0;
  for (let index = match.index; index < schema.length; index += 1) {
    if (schema[index] === "{") depth += 1;
    if (schema[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return schema
          .slice(match.index, index + 1)
          .split("\n")
          .map((line) => line.trim().replace(/\s+/g, " "))
          .filter(Boolean)
          .join("\n");
      }
    }
  }

  throw new Error(`Unterminated Prisma model ${name}`);
}

function modelLines(name: string): string[] {
  return modelBlock(name)
    .split("\n")
    .slice(1, -1)
    .filter((line) => !line.startsWith("//"));
}

function d1TableNames(): string[] {
  const migrationsDirectory = resolve(__dirname, "..", "..", "migrations");
  return readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith(".sql"))
    .flatMap((name) => {
      const sql = readFileSync(resolve(migrationsDirectory, name), "utf8");
      return Array.from(
        sql.matchAll(/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+["`]?([^"`\s(]+)/gi),
        (match) => match[1],
      );
    });
}

describe("Clem feedback Prisma product contract", () => {
  it("adds nullable course and the exact SavedRecipe and RecipeTag relations", () => {
    const recipe = modelBlock("Recipe");
    const user = modelBlock("User");

    expect(recipe).toContain("course String?");
    expect(recipe).not.toMatch(/course String\? @default/);
    expect(recipe).toContain("savedBy SavedRecipe[]");
    expect(recipe).toContain("tags RecipeTag[]");
    expect(recipe).toContain("@@index([course, deletedAt, updatedAt])");
    expect(user).toContain("savedRecipes SavedRecipe[]");
    expect(user).not.toMatch(/cookSessions?\s+/i);
  });

  it("models SavedRecipe with the exact key, cascades, and indexes", () => {
    expect(modelLines("SavedRecipe")).toEqual([
      "userId String",
      "recipeId String",
      "savedAt String",
      "user User @relation(fields: [userId], references: [id], onDelete: Cascade)",
      "recipe Recipe @relation(fields: [recipeId], references: [id], onDelete: Cascade)",
      "@@id([userId, recipeId])",
      "@@index([userId, savedAt, recipeId])",
      "@@index([recipeId])",
    ]);
  });

  it("models RecipeTag with the exact identity, timestamps, cascade, and indexes", () => {
    expect(modelLines("RecipeTag")).toEqual([
      "id String @id @default(cuid())",
      "recipeId String",
      "label String",
      "normalizedLabel String",
      "createdAt DateTime @default(now())",
      "updatedAt DateTime @default(now()) @updatedAt",
      "recipe Recipe @relation(fields: [recipeId], references: [id], onDelete: Cascade)",
      "@@unique([recipeId, normalizedLabel])",
      "@@index([normalizedLabel, recipeId])",
    ]);
  });

  it("removes only Prisma's legacy full shopping identity constraint", () => {
    expect(modelLines("ShoppingListItem")).toEqual([
      "id String @id @default(cuid())",
      "shoppingListId String",
      "shoppingList ShoppingList @relation(fields: [shoppingListId], references: [id], onDelete: Cascade)",
      "quantity Float?",
      "unitId String?",
      "unit Unit? @relation(fields: [unitId], references: [id])",
      "ingredientRefId String",
      "ingredientRef IngredientRef @relation(fields: [ingredientRefId], references: [id])",
      "checked Boolean @default(false)",
      "checkedAt DateTime?",
      "deletedAt DateTime?",
      "sortIndex Int @default(0)",
      "categoryKey String?",
      "iconKey String?",
      "updatedAt DateTime @default(now()) @updatedAt",
      "@@index([shoppingListId])",
      "@@index([shoppingListId, deletedAt, sortIndex])",
      "@@index([unitId])",
      "@@index([ingredientRefId])",
    ]);
  });

  it("keeps cook progress and discovery out of Prisma and D1", () => {
    const allowedCookbookTables = new Set(["Cookbook", "RecipeInCookbook"]);
    const forbiddenCookTables = [...modelNames(), ...d1TableNames()].filter(
      (name) => /cook/i.test(name) && !allowedCookbookTables.has(name),
    );

    expect(forbiddenCookTables).toEqual([]);
    expect(schema).not.toMatch(/^\s*\w*(?:cookSession|cookProgress|cookDiscovery)\w*\s+/im);
  });
});
