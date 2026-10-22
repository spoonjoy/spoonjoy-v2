import type { Route } from "./+types/recipes._index";
import { chefDisplayName } from "~/lib/username";
import { Form, useLoaderData } from "react-router";
import { BookOpen, ChefHat, Plus, Search as SearchIcon } from "lucide-react";
import { Button } from "~/components/button";
import { Heading } from "~/components/ouro/text/heading";
import { Item } from "~/components/ouro/item/item";
import { TextField } from "~/components/ouro/text-field/text-field";
import { Text } from "~/components/ouro/text/text";
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
import { ShowMore } from "~/components/ouro/collapsible/show-more";
import { useAppendingList } from "~/hooks/use-appending-list";
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
              <h1 className="font-sj-display text-2xl/8 font-semibold tracking-normal text-[var(--sj-ink)] mt-3 max-w-4xl text-4xl/10 sm:text-7xl/18 lg:text-[84px] lg:leading-[1.04]">
                Recipes worth opening.
              </h1>
              <p className="text-base/6 text-[var(--sj-ink-soft)] mt-3 max-w-2xl text-base/7 sm:mt-5 sm:text-lg/8">
                {isAuthenticated
                  ? "Every public Spoonjoy recipe, to cook, fork, save or shop from."
                  : "Every public Spoonjoy recipe, free to read. Sign up to cook, save and shop from them."}
              </p>
            </div>

            <div className="border-t border-[var(--sj-border)] pt-4 sm:pt-5 lg:border-t-0">
              <Form method="get" role="search" className="grid gap-3">
                <span className="font-sj-ui text-xs font-semibold uppercase tracking-[0.18em] text-[var(--sj-ink-soft)]">
                  Search recipes
                </span>
                <div className="font-sj-display flex min-h-14 items-center border-y border-[var(--sj-border-strong)] bg-transparent">
                  <SearchIcon className="ml-1 mr-3 size-5 shrink-0 text-[var(--sj-ink-soft)]" aria-hidden="true" />
                  <TextField
                    ref={searchInputRef}
                    label="Search recipes"
                    hideLabel
                    variant="plain"
                    size="lg"
                    id="public-recipe-search"
                    name="q"
                    type="search"
                    defaultValue={query}
                    // Off, so a document-level Back does not restore stale typed text over the
                    // server-rendered query (the browser skips form restoration for these fields).
                    autoComplete="off"
                    placeholder="tomato, beans, lemon"
                    className="min-w-0 flex-1"
                  />
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button type="submit">Search</Button>
                  {hasQuery ? <Button href="/recipes" plain>Clear</Button> : null}
                  {isAuthenticated ? (
                    <Button href="/recipes/new" plain>
                      <Plus data-slot="icon" aria-hidden="true" />
                      Create recipe
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
              <Heading level={2} size="2xl" className="mt-1 leading-9">
                {hasQuery ? `Recipes for "${query}"` : "All public recipes"}
              </Heading>
            </div>
            <p className="text-base/6 text-[var(--sj-ink-soft)] font-sj-ui text-xs font-semibold uppercase tracking-[0.16em]">
              {list.nextCursor ? `${recipes.length} shown` : `${recipes.length} ${recipes.length === 1 ? "recipe" : "recipes"}`}
            </p>
          </div>

          {recipes.length > 0 ? (
            <ShowMore
              ordered
              items={recipes.map((recipe, index) => (
                <RecipeRow key={recipe.id} recipe={recipe} imageProps={listImageProps(index)} />
              ))}
              hasMore={Boolean(list.nextCursor)}
              loading={list.loading}
              onShowMore={list.showMore}
              href={list.nextCursor ? publicRecipesPageHref(list.nextCursor) : undefined}
              showMoreLabel="Show more recipes"
              loadedLabel={(count) => `Showing ${count} recipes`}
              noMoreLabel={`Showing ${recipes.length} recipes`}
            />
          ) : (
            <RuledEmptyState
              title={hasQuery ? "No matching recipes yet" : after ? "That's every recipe" : "No public recipes yet"}
              action={hasQuery ? (
                <Button href="/recipes" plain>Clear search</Button>
              ) : after ? (
                <Button href="/recipes" plain>Back to the newest</Button>
              ) : null}
            >
              <Text tone="muted" className="mx-auto mt-2 max-w-xl">
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
  imageProps,
}: {
  recipe: PublicRecipe;
  imageProps: ImageLoadingProps;
}) {
  const byline = [`By ${chefDisplayName(recipe.chef.username)}`, formatServingsLabel(recipe.servings)].filter(Boolean).join(" • ");

  return (
    <Item
      as="article"
      // HX ShowMore lists rows without lines between them, so each row is outlined.
      variant="outline"
      href={`/recipes/${recipe.id}`}
      title={recipe.title}
      description={
        <>
          {recipe.description ? <Text lines={2}>{recipe.description}</Text> : null}
          <Text size="sm">{byline}</Text>
        </>
      }
      media={recipe.coverImageUrl ? <img src={recipe.coverImageUrl} alt="" {...imageProps} /> : <ChefHat />}
      mediaSize={recipe.coverImageUrl ? "lg" : "icon"}
      mediaAbove={recipe.coverImageUrl ? "sm" : undefined}
      actions={recipe.coverProvenanceLabel ? <CoverProvenanceBadge label={recipe.coverProvenanceLabel} /> : undefined}
      stackBelow="sm"
    />
  );
}
