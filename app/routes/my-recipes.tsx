import type { Route } from "./+types/my-recipes";
import { Form, useLoaderData, useLocation } from "react-router";
import { Plus, Search } from "lucide-react";
import { Button } from "~/components/ouro/button/button";
import { Link } from "~/components/ouro/link/link";
import { TextField } from "~/components/ouro/text-field/text-field";
import { Pagination } from "~/components/ouro/pagination/pagination";
import { Item } from "~/components/ouro/item/item";
import { ItemGroup } from "~/components/ouro/item/item-group";
import { Text } from "~/components/ouro/text/text";
import { CookbookPage, RuledEmptyState } from "~/components/cookbook/page";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import {
  normalizeMyRecipesPage,
  normalizeMyRecipesQuery,
  searchMyRecipes,
  searchMyRecipesFromD1,
} from "~/lib/my-recipes-search.server";
import { requestD1 } from "~/lib/d1-read.server";
import { getRequestDb } from "~/lib/route-platform.server";
import { requireUserId } from "~/lib/session.server";
import { RecipesSectionNav } from "~/components/navigation";

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

export function meta({}: Route.MetaArgs) {
  return [
    { title: "My recipes - Spoonjoy" },
    { name: "description", content: "Recipes you've created on Spoonjoy." },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const userId = await requireUserId(request, "/login", context.cloudflare?.env);
  const url = new URL(request.url);
  const query = normalizeMyRecipesQuery(url.searchParams.get("q"));
  const page = normalizeMyRecipesPage(url.searchParams.get("page"));
  // On the Worker the owner and their recipes come from D1 in one batch; Prisma is only
  // the fallback where there is no binding.
  const d1 = requestD1(context);
  if (d1) {
    return searchMyRecipesFromD1(d1, { ownerId: userId, query, page });
  }
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
  const { pathname } = useLocation();

  return (
    <CookbookPage>
      <RecipesSectionNav />
      <PageHeader
        eyebrow="My Kitchen"
        title="My Recipes"
        actions={(
          <Button href="/recipes/new">
            <Plus data-slot="icon" className="size-4" />
            Create recipe
          </Button>
        )}
        size="lg"
        divider
        description="Recipes you wrote and keep in your kitchen."
      />

      <DrawerSearch label="Search my recipes" query={query} placeholder="sumac, beans, serves 4" />

      {recipes.length > 0 ? (
        <ItemGroup aria-label="My recipes" variant="divided" className="mt-6">
          {recipes.map((recipe) => (
            <Item
              key={recipe.id}
              href={`/recipes/${recipe.id}`}
              title={recipe.title}
              description={recipe.description ?? `By ${recipe.chef.username}`}
              actions={recipe.servings ? <Text size="sm" tone="muted">{recipe.servings}</Text> : undefined}
            />
          ))}
        </ItemGroup>
      ) : (
        <RuledEmptyState
          title={query ? "No matching recipes" : "No recipes yet"}
          action={<Button href="/recipes/new">Create recipe</Button>}
        >
          <Text tone="muted">
            {query
              ? "Try another title, ingredient, serving size, or note."
              : "Start with the dish you make most often."}
          </Text>
        </RuledEmptyState>
      )}

      {(hasPreviousPage || hasNextPage) ? (
        <Pagination
          className="mt-6"
          label="My recipes pagination"
          page={page}
          hasNextPage={hasNextPage}
          href={(target) => {
            const queryHref = myRecipesPageHref(query, target);
            return queryHref === "." ? pathname : `${pathname}${queryHref}`;
          }}
          previousLabel="Previous page"
          nextLabel="Next page"
        />
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
      <TextField
        type="search"
        name="q"
        label={label}
        hideLabel
        defaultValue={query}
        placeholder={placeholder}
        startAdornment={<Search />}
        className="flex-1"
      />
      <Button type="submit" variant="outline" tone="secondary">Search</Button>
      {query ? <Link href=".">Clear</Link> : null}
    </Form>
  );
}
