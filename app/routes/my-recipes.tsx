import type { Route } from "./+types/my-recipes";
import { Form, useLoaderData } from "react-router";
import { Plus, Search } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Link } from "~/components/ui/link";
import { Pagination, PaginationNext, PaginationPrevious } from "~/components/ui/pagination";
import { Text } from "~/components/ui/text";
import { CookbookHeader, CookbookPage, ObjectRow, RuledEmptyState } from "~/components/cookbook/page";
import {
  normalizeMyRecipesPage,
  normalizeMyRecipesQuery,
  searchMyRecipes,
} from "~/lib/my-recipes-search.server";
import { getRequestDb } from "~/lib/route-platform.server";
import { requireUserId } from "~/lib/session.server";

type IngredientLookupDb = {
  ingredient: {
    findMany(args: {
      where: { recipeId: { in: string[] } };
      select: { recipeId: true; ingredientRef: { select: { name: true } } };
    }): Promise<Array<{ recipeId: string; ingredientRef: { name: string } }>>;
  };
};

export const INGREDIENT_LOOKUP_BATCH_SIZE = 200;

export async function loadIngredientNamesByRecipeId(
  database: IngredientLookupDb,
  recipeIds: string[],
) {
  const namesByRecipeId = new Map<string, string[]>();

  for (let start = 0; start < recipeIds.length; start += INGREDIENT_LOOKUP_BATCH_SIZE) {
    const batch = recipeIds.slice(start, start + INGREDIENT_LOOKUP_BATCH_SIZE);
    const ingredients = await database.ingredient.findMany({
      where: { recipeId: { in: batch } },
      select: {
        recipeId: true,
        ingredientRef: { select: { name: true } },
      },
    });

    for (const ingredient of ingredients) {
      const names = namesByRecipeId.get(ingredient.recipeId) ?? [];
      names.push(ingredient.ingredientRef.name);
      namesByRecipeId.set(ingredient.recipeId, names);
    }
  }

  return namesByRecipeId;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const userId = await requireUserId(request, "/login", context.cloudflare?.env);
  const url = new URL(request.url);
  const query = normalizeMyRecipesQuery(url.searchParams.get("q"));
  const page = normalizeMyRecipesPage(url.searchParams.get("page"));
  const database = await getRequestDb(context);

  const chef = await database.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, username: true },
  });
  return searchMyRecipes(database, {
    ownerId: chef.id,
    ownerUsername: chef.username,
    query,
    page,
  });
}

export default function MyRecipes() {
  const { query, recipes, page, hasPreviousPage, hasNextPage } = useLoaderData<typeof loader>();

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

      {(hasPreviousPage || hasNextPage) ? (
        <Pagination className="mt-6" aria-label="My recipes pagination">
          <PaginationPrevious href={hasPreviousPage ? myRecipesPageHref(query, page - 1) : null} />
          <PaginationNext href={hasNextPage ? myRecipesPageHref(query, page + 1) : null} />
        </Pagination>
      ) : null}
    </CookbookPage>
  );
}

function myRecipesPageHref(query: string, page: number) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  return search ? `?${search}` : ".";
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
