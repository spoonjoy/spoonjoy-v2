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
import { useUrlSyncedInput } from "~/hooks/useUrlSyncedInput";
import { CoverProvenanceBadge } from "~/components/recipe/CoverProvenanceBadge";
import { requestD1 } from "~/lib/d1-read.server";
import {
  readPublicRecipesFromD1,
  readPublicRecipesWithPrisma,
  type PublicRecipe,
} from "~/lib/collection-reads.server";
import { formatServingsLabel } from "~/lib/quantity";
import { RecipesSectionNav } from "~/components/navigation";
import { ShowMore, useAppendingList, useFocusFirstNew } from "~/components/ui/show-more";
import { listImageProps, type ImageLoadingProps } from "~/lib/image-loading";

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
  const userId = await getUserId(request, context.cloudflare?.env);
  // On the Worker the page reads from D1 in one batch (after the search, when there is a
  // query); Prisma is only the fallback where there is no binding.
  const d1 = requestD1(context);
  // Browsing pages through every public recipe, PUBLIC_RECIPE_LIMIT at a time, after the last
  // recipe of the previous page. One extra row says whether there is another page.
  const after = query ? null : parsePublicRecipeCursor(url.searchParams.get("after"));
  const input = { query, limit: PUBLIC_RECIPE_LIMIT + 1, after };
  const rows = d1
    ? await readPublicRecipesFromD1(d1, input)
    : await readPublicRecipesWithPrisma(await getRequestDb(context), input);
  const hasMore = !query && rows.length > PUBLIC_RECIPE_LIMIT;
  const recipes = rows.slice(0, PUBLIC_RECIPE_LIMIT);

  return {
    query,
    isAuthenticated: Boolean(userId),
    recipes,
    after,
    nextCursor: hasMore ? recipes[recipes.length - 1]!.id : null,
  };
}

// Recipe ids are cuids; anything else is ignored rather than sent to the database.
export function parsePublicRecipeCursor(raw: string | null): string | null {
  return raw && /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : null;
}

export function publicRecipesPageHref(cursor: string): string {
  return `/recipes?after=${encodeURIComponent(cursor)}`;
}

type PublicRecipesData = Awaited<ReturnType<typeof loader>>;
const selectPublicRecipesPage = (data: PublicRecipesData) => ({ items: data.recipes, nextCursor: data.nextCursor });
const loadPublicRecipesPage = (cursor: string) => `/recipes?index&after=${encodeURIComponent(cursor)}`;

export default function RecipesIndex() {
  const { query, isAuthenticated, recipes: firstPage, after, nextCursor } = useLoaderData<typeof loader>();
  const hasQuery = query.length > 0;
  const list = useAppendingList({
    page: { items: firstPage, nextCursor },
    resetKey: `${query}|${after ?? ""}|${firstPage[0]?.id ?? ""}`,
    loadHref: loadPublicRecipesPage,
    select: selectPublicRecipesPage,
    noun: "recipes",
  });
  const recipes = list.items;
  const firstNewRef = useFocusFirstNew<HTMLAnchorElement>(list.firstNewIndex);
  const searchInputRef = useUrlSyncedInput(query);

  return (
    <CookbookPage>
      {isAuthenticated ? <RecipesSectionNav /> : null}
      <section>
        {/* On a phone the header stays short, so the first recipe shows on the first screen (finding 18). */}
        <header className="border-b border-[var(--sj-border-strong)] pb-6 sm:pb-8">
          <div className="grid gap-5 sm:gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] lg:items-end">
            <div>
              <p className="sj-eyebrow">Public recipe box</p>
              <Heading level={1} className="mt-3 max-w-4xl text-4xl/10 sm:text-7xl/18 lg:text-[84px] lg:leading-[1.04]">
                Recipes worth opening.
              </Heading>
              <Text className="mt-3 max-w-2xl text-base/7 sm:mt-5 sm:text-lg/8">
                {isAuthenticated
                  ? "Every public Spoonjoy recipe, to cook, fork, save or shop from."
                  : "Every public Spoonjoy recipe, free to read. Sign up to cook, save and shop from them."}
              </Text>
            </div>

            <div className="border-t border-[var(--sj-border)] pt-4 sm:pt-5 lg:border-t-0">
              <Form method="get" role="search" className="grid gap-3">
                <label htmlFor="public-recipe-search" className="font-sj-ui text-xs font-semibold uppercase tracking-[0.18em] text-[var(--sj-ink-soft)]">
                  Search recipes
                </label>
                <div className="flex min-h-14 items-center border-y border-[var(--sj-border-strong)] bg-transparent">
                  <SearchIcon className="ml-1 mr-3 size-5 shrink-0 text-[var(--sj-ink-soft)]" aria-hidden="true" />
                  <Input
                    ref={searchInputRef}
                    id="public-recipe-search"
                    name="q"
                    type="search"
                    defaultValue={query}
                    // Off, so a document-level Back does not restore stale typed text over the
                    // server-rendered query (the browser skips form restoration for these fields).
                    autoComplete="off"
                    placeholder="tomato, beans, lemon"
                    className="min-w-0 flex-1 before:hidden after:hidden [&_input]:h-14 [&_input]:border-0 [&_input]:bg-transparent [&_input]:px-0 [&_input]:py-0 [&_input]:font-sj-display [&_input]:text-xl/7 sm:[&_input]:text-2xl/8 [&_input]:outline-none [&_input]:placeholder:text-[var(--sj-ink-soft)]"
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
              <p className="sj-eyebrow">{hasQuery ? "Matches" : after ? "Older recipes" : "Recently cooked and saved"}</p>
              <Subheading level={2} className="mt-1 text-3xl/9">
                {hasQuery ? `Recipes for "${query}"` : "All public recipes"}
              </Subheading>
            </div>
            <Text className="font-sj-ui text-xs font-semibold uppercase tracking-[0.16em]">
              {list.nextCursor ? `${recipes.length} shown` : `${recipes.length} ${recipes.length === 1 ? "recipe" : "recipes"}`}
            </Text>
          </div>

          {recipes.length > 0 ? (
            <ol className="border-y border-[var(--sj-border-strong)]">
              {recipes.map((recipe, index) => (
                <li key={recipe.id} className="border-b border-[var(--sj-border)] last:border-b-0">
                  <RecipeRow
                    recipe={recipe}
                    ordinal={index + 1}
                    imageProps={listImageProps(index)}
                    linkRef={index === list.firstNewIndex ? firstNewRef : undefined}
                  />
                </li>
              ))}
            </ol>
          ) : null}
          {recipes.length > 0 ? (
            <ShowMore
              list={list}
              href={list.nextCursor ? publicRecipesPageHref(list.nextCursor) : null}
              label="Show more recipes"
            />
          ) : (
            <RuledEmptyState
              title={hasQuery ? "No matching recipes yet" : after ? "That's every recipe" : "No public recipes yet"}
              action={hasQuery ? (
                <Button href="/recipes" plain>Clear Search</Button>
              ) : after ? (
                <Button href="/recipes" plain>Back to the newest</Button>
              ) : null}
            >
              <Text className="mx-auto mt-2 max-w-xl">
                {hasQuery
                  ? "Try a broader ingredient, dish name, or chef."
                  : after
                    ? "You've reached the oldest public recipe."
                    : "The public recipe box will fill as kitchens publish their first recipes."}
              </Text>
            </RuledEmptyState>
          )}
        </div>
      </section>
    </CookbookPage>
  );
}

function RecipeRow({
  recipe,
  ordinal,
  imageProps,
  linkRef,
}: {
  recipe: PublicRecipe;
  ordinal: number;
  imageProps: ImageLoadingProps;
  linkRef?: React.Ref<HTMLAnchorElement>;
}) {
  const servingsLabel = formatServingsLabel(recipe.servings);
  const displayImageUrl = recipe.coverImageUrl && recipe.coverImageUrl.length > 0
    ? recipe.coverImageUrl
    : undefined;

  return (
    <Link
      ref={linkRef}
      href={`/recipes/${recipe.id}`}
      className="group grid min-h-28 grid-cols-[2.5rem_5.25rem_minmax(0,1fr)] gap-4 py-5 no-underline sm:grid-cols-[3rem_7rem_minmax(0,1fr)_auto] sm:items-center sm:gap-5"
      aria-label={recipe.title}
    >
      <span className="font-sj-ui pt-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--sj-brass)] sm:pt-0">
        {String(ordinal).padStart(2, "0")}
      </span>
      <span className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-[color-mix(in_srgb,var(--sj-flour)_62%,var(--sj-panel-solid))]">
        {displayImageUrl ? (
          <img src={displayImageUrl} alt="" {...imageProps} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.025]" />
        ) : (
          <ChefHat className="size-6 text-[var(--sj-brass)]" aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0 self-center">
        <span className="font-sj-display block text-2xl/7 font-semibold [overflow-wrap:anywhere] text-[var(--sj-ink)] group-hover:text-[var(--sj-tomato)] sm:text-3xl/8">
          {recipe.title}
        </span>
        <CoverProvenanceBadge label={recipe.coverProvenanceLabel} className="mt-2" />
        <span className="mt-1 block max-w-2xl text-base/6 text-[var(--sj-ink-soft)] [overflow-wrap:anywhere]">
          {recipe.description ?? `By ${recipe.chef.username}`}
        </span>
      </span>
      <span className="font-sj-ui col-start-3 flex min-w-0 flex-wrap [overflow-wrap:anywhere] gap-x-3 gap-y-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--sj-ink-soft)] sm:col-start-auto sm:block sm:justify-self-end sm:text-right">
        <span>By {recipe.chef.username}</span>
        {servingsLabel ? <span className="sm:mt-1 sm:block">{servingsLabel}</span> : null}
      </span>
    </Link>
  );
}
