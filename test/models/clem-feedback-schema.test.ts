import { readFileSync } from "node:fs";
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
    const savedRecipe = modelBlock("SavedRecipe");

    expect(savedRecipe).toContain("userId String");
    expect(savedRecipe).toContain("recipeId String");
    expect(savedRecipe).toContain("savedAt String");
    expect(savedRecipe).toContain(
      "user User @relation(fields: [userId], references: [id], onDelete: Cascade)",
    );
    expect(savedRecipe).toContain(
      "recipe Recipe @relation(fields: [recipeId], references: [id], onDelete: Cascade)",
    );
    expect(savedRecipe).toContain("@@id([userId, recipeId])");
    expect(savedRecipe).toContain("@@index([userId, savedAt, recipeId])");
    expect(savedRecipe).toContain("@@index([recipeId])");
  });

  it("models RecipeTag with the exact identity, timestamps, cascade, and indexes", () => {
    const recipeTag = modelBlock("RecipeTag");

    expect(recipeTag).toContain("id String @id @default(cuid())");
    expect(recipeTag).toContain("recipeId String");
    expect(recipeTag).toContain("label String");
    expect(recipeTag).toContain("normalizedLabel String");
    expect(recipeTag).toContain("createdAt DateTime @default(now())");
    expect(recipeTag).toContain("updatedAt DateTime @default(now()) @updatedAt");
    expect(recipeTag).toContain(
      "recipe Recipe @relation(fields: [recipeId], references: [id], onDelete: Cascade)",
    );
    expect(recipeTag).toContain("@@unique([recipeId, normalizedLabel])");
    expect(recipeTag).toContain("@@index([normalizedLabel, recipeId])");
  });

  it("removes only Prisma's legacy full shopping identity constraint", () => {
    const shoppingItem = modelBlock("ShoppingListItem");

    expect(shoppingItem).not.toContain(
      "@@unique([shoppingListId, unitId, ingredientRefId])",
    );
    expect(shoppingItem).toContain("@@index([shoppingListId])");
    expect(shoppingItem).toContain("@@index([shoppingListId, deletedAt, sortIndex])");
    expect(shoppingItem).toContain("@@index([unitId])");
    expect(shoppingItem).toContain("@@index([ingredientRefId])");
  });

  it("keeps cook progress and discovery out of Prisma and D1", () => {
    expect(modelNames()).not.toEqual(
      expect.arrayContaining([
        "CookSession",
        "CookSessionIndex",
        "CookSessionReceipt",
        "CookSessionRegistry",
      ]),
    );
    expect(schema).not.toMatch(/^\s*cookSessions?\s+/im);
  });
});
