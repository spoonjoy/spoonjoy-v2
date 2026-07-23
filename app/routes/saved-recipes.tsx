import type { Route } from "./+types/saved-recipes";
import { useLoaderData } from "react-router";
import { Button } from "~/components/ui/button";
import { Pagination, PaginationNext } from "~/components/ui/pagination";
import { Text } from "~/components/ui/text";
import { CookbookHeader, CookbookPage, ObjectRow, RuledEmptyState } from "~/components/cookbook/page";
import { getRequestDb } from "~/lib/route-platform.server";
import {
  listSavedRecipes,
  SavedRecipeValidationError,
} from "~/lib/saved-recipes.server";
import { requireUserId } from "~/lib/session.server";
import { DrawerSearch } from "./my-recipes";

type SavedRecipe = {
  id: string;
  title: string;
  description: string | null;
  servings: string | null;
  chef: {
    id: string;
    username: string;
  };
  savedAt: string;
};

export async function loader({ request, context }: Route.LoaderArgs) {
  const userId = await requireUserId(request, "/login", context.cloudflare?.env);
  const url = new URL(request.url);
  const database = await getRequestDb(context);

  try {
    const page = await listSavedRecipes(database, {
      userId,
      query: url.searchParams.get("q"),
      cursor: url.searchParams.get("cursor"),
    });
    const recipeIds = page.items.map((item) => item.recipeId);
    const hydrated = recipeIds.length > 0
      ? await database.recipe.findMany({
          where: { id: { in: recipeIds }, deletedAt: null },
          select: {
            id: true,
            title: true,
            description: true,
            servings: true,
            chef: { select: { id: true, username: true } },
          },
        })
      : [];
    const hydratedById = new Map(hydrated.map((recipe) => [recipe.id, recipe]));
    const recipes = page.items.flatMap((item) => {
      const recipe = hydratedById.get(item.recipeId);
      return recipe ? [{ ...recipe, savedAt: item.savedAt } satisfies SavedRecipe] : [];
    });

    return { query: page.query, recipes, nextCursor: page.nextCursor };
  } catch (error) {
    if (error instanceof SavedRecipeValidationError) {
      throw new Response(error.message, { status: 400 });
    }
    throw error;
  }
}

export default function SavedRecipes() {
  const { query, recipes, nextCursor = null } = useLoaderData<typeof loader>();

  return (
    <CookbookPage>
      <CookbookHeader eyebrow="My Kitchen" title="Saved Recipes">
        Recipes you saved for later.
      </CookbookHeader>

      <DrawerSearch label="Search saved recipes" query={query} placeholder="title, chef, course, tag" />

      {recipes.length > 0 ? (
        <section aria-label="Saved recipes" className="mt-6 divide-y divide-[var(--sj-border)]">
          {recipes.map((recipe) => (
            <ObjectRow
              key={recipe.id}
              href={`/recipes/${recipe.id}`}
              title={recipe.title}
              subtitle={recipe.description ?? `By ${recipe.chef.username}`}
              stamp={recipe.servings ?? undefined}
            />
          ))}
        </section>
      ) : (
        <RuledEmptyState
          title={query ? "No matching saved recipes" : "No saved recipes yet"}
          action={(
            <div className="flex flex-wrap gap-2">
              <Button href="/recipes">Explore Recipes</Button>
            </div>
          )}
        >
          <Text>
            {query
              ? "Try a different title, description, chef, course, or tag."
              : "Save a recipe to keep it close at hand."}
          </Text>
        </RuledEmptyState>
      )}

      {nextCursor ? (
        <Pagination className="mt-6" aria-label="Saved recipes pagination">
          <PaginationNext href={savedRecipesPageHref(query, nextCursor)} />
        </Pagination>
      ) : null}
    </CookbookPage>
  );
}

function savedRecipesPageHref(query: string, cursor: string) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  params.set("cursor", cursor);
  return `/saved-recipes?${params.toString()}`;
}

export function ErrorBoundary() {
  return (
    <CookbookPage>
      <div role="alert" className="sj-rule-block border-l-2 border-[var(--sj-tomato)] pl-4">
        <CookbookHeader eyebrow="My Kitchen" title="Saved Recipes unavailable">
          We could not load your saved recipes. Please try again.
        </CookbookHeader>
      </div>
    </CookbookPage>
  );
}
