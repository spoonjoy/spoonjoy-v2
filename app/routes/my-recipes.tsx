import type { Route } from "./+types/my-recipes";
import type { ChangeEvent } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { Form, useLoaderData, useLocation } from "react-router";
import { Plus, Search, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Link } from "~/components/ui/link";
import { Pagination, PaginationNext, PaginationPrevious } from "~/components/ui/pagination";
import { Text } from "~/components/ui/text";
import { CookbookHeader, CookbookPage, ObjectRow, RuledEmptyState } from "~/components/cookbook/page";
import {
  MyRecipesSearchValidationError,
  normalizeMyRecipesFilters,
  normalizeMyRecipesQuery,
  parseMyRecipesPage,
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
  let page: number;
  let filters: ReturnType<typeof normalizeMyRecipesFilters>;
  try {
    page = parseMyRecipesPage(url.searchParams.get("page"));
    filters = normalizeMyRecipesFilters(
      url.searchParams.get("course"),
      url.searchParams.getAll("tag"),
    );
  } catch (error) {
    if (!(error instanceof MyRecipesSearchValidationError)) throw error;
    throw new Response("Invalid recipe filters", { status: 400 });
  }
  const database = await getRequestDb(context);

  const chef = await database.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, username: true },
  });
  const result = await searchMyRecipes(database, {
    ownerId: chef.id,
    ownerUsername: chef.username,
    query,
    normalizedFilters: filters,
    page,
  });
  return { ...result, tags: [...filters.displayTags] };
}

export default function MyRecipes() {
  const data = useLoaderData<typeof loader>();
  const { query, recipes, page, hasPreviousPage, hasNextPage } = data;
  const course = data.course ?? null;
  const tags = data.tags ?? [];
  const hasFilters = Boolean(course || tags.length > 0);
  const [paginationQuery, setPaginationQuery] = useState(query);
  const previousPaginationQuery = useRef(query);

  useEffect(() => {
    if (previousPaginationQuery.current === query) return;
    previousPaginationQuery.current = query;
    setPaginationQuery(query);
  }, [query]);

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

      <DrawerSearch
        label="Search my recipes"
        query={query}
        placeholder="sumac, beans, serves 4"
        course={course}
        tags={tags}
        recipeFilters
        onQueryDraftChange={setPaginationQuery}
      />

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
          title={query || hasFilters ? "No matching recipes" : "No recipes yet"}
          action={<Button href="/recipes/new">Create Recipe</Button>}
        >
          <Text>
            {query || hasFilters
              ? "Try another title, ingredient, serving size, or note."
              : "Start with the dish you make most often."}
          </Text>
        </RuledEmptyState>
      )}

      {(hasPreviousPage || hasNextPage) ? (
        <Pagination className="mt-6" aria-label="My recipes pagination">
          <PaginationPrevious href={hasPreviousPage ? myRecipesPageHref(paginationQuery.trim(), course, tags, page - 1) : null} />
          <PaginationNext href={hasNextPage ? myRecipesPageHref(paginationQuery.trim(), course, tags, page + 1) : null} />
        </Pagination>
      ) : null}
    </CookbookPage>
  );
}

function myRecipesPageHref(
  query: string,
  course: string | null,
  tags: string[],
  page: number,
) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (course) params.set("course", course);
  for (const tag of tags) params.append("tag", tag);
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  return search ? `?${search}` : ".";
}

export function DrawerSearch({
  label,
  query,
  placeholder,
  course = null,
  tags = [],
  recipeFilters = false,
  onQueryDraftChange,
}: {
  label: string;
  query: string;
  placeholder: string;
  course?: string | null;
  tags?: string[];
  recipeFilters?: boolean;
  onQueryDraftChange?: (query: string) => void;
}) {
  const searchId = useId();
  const tagHelpId = useId();
  const location = useLocation();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const filterPanelRef = useRef<HTMLDivElement>(null);
  const [searchDraft, setSearchDraft] = useState(query);
  const previousQuery = useRef(query);
  const serializedQuery = searchDraft.trim();
  const filterState = `${course ?? ""}\u0000${tags.join("\u0000")}`;
  const previousFilterState = useRef(filterState);
  const filterHref = (nextCourse: string | null, nextTags: string[]) => (
    myRecipesPageHref(serializedQuery, nextCourse, nextTags, 1)
  );
  const handleSearchDraftChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextQuery = event.currentTarget.value;
    setSearchDraft(nextQuery);
    onQueryDraftChange?.(nextQuery);
  };

  useEffect(() => {
    if (previousFilterState.current === filterState) return;
    previousFilterState.current = filterState;
    filterPanelRef.current?.focus();
  }, [filterState]);

  useEffect(() => {
    if (previousQuery.current === query) return;
    previousQuery.current = query;
    setSearchDraft(query);
    searchInputRef.current?.focus();
  }, [query]);

  if (!recipeFilters) {
    return (
      <Form method="get" role="search" className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="sr-only" htmlFor={searchId}>{label}</label>
        <div className="flex min-h-12 flex-1 items-center border border-[var(--sj-border-strong)] bg-[var(--sj-field)] px-4 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--sj-brass)]">
          <Search className="mr-2 size-4 shrink-0 text-[var(--sj-ink-soft)]" aria-hidden="true" />
          <input
            ref={searchInputRef}
            id={searchId}
            type="search"
            name="q"
            value={searchDraft}
            onChange={handleSearchDraftChange}
            placeholder={placeholder}
            className="min-h-11 w-full border-0 bg-transparent text-base text-[var(--sj-ink)] outline-none placeholder:text-[var(--sj-ink-soft)]"
          />
        </div>
        <Button type="submit" plain>Search</Button>
        {query ? <Link href="." className="font-sj-ui text-sm font-semibold">Clear</Link> : null}
      </Form>
    );
  }

  return (
    <div
      ref={filterPanelRef}
      role="region"
      aria-label="Recipe filters"
      tabIndex={-1}
      className="mt-6 border-y border-[var(--sj-border)] py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sj-brass)]"
    >
      <div aria-live="polite" className="sr-only">
        {course || tags.length > 0
          ? `Recipe filters updated. Course ${course ?? "any"}. Tags ${tags.join(", ") || "none"}.`
          : "Recipe filters cleared."}
      </div>
      <Form method="get" role="search" className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="sr-only" htmlFor={searchId}>{label}</label>
        <div className="flex min-h-12 flex-1 items-center border border-[var(--sj-border-strong)] bg-[var(--sj-field)] px-4 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--sj-brass)]">
          <Search className="mr-2 size-4 shrink-0 text-[var(--sj-ink-soft)]" aria-hidden="true" />
          <input
            ref={searchInputRef}
            id={searchId}
            type="search"
            name="q"
            value={searchDraft}
            onChange={handleSearchDraftChange}
            placeholder={placeholder}
            className="min-h-11 w-full border-0 bg-transparent text-base text-[var(--sj-ink)] outline-none placeholder:text-[var(--sj-ink-soft)]"
          />
        </div>
        {course ? <input type="hidden" name="course" value={course} /> : null}
        {tags.map((tag) => <input key={tag} type="hidden" name="tag" value={tag} />)}
        <Button type="submit" plain>Search</Button>
        {query ? (
          <Link
            href={myRecipesPageHref("", course, tags, 1)}
            className="font-sj-ui inline-flex min-h-11 min-w-11 items-center justify-center px-2 py-3 text-sm font-semibold"
          >
            Clear
          </Link>
        ) : null}
      </Form>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
        <Form method="get" className="flex min-w-0 items-end gap-2">
            {serializedQuery ? <input type="hidden" name="q" value={serializedQuery} /> : null}
            <label className="min-w-0 flex-1 font-sj-ui text-sm font-semibold">
              <span className="mb-1 block">Course</span>
              <select
                key={course ?? "no-course"}
                name="course"
                defaultValue={course ?? ""}
                required
                className="min-h-11 w-full border border-[var(--sj-border-strong)] bg-[var(--sj-field)] px-3 text-base text-[var(--sj-ink)]"
              >
                <option value="" disabled>Choose a course</option>
                <option value="main">Main</option>
                <option value="side">Side</option>
                <option value="appetizer">Appetizer</option>
                <option value="dessert">Dessert</option>
              </select>
            </label>
            {tags.map((tag) => <input key={tag} type="hidden" name="tag" value={tag} />)}
            <Button type="submit" plain>Apply</Button>
            {course ? (
              <Link href={filterHref(null, tags)} className="font-sj-ui inline-flex min-h-11 items-center py-3 text-sm font-semibold">
                Clear course
              </Link>
            ) : null}
          </Form>

          <Form method="get" className="flex min-w-0 items-end gap-2">
            {serializedQuery ? <input type="hidden" name="q" value={serializedQuery} /> : null}
            {course ? <input type="hidden" name="course" value={course} /> : null}
            {tags.map((tag) => <input key={tag} type="hidden" name="tag" value={tag} />)}
            <label className="min-w-0 flex-1 font-sj-ui text-sm font-semibold">
              <span className="mb-1 block">Add tag filter</span>
              <input
                key={`${location.key}:${tags.join("\u0000")}`}
                type="text"
                name="tag"
                required
                disabled={tags.length >= 10}
                aria-describedby={tags.length >= 10 ? tagHelpId : undefined}
                className="min-h-11 w-full border border-[var(--sj-border-strong)] bg-[var(--sj-field)] px-3 text-base text-[var(--sj-ink)]"
              />
            </label>
            <Button type="submit" plain disabled={tags.length >= 10}>Add</Button>
            {tags.length >= 10 ? (
              <span id={tagHelpId} role="status" className="font-sj-ui text-sm font-semibold text-[var(--sj-ink-soft)]">
                10-tag limit reached. Remove a tag to add another.
              </span>
            ) : null}
          </Form>

          {course || tags.length > 0 ? (
            <Link href={filterHref(null, [])} className="font-sj-ui inline-flex min-h-11 items-center self-end py-3 text-sm font-semibold">
              Clear filters
            </Link>
          ) : null}
      </div>

      {tags.length > 0 ? (
        <ul aria-label="Active tag filters" className="mt-3 flex flex-wrap gap-2">
          {tags.map((tag, index) => (
            <li key={tag} className="flex max-w-full min-w-0 items-center gap-1 border border-[var(--sj-border)] bg-[var(--sj-panel-solid)] pl-3 text-sm">
              <span className="min-w-0 [overflow-wrap:anywhere]">{tag}</span>
              <Link
                href={filterHref(course, tags.filter((_, tagIndex) => tagIndex !== index))}
                aria-label={`Remove tag ${tag}`}
                title={`Remove ${tag}`}
                className="flex size-11 shrink-0 items-center justify-center text-[var(--sj-ink-soft)] hover:text-[var(--sj-ink)]"
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
