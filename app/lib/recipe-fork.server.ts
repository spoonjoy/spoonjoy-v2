import type { Prisma, PrismaClient as PrismaClientType } from "@prisma/client";
import type { D1ReadDatabase } from "~/lib/d1-read.server";
import { d1WriteBatch, isD1GuardFailure } from "~/lib/d1-write.server";
import {
  activeRecipeTitleFreeGuard,
  ingredientInsertStatement,
  recipeInsertStatement,
  recipeUpdateStatement,
  stepInsertStatement,
  stepOutputUseInsertStatement,
} from "~/lib/recipe-d1-writes.server";
import {
  coverInsertStatement,
  createCover,
  type RecipeCoverGenerationStatus,
  type RecipeCoverSourceType,
  type RecipeCoverStatus,
  type RecipeCoverVariant,
} from "~/lib/recipe-cover.server";

export class ForkSourceNotFoundError extends Error {
  constructor(sourceRecipeId: string) {
    super(`Source recipe not found: ${sourceRecipeId}`);
    this.name = "ForkSourceNotFoundError";
  }
}

export class ForkTitleExhaustedError extends Error {
  constructor(baseTitle: string) {
    super(
      `Could not resolve a unique title for fork of "${baseTitle}" after ${MAX_VARIATION_ATTEMPTS} attempts`,
    );
    this.name = "ForkTitleExhaustedError";
  }
}

const MAX_VARIATION_ATTEMPTS = 100;
// On D1 the fork re-checks its title as it writes; a recipe that takes the title in between
// sends it back to pick the next free one, this many times at most.
const D1_TITLE_RACE_ATTEMPTS = 3;

export interface ForkRecipeInput {
  sourceRecipeId: string;
  viewerId: string;
  titleOverride?: string | null;
  recipeId?: string;
}

const sourceInclude = {
  chef: { select: { id: true, username: true } },
  activeCover: true,
  steps: {
    orderBy: { stepNum: "asc" as const },
    include: {
      ingredients: true,
    },
  },
} satisfies Prisma.RecipeInclude;

const detailInclude = {
  chef: { select: { id: true, email: true, username: true } },
  covers: { orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }] },
  steps: {
    orderBy: { stepNum: "asc" as const },
    include: {
      ingredients: { include: { unit: true, ingredientRef: true } },
    },
  },
} satisfies Prisma.RecipeInclude;

export type ForkedRecipeDetail = Prisma.RecipeGetPayload<{ include: typeof detailInclude }>;

export interface ForkedRecipeResult {
  recipe: ForkedRecipeDetail;
  attribution: {
    sourceRecipeId: string;
    sourceChef: { id: string; username: string };
  };
  appliedTitle: string;
  titleWasSuffixed: boolean;
}

function variationTitle(base: string, n: number): string {
  return n <= 1 ? base : `${base} (variation ${n})`;
}

function nonEmpty(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function copyableActiveVariant(source: ForkSource): RecipeCoverVariant | null {
  const cover = source.activeCover;
  if (!cover || source.coverMode === "none") return null;
  if (cover.recipeId !== source.id) return null;
  if (cover.status !== "ready" || cover.archivedAt) return null;

  if (source.activeCoverVariant === "stylized" && nonEmpty(cover.stylizedImageUrl)) return "stylized";
  if (source.activeCoverVariant === "image" && nonEmpty(cover.imageUrl)) return "image";
  if (nonEmpty(cover.stylizedImageUrl)) return "stylized";
  if (nonEmpty(cover.imageUrl)) return "image";
  return null;
}

async function resolveTitle(
  db: PrismaClientType,
  chefId: string,
  baseTitle: string,
): Promise<{ title: string; suffixed: boolean }> {
  for (let n = 1; n <= MAX_VARIATION_ATTEMPTS; n++) {
    const candidate = variationTitle(baseTitle, n);
    const collision = await db.recipe.findFirst({
      where: { chefId, title: candidate, deletedAt: null },
      select: { id: true },
    });
    if (!collision) return { title: candidate, suffixed: n > 1 };
  }
  throw new ForkTitleExhaustedError(baseTitle);
}

type ForkSource = Prisma.RecipeGetPayload<{ include: typeof sourceInclude }>;
type ForkStepOutputUse = { outputStepNum: number; inputStepNum: number };

function copiedCoverInput(source: ForkSource, recipeId: string) {
  const cover = source.activeCover!;
  return {
    recipeId,
    imageUrl: cover.imageUrl,
    stylizedImageUrl: cover.stylizedImageUrl,
    sourceType: cover.sourceType as RecipeCoverSourceType,
    sourceSpoonId: null,
    status: cover.status as RecipeCoverStatus,
    createdById: cover.createdById,
    sourceImageUrl: cover.sourceImageUrl,
    generationStatus: cover.generationStatus as RecipeCoverGenerationStatus,
    failureReason: cover.failureReason,
    promptVersion: cover.promptVersion,
    styleVersion: cover.styleVersion,
  };
}

/**
 * The fork as one atomic D1 batch: the recipe, its steps, ingredients, step output uses and
 * copied cover all apply, or none do. The batch re-checks the title as it writes; if another
 * recipe took it in between, the title is resolved again.
 */
async function writeForkOnD1(
  db: PrismaClientType,
  d1: D1ReadDatabase,
  source: ForkSource,
  stepOutputUses: ForkStepOutputUse[],
  input: ForkRecipeInput,
  baseTitle: string,
): Promise<string> {
  const recipeId = input.recipeId ?? crypto.randomUUID();
  const activeVariant = source.coverMode === "none" ? null : copyableActiveVariant(source);
  for (let attempt = 1; ; attempt++) {
    const { title } = await resolveTitle(db, input.viewerId, baseTitle);
    const now = new Date();
    const coverId = crypto.randomUUID();
    try {
      await d1WriteBatch(d1, [
        activeRecipeTitleFreeGuard(input.viewerId, title),
        recipeInsertStatement({
          id: recipeId,
          title,
          description: source.description,
          servings: source.servings,
          chefId: input.viewerId,
          sourceRecipeId: source.id,
          // sourceUrl intentionally NOT propagated
          coverMode: source.coverMode === "none" ? "none" : "auto",
          now,
        }),
        ...source.steps.map((step) => stepInsertStatement({
          recipeId,
          stepNum: step.stepNum,
          stepTitle: step.stepTitle,
          description: step.description,
          duration: step.duration,
          now,
        })),
        ...source.steps.flatMap((step) => step.ingredients.map((ingredient) => ingredientInsertStatement({
          recipeId,
          stepNum: step.stepNum,
          quantity: ingredient.quantity,
          unitId: ingredient.unitId,
          ingredientRefId: ingredient.ingredientRefId,
          now,
        }))),
        ...stepOutputUses.map((use) => stepOutputUseInsertStatement(recipeId, use.inputStepNum, use.outputStepNum, now)),
        ...(activeVariant
          ? [
            coverInsertStatement({ ...copiedCoverInput(source, recipeId), id: coverId }, now),
            recipeUpdateStatement(recipeId, {
              activeCoverId: coverId,
              activeCoverVariant: activeVariant,
              coverMode: source.coverMode,
            }, now),
          ]
          : []),
      ]);
      return recipeId;
    } catch (error) {
      if (!isD1GuardFailure(error)) throw error;
      if (attempt === D1_TITLE_RACE_ATTEMPTS) throw new ForkTitleExhaustedError(baseTitle);
    }
  }
}

async function writeForkWithPrisma(
  db: PrismaClientType,
  source: ForkSource,
  stepOutputUses: ForkStepOutputUse[],
  input: ForkRecipeInput,
  baseTitle: string,
): Promise<string> {
  // Prisma (no D1 binding): the writes run in sequence against the top-level client.
  const { title } = await resolveTitle(db, input.viewerId, baseTitle);
  const created = await db.recipe.create({
    data: {
      id: input.recipeId,
      title,
      description: source.description,
      servings: source.servings,
      chefId: input.viewerId,
      sourceRecipeId: source.id,
      // sourceUrl intentionally NOT propagated
    },
    select: { id: true },
  });

  for (const step of source.steps) {
    await db.recipeStep.create({
      data: {
        recipeId: created.id,
        stepNum: step.stepNum,
        stepTitle: step.stepTitle,
        description: step.description,
        duration: step.duration,
      },
    });
  }

  for (const step of source.steps) {
    if (step.ingredients.length === 0) continue;
    await db.ingredient.createMany({
      data: step.ingredients.map((ing) => ({
        recipeId: created.id,
        stepNum: step.stepNum,
        quantity: ing.quantity,
        unitId: ing.unitId,
        ingredientRefId: ing.ingredientRefId,
      })),
    });
  }

  if (stepOutputUses.length > 0) {
    await db.stepOutputUse.createMany({
      data: stepOutputUses.map((sou) => ({
        recipeId: created.id,
        outputStepNum: sou.outputStepNum,
        inputStepNum: sou.inputStepNum,
      })),
    });
  }

  if (source.coverMode === "none") {
    await db.recipe.update({
      where: { id: created.id },
      data: {
        activeCoverId: null,
        activeCoverVariant: null,
        coverMode: "none",
      },
    });
  } else {
    const activeVariant = copyableActiveVariant(source);
    if (source.activeCover && activeVariant) {
      const copiedCover = await createCover(db, copiedCoverInput(source, created.id));
      await db.recipe.update({
        where: { id: created.id },
        data: {
          activeCoverId: copiedCover.id,
          activeCoverVariant: activeVariant,
          coverMode: source.coverMode,
        },
      });
    }
  }

  return created.id;
}

/**
 * Forks a recipe for the viewer. With a D1 binding the writes are one atomic batch; without
 * one (unit tests, scripts) they run through Prisma.
 */
export async function forkRecipe(
  db: PrismaClientType,
  input: ForkRecipeInput,
  d1: D1ReadDatabase | null = null,
): Promise<ForkedRecipeResult> {
  const source = await db.recipe.findUnique({
    where: { id: input.sourceRecipeId },
    include: sourceInclude,
  });
  if (!source || source.deletedAt) {
    throw new ForkSourceNotFoundError(input.sourceRecipeId);
  }

  const stepOutputUses = await db.stepOutputUse.findMany({
    where: { recipeId: source.id },
    select: { outputStepNum: true, inputStepNum: true },
  });

  const override = input.titleOverride?.trim();
  const baseTitle = override && override.length > 0 ? override : source.title;

  const createdId = d1
    ? await writeForkOnD1(db, d1, source, stepOutputUses, input, baseTitle)
    : await writeForkWithPrisma(db, source, stepOutputUses, input, baseTitle);

  const recipe = await db.recipe.findUniqueOrThrow({
    where: { id: createdId },
    include: detailInclude,
  });

  return {
    recipe,
    attribution: {
      sourceRecipeId: source.id,
      sourceChef: { id: source.chef.id, username: source.chef.username },
    },
    appliedTitle: recipe.title,
    titleWasSuffixed: recipe.title !== baseTitle,
  };
}
