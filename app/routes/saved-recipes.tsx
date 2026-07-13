import type { Route } from "./+types/saved-recipes";
import { useLoaderData } from "react-router";
import { Button } from "~/components/ui/button";
import { Text } from "~/components/ui/text";
import { CookbookHeader, CookbookPage, ObjectRow, RuledEmptyState } from "~/components/cookbook/page";
import { getRequestDb } from "~/lib/route-platform.server";
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
  savedCookbookTitles: string[];
};

function normalizedQuery(request: Request) {
  return (new URL(request.url).searchParams.get("q") ?? "").trim();
}

function matchesSavedRecipeQuery(recipe: SavedRecipe, query: string) {
  if (!query) return true;
  const needle = query.toLowerCase();
  return [
    recipe.title,
    recipe.description,
    recipe.servings,
    recipe.chef.username,
    ...recipe.savedCookbookTitles,
  ].some((value) => value?.toLowerCase().includes(needle));
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const userId = await requireUserId(request, "/login", context.cloudflare?.env);
  const query = normalizedQuery(request);
  const database = await getRequestDb(context);

  const memberships = await database.recipeInCookbook.findMany({
    where: {
      cookbook: { authorId: userId },
      recipe: { deletedAt: null },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    include: {
      cookbook: {
        select: { title: true },
      },
      recipe: {
        include: {
          chef: {
            select: { id: true, username: true },
          },
        },
      },
    },
  });

  const byRecipeId = new Map<string, SavedRecipe>();
  for (const membership of memberships) {
    const existing = byRecipeId.get(membership.recipeId);
    if (existing) {
      if (!existing.savedCookbookTitles.includes(membership.cookbook.title)) {
        existing.savedCookbookTitles.push(membership.cookbook.title);
      }
      continue;
    }

    byRecipeId.set(membership.recipeId, {
      id: membership.recipe.id,
      title: membership.recipe.title,
      description: membership.recipe.description,
      servings: membership.recipe.servings,
      chef: membership.recipe.chef,
      savedCookbookTitles: [membership.cookbook.title],
    });
  }

  return {
    query,
    recipes: Array.from(byRecipeId.values()).filter((recipe) =>
      matchesSavedRecipeQuery(recipe, query),
    ),
  };
}

export default function SavedRecipes() {
  const { query, recipes } = useLoaderData<typeof loader>();

  return (
    <CookbookPage>
      <CookbookHeader eyebrow="My Kitchen" title="Saved Recipes">
        Recipes you saved into your cookbooks.
      </CookbookHeader>

      <DrawerSearch label="Search saved recipes" query={query} placeholder="cookbook, chef, ingredient" />

      {recipes.length > 0 ? (
        <section aria-label="Saved recipes" className="mt-6 divide-y divide-[var(--sj-border)]">
          {recipes.map((recipe) => (
            <ObjectRow
              key={recipe.id}
              href={`/recipes/${recipe.id}`}
              title={recipe.title}
              subtitle={`By ${recipe.chef.username} - ${recipe.savedCookbookTitles.join(", ")}`}
              stamp={recipe.servings ?? undefined}
            />
          ))}
        </section>
      ) : (
        <RuledEmptyState
          title={query ? "No matching saved recipes" : "No saved recipes yet"}
          action={<Button href="/recipes">Explore Recipes</Button>}
        >
          <Text>
            {query
              ? "Try a different cookbook, chef, or recipe term."
              : "Save recipes by adding them to one of your cookbooks."}
          </Text>
        </RuledEmptyState>
      )}
    </CookbookPage>
  );
}
