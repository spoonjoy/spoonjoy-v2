// The recipe page's cover jobs on D1, without Prisma in the request: a cover made from a cook's
// photo, an AI placeholder cover, and regenerating a cover. One read batch takes the owner check
// and the photo or cover the job starts from; the caller then writes the cover row in one guarded
// batch and hands the stylization or placeholder job to the background, which builds its own
// Prisma client when it starts.
import { d1NullableDateTime, d1ReadBatch, type D1Query, type D1ReadDatabase, type D1Row } from "~/lib/d1-read.server";
import { d1Timestamp } from "~/lib/d1-write.server";
import { coverInsertStatement, type RecipeCoverSourceType } from "~/lib/recipe-cover.server";

export interface RecipeForCoverJob {
  title: string;
  description: string | null;
  activeCoverId: string | null;
  activeCoverVariant: string | null;
  coverMode: string;
}

export interface CoverForRegeneration {
  id: string;
  recipeId: string;
  imageUrl: string;
  stylizedImageUrl: string | null;
  sourceImageUrl: string | null;
  sourceType: string;
  sourceSpoonId: string | null;
  status: string;
  archivedAt: Date | null;
}

function text(row: D1Row, column: string): string {
  const value = row[column];
  if (typeof value !== "string") throw new Error(`D1 column ${column} is not text`);
  return value;
}

function nullableText(row: D1Row, column: string): string | null {
  return row[column] == null ? null : text(row, column);
}

/**
 * Reads the recipe for a cover job and answers as the Prisma path does: 404 for a recipe that does
 * not exist or is in the trash, then 403 for someone else's. With a `spoonId` it also reads that
 * cook's photo on this recipe (a live cook with a photo, else null); with a `coverId`, that cover
 * of this recipe (else null).
 */
export async function readOwnedRecipeForCoverJobOnD1(
  d1: D1ReadDatabase,
  input: { recipeId: string; userId: string; spoonId?: string; coverId?: string },
): Promise<{
  recipe: RecipeForCoverJob;
  spoon: { id: string; photoUrl: string } | null;
  cover: CoverForRegeneration | null;
}> {
  const queries: D1Query[] = [
    [
      `SELECT "chefId", "deletedAt", "title", "description", "activeCoverId", "activeCoverVariant", "coverMode" FROM "Recipe" WHERE "id" = ?`,
      input.recipeId,
    ],
  ];
  if (input.spoonId !== undefined) {
    queries.push([
      `SELECT "id", "photoUrl" FROM "RecipeSpoon" WHERE "id" = ? AND "recipeId" = ? AND "deletedAt" IS NULL AND "photoUrl" IS NOT NULL`,
      input.spoonId,
      input.recipeId,
    ]);
  }
  if (input.coverId !== undefined) {
    queries.push([
      `SELECT "id", "recipeId", "imageUrl", "stylizedImageUrl", "sourceImageUrl", "sourceType", "sourceSpoonId", "status", "archivedAt"
       FROM "RecipeCover" WHERE "id" = ? AND "recipeId" = ?`,
      input.coverId,
      input.recipeId,
    ]);
  }
  const [recipeRows, ...rest] = await d1ReadBatch(d1, queries);
  const row = recipeRows[0];
  if (!row || row.deletedAt != null) throw new Response("Recipe not found", { status: 404 });
  if (row.chefId !== input.userId) throw new Response("Unauthorized", { status: 403 });

  const spoonRow = input.spoonId !== undefined ? rest.shift()![0] : undefined;
  const coverRow = input.coverId !== undefined ? rest.shift()![0] : undefined;
  return {
    recipe: {
      title: text(row, "title"),
      description: nullableText(row, "description"),
      activeCoverId: nullableText(row, "activeCoverId"),
      activeCoverVariant: nullableText(row, "activeCoverVariant"),
      coverMode: text(row, "coverMode"),
    },
    spoon: spoonRow ? { id: text(spoonRow, "id"), photoUrl: text(spoonRow, "photoUrl") } : null,
    cover: coverRow
      ? {
          id: text(coverRow, "id"),
          recipeId: text(coverRow, "recipeId"),
          imageUrl: text(coverRow, "imageUrl"),
          stylizedImageUrl: nullableText(coverRow, "stylizedImageUrl"),
          sourceImageUrl: nullableText(coverRow, "sourceImageUrl"),
          sourceType: text(coverRow, "sourceType"),
          sourceSpoonId: nullableText(coverRow, "sourceSpoonId"),
          status: text(coverRow, "status"),
          archivedAt: d1NullableDateTime(coverRow.archivedAt, "archivedAt"),
        }
      : null,
  };
}

/**
 * `startRecipeCoverRegeneration` as one D1 statement. A cover that already has a generated
 * (stylized) image gets a child cover linked by `parentCoverId`, so that image is kept; any other
 * cover is regenerated in place, timed from now for the stuck-generation check.
 */
export function coverRegenerationStatement(
  cover: CoverForRegeneration,
  input: { createdById: string; rawPhotoUrl: string; promptAddition: string | null },
  now: Date,
): { coverId: string; parentCoverId: string | undefined; statement: D1Query } {
  if (cover.stylizedImageUrl) {
    const coverId = crypto.randomUUID();
    return {
      coverId,
      parentCoverId: cover.id,
      statement: coverInsertStatement(
        {
          id: coverId,
          recipeId: cover.recipeId,
          imageUrl: cover.imageUrl,
          sourceType: cover.sourceType as RecipeCoverSourceType,
          sourceSpoonId: cover.sourceSpoonId,
          status: "processing",
          generationStatus: "processing",
          createdById: input.createdById,
          sourceImageUrl: input.rawPhotoUrl,
          promptAddition: input.promptAddition,
          parentCoverId: cover.id,
        },
        now,
      ),
    };
  }
  return {
    coverId: cover.id,
    parentCoverId: undefined,
    statement: [
      `UPDATE "RecipeCover" SET "status" = 'processing', "generationStatus" = 'processing', "generationStartedAt" = ?,
         "failureReason" = NULL, "sourceImageUrl" = ?, "promptAddition" = ? WHERE "id" = ?`,
      d1Timestamp(now),
      cover.sourceImageUrl ?? input.rawPhotoUrl,
      input.promptAddition,
      cover.id,
    ],
  };
}
