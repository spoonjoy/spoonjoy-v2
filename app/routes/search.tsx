import type { Route } from "./+types/search";
import { Form, useLoaderData } from "react-router";
import { BookOpen, ChefHat, Search as SearchIcon, ShoppingCart, Users } from "lucide-react";
import { Button } from "~/components/button";
import { Heading } from "~/components/ouro/text/heading";
import { Badge } from "~/components/ouro/badge/badge";
import { Item } from "~/components/ouro/item/item";
import { ItemGroup } from "~/components/ouro/item/item-group";
import { Tabs } from "~/components/ouro/tabs/tabs";
import { TextField } from "~/components/ouro/text-field/text-field";
import { Text } from "~/components/ouro/text/text";
import { CookbookPage, RuledEmptyState } from "~/components/cookbook/page";
import { CoverProvenanceBadge } from "~/components/recipe/CoverProvenanceBadge";
import { getRequestDb } from "~/lib/route-platform.server";
import { requestD1 } from "~/lib/d1-read.server";
import { getUserId } from "~/lib/session.server";
import { useUrlSyncedInput } from "~/hooks/useUrlSyncedInput";
import {
  normalizeSearchScope,
  searchSpoonjoy,
  searchSpoonjoyFromD1,
  type SearchEntityType,
  type SearchResult,
  type SearchScope,
} from "~/lib/search.server";
import { listImageProps, type ImageLoadingProps } from "~/lib/image-loading";

const SCOPE_LABELS: Record<SearchScope, string> = {
  all: "Everything",
  recipes: "Recipes",
  cookbooks: "Cookbooks",
  chefs: "Chefs",
  "shopping-list": "Shopping List",
};

const SCOPE_DESCRIPTIONS: Record<SearchScope, string> = {
  all: "Recipes, cookbooks, chefs, and your private list when signed in.",
  recipes: "Dishes, ingredients, steps, and source notes.",
  cookbooks: "Collections by title, author, and included recipes.",
  chefs: "Kitchen pages by chef username.",
  "shopping-list": "Your private list by ingredient, unit, category, and checked state.",
};

const RESULT_LABELS: Record<SearchEntityType, string> = {
  recipe: "Recipe",
  cookbook: "Cookbook",
  chef: "Chef",
  "shopping-list-item": "Shopping List",
};

const RESULT_ICONS = {
  recipe: ChefHat,
  cookbook: BookOpen,
  chef: Users,
  "shopping-list-item": ShoppingCart,
} satisfies Record<SearchEntityType, typeof ChefHat>;

const SEARCH_SCOPES: SearchScope[] = ["all", "recipes", "cookbooks", "chefs", "shopping-list"];

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Search Spoonjoy" },
    { name: "description", content: "Search Spoonjoy recipes, cookbooks, chefs, and private shopping list items." },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const scope = normalizeSearchScope(url.searchParams.get("scope"));
  const userId = await getUserId(request, context.cloudflare?.env);
  const searchOptions = { query, scope, viewerId: userId, limit: 30 };
  // On the Worker, search runs on the D1 binding (freshness check and search in one
  // batch); Prisma is only the fallback where there is no binding.
  const d1 = requestD1(context);
  const results = d1
    ? await searchSpoonjoyFromD1(d1, searchOptions)
    : await searchSpoonjoy(await getRequestDb(context), searchOptions);

  return {
    query,
    scope,
    isAuthenticated: Boolean(userId),
    results,
  };
}

function resultCountLabel(count: number) {
  return `${count} ${count === 1 ? "result" : "results"}`;
}

function ResultCard({ result, imageProps }: { result: SearchResult; imageProps: ImageLoadingProps }) {
  const Icon = RESULT_ICONS[result.type];
  const coverProvenanceLabel = typeof result.metadata.coverProvenanceLabel === "string"
    ? result.metadata.coverProvenanceLabel
    : null;
  const isPrivate = result.type === "shopping-list-item";
  // The link is named by the card's visible type, Private mark, title and byline, so a screen
  // reader hears what a sighted reader sees first and voice control can say any of it (product
  // audit 2026-10-09, finding 19; WCAG 2.5.3). The title is the result's heading.
  return (
    <Item
      as="article"
      href={result.href}
      title={
        <>
          <Badge variant="outline">{RESULT_LABELS[result.type]}</Badge>
          {isPrivate ? <> <Badge variant="outline">Private</Badge></> : null}{" "}
          <Heading level={2} size="md" className="inline">{result.title}</Heading>{" "}
          <Text size="sm" className="block">{result.subtitle}</Text>
        </>
      }
      description={<>
        <CoverProvenanceBadge label={coverProvenanceLabel} />
        <Text size="sm" lines={2}>{result.snippet}</Text>
      </>}
      media={result.imageUrl ? <img src={result.imageUrl} alt="" {...imageProps} /> : <Icon />}
      mediaSize={result.imageUrl ? "lg" : "icon"}
      mediaAbove={result.imageUrl ? "sm" : undefined}
      stackBelow="sm"
    />
  );
}

export default function Search() {
  const { query, scope, isAuthenticated, results } = useLoaderData<typeof loader>();
  const hasQuery = query.trim().length > 0;
  const searchInputRef = useUrlSyncedInput(query);
  const showPrivatePrompt = scope === "shopping-list" && !isAuthenticated;
  const resultCounts = results.reduce<Record<SearchEntityType, number>>(
    (counts, result) => ({
      ...counts,
      [result.type]: counts[result.type] + 1,
    }),
    { recipe: 0, cookbook: 0, chef: 0, "shopping-list-item": 0 },
  );

  return (
    <CookbookPage>
      <section>
        <header className="grid gap-8 border-b border-[var(--sj-border-strong)] py-8 lg:grid-cols-[minmax(0,1fr)_20.625rem]">
          <div className="max-w-3xl">
            <div className="sj-eyebrow">
              <SearchIcon className="size-3.5" aria-hidden="true" />
              Kitchen index
            </div>
            <h1 className="font-sj-display text-2xl/8 font-semibold tracking-normal text-[var(--sj-ink)] mt-3 text-5xl/12 sm:text-7xl/18 lg:text-[84px] lg:leading-[1.05]">
              Find the thing you meant to cook.
            </h1>
            <Form method="get" role="search" className="mt-8 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <input type="hidden" name="scope" value={scope} />
              <TextField
                ref={searchInputRef}
                type="search"
                name="q"
                label="Search terms"
                hideLabel
                defaultValue={query}
                // Off, so a document-level Back does not restore stale typed text over the
                // server-rendered query (the browser skips form restoration for these fields).
                autoComplete="off"
                placeholder="tomato basil"
                startAdornment={<SearchIcon />}
                size="lg"
              />
              <Button type="submit">Search</Button>
            </Form>
          </div>

          {/* A <div>, not <aside>: root.tsx already wraps every route in a <main> landmark, so
              an <aside> here would nest a complementary landmark inside it and fail
              landmark-complementary-is-top-level. These result counts are also tightly
              coupled to the page's own search results, not tangential content, so a plain
              container is the right call rather than another named landmark. */}
          <div className="sj-receipt p-5">
            <p className="sj-eyebrow">Quick filters</p>
            <ul className="mt-4 space-y-0">
              {[
                ["Recipes", resultCounts.recipe],
                ["Cookbooks", resultCounts.cookbook],
                ["Chefs", resultCounts.chef],
                ["Lists", resultCounts["shopping-list-item"]],
              ].map(([label, count]) => (
                <li key={label} className="flex justify-between gap-4 border-b border-[color-mix(in_srgb,var(--sj-border)_65%,transparent)] py-2.5 text-base">
                  <span>{label}</span>
                  <strong className="font-sj-ui">{count}</strong>
                </li>
              ))}
            </ul>
          </div>
        </header>

        <div className="grid gap-8 py-8 lg:grid-cols-[13.75rem_minmax(0,1fr)]">
          <div className="border-t border-[var(--sj-border)] pt-4 lg:border-r lg:border-t-0 lg:pr-6 lg:pt-0">
            <Heading level={2} size="lg">{SCOPE_LABELS[scope]}</Heading>
            <p className="text-base/6 text-[var(--sj-ink-soft)] mt-2 font-sj-body text-sm/6 normal-case tracking-normal">{SCOPE_DESCRIPTIONS[scope]}</p>
            <Tabs
              label="Search scope"
              orientation="vertical"
              className="mt-5"
              value={scope}
              items={SEARCH_SCOPES.map((searchScope) => {
                const params = new URLSearchParams();
                params.set("scope", searchScope);
                if (query.trim()) params.set("q", query.trim());

                return {
                  value: searchScope,
                  href: `/search?${params.toString()}`,
                  label: SCOPE_LABELS[searchScope],
                };
              })}
            />
            <p className="text-base/6 text-[var(--sj-ink-soft)] font-sj-ui mt-5 hidden text-xs/5 uppercase tracking-[0.14em] sm:block">
              Shopping List results are private to your signed-in kitchen.
            </p>
          </div>

          {/* <section>, not <main>: root.tsx already renders the page's only <main>. */}
          <section aria-label="Search results">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <Heading level={2} size="xl">{hasQuery ? `Results for "${query.trim()}"` : "Recently searchable"}</Heading>
                <Text tone="muted" size="sm" className="mt-1">{resultCountLabel(results.length)}</Text>
              </div>
            </div>

            {showPrivatePrompt ? (
              <div className="mb-4 border-y border-[var(--sj-brass)] bg-[color-mix(in_srgb,var(--sj-brass)_12%,var(--sj-panel-solid))] py-4 text-sm text-[var(--sj-ink)]">
                Log in to search your private shopping list.
              </div>
            ) : null}

            {!hasQuery ? (
              <div className="mb-4 border-y border-dashed border-[var(--sj-border-strong)] py-4">
                <Text tone="muted" size="sm" className="leading-6">
                  Try searching by ingredient, step wording, cookbook theme, chef username, or shopping list category.
                </Text>
              </div>
            ) : null}

            {results.length > 0 ? (
              <ItemGroup aria-label="Results" variant="divided">
                {results.map((result, index) => (
                  <ResultCard key={`${result.type}:${result.id}`} result={result} imageProps={listImageProps(index)} />
                ))}
              </ItemGroup>
            ) : (
              <RuledEmptyState title="No matches yet">
                <Text tone="muted" className="mx-auto mt-2 max-w-xl">
                  Broaden the scope, try an ingredient, or search for a chef username.
                </Text>
              </RuledEmptyState>
            )}
          </section>
        </div>
      </section>
    </CookbookPage>
  );
}
