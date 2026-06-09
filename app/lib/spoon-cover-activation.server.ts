import type { Prisma, PrismaClient } from "@prisma/client";
import type { SpoonCoverCreationDecision } from "~/lib/spoon-cover-decision.server";

type CreatingSpoonCoverDecision = Extract<
  SpoonCoverCreationDecision,
  { shouldCreateCover: true }
>;

export async function activateSpoonCoverForDecision(
  db: PrismaClient,
  input: {
    recipeId: string;
    coverId: string;
    decision: CreatingSpoonCoverDecision;
    previousActiveCoverId: string | null;
  },
): Promise<boolean> {
  if (input.decision.reason === "manual-opt-in") {
    await db.recipe.update({
      where: { id: input.recipeId },
      data: {
        activeCoverId: input.coverId,
        activeCoverVariant: input.decision.activeCoverVariant,
        coverMode: input.decision.coverMode,
      },
    });
    return true;
  }

  const result = await db.recipe.updateMany({
    where: {
      id: input.recipeId,
      coverMode: "auto",
      activeCoverId: input.previousActiveCoverId,
      ...withoutRealActiveCover(input.recipeId),
    },
    data: {
      activeCoverId: input.coverId,
      activeCoverVariant: input.decision.activeCoverVariant,
      coverMode: input.decision.coverMode,
    },
  });
  return result.count > 0;
}

function withoutRealActiveCover(recipeId: string): Prisma.RecipeWhereInput {
  return {
    OR: [
      { activeCoverId: null },
      { activeCover: null },
      { activeCover: { is: { recipeId: { not: recipeId } } } },
      { activeCover: { is: { status: { not: "ready" } } } },
      { activeCover: { is: { archivedAt: { not: null } } } },
      { activeCover: { is: { sourceType: "ai-placeholder" } } },
      {
        AND: [
          { activeCoverVariant: "image" },
          { activeCover: { is: { imageUrl: "" } } },
        ],
      },
      {
        AND: [
          { activeCoverVariant: "stylized" },
          {
            activeCover: {
              is: {
                OR: [{ stylizedImageUrl: null }, { stylizedImageUrl: "" }],
              },
            },
          },
        ],
      },
      {
        AND: [
          { activeCoverVariant: null },
          { activeCover: { is: { imageUrl: "" } } },
          {
            activeCover: {
              is: {
                OR: [{ stylizedImageUrl: null }, { stylizedImageUrl: "" }],
              },
            },
          },
        ],
      },
    ],
  };
}
