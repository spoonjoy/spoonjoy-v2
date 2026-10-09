import type { Route } from "./+types/saved-recipes";
import { useLoaderData } from "react-router";
import { Button } from "~/components/ui/button";
import { Text } from "~/components/ui/text";
import { CookbookHeader, CookbookPage, ObjectRow, RuledEmptyState } from "~/components/cookbook/page";
import { getRequestDb } from "~/lib/route-platform.server";
import { requestD1 } from "~/lib/d1-read.server";
import {
  readSavedRecipesFromD1,
  readSavedRecipesWithPrisma,
  type SavedRecipe,
} from "~/lib/collection-reads.server";
import { requireUserId } from "~/lib/session.server";
import { DrawerSearch } from "./my-recipes";
import { RecipesSectionNav } from "~/components/navigation";

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

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Saved recipes - Spoonjoy" },
    { name: "description", content: "Recipes you've saved on Spoonjoy." },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const userId = await requireUserId(request, "/login", context.cloudflare?.env);
  const query = normalizedQuery(request);
  // On the Worker the page reads from D1 in one statement; Prisma is only the fallback
  // where there is no binding.
  const d1 = requestD1(context);
  const recipes = d1
    ? await readSavedRecipesFromD1(d1, userId)
    : await readSavedRecipesWithPrisma(await getRequestDb(context), userId);

  return {
    query,
    recipes: recipes.filter((recipe) => matchesSavedRecipeQuery(recipe, query)),
  };
}

export default function SavedRecipes() {
  const { query, recipes } = useLoaderData<typeof loader>();

  return (
    <CookbookPage>
      <RecipesSectionNav />
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
          action={(
            <div className="flex flex-wrap gap-2">
              <Button href="/recipes">Explore recipes</Button>
              <Button href="/cookbooks/new" plain>New cookbook</Button>
            </div>
          )}
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
