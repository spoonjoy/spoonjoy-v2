import { formatServingsLabel } from "~/domains/food-knowledge";
import { CoverProvenanceBadge } from "~/components/recipe/CoverProvenanceBadge";
import { Cover } from "~/components/ouro/cover/cover";
import { Item } from "~/components/ouro/item/item";
import { ItemGroup } from "~/components/ouro/item/item-group";
import { SectionHeader } from "~/components/ouro/section-header/section-header";
import { Text } from "~/components/ouro/text/text";
import { listImageProps } from "~/lib/image-loading";

export type CookbookContentsRecipe = {
  /** The row's key: a cookbook entry's id, or the recipe's own. */
  key: string;
  id: string;
  title: string;
  servings: string | null;
  coverImageUrl: string | null;
  coverProvenanceLabel: string | null;
};

/**
 * A cookbook's Contents, as the Apple app sets them: a section header with how many recipes it holds, then numbered
 * rows (01, the cover tile, the title and "Serves 4"); the number is the list's own counter. A regular cookbook and
 * a smart one both show their recipes this way.
 */
export function CookbookContents({
  recipes,
  count = recipes.length,
  listLabel = "Contents",
}: {
  recipes: CookbookContentsRecipe[];
  /** How many recipes it holds in all, when the rows are one page of them. */
  count?: number;
  listLabel?: string;
}) {
  return (
    <section aria-label="Contents" className="mt-10">
      <SectionHeader title="Contents" meta={`${count} ${count === 1 ? "recipe" : "recipes"}`} />

      <div className="[counter-reset:contents] [&_ol>li]:grid [&_ol>li]:grid-cols-[2.25rem_minmax(0,1fr)] [&_ol>li]:items-center [&_ol>li]:[counter-increment:contents] [&_ol>li]:before:font-sj-ui [&_ol>li]:before:text-sm [&_ol>li]:before:font-semibold [&_ol>li]:before:tracking-[0.12em] [&_ol>li]:before:text-[var(--sj-brass)] [&_ol>li]:before:tabular-nums [&_ol>li]:before:content-[counter(contents,decimal-leading-zero)]">
        <ItemGroup aria-label={listLabel} ordered variant="divided" className="@container mt-2 [overflow-wrap:anywhere]">
          {recipes.map((recipe, index) => (
            <Item
              key={recipe.key}
              href={`/recipes/${recipe.id}`}
              title={recipe.title}
              description={formatServingsLabel(recipe.servings) ? <Text size="sm">{formatServingsLabel(recipe.servings)}</Text> : undefined}
              media={recipe.coverImageUrl ? <img src={recipe.coverImageUrl} alt="" {...listImageProps(index, { prioritizeFirst: false })} /> : (
                // Ouro UI's Cover, square so the media slot's own corner rounds it as it does a photo.
                <Cover data-testid={`cookbook-recipe-cover-placeholder-${recipe.id}`} title={recipe.title} size="fill" shape="square" />
              )}
              mediaSize="md"
              actions={recipe.coverProvenanceLabel ? <CoverProvenanceBadge label={recipe.coverProvenanceLabel} /> : undefined}
            />
          ))}
        </ItemGroup>
      </div>
    </section>
  );
}
