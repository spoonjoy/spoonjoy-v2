import { Form } from "react-router";
import { Search as SearchIcon } from "lucide-react";
import { TextField } from "~/components/ouro/text-field/text-field";
import { CookbookHeader, CookbookPage } from "~/components/cookbook/page";
import { Button } from "~/components/button";
import { Text } from "~/components/ouro/text/text";

// What a recipe link shows when its recipe is gone: whether it was deleted, a recipe search and the
// recipe box (product audit 2026-10-09, finding 20). It never names the deleted recipe's chef: until
// recipes can be private there is no record of whether it was public when it was deleted.
export function RecipeNotFound({ deleted }: { deleted: boolean }) {
  return (
    <CookbookPage>
      <CookbookHeader eyebrow="Recipes" title={deleted ? "This recipe was deleted." : "We can't find this recipe."}>
        <Text tone="muted">
          {deleted
            ? "Its chef deleted it, so the link no longer opens. Search for something like it, or browse every public recipe."
            : "The link may be mistyped, or the recipe may have been removed. Try a search, or browse every public recipe."}
        </Text>
      </CookbookHeader>

      <Form method="get" action="/search" role="search" className="mt-8 grid max-w-2xl gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-stretch">
        <input type="hidden" name="scope" value="recipes" />
        <TextField type="search" name="q" label="Search recipes" hideLabel placeholder="Search recipes" startAdornment={<SearchIcon />} />
        <Button type="submit">Search</Button>
      </Form>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button href="/recipes" plain>Browse recipes</Button>
      </div>
    </CookbookPage>
  );
}
