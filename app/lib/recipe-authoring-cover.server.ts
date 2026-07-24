export type RecipeAuthoringCoverMutation =
  | {
      kind: "uploaded";
      coverId: string;
      createdById: string;
      imageUrl: string;
    }
  | {
      kind: "placeholder";
      coverId: string;
      createdById: string;
    }
  | { kind: "clear" };

export interface RecipeAuthoringCoverOperation {
  kind: "insert-cover" | "activate-cover" | "clear-cover";
  sql: string;
  values: unknown[];
}

const INSERT_COVER_SQL = `
  INSERT INTO "RecipeCover" (
    "id", "recipeId", "imageUrl", "sourceType", "status", "createdById",
    "sourceImageUrl", "generationStatus", "createdAt"
  )
  SELECT ?, recipe."id", ?, ?, ?, ?, ?, ?, ?
  FROM "Recipe" AS recipe
  WHERE recipe."id" = ? AND recipe."chefId" = ? AND recipe."deletedAt" IS NULL
  RETURNING
    "id", "recipeId", "imageUrl", "sourceType", "status", "createdById",
    "sourceImageUrl", "generationStatus", "createdAt"
`;

const ACTIVATE_COVER_SQL = `
  UPDATE "Recipe"
  SET
    "activeCoverId" = ?,
    "activeCoverVariant" = 'image',
    "coverMode" = 'manual',
    "updatedAt" = ?
  WHERE "id" = ? AND "chefId" = ? AND "deletedAt" IS NULL
    AND EXISTS (
      SELECT 1 FROM "RecipeCover"
      WHERE "id" = ? AND "recipeId" = "Recipe"."id"
    )
  RETURNING
    "id" AS "recipeId", "activeCoverId", "activeCoverVariant", "coverMode", "updatedAt"
`;

const CLEAR_COVER_SQL = `
  UPDATE "Recipe"
  SET
    "activeCoverId" = NULL,
    "activeCoverVariant" = NULL,
    "coverMode" = 'none',
    "updatedAt" = ?
  WHERE "id" = ? AND "chefId" = ? AND "deletedAt" IS NULL
  RETURNING
    "id" AS "recipeId", "activeCoverId", "activeCoverVariant", "coverMode", "updatedAt"
`;

export function buildRecipeAuthoringCoverOperations(input: {
  boundTimestamp: string;
  mutation: RecipeAuthoringCoverMutation | null;
  recipeId: string;
  userId: string;
}): RecipeAuthoringCoverOperation[] {
  const { boundTimestamp, mutation, recipeId, userId } = input;
  if (!mutation) return [];
  if (mutation.kind === "clear") {
    return [{
      kind: "clear-cover",
      sql: CLEAR_COVER_SQL,
      values: [boundTimestamp, recipeId, userId],
    }];
  }

  const uploaded = mutation.kind === "uploaded";
  const imageUrl = uploaded ? mutation.imageUrl : "";
  const insertion: RecipeAuthoringCoverOperation = {
    kind: "insert-cover",
    sql: INSERT_COVER_SQL,
    values: [
      mutation.coverId,
      imageUrl,
      uploaded ? "chef-upload" : "ai-placeholder",
      uploaded ? "ready" : "processing",
      mutation.createdById,
      uploaded ? imageUrl : null,
      uploaded ? "none" : "processing",
      boundTimestamp,
      recipeId,
      userId,
    ],
  };
  if (!uploaded) return [insertion];

  return [
    insertion,
    {
      kind: "activate-cover",
      sql: ACTIVATE_COVER_SQL,
      values: [mutation.coverId, boundTimestamp, recipeId, userId, mutation.coverId],
    },
  ];
}
