import type { Route } from "./+types/search";
import { Form, useLoaderData } from "react-router";
import { BookOpen, ChefHat, Search as SearchIcon, ShoppingCart, Users } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Heading, Subheading } from "~/components/ui/heading";
import { Input, InputGroup } from "~/components/ui/input";
import { Link } from "~/components/ui/link";
import { Text } from "~/components/ui/text";
import { getRequestDb } from "~/lib/route-platform.server";
import { getUserId } from "~/lib/session.server";
import {
  normalizeSearchScope,
  searchSpoonjoy,
  type SearchEntityType,
  type SearchResult,
  type SearchScope,
} from "~/lib/search.server";

const SCOPE_LABELS: Record<SearchScope, string> = {
  all: "Everything",
  recipes: "Recipes",
  cookbooks: "Cookbooks",
  chefs: "Chefs",
  "shopping-list": "Shopping List",
};

const SCOPE_DESCRIPTIONS: Record<SearchScope, string> = {
  all: "Recipes, cookbooks, chefs, and your private list when signed in.",
  recipes: "Search titles, descriptions, steps, source URLs, and ingredients.",
  cookbooks: "Find collections by title, author, and included recipes.",
  chefs: "Discover kitchens by chef username.",
  "shopping-list": "Search your private list by ingredient, unit, category, and checked state.",
};

const RESULT_LABELS: Record<SearchEntityType, string> = {
  recipe: "Recipe",
  cookbook: "Cookbook",
  chef: "Chef",
  "shopping-list-item": "Shopping List",
};

const RESULT_TONES: Record<SearchEntityType, string> = {
  recipe: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/35 dark:text-amber-100",
  cookbook: "border-lime-300 bg-lime-50 text-lime-900 dark:border-lime-800 dark:bg-lime-950/30 dark:text-lime-100",
  chef: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-100",
  "shopping-list-item": "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-100",
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
    { name: "description", content: "Search Spoonjoy recipes, cookbooks, chefs, and private shopping-list items." },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const scope = normalizeSearchScope(url.searchParams.get("scope"));
  const userId = await getUserId(request);
  const database = await getRequestDb(context);

  const results = await searchSpoonjoy(database, {
    query,
    scope,
    viewerId: userId,
    limit: 30,
  });

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

function ResultCard({ result }: { result: SearchResult }) {
  const Icon = RESULT_ICONS[result.type];

  return (
    <Link
      href={result.href}
      className="sj-card sj-hover-lift group block rounded-[1.5rem] p-4 no-underline"
    >
      <div className="flex items-start gap-3">
        <div className={`rounded-[1rem] border p-2 ${RESULT_TONES[result.type]}`}>
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`font-sj-ui rounded-full border px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-[0.18em] ${RESULT_TONES[result.type]}`}>
              {RESULT_LABELS[result.type]}
            </span>
            {result.type === "shopping-list-item" ? (
              <span className="font-sj-ui rounded-full border border-[var(--sj-border)] px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[var(--sj-ink-soft)]">
                Private
              </span>
            ) : null}
          </div>
          <Subheading level={2} className="mt-2 line-clamp-1 text-xl/7 group-hover:text-[var(--sj-tomato)]">
            {result.title}
          </Subheading>
          <Text className="mt-1 text-sm">{result.subtitle}</Text>
          <Text className="mt-3 line-clamp-2 text-sm/6">{result.snippet}</Text>
        </div>
      </div>
    </Link>
  );
}

export default function Search() {
  const { query, scope, isAuthenticated, results } = useLoaderData<typeof loader>();
  const hasQuery = query.trim().length > 0;
  const showPrivatePrompt = scope === "shopping-list" && !isAuthenticated;

  return (
    <div className="sj-page px-4 py-8 sm:py-12">
      <section className="sj-panel mx-auto max-w-6xl overflow-hidden rounded-[2rem]">
        <div className="border-b border-[var(--sj-border)] bg-[color-mix(in_srgb,var(--sj-panel-solid)_68%,transparent)] p-5 backdrop-blur sm:p-7">
          <div className="max-w-3xl">
            <div className="sj-eyebrow">
              <SearchIcon className="size-3.5" aria-hidden="true" />
              Full pantry search
            </div>
            <Heading level={1} className="mt-4 text-4xl/11 tracking-[-0.04em] sm:text-6xl/15">
              Find the recipe, person, collection, or grocery note you half-remember.
            </Heading>
            <Text className="mt-4 text-base/7">
              Spoonjoy searches local SQLite/D1 full-text indexes across recipe instructions, ingredients, cookbooks, chef kitchens, and your private shopping list.
            </Text>
          </div>

          <Form method="get" role="search" className="mt-6 grid gap-3 lg:grid-cols-[minmax(0,1fr)_14rem_auto] lg:items-end">
            <label className="block">
              <span className="font-sj-ui mb-1 block text-sm font-semibold text-[var(--sj-ink)]">Search terms</span>
              <InputGroup>
                <SearchIcon data-slot="icon" aria-hidden="true" />
                <Input type="search" name="q" defaultValue={query} placeholder="tomato, weeknight, beans, Nonna..." />
              </InputGroup>
            </label>
            <label className="block">
              <span className="font-sj-ui mb-1 block text-sm font-semibold text-[var(--sj-ink)]">Scope</span>
              <select
                name="scope"
                defaultValue={scope}
                className="font-sj-ui block h-11 w-full rounded-full border border-[var(--sj-border-strong)] bg-[var(--sj-field)] px-4 text-sm text-[var(--sj-ink)] shadow-sm"
              >
                {SEARCH_SCOPES.map((searchScope) => (
                  <option key={searchScope} value={searchScope}>{SCOPE_LABELS[searchScope]}</option>
                ))}
              </select>
            </label>
            <Button type="submit" className="h-10">Search</Button>
          </Form>
        </div>

        <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <aside className="rounded-[1.5rem] border border-[var(--sj-border)] bg-[color-mix(in_srgb,var(--sj-panel-solid)_76%,transparent)] p-4">
            <Subheading level={2} className="text-xl/7">{SCOPE_LABELS[scope]}</Subheading>
            <Text className="mt-2 text-sm/6">{SCOPE_DESCRIPTIONS[scope]}</Text>
            <div className="mt-5 grid gap-2">
              {SEARCH_SCOPES.map((searchScope) => {
                const params = new URLSearchParams();
                params.set("scope", searchScope);
                if (query.trim()) params.set("q", query.trim());

                return (
                  <Link
                    key={searchScope}
                    href={`/search?${params.toString()}`}
                    className={[
                      "font-sj-ui rounded-full border px-3 py-2 text-sm font-semibold no-underline transition",
                      scope === searchScope
                        ? "border-[var(--sj-ink)] bg-[var(--sj-ink)] text-[var(--sj-paper)]"
                        : "border-[var(--sj-border)] bg-[var(--sj-panel-solid)] text-[var(--sj-ink-soft)] hover:bg-[var(--sj-flour)]",
                    ].join(" ")}
                  >
                    {SCOPE_LABELS[searchScope]}
                  </Link>
                );
              })}
            </div>
            <Text className="font-sj-ui mt-5 text-xs/5 uppercase tracking-[0.14em]">
              Shopping-list results are always private to the signed-in kitchen.
            </Text>
          </aside>

          <main>
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <Subheading level={2} className="text-2xl/8">{hasQuery ? `Results for "${query.trim()}"` : "Recently searchable"}</Subheading>
                <Text className="mt-1 text-sm">{resultCountLabel(results.length)}</Text>
              </div>
              <Text className="font-sj-ui text-xs uppercase tracking-[0.18em]">FTS5 + BM25</Text>
            </div>

            {showPrivatePrompt ? (
              <div className="mb-4 rounded-[1.25rem] border border-[var(--sj-brass)] bg-[color-mix(in_srgb,var(--sj-brass)_12%,var(--sj-panel-solid))] p-4 text-sm text-[var(--sj-ink)]">
                Log in to search your private shopping list.
              </div>
            ) : null}

            {!hasQuery ? (
              <div className="mb-4 rounded-[1.25rem] border border-dashed border-[var(--sj-border-strong)] bg-[color-mix(in_srgb,var(--sj-panel-solid)_70%,transparent)] p-4">
                <Text className="text-sm/6">
                  Try searching by ingredient, step wording, cookbook theme, chef username, or shopping-list category.
                </Text>
              </div>
            ) : null}

            {results.length > 0 ? (
              <div className="grid gap-3">
                {results.map((result) => (
                  <ResultCard key={`${result.type}:${result.id}`} result={result} />
                ))}
              </div>
            ) : (
              <div className="rounded-[2rem] border border-dashed border-[var(--sj-border-strong)] bg-[color-mix(in_srgb,var(--sj-panel-solid)_72%,transparent)] p-8 text-center">
                <SearchIcon className="mx-auto size-8 text-[var(--sj-ink-soft)]" aria-hidden="true" />
                <Subheading level={2} className="mt-3 text-xl/7">No matches yet</Subheading>
                <Text className="mx-auto mt-2 max-w-xl">
                  Broaden the scope, try an ingredient, or search for a chef username. The index refreshes from the local database on every search.
                </Text>
              </div>
            )}
          </main>
        </div>
      </section>
    </div>
  );
}
