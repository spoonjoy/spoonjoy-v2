import { Empty } from "~/components/ouro/empty/empty";
import type { Route } from "./+types/saved-recipes";
import { chefDisplayName } from "~/lib/username";
import { useLoaderData } from "react-router";
import { Button } from "~/components/ouro/button/button";
import { Item } from "~/components/ouro/item/item";
import { ItemGroup } from "~/components/ouro/item/item-group";
import { Text } from "~/components/ouro/text/text";
import { CookbookPage } from "~/components/cookbook/page";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { getRequestDb } from "~/lib/route-platform.server";
import { requestD1 } from "~/lib/d1-read.server";
import {
  readSavedRecipesFromD1,
  readSavedRecipesWithPrisma,
  type SavedRecipe,
} from "~/lib/collection-reads.server";
import { requireUserId } from "~/lib/session.server";
import { loadRequestViewerHides, withoutHidden } from "~/lib/moderation.server";
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

  const hides = await loadRequestViewerHides(context, userId);

  return {
    query,
    recipes: withoutHidden(hides, recipes, (recipe) => ({ type: "recipe", id: recipe.id, chefId: recipe.chef.id }))
      .filter((recipe) => matchesSavedRecipeQuery(recipe, query)),
  };
}

export default function SavedRecipes() {
  const { query, recipes } = useLoaderData<typeof loader>();

  return (
    <CookbookPage>
      <RecipesSectionNav />
      <PageHeader
        eyebrow="My Kitchen"
        title="Saved Recipes"
        size="lg"
        divider
        description="Recipes you saved into your cookbooks."
      />

      <DrawerSearch label="Search saved recipes" query={query} placeholder="cookbook, chef, ingredient" />

      {recipes.length > 0 ? (
        <ItemGroup aria-label="Saved recipes" variant="divided" className="mt-6">
          {recipes.map((recipe) => (
            <Item
              key={recipe.id}
              href={`/recipes/${recipe.id}`}
              title={recipe.title}
              description={`By ${chefDisplayName(recipe.chef.username)} - ${recipe.savedCookbookTitles.join(", ")}`}
              actions={recipe.servings ? <Text size="sm" tone="muted">{recipe.servings}</Text> : undefined}
            />
          ))}
        </ItemGroup>
      ) : (
        <Empty headingLevel={2} align="start" description={<>
          <Text tone="muted">
            {query
              ? "Try a different cookbook, chef, or recipe term."
              : "Save recipes by adding them to one of your cookbooks."}
          </Text>
        </>}
          title={query ? "No matching saved recipes" : "No saved recipes yet"}
          action={(
            <div className="flex flex-wrap gap-2">
              <Button href="/recipes">Explore recipes</Button>
              <Button href="/cookbooks/new" variant="outline" tone="secondary">New cookbook</Button>
            </div>
          )} />
      )}
    </CookbookPage>
  );
}
