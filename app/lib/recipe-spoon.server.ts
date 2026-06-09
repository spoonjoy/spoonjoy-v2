import type { Prisma, PrismaClient, RecipeSpoon } from "@prisma/client";
import { RECIPE_IMAGE_TYPES, storeImage, validateImageFileForStorage } from "~/lib/image-storage.server";
import { FOOD_IMAGE_SIZE_MESSAGE, FOOD_IMAGE_TYPE_MESSAGE } from "~/lib/recipe-image";

export class SpoonValidationError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "SpoonValidationError";
  }
}

export class SpoonAuthError extends Error {
  status = 403;
  constructor(message: string) {
    super(message);
    this.name = "SpoonAuthError";
  }
}

export class SpoonNotFoundError extends Error {
  status = 404;
  constructor(message: string) {
    super(message);
    this.name = "SpoonNotFoundError";
  }
}

export interface CreateSpoonInput {
  chefId: string;
  recipeId: string;
  photoFile?: File;
  photoUrl?: string | null;
  note?: string | null;
  nextTime?: string | null;
  cookedAt?: Date;
}

export interface CreateSpoonDeps {
  bucket?: R2Bucket;
  now?: () => number;
}

export interface CreateSpoonResult {
  spoon: RecipeSpoon;
  isOriginCook: boolean;
}

export interface UpdateSpoonPatch {
  note?: string | null;
  nextTime?: string | null;
  cookedAt?: Date;
  photoUrl?: string | null;
}

export interface ListSpoonsOptions {
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

function normalizeLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit < 1) {
    return DEFAULT_LIMIT;
  }
  return Math.min(MAX_LIMIT, Math.floor(limit));
}

function normalizeOffset(offset: number | undefined): number {
  if (typeof offset !== "number" || !Number.isFinite(offset) || offset < 0) {
    return 0;
  }
  return Math.floor(offset);
}

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

async function hasPriorNonDeletedSpoon(
  db: PrismaClient,
  chefId: string,
  recipeId: string,
): Promise<boolean> {
  const existing = await db.recipeSpoon.findFirst({
    where: { chefId, recipeId, deletedAt: null },
    select: { id: true },
  });
  return existing !== null;
}

export async function isOriginCookCandidate(
  db: PrismaClient,
  chefId: string,
  recipeId: string,
): Promise<boolean> {
  const recipe = await db.recipe.findUnique({
    where: { id: recipeId },
    select: { chefId: true },
  });
  if (!recipe) return false;
  if (recipe.chefId !== chefId) return false;
  return !(await hasPriorNonDeletedSpoon(db, chefId, recipeId));
}

export async function createSpoon(
  db: PrismaClient,
  input: CreateSpoonInput,
  deps: CreateSpoonDeps = {},
): Promise<CreateSpoonResult> {
  const note = trimOrNull(input.note ?? null);
  const nextTime = trimOrNull(input.nextTime ?? null);

  const isOriginCook = await isOriginCookCandidate(db, input.chefId, input.recipeId);

  let photoUrl: string | null = input.photoUrl ?? null;
  if (input.photoFile) {
    const photoError = await validateImageFileForStorage(input.photoFile, {
      allowedTypes: RECIPE_IMAGE_TYPES,
      messages: {
        invalidType: FOOD_IMAGE_TYPE_MESSAGE,
        fileTooLarge: FOOD_IMAGE_SIZE_MESSAGE,
      },
    });
    if (photoError) {
      throw new SpoonValidationError(photoError);
    }

    photoUrl = await storeImage({
      bucket: deps.bucket,
      file: input.photoFile,
      namespace: `spoons/${input.chefId}/${input.recipeId}`,
      now: deps.now,
    });
  }

  if (!photoUrl && !note && !nextTime) {
    throw new SpoonValidationError(
      "Spoon must include at least one of: photo, note, nextTime",
    );
  }
  const data: Prisma.RecipeSpoonUncheckedCreateInput = {
    chefId: input.chefId,
    recipeId: input.recipeId,
    note,
    nextTime,
    photoUrl,
  };
  if (input.cookedAt) {
    data.cookedAt = input.cookedAt;
  }

  const spoon = await db.recipeSpoon.create({ data });
  return { spoon, isOriginCook };
}

async function findOwnedActiveSpoon(
  db: PrismaClient,
  spoonId: string,
  requestingUserId: string,
): Promise<RecipeSpoon> {
  const existing = await db.recipeSpoon.findUnique({ where: { id: spoonId } });
  if (!existing) {
    throw new SpoonNotFoundError(`Spoon ${spoonId} not found`);
  }
  if (existing.deletedAt) {
    throw new SpoonNotFoundError(`Spoon ${spoonId} is deleted`);
  }
  if (existing.chefId !== requestingUserId) {
    throw new SpoonAuthError("Spoon is not owned by requesting user");
  }
  return existing;
}

export async function updateSpoon(
  db: PrismaClient,
  spoonId: string,
  requestingUserId: string,
  patch: UpdateSpoonPatch,
): Promise<RecipeSpoon> {
  const existing = await findOwnedActiveSpoon(db, spoonId, requestingUserId);

  const data: Prisma.RecipeSpoonUncheckedUpdateInput = {};
  let nextNote = existing.note;
  let nextNextTime = existing.nextTime;
  let nextPhotoUrl = existing.photoUrl;

  if (patch.note !== undefined) {
    nextNote = trimOrNull(patch.note);
    data.note = nextNote;
  }
  if (patch.nextTime !== undefined) {
    nextNextTime = trimOrNull(patch.nextTime);
    data.nextTime = nextNextTime;
  }
  if (patch.photoUrl !== undefined) {
    nextPhotoUrl = patch.photoUrl;
    data.photoUrl = patch.photoUrl;
  }
  if (patch.cookedAt !== undefined) {
    data.cookedAt = patch.cookedAt;
  }

  if (!nextPhotoUrl && !nextNote && !nextNextTime) {
    throw new SpoonValidationError(
      "Spoon must include at least one of: photo, note, nextTime",
    );
  }

  return db.recipeSpoon.update({ where: { id: spoonId }, data });
}

export async function deleteSpoon(
  db: PrismaClient,
  spoonId: string,
  requestingUserId: string,
): Promise<RecipeSpoon> {
  await findOwnedActiveSpoon(db, spoonId, requestingUserId);
  return db.recipeSpoon.update({
    where: { id: spoonId },
    data: { deletedAt: new Date() },
  });
}

const chefSelect = { id: true, username: true, photoUrl: true } as const;

export type SpoonWithChef = Prisma.RecipeSpoonGetPayload<{
  include: { chef: { select: typeof chefSelect } };
}>;

export async function listSpoonsForRecipe(
  db: PrismaClient,
  recipeId: string,
  opts: ListSpoonsOptions = {},
): Promise<SpoonWithChef[]> {
  const take = normalizeLimit(opts.limit);
  const skip = normalizeOffset(opts.offset);
  const where: Prisma.RecipeSpoonWhereInput = { recipeId };
  if (!opts.includeDeleted) where.deletedAt = null;
  return db.recipeSpoon.findMany({
    where,
    orderBy: [{ cookedAt: "desc" }, { id: "desc" }],
    take,
    skip,
    include: { chef: { select: chefSelect } },
  });
}

const recipeWithCoversInclude = {
  recipe: {
    select: {
      id: true,
      title: true,
      chefId: true,
      activeCoverId: true,
      activeCoverVariant: true,
      coverMode: true,
      covers: {
        orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
      },
    },
  },
  chef: { select: chefSelect },
} satisfies Prisma.RecipeSpoonInclude;

export type SpoonWithRecipeAndChef = Prisma.RecipeSpoonGetPayload<{
  include: typeof recipeWithCoversInclude;
}>;

export async function listSpoonsByChef(
  db: PrismaClient,
  chefIdOrUsername: string,
  opts: ListSpoonsOptions = {},
): Promise<SpoonWithRecipeAndChef[]> {
  const user = await db.user.findFirst({
    where: { OR: [{ id: chefIdOrUsername }, { username: chefIdOrUsername }] },
    select: { id: true },
  });
  if (!user) {
    throw new SpoonNotFoundError(`Chef ${chefIdOrUsername} not found`);
  }
  const take = normalizeLimit(opts.limit);
  const skip = normalizeOffset(opts.offset);
  const where: Prisma.RecipeSpoonWhereInput = { chefId: user.id };
  if (!opts.includeDeleted) where.deletedAt = null;
  return db.recipeSpoon.findMany({
    where,
    orderBy: [{ cookedAt: "desc" }, { id: "desc" }],
    take,
    skip,
    include: recipeWithCoversInclude,
  });
}
