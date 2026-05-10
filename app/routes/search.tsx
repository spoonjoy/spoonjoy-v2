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
      className="group block rounded-sm border border-zinc-300 bg-white p-4 no-underline shadow-sm transition hover:-translate-y-0.5 hover:border-zinc-500 hover:shadow-md dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-500"
    >
      <div className="flex items-start gap-3">
        <div className={`rounded-sm border p-2 ${RESULT_TONES[result.type]}`}>
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-[0.18em] ${RESULT_TONES[result.type]}`}>
              {RESULT_LABELS[result.type]}
            </span>
            {result.type === "shopping-list-item" ? (
              <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                Private
              </span>
            ) : null}
          </div>
          <Subheading level={2} className="mt-2 line-clamp-1 font-serif text-xl/7 text-zinc-950 group-hover:text-amber-800 dark:text-zinc-50 dark:group-hover:text-amber-200">
            {result.title}
          </Subheading>
          <Text className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{result.subtitle}</Text>
          <Text className="mt-3 line-clamp-2 text-sm/6 text-zinc-700 dark:text-zinc-300">{result.snippet}</Text>
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
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <section className="overflow-hidden rounded-sm border border-zinc-300 bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.28),_transparent_34%),linear-gradient(135deg,_#fffaf0_0%,_#fafaf9_48%,_#eef7e8_100%)] shadow-sm dark:border-zinc-700 dark:bg-[radial-gradient(circle_at_top_left,_rgba(146,64,14,0.28),_transparent_34%),linear-gradient(135deg,_#1c1917_0%,_#18181b_54%,_#102018_100%)]">
        <div className="border-b border-zinc-300 bg-white/68 p-5 backdrop-blur dark:border-zinc-700 dark:bg-zinc-950/58 sm:p-7">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-amber-900 dark:border-amber-800 dark:bg-amber-950/70 dark:text-amber-200">
              <SearchIcon className="size-3.5" aria-hidden="true" />
              Full pantry search
            </div>
            <Heading level={1} className="mt-4 font-serif text-4xl/11 tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-5xl/14">
              Find the recipe, person, collection, or grocery note you half-remember.
            </Heading>
            <Text className="mt-4 text-base/7 text-zinc-700 dark:text-zinc-300">
              Spoonjoy searches local SQLite/D1 full-text indexes across recipe instructions, ingredients, cookbooks, chef kitchens, and your private shopping list.
            </Text>
          </div>

          <Form method="get" role="search" className="mt-6 grid gap-3 lg:grid-cols-[minmax(0,1fr)_14rem_auto] lg:items-end">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-zinc-800 dark:text-zinc-200">Search terms</span>
              <InputGroup>
                <SearchIcon data-slot="icon" aria-hidden="true" />
                <Input type="search" name="q" defaultValue={query} placeholder="tomato, weeknight, beans, Nonna..." />
              </InputGroup>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-zinc-800 dark:text-zinc-200">Scope</span>
              <select
                name="scope"
                defaultValue={scope}
                className="block h-10 w-full rounded-sm border border-zinc-300 bg-white px-3 text-sm text-zinc-950 shadow-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
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
          <aside className="rounded-sm border border-zinc-300 bg-white/78 p-4 dark:border-zinc-700 dark:bg-zinc-900/78">
            <Subheading level={2} className="font-serif text-xl/7">{SCOPE_LABELS[scope]}</Subheading>
            <Text className="mt-2 text-sm/6 text-zinc-600 dark:text-zinc-300">{SCOPE_DESCRIPTIONS[scope]}</Text>
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
                      "rounded-sm border px-3 py-2 text-sm font-medium no-underline transition",
                      scope === searchScope
                        ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-200 dark:bg-zinc-200 dark:text-zinc-950"
                        : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800",
                    ].join(" ")}
                  >
                    {SCOPE_LABELS[searchScope]}
                  </Link>
                );
              })}
            </div>
            <Text className="mt-5 text-xs/5 text-zinc-500 dark:text-zinc-400">
              Shopping-list results are always private to the signed-in kitchen.
            </Text>
          </aside>

          <main>
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <Subheading level={2} className="font-serif text-2xl/8">{hasQuery ? `Results for "${query.trim()}"` : "Recently searchable"}</Subheading>
                <Text className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{resultCountLabel(results.length)}</Text>
              </div>
              <Text className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">FTS5 + BM25</Text>
            </div>

            {showPrivatePrompt ? (
              <div className="mb-4 rounded-sm border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                Log in to search your private shopping list.
              </div>
            ) : null}

            {!hasQuery ? (
              <div className="mb-4 rounded-sm border border-dashed border-zinc-300 bg-white/70 p-4 dark:border-zinc-700 dark:bg-zinc-900/70">
                <Text className="text-sm/6 text-zinc-600 dark:text-zinc-300">
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
              <div className="rounded-sm border border-dashed border-zinc-300 bg-white/78 p-8 text-center dark:border-zinc-700 dark:bg-zinc-900/78">
                <SearchIcon className="mx-auto size-8 text-zinc-400" aria-hidden="true" />
                <Subheading level={2} className="mt-3 font-serif text-xl/7">No matches yet</Subheading>
                <Text className="mx-auto mt-2 max-w-xl text-zinc-600 dark:text-zinc-300">
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
