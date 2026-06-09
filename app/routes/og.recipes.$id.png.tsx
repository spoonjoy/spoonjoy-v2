import type { Route } from "./+types/og.recipes.$id.png";
import type { RecipeCover } from "@prisma/client";
import { formatServingsLabel } from "~/lib/quantity";
import { absoluteUrlFromRequest, createRecipeOgImageResponse } from "~/lib/og-image.server";
import {
  getRecipeCoverImageUrl,
  getScopedActiveCover,
  recipeCoverCacheSnapshot,
  RECIPE_COVER_DISPLAY_SELECT,
} from "~/lib/recipe-cover.server";
import { getRequestDb } from "~/lib/route-platform.server";

function recipeOgCacheKey(recipe: {
  id: string;
  title: string;
  description: string | null;
  servings: string | null;
  activeCoverId: string | null;
  activeCoverVariant: string | null;
  coverMode: string | null;
  chef: { username: string };
  activeCover: RecipeCover | null;
}) {
  const activeCover = getScopedActiveCover(recipe);
  return JSON.stringify({
    recipeId: recipe.id,
    title: recipe.title,
    description: recipe.description,
    servings: recipe.servings,
    chefUsername: recipe.chef.username,
    activeCoverId: recipe.activeCoverId,
    activeCoverVariant: recipe.activeCoverVariant,
    coverMode: recipe.coverMode,
    cover: recipeCoverCacheSnapshot(activeCover),
  });
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const id = params.id;
  const database = await getRequestDb(context);
  const recipe = await database.recipe.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      servings: true,
      deletedAt: true,
      activeCoverId: true,
      activeCoverVariant: true,
      coverMode: true,
      chef: { select: { username: true } },
      activeCover: { select: RECIPE_COVER_DISPLAY_SELECT },
    },
  });

  if (!recipe || recipe.deletedAt) {
    throw new Response("Recipe not found", { status: 404 });
  }
  const activeCover = getScopedActiveCover(recipe);

  return createRecipeOgImageResponse(
    {
      title: recipe.title,
      description: recipe.description,
      chefUsername: recipe.chef.username,
      servingsLabel: formatServingsLabel(recipe.servings),
      coverImageUrl: absoluteUrlFromRequest(
        request.url,
        getRecipeCoverImageUrl(recipe, activeCover ? [activeCover] : []),
      ),
    },
    context.cloudflare?.ctx,
    recipeOgCacheKey(recipe),
  );
}
