import type { Route } from "./+types/og.cookbooks.$id.png";
import { absoluteUrlFromRequest, createCookbookOgImageResponse } from "~/lib/og-image.server";
import { getRecipeCoverImageUrl } from "~/lib/recipe-cover.server";
import { getRequestDb } from "~/lib/route-platform.server";

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
              covers: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
            },
          },
        },
      },
    },
  });

  if (!cookbook) {
    throw new Response("Cookbook not found", { status: 404 });
  }

  const coverImageUrls = cookbook.recipes.map((item) =>
    absoluteUrlFromRequest(
      request.url,
      getRecipeCoverImageUrl(
        { id: item.recipe.id, title: item.recipe.title },
        item.recipe.covers,
      ),
    ),
  );
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
  );
}
