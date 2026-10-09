import { Form } from "react-router";
import { Search as SearchIcon } from "lucide-react";
import { CookbookHeader, CookbookPage } from "~/components/cookbook/page";
import { Button } from "~/components/ui/button";
import { Text } from "~/components/ui/text";

// What a recipe link shows when its recipe is gone: whether it was deleted, a recipe search and the
// recipe box (product audit 2026-10-09, finding 20). It never names the deleted recipe's chef: until
// recipes can be private there is no record of whether it was public when it was deleted.
export function RecipeNotFound({ deleted }: { deleted: boolean }) {
  return (
    <CookbookPage>
      <CookbookHeader eyebrow="Recipes" title={deleted ? "This recipe was deleted." : "We can't find this recipe."}>
        <Text>
          {deleted
            ? "Its chef deleted it, so the link no longer opens. Search for something like it, or browse every public recipe."
            : "The link may be mistyped, or the recipe may have been removed. Try a search, or browse every public recipe."}
        </Text>
      </CookbookHeader>

      <Form method="get" action="/search" role="search" className="mt-8 grid max-w-2xl gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <input type="hidden" name="scope" value="recipes" />
        <label className="sr-only" htmlFor="recipe-not-found-search">Search recipes</label>
        <div className="flex h-14 items-center rounded-[var(--sj-radius-surface)] border border-[var(--sj-border-strong)] bg-[var(--sj-field)] px-4">
          <SearchIcon className="mr-3 size-5 shrink-0 text-[var(--sj-ink-soft)]" aria-hidden="true" />
          <input
            id="recipe-not-found-search"
            type="search"
            name="q"
            placeholder="Search recipes"
            className="h-full min-w-0 flex-1 border-0 bg-transparent font-sj-ui text-base text-[var(--sj-ink)] outline-none placeholder:text-[var(--sj-ink-soft)]"
          />
        </div>
        <Button type="submit">Search</Button>
      </Form>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button href="/recipes" plain>Browse recipes</Button>
      </div>
    </CookbookPage>
  );
}
