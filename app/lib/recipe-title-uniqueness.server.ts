import type { Prisma, PrismaClient as PrismaClientType } from "@prisma/client";
import type { ValidationResult } from "~/lib/validation";

type Database = PrismaClientType | Prisma.TransactionClient;

interface ActiveTitleUniquenessInput {
  chefId: string;
  title: string;
  excludeRecipeId?: string;
}

export const ACTIVE_RECIPE_TITLE_CONFLICT_ERROR = "You already have an active recipe with this title";

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
