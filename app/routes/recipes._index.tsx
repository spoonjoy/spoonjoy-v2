import type { Route } from "./+types/recipes._index";
import { Form, useLoaderData } from "react-router";
import { BookOpen, ChefHat, Plus, Search as SearchIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Heading, Subheading } from "~/components/ui/heading";
import { Input } from "~/components/ui/input";
import { Link } from "~/components/ui/link";
import { Text } from "~/components/ui/text";
import { CookbookPage, RuledEmptyState } from "~/components/cookbook/page";
import { getRequestDb } from "~/lib/route-platform.server";
import { getUserId } from "~/lib/session.server";
import { getRecipeCoverImageUrl } from "~/lib/recipe-cover.server";
import { searchSpoonjoy } from "~/lib/search.server";
import { formatServingsLabel } from "~/lib/quantity";

type PublicRecipe = {
  id: string;
  title: string;
  description: string | null;
  servings: string | null;
  chef: { username: string };
  coverImageUrl: string | null;
};

const PUBLIC_RECIPE_LIMIT = 48;

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Recipes - Spoonjoy" },
    { name: "description", content: "Browse public Spoonjoy recipes from every kitchen." },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  const database = await getRequestDb(context);
  const userId = await getUserId(request, context.cloudflare?.env);

  const recipeIds = query
    ? (await searchSpoonjoy(database, {
        query,
        scope: "recipes",
        limit: PUBLIC_RECIPE_LIMIT,
      })).map((result) => result.id)
    : [];

  const recipes = await database.recipe.findMany({
    where: {
      deletedAt: null,
      ...(query ? { id: { in: recipeIds } } : {}),
    },
    include: {
      chef: { select: { username: true } },
      covers: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
    },
    orderBy: query ? undefined : { updatedAt: "desc" },
    take: PUBLIC_RECIPE_LIMIT,
  });

  const order = new Map(recipeIds.map((id, index) => [id, index]));
  if (query) {
    recipes.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  }

  return {
    query,
    isAuthenticated: Boolean(userId),
    recipes: recipes.map(({ covers, ...recipe }): PublicRecipe => ({
      id: recipe.id,
      title: recipe.title,
      description: recipe.description,
      servings: recipe.servings,
      chef: recipe.chef,
      coverImageUrl: getRecipeCoverImageUrl(recipe, covers),
    })),
  };
}

export default function RecipesIndex() {
  const { query, isAuthenticated, recipes } = useLoaderData<typeof loader>();
  const hasQuery = query.length > 0;

  return (
    <CookbookPage>
      <section>
        <header className="border-b border-[var(--sj-border-strong)] pb-8">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] lg:items-end">
            <div>
              <p className="sj-eyebrow">Public recipe box</p>
              <Heading level={1} className="mt-3 max-w-4xl text-5xl/12 sm:text-7xl/18 lg:text-[84px] lg:leading-[1.04]">
                Recipes worth opening before you sign in.
              </Heading>
              <Text className="mt-5 max-w-2xl text-lg/8">
                Browse every public Spoonjoy recipe. Sign in only when you want to cook, fork, save, or add ingredients to your own list.
              </Text>
            </div>

            <div className="border-t border-[var(--sj-border)] pt-5 lg:border-t-0">
              <Form method="get" role="search" className="grid gap-3">
                <label htmlFor="public-recipe-search" className="font-sj-ui text-xs font-semibold uppercase tracking-[0.18em] text-[var(--sj-ink-soft)]">
                  Search recipes
                </label>
                <div className="flex min-h-14 items-center border-y border-[var(--sj-border-strong)] bg-transparent">
                  <SearchIcon className="ml-1 mr-3 size-5 shrink-0 text-[var(--sj-ink-soft)]" aria-hidden="true" />
                  <Input
                    id="public-recipe-search"
                    name="q"
                    type="search"
                    defaultValue={query}
                    placeholder="tomato, beans, lemon"
                    className="min-w-0 flex-1 before:hidden after:hidden [&_input]:h-14 [&_input]:border-0 [&_input]:bg-transparent [&_input]:px-0 [&_input]:py-0 [&_input]:font-sj-display [&_input]:text-2xl/8 [&_input]:outline-none [&_input]:placeholder:text-[var(--sj-ink-soft)]"
                  />
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button type="submit">Search</Button>
                  {hasQuery ? <Button href="/recipes" plain>Clear</Button> : null}
                  {isAuthenticated ? (
                    <Button href="/recipes/new" plain>
                      <Plus data-slot="icon" aria-hidden="true" />
                      Create Recipe
                    </Button>
                  ) : null}
                </div>
              </Form>
            </div>
          </div>
        </header>

        <div className="py-8">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="sj-eyebrow">{hasQuery ? "Matches" : "Recently cooked and saved"}</p>
              <Subheading level={2} className="mt-1 text-3xl/9">
                {hasQuery ? `Recipes for "${query}"` : "All public recipes"}
              </Subheading>
            </div>
            <Text className="font-sj-ui text-xs font-semibold uppercase tracking-[0.16em]">
              {recipes.length} {recipes.length === 1 ? "recipe" : "recipes"}
            </Text>
          </div>

          {recipes.length > 0 ? (
            <ol className="border-y border-[var(--sj-border-strong)]">
              {recipes.map((recipe, index) => (
                <li key={recipe.id} className="border-b border-[var(--sj-border)] last:border-b-0">
                  <RecipeRow recipe={recipe} ordinal={index + 1} />
                </li>
              ))}
            </ol>
          ) : (
            <RuledEmptyState
              title={hasQuery ? "No matching recipes yet" : "No public recipes yet"}
              action={hasQuery ? <Button href="/recipes" plain>Clear Search</Button> : null}
            >
              <Text className="mx-auto mt-2 max-w-xl">
                {hasQuery
                  ? "Try a broader ingredient, dish name, or chef."
                  : "The public recipe box will fill as kitchens publish their first recipes."}
              </Text>
            </RuledEmptyState>
          )}
        </div>
      </section>
    </CookbookPage>
  );
}

function RecipeRow({ recipe, ordinal }: { recipe: PublicRecipe; ordinal: number }) {
  const servingsLabel = formatServingsLabel(recipe.servings);
  const displayImageUrl = recipe.coverImageUrl && recipe.coverImageUrl.length > 0
    ? recipe.coverImageUrl
    : undefined;

  return (
    <Link
      href={`/recipes/${recipe.id}`}
      className="group grid min-h-28 grid-cols-[2.5rem_5.25rem_minmax(0,1fr)] gap-4 py-5 no-underline sm:grid-cols-[3rem_7rem_minmax(0,1fr)_auto] sm:items-center sm:gap-5"
      aria-label={recipe.title}
    >
      <span className="font-sj-ui pt-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--sj-brass)] sm:pt-0">
        {String(ordinal).padStart(2, "0")}
      </span>
      <span className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-[color-mix(in_srgb,var(--sj-flour)_62%,var(--sj-panel-solid))]">
        {displayImageUrl ? (
          <img src={displayImageUrl} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.025]" />
        ) : (
          <ChefHat className="size-6 text-[var(--sj-brass)]" aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0 self-center">
        <span className="font-sj-display block text-2xl/7 font-semibold text-[var(--sj-ink)] group-hover:text-[var(--sj-tomato)] sm:text-3xl/8">
          {recipe.title}
        </span>
        <span className="mt-1 block max-w-2xl text-base/6 text-[var(--sj-ink-soft)]">
          {recipe.description ?? `By ${recipe.chef.username}`}
        </span>
      </span>
      <span className="font-sj-ui col-start-3 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--sj-ink-soft)] sm:col-start-auto sm:block sm:justify-self-end sm:text-right">
        <span>By {recipe.chef.username}</span>
        {servingsLabel ? <span className="sm:mt-1 sm:block">{servingsLabel}</span> : null}
      </span>
    </Link>
  );
}
