import type { Route } from "./+types/search";
import { Form, useLoaderData } from "react-router";
import { BookOpen, ChefHat, Search as SearchIcon, ShoppingCart, Users, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Heading, Subheading } from "~/components/ui/heading";
import { Link } from "~/components/ui/link";
import { Text } from "~/components/ui/text";
import { CookbookPage, RuledEmptyState } from "~/components/cookbook/page";
import { CoverProvenanceBadge } from "~/components/recipe/CoverProvenanceBadge";
import { getRequestDb } from "~/lib/route-platform.server";
import { getUserId } from "~/lib/session.server";
import {
  normalizeSearchRecipeFilters,
  searchSpoonjoy,
  SearchValidationError,
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

const RESULT_TONES: Record<SearchEntityType, string> = {
  recipe: "sj-result-tone-recipe",
  cookbook: "sj-result-tone-cookbook",
  chef: "sj-result-tone-chef",
  "shopping-list-item": "sj-result-tone-shopping-list-item",
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
  const rawScope = url.searchParams.get("scope");
  if (rawScope !== null && rawScope !== "shopping" && !SEARCH_SCOPES.includes(rawScope as SearchScope)) {
    throw new Response("Invalid search filters", { status: 400 });
  }
  const scope = (rawScope === "shopping" ? "shopping-list" : rawScope ?? "all") as SearchScope;
  const rawCourse = url.searchParams.get("course");
  const rawTags = url.searchParams.getAll("tag");
  const hasRawRecipeFilters = url.searchParams.has("course") || rawTags.length > 0;
  if (hasRawRecipeFilters && scope !== "all" && scope !== "recipes") {
    throw new Response("Invalid search filters", { status: 400 });
  }

  let filters: ReturnType<typeof normalizeSearchRecipeFilters>;
  try {
    filters = normalizeSearchRecipeFilters(rawCourse, rawTags);
  } catch (error) {
    if (!(error instanceof SearchValidationError)) throw error;
    throw new Response("Invalid search filters", { status: 400 });
  }
  const userId = await getUserId(request, context.cloudflare?.env);
  const database = await getRequestDb(context);

  const results = await searchSpoonjoy(database, {
    query,
    scope,
    course: filters.course,
    tags: filters.tags,
    viewerId: userId,
    limit: 30,
  });

  return {
    query,
    scope,
    ...(scope === "all" || scope === "recipes"
      ? { course: filters.course, tags: filters.tags }
      : {}),
    isAuthenticated: Boolean(userId),
    results,
  };
}

function resultCountLabel(count: number) {
  return `${count} ${count === 1 ? "result" : "results"}`;
}

function ResultCard({ result }: { result: SearchResult }) {
  const Icon = RESULT_ICONS[result.type];
  const displayImageUrl = result.imageUrl && result.imageUrl.length > 0 ? result.imageUrl : undefined;
  const coverProvenanceLabel = typeof result.metadata.coverProvenanceLabel === "string"
    ? result.metadata.coverProvenanceLabel
    : null;
  const accessibleLabel = result.type === "shopping-list-item"
    ? `${RESULT_LABELS[result.type]} Private ${result.title}`
    : `${RESULT_LABELS[result.type]} ${result.title}`;

  return (
    <Link
      href={result.href}
      aria-label={accessibleLabel}
      className="group grid gap-4 border-t border-[var(--sj-border)] py-5 no-underline transition hover:border-[var(--sj-border-strong)] sm:grid-cols-[7rem_minmax(0,1fr)]"
    >
      <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-[var(--sj-flour)] sm:aspect-square">
        {displayImageUrl ? (
          <img src={displayImageUrl} alt="" className="h-full w-full object-cover transition group-hover:scale-105" />
        ) : (
          <Icon className="size-5" aria-hidden="true" />
        )}
      </div>
      <div className="min-w-0 self-center">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`font-sj-ui rounded-[var(--sj-radius-control)] border px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-[0.18em] ${RESULT_TONES[result.type]}`}>
            {RESULT_LABELS[result.type]}
          </span>
          {result.type === "shopping-list-item" ? (
            <span className="font-sj-ui rounded-[var(--sj-radius-control)] border border-[var(--sj-border)] px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[var(--sj-ink-soft)]">
              Private
            </span>
          ) : null}
          <CoverProvenanceBadge label={coverProvenanceLabel} />
        </div>
        <Subheading level={2} className="mt-2 line-clamp-2 text-2xl/8 group-hover:text-[var(--sj-tomato)]">
          {result.title}
        </Subheading>
        <Text className="mt-1 text-sm">{result.subtitle}</Text>
        <Text className="mt-3 line-clamp-2 text-sm/6">{result.snippet}</Text>
      </div>
    </Link>
  );
}

export default function Search() {
  const data = useLoaderData<typeof loader>();
  const { query, scope, isAuthenticated, results } = data;
  const course = "course" in data ? data.course ?? null : null;
  const tags = "tags" in data ? data.tags ?? [] : [];
  const hasQuery = query.trim().length > 0;
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
            <Heading level={1} className="mt-3 text-5xl/12 sm:text-7xl/18 lg:text-[84px] lg:leading-[1.05]">
              Find the thing you meant to cook.
            </Heading>
            <Form method="get" role="search" className="mt-8 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <input type="hidden" name="scope" value={scope} />
              <label className="sr-only" htmlFor="search-query">Search terms</label>
              <div className="flex h-[4.5rem] items-center rounded-[var(--sj-radius-surface)] border border-[var(--sj-border-strong)] bg-[var(--sj-field)] px-5">
                <SearchIcon className="mr-3 size-5 shrink-0 text-[var(--sj-ink-soft)]" aria-hidden="true" />
                <input
                  id="search-query"
                  type="search"
                  name="q"
                  defaultValue={query}
                  placeholder="tomato basil"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  className="font-sj-display h-full w-full border-0 bg-transparent text-3xl/9 text-[var(--sj-ink)] outline-none placeholder:text-[var(--sj-ink-soft)]"
                />
              </div>
              {course ? <input type="hidden" name="course" value={course} /> : null}
              {tags.map((tag) => <input key={tag} type="hidden" name="tag" value={tag} />)}
              <Button type="submit" className="h-11">Search</Button>
            </Form>
            {scope === "all" || scope === "recipes" ? (
              <RecipeSearchFilters query={query} scope={scope} course={course} tags={tags} />
            ) : null}
          </div>

          <aside className="sj-receipt p-5">
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
          </aside>
        </header>

        <div className="grid gap-8 py-8 lg:grid-cols-[13.75rem_minmax(0,1fr)]">
          <aside className="border-t border-[var(--sj-border)] pt-4 font-sj-ui text-sm font-bold uppercase tracking-[0.14em] lg:border-r lg:border-t-0 lg:pr-6 lg:pt-0">
            <Subheading level={2} className="text-xl/7">{SCOPE_LABELS[scope]}</Subheading>
            <Text className="mt-2 font-sj-body text-sm/6 normal-case tracking-normal">{SCOPE_DESCRIPTIONS[scope]}</Text>
            <div className="mt-5 grid gap-0">
              {SEARCH_SCOPES.map((searchScope) => {
                return (
                  <Link
                    key={searchScope}
                    href={searchHref(searchScope, query, course, tags)}
                    className={[
                      "flex justify-between border-b border-[var(--sj-border)] py-3 no-underline transition",
                      scope === searchScope
                        ? "text-[var(--sj-ink)]"
                        : "text-[var(--sj-ink-soft)] hover:text-[var(--sj-ink)]",
                    ].join(" ")}
                  >
                    <span>{SCOPE_LABELS[searchScope]}</span>
                  </Link>
                );
              })}
            </div>
            <Text className="font-sj-ui mt-5 hidden text-xs/5 uppercase tracking-[0.14em] sm:block">
              Shopping List results are private to your signed-in kitchen.
            </Text>
          </aside>

          {/* <section>, not <main>: root.tsx already renders the page's only <main>. */}
          <section aria-label="Search results">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <Subheading level={2} className="text-2xl/8">{hasQuery ? `Results for "${query.trim()}"` : "Recently searchable"}</Subheading>
                <Text className="mt-1 text-sm">{resultCountLabel(results.length)}</Text>
              </div>
            </div>

            {showPrivatePrompt ? (
              <div className="mb-4 border-y border-[var(--sj-brass)] bg-[color-mix(in_srgb,var(--sj-brass)_12%,var(--sj-panel-solid))] py-4 text-sm text-[var(--sj-ink)]">
                Log in to search your private shopping list.
              </div>
            ) : null}

            {!hasQuery ? (
              <div className="mb-4 border-y border-dashed border-[var(--sj-border-strong)] py-4">
                <Text className="text-sm/6">
                  Try searching by ingredient, step wording, cookbook theme, chef username, or shopping list category.
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
              <RuledEmptyState title="No matches yet">
                <Text className="mx-auto mt-2 max-w-xl">
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

function searchHref(
  scope: SearchScope,
  query: string,
  course: string | null,
  tags: string[],
) {
  const params = new URLSearchParams();
  params.set("scope", scope);
  if (query.trim()) params.set("q", query.trim());
  if (scope === "all" || scope === "recipes") {
    if (course) params.set("course", course);
    for (const tag of tags) params.append("tag", tag);
  }
  return `/search?${params.toString()}`;
}

function RecipeSearchFilters({
  query,
  scope,
  course,
  tags,
}: {
  query: string;
  scope: "all" | "recipes";
  course: string | null;
  tags: string[];
}) {
  return (
    <div className="mt-5 border-t border-[var(--sj-border)] pt-4">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
        <Form method="get" className="flex min-w-0 items-end gap-2">
          <input type="hidden" name="scope" value={scope} />
          {query.trim() ? <input type="hidden" name="q" value={query.trim()} /> : null}
          <label className="min-w-0 flex-1 font-sj-ui text-sm font-semibold">
            <span className="mb-1 block">Course</span>
            <select
              name="course"
              defaultValue={course ?? ""}
              className="min-h-11 w-full border border-[var(--sj-border-strong)] bg-[var(--sj-field)] px-3 text-base text-[var(--sj-ink)]"
            >
              <option value="">Any course</option>
              <option value="main">Main</option>
              <option value="side">Side</option>
              <option value="appetizer">Appetizer</option>
              <option value="dessert">Dessert</option>
            </select>
          </label>
          {tags.map((tag) => <input key={tag} type="hidden" name="tag" value={tag} />)}
          <Button type="submit" plain>Apply</Button>
        </Form>

        <Form method="get" className="flex min-w-0 items-end gap-2">
          <input type="hidden" name="scope" value={scope} />
          {query.trim() ? <input type="hidden" name="q" value={query.trim()} /> : null}
          {course ? <input type="hidden" name="course" value={course} /> : null}
          {tags.map((tag) => <input key={tag} type="hidden" name="tag" value={tag} />)}
          <label className="min-w-0 flex-1 font-sj-ui text-sm font-semibold">
            <span className="mb-1 block">Add tag filter</span>
            <input
              type="text"
              name="tag"
              required
              className="min-h-11 w-full border border-[var(--sj-border-strong)] bg-[var(--sj-field)] px-3 text-base text-[var(--sj-ink)]"
            />
          </label>
          <Button type="submit" plain>Add</Button>
        </Form>

        {course || tags.length > 0 ? (
          <Link
            href={searchHref(scope, query, null, [])}
            className="font-sj-ui min-h-11 self-end py-3 text-sm font-semibold"
          >
            Clear filters
          </Link>
        ) : null}
      </div>

      {tags.length > 0 ? (
        <ul aria-label="Active tag filters" className="mt-3 flex flex-wrap gap-2">
          {tags.map((tag, index) => (
            <li key={tag} className="flex min-h-9 items-center gap-1 border border-[var(--sj-border)] bg-[var(--sj-panel-solid)] pl-3 text-sm">
              <span>{tag}</span>
              <Link
                href={searchHref(scope, query, course, tags.filter((_, tagIndex) => tagIndex !== index))}
                aria-label={`Remove tag ${tag}`}
                title={`Remove ${tag}`}
                className="flex size-9 items-center justify-center text-[var(--sj-ink-soft)] hover:text-[var(--sj-ink)]"
              >
                <X className="size-4" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
