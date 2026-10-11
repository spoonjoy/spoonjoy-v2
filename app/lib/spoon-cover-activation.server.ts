import type { Prisma, PrismaClient } from "@prisma/client";
import { retryD1Write } from "~/lib/d1-write-retry.server";
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
  const activeCoverVariant = activeCoverVariantFor(input.decision);
  const data = { activeCoverId: input.coverId, activeCoverVariant, coverMode: input.decision.coverMode };
  if (input.decision.reason === "manual-opt-in") {
    // Sets fixed values, so running it again after a transient D1 error leaves the same recipe.
    await retryD1Write({ scope: "cover.activate_spoon" }, () => db.recipe.update({ where: { id: input.recipeId }, data }));
    return true;
  }

  // The automatic choice fills a gap only while it is still open, so its answer depends on rows
  // changed. After a lost answer, the retry finds the gap closed by its own earlier try: the
  // recipe pointing at this cover (whose id is new to this request) says that try committed.
  const madeActive = async () =>
    (await db.recipe.findFirst({ where: { id: input.recipeId, activeCoverId: input.coverId }, select: { id: true } })) !== null;
  let tries = 0;
  return retryD1Write(
    { scope: "cover.auto_seed_spoon", applied: async () => ((await madeActive()) ? true : null) },
    async () => {
      tries += 1;
      const result = await db.recipe.updateMany({
        where: {
          id: input.recipeId,
          coverMode: "auto",
          activeCoverId: input.previousActiveCoverId,
          ...withoutRealActiveCover(input.recipeId),
        },
        data,
      });
      if (result.count > 0) return true;
      return tries > 1 && (await madeActive());
    },
  );
}

function activeCoverVariantFor(
  decision: CreatingSpoonCoverDecision,
): "image" | "stylized" | null {
  if (decision.reason === "auto-seed") return "image";
  return decision.activeCoverVariant;
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
