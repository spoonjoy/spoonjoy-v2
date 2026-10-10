// Logging a cook from the recipe page on D1, without Prisma in the request. One read batch takes
// everything the decisions need (the recipe and its active cover, whether this chef has cooked it
// before, and the cook's username); one write batch then adds the spoon and, when its photo
// becomes the recipe's cover, the cover and the recipe's new cover choice together.
import { d1ReadBatch, d1NullableDateTime, type D1Query, type D1ReadDatabase, type D1Row } from "~/lib/d1-read.server";
import { d1Timestamp, d1WriteBatch } from "~/lib/d1-write.server";
import { coverInsertStatement } from "~/lib/recipe-cover.server";
import { prepareSpoonContent, type CreateSpoonDeps, type CreateSpoonInput } from "~/lib/recipe-spoon.server";
import {
  decideSpoonCoverCreation,
  type ActiveCoverForSpoonDecision,
  type RecipeForSpoonCoverDecision,
  type SpoonCoverCreationDecision,
} from "~/lib/spoon-cover-decision.server";

export interface CreateSpoonOnD1Input extends CreateSpoonInput {
  useAsRecipeCover: boolean;
}

export interface CreateSpoonOnD1Result {
  spoon: { id: string; photoUrl: string | null };
  isOriginCook: boolean;
  recipe: { id: string; title: string };
  spoonerUsername: string | null;
  /** The cover made from the spoon's photo, when one was made. */
  cover: { id: string } | null;
}

// `activateSpoonCoverForDecision`'s auto-seed condition, in SQL: the recipe is still on automatic
// covers, its active cover is the one this request read, and that cover is not a real one (missing,
// another recipe's, not ready, archived, a placeholder, or without an image for its variant).
const STILL_WITHOUT_REAL_COVER = `"coverMode" = 'auto' AND "activeCoverId" IS ? AND NOT EXISTS (
  SELECT 1 FROM "RecipeCover" c
  WHERE c."id" = "Recipe"."activeCoverId" AND c."recipeId" = "Recipe"."id" AND c."status" = 'ready'
    AND c."archivedAt" IS NULL AND c."sourceType" <> 'ai-placeholder'
    AND CASE
      WHEN "Recipe"."activeCoverVariant" = 'image' THEN c."imageUrl" <> ''
      WHEN "Recipe"."activeCoverVariant" = 'stylized' THEN COALESCE(c."stylizedImageUrl", '') <> ''
      WHEN "Recipe"."activeCoverVariant" IS NULL THEN c."imageUrl" <> '' OR COALESCE(c."stylizedImageUrl", '') <> ''
      ELSE 1
    END
)`;

function text(row: D1Row, column: string): string {
  const value = row[column];
  if (typeof value !== "string") throw new Error(`D1 column ${column} is not text`);
  return value;
}

function nullableText(row: D1Row, column: string): string | null {
  return row[column] == null ? null : text(row, column);
}

function activeCoverFromRow(row: D1Row | undefined): ActiveCoverForSpoonDecision | null {
  if (!row) return null;
  return {
    id: text(row, "id"),
    recipeId: text(row, "recipeId"),
    sourceType: text(row, "sourceType"),
    status: text(row, "status"),
    archivedAt: d1NullableDateTime(row.archivedAt, "archivedAt"),
    imageUrl: nullableText(row, "imageUrl"),
    stylizedImageUrl: nullableText(row, "stylizedImageUrl"),
  };
}

function recipeCoverUpdate(
  recipeId: string,
  decision: Extract<SpoonCoverCreationDecision, { shouldCreateCover: true }>,
  coverId: string,
  previousActiveCoverId: string | null,
  now: string,
): D1Query {
  const set = `UPDATE "Recipe" SET "activeCoverId" = ?, "activeCoverVariant" = ?, "coverMode" = ?, "updatedAt" = ? WHERE "id" = ?`;
  const values = [coverId, decision.activeCoverVariant, decision.coverMode, now, recipeId];
  // A cover the chef asked for replaces whatever is there; an automatic one only fills a gap that
  // is still open when the batch runs.
  if (decision.reason === "manual-opt-in") return [set, ...values];
  return [`${set} AND ${STILL_WITHOUT_REAL_COVER}`, ...values, previousActiveCoverId];
}

/**
 * Adds a cook's spoon to a recipe on D1. Answers 404 for a recipe that does not exist or is in the
 * trash; otherwise it decides and writes as `createSpoon` followed by the spoon-cover step on the Prisma path.
 */
export async function createSpoonOnD1(
  d1: D1ReadDatabase,
  input: CreateSpoonOnD1Input,
  deps: CreateSpoonDeps = {},
): Promise<CreateSpoonOnD1Result> {
  const [recipeRows, coverRows, priorRows, spoonerRows] = await d1ReadBatch(d1, [
    [
      `SELECT "id", "title", "chefId", "coverMode", "activeCoverId", "activeCoverVariant" FROM "Recipe" WHERE "id" = ? AND "deletedAt" IS NULL`,
      input.recipeId,
    ],
    [
      `SELECT c."id", c."recipeId", c."imageUrl", c."stylizedImageUrl", c."sourceType", c."status", c."archivedAt"
       FROM "Recipe" r JOIN "RecipeCover" c ON c."id" = r."activeCoverId" WHERE r."id" = ?`,
      input.recipeId,
    ],
    [
      `SELECT 1 AS "prior" FROM "RecipeSpoon" WHERE "chefId" = ? AND "recipeId" = ? AND "deletedAt" IS NULL LIMIT 1`,
      input.chefId,
      input.recipeId,
    ],
    [`SELECT "username" FROM "User" WHERE "id" = ?`, input.chefId],
  ]);
  const recipeRow = recipeRows[0];
  if (!recipeRow) throw new Response("Recipe not found", { status: 404 });
  const recipe: RecipeForSpoonCoverDecision & { title: string } = {
    id: text(recipeRow, "id"),
    title: text(recipeRow, "title"),
    chefId: text(recipeRow, "chefId"),
    coverMode: nullableText(recipeRow, "coverMode"),
    activeCoverId: nullableText(recipeRow, "activeCoverId"),
    activeCoverVariant: nullableText(recipeRow, "activeCoverVariant"),
    activeCover: activeCoverFromRow(coverRows[0]),
  };
  const isOriginCook = recipe.chefId === input.chefId && priorRows.length === 0;

  const { note, nextTime, photoUrl } = await prepareSpoonContent(input, deps);
  const decision = decideSpoonCoverCreation({
    recipe,
    userId: input.chefId,
    isOriginCook,
    hasPhoto: photoUrl !== null,
    useAsRecipeCover: input.useAsRecipeCover,
  });

  const nowDate = new Date();
  const now = d1Timestamp(nowDate);
  const spoonId = input.id ?? crypto.randomUUID();
  const writes: D1Query[] = [
    [
      `INSERT INTO "RecipeSpoon" ("id", "chefId", "recipeId", "cookedAt", "photoUrl", "note", "nextTime", "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      spoonId,
      input.chefId,
      input.recipeId,
      input.cookedAt ? d1Timestamp(input.cookedAt) : now,
      photoUrl,
      note,
      nextTime,
      now,
      now,
    ],
  ];
  let cover: { id: string } | null = null;
  if (decision.shouldCreateCover && photoUrl) {
    cover = { id: crypto.randomUUID() };
    writes.push(
      coverInsertStatement(
        {
          id: cover.id,
          recipeId: input.recipeId,
          imageUrl: photoUrl,
          sourceType: "spoon",
          sourceSpoonId: spoonId,
          status: "processing",
          createdById: input.chefId,
          sourceImageUrl: photoUrl,
          generationStatus: "processing",
        },
        nowDate,
      ),
      recipeCoverUpdate(input.recipeId, decision, cover.id, recipe.activeCoverId, now),
    );
  }
  await d1WriteBatch(d1, writes);

  return {
    spoon: { id: spoonId, photoUrl },
    isOriginCook,
    recipe: { id: recipe.id, title: recipe.title },
    spoonerUsername: spoonerRows[0] ? nullableText(spoonerRows[0], "username") : null,
    cover,
  };
}
