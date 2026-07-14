import type { Route } from "./+types/my-recipes";
import { Form, useLoaderData } from "react-router";
import { Plus, Search } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Link } from "~/components/ui/link";
import { Text } from "~/components/ui/text";
import { CookbookHeader, CookbookPage, ObjectRow, RuledEmptyState } from "~/components/cookbook/page";
import { getRequestDb } from "~/lib/route-platform.server";
import { requireUserId } from "~/lib/session.server";

type DrawerRecipe = {
  id: string;
  title: string;
  description: string | null;
  servings: string | null;
  chef: {
    id: string;
    username: string;
  };
  ingredientNames: string[];
};

function normalizedQuery(request: Request) {
  return (new URL(request.url).searchParams.get("q") ?? "").trim();
}

function matchesRecipeQuery(recipe: DrawerRecipe, query: string) {
  if (!query) return true;
  const needle = query.toLowerCase();
  return [
    recipe.title,
    recipe.description,
    recipe.servings,
    recipe.chef.username,
    ...recipe.ingredientNames,
  ].some((value) => value?.toLowerCase().includes(needle));
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const userId = await requireUserId(request, "/login", context.cloudflare?.env);
  const query = normalizedQuery(request);
  const database = await getRequestDb(context);

  const recipes = await database.recipe.findMany({
    where: {
      chefId: userId,
      deletedAt: null,
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    include: {
      chef: {
        select: { id: true, username: true },
      },
      steps: {
        include: {
          ingredients: {
            include: {
              ingredientRef: {
                select: { name: true },
              },
            },
          },
        },
      },
    },
  });

  const drawerRecipes: DrawerRecipe[] = recipes.map((recipe) => ({
    id: recipe.id,
    title: recipe.title,
    description: recipe.description,
    servings: recipe.servings,
    chef: recipe.chef,
    ingredientNames: recipe.steps.flatMap((step) =>
      step.ingredients.map((ingredient) => ingredient.ingredientRef.name),
    ),
  }));

  return {
    query,
    recipes: drawerRecipes.filter((recipe) => matchesRecipeQuery(recipe, query)),
  };
}

export default function MyRecipes() {
  const { query, recipes } = useLoaderData<typeof loader>();

  return (
    <CookbookPage>
      <CookbookHeader
        eyebrow="My Kitchen"
        title="My Recipes"
        action={(
          <Button href="/recipes/new">
            <Plus data-slot="icon" className="size-4" />
            Create Recipe
          </Button>
        )}
      >
        Recipes you wrote and keep in your kitchen.
      </CookbookHeader>

      <DrawerSearch label="Search my recipes" query={query} placeholder="sumac, beans, serves 4" />

      {recipes.length > 0 ? (
        <section aria-label="My recipes" className="mt-6 divide-y divide-[var(--sj-border)]">
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
          title={query ? "No matching recipes" : "No recipes yet"}
          action={<Button href="/recipes/new">Create Recipe</Button>}
        >
          <Text>
            {query
              ? "Try another title, ingredient, serving size, or note."
              : "Start with the dish you make most often."}
          </Text>
        </RuledEmptyState>
      )}
    </CookbookPage>
  );
}

export function DrawerSearch({
  label,
  query,
  placeholder,
}: {
  label: string;
  query: string;
  placeholder: string;
}) {
  return (
    <Form method="get" role="search" className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
      <label className="sr-only" htmlFor="drawer-search">{label}</label>
      <div className="flex min-h-12 flex-1 items-center border border-[var(--sj-border-strong)] bg-[var(--sj-field)] px-4">
        <Search className="mr-2 size-4 shrink-0 text-[var(--sj-ink-soft)]" aria-hidden="true" />
        <input
          id="drawer-search"
          type="search"
          name="q"
          defaultValue={query}
          placeholder={placeholder}
          className="min-h-11 w-full border-0 bg-transparent text-base text-[var(--sj-ink)] outline-none placeholder:text-[var(--sj-ink-soft)]"
        />
      </div>
      <Button type="submit" plain>Search</Button>
      {query ? <Link href="." className="font-sj-ui text-sm font-semibold">Clear</Link> : null}
    </Form>
  );
}
