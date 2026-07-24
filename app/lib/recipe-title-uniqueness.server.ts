import type { Prisma, PrismaClient as PrismaClientType } from "@prisma/client";
import type { ValidationResult } from "~/lib/validation";

type Database = PrismaClientType | Prisma.TransactionClient;

interface ActiveTitleUniquenessInput {
  chefId: string;
  title: string;
  excludeRecipeId?: string;
}

export const ACTIVE_RECIPE_TITLE_CONFLICT_ERROR = "You already have an active recipe with this title";
export const ACTIVE_RECIPE_TITLE_UNIQUE_INDEX = "Recipe_active_chefId_title_key";

const SQLITE_ACTIVE_RECIPE_TITLE_CONSTRAINT =
  "UNIQUE constraint failed: Recipe.chefId, Recipe.title";

interface ErrorCandidate {
  cause?: unknown;
  code?: unknown;
  message?: unknown;
  meta?: unknown;
}

interface PrismaRawQueryMeta {
  code?: unknown;
  message?: unknown;
}

function hasExactRecipeTitleTarget(meta: unknown): boolean {
  if (!meta || typeof meta !== "object") return false;

  const candidate = meta as { modelName?: unknown; target?: unknown };
  if (candidate.target === ACTIVE_RECIPE_TITLE_UNIQUE_INDEX) return true;
  if (candidate.modelName !== "Recipe" || !Array.isArray(candidate.target)) {
    return false;
  }

  return candidate.target.length === 2
    && candidate.target[0] === "chefId"
    && candidate.target[1] === "title";
}

function hasExactSqliteConstraintMessage(message: unknown): boolean {
  if (typeof message !== "string") return false;

  const namedIndexConstraint =
    `UNIQUE constraint failed: index '${ACTIVE_RECIPE_TITLE_UNIQUE_INDEX}'`;
  return [SQLITE_ACTIVE_RECIPE_TITLE_CONSTRAINT, namedIndexConstraint].some((signature) => {
    const sqliteFailure = `${signature}: SQLITE_CONSTRAINT`;
    const extendedFailure = `${sqliteFailure} (extended: SQLITE_CONSTRAINT_UNIQUE)`;
    return message === signature
      || message === `D1_ERROR: ${sqliteFailure}`
      || message === extendedFailure
      || message === `D1_ERROR: ${extendedFailure}`;
  });
}

function hasExactPrismaRawQueryConstraint(record: ErrorCandidate): boolean {
  if (record.code !== "P2010" || !record.meta || typeof record.meta !== "object") {
    return false;
  }
  const meta = record.meta as PrismaRawQueryMeta;
  return meta.code === "2067" && hasExactSqliteConstraintMessage(meta.message);
}

export function isActiveRecipeTitleConflictError(error: unknown): boolean {
  const seen = new Set<object>();
  let candidate: unknown = error;

  while (candidate && typeof candidate === "object" && !seen.has(candidate)) {
    seen.add(candidate);
    const record = candidate as ErrorCandidate;
    if (
      (record.code === "P2002" && hasExactRecipeTitleTarget(record.meta))
      || hasExactPrismaRawQueryConstraint(record)
      || hasExactSqliteConstraintMessage(record.message)
    ) {
      return true;
    }
    candidate = record.cause;
  }

  return false;
}

export async function findActiveRecipeTitleConflict(
  db: Database,
  { chefId, title, excludeRecipeId }: ActiveTitleUniquenessInput
) {
  const where: Prisma.RecipeWhereInput = {
    chefId,
    title: title.trim(),
    deletedAt: null,
  };

  if (excludeRecipeId) {
    where.id = { not: excludeRecipeId };
  }

  return db.recipe.findFirst({
    where,
    select: { id: true, title: true },
  });
}

export async function validateActiveRecipeTitleUnique(
  db: Database,
  input: ActiveTitleUniquenessInput
): Promise<ValidationResult> {
  const conflict = await findActiveRecipeTitleConflict(db, input);

  if (conflict) {
    return { valid: false, error: ACTIVE_RECIPE_TITLE_CONFLICT_ERROR };
  }

  return { valid: true };
}
