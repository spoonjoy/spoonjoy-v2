import type { Route } from "./+types/og.cookbooks.$id.png";
import type { RecipeCover } from "@prisma/client";
import { absoluteUrlFromRequest, createCookbookOgImageResponse } from "~/lib/og-image.server";
import {
  getRecipeCoverImageUrl,
  getScopedActiveCover,
  recipeCoverCacheSnapshot,
  RECIPE_COVER_DISPLAY_SELECT,
} from "~/lib/recipe-cover.server";
import { getRequestDb } from "~/lib/route-platform.server";

function coverCachePart(recipe: {
  id: string;
  title: string;
  activeCoverId: string | null;
  activeCoverVariant: string | null;
  coverMode: string | null;
  activeCover: RecipeCover | null;
}) {
  const activeCover = getScopedActiveCover(recipe);
  return {
    recipeId: recipe.id,
    title: recipe.title,
    activeCoverId: recipe.activeCoverId,
    activeCoverVariant: recipe.activeCoverVariant,
    coverMode: recipe.coverMode,
    cover: recipeCoverCacheSnapshot(activeCover),
  };
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const id = params.id;
  const database = await getRequestDb(context);
  const cookbook = await database.cookbook.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      author: { select: { username: true } },
      recipes: {
        where: { recipe: { deletedAt: null } },
        orderBy: { createdAt: "desc" },
        take: 4,
        select: {
          recipe: {
            select: {
              id: true,
              title: true,
              activeCoverId: true,
              activeCoverVariant: true,
              coverMode: true,
              activeCover: { select: RECIPE_COVER_DISPLAY_SELECT },
            },
          },
        },
      },
    },
  });

  if (!cookbook) {
    throw new Response("Cookbook not found", { status: 404 });
  }

  const coverImageUrls = cookbook.recipes.map((item) => {
    const activeCover = getScopedActiveCover(item.recipe);
    return absoluteUrlFromRequest(
      request.url,
      getRecipeCoverImageUrl(
        item.recipe,
        activeCover ? [activeCover] : [],
      ),
    );
  });
  const activeRecipeCount = await database.recipeInCookbook.count({
    where: { cookbookId: id, recipe: { deletedAt: null } },
  });

  return createCookbookOgImageResponse(
    {
      title: cookbook.title,
      authorUsername: cookbook.author.username,
      recipeCount: activeRecipeCount,
      coverImageUrls,
    },
    context.cloudflare?.ctx,
    JSON.stringify({
      cookbookId: cookbook.id,
      title: cookbook.title,
      authorUsername: cookbook.author.username,
      recipeCount: activeRecipeCount,
      coverParts: cookbook.recipes.map((item) => coverCachePart(item.recipe)),
    }),
  );
}
