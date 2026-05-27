import type { Route } from "./+types/og.recipes.$id.png";
import { formatServingsLabel } from "~/lib/quantity";
import { absoluteUrlFromRequest, createRecipeOgImageResponse } from "~/lib/og-image.server";
import { getRecipeCoverImageUrl } from "~/lib/recipe-cover.server";
import { getRequestDb } from "~/lib/route-platform.server";

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
      chef: { select: { username: true } },
      covers: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
    },
  });

  if (!recipe || recipe.deletedAt) {
    throw new Response("Recipe not found", { status: 404 });
  }

  return createRecipeOgImageResponse(
    {
      title: recipe.title,
      description: recipe.description,
      chefUsername: recipe.chef.username,
      servingsLabel: formatServingsLabel(recipe.servings),
      coverImageUrl: absoluteUrlFromRequest(
        request.url,
        getRecipeCoverImageUrl({ id: recipe.id, title: recipe.title }, recipe.covers),
      ),
    },
    context.cloudflare?.ctx,
  );
}
