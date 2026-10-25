import { Form } from "react-router";
import { Search as SearchIcon } from "lucide-react";
import { TextField } from "~/components/ouro/text-field/text-field";
import { CookbookPage } from "~/components/cookbook/page";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { Button } from "~/components/ouro/button/button";

// What a recipe link shows when its recipe is gone: whether it was deleted, a recipe search and the
// recipe box (product audit 2026-10-09, finding 20). It never names the deleted recipe's chef: until
// recipes can be private there is no record of whether it was public when it was deleted.
// A recipe the viewer reported, or whose chef they blocked or reported, is hidden from them.
export function RecipeNotFound({ deleted, hidden = false }: { deleted: boolean; hidden?: boolean }) {
  return (
    <CookbookPage>
      <PageHeader
        eyebrow="Recipes"
        title={hidden ? "You've hidden this recipe." : deleted ? "This recipe was deleted." : "We can't find this recipe."}
        size="lg"
        divider
        description={hidden
          ? "You reported it, or blocked or reported its chef, so Spoonjoy keeps it out of your kitchen. You can unblock chefs in Settings."
          : deleted
            ? "Its chef deleted it, so the link no longer opens. Search for something like it, or browse every public recipe."
            : "The link may be mistyped, or the recipe may have been removed. Try a search, or browse every public recipe."}
      />

      <Form method="get" action="/search" role="search" className="mt-8 grid max-w-2xl gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-stretch">
        <input type="hidden" name="scope" value="recipes" />
        <TextField type="search" name="q" label="Search recipes" hideLabel placeholder="Search recipes" startAdornment={<SearchIcon />} />
        <Button type="submit">Search</Button>
      </Form>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button href="/recipes" variant="outline" tone="secondary">Browse recipes</Button>
      </div>
    </CookbookPage>
  );
}
