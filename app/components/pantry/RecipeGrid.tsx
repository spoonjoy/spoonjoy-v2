import { Empty } from '~/components/ouro/empty/empty'
import { SectionHeader } from '~/components/ouro/section-header/section-header'
import { CoverPlaceholder } from '~/components/recipe/CoverPlaceholder'
import { Item } from '~/components/ouro/item/item'
import { ItemGroup } from '~/components/ouro/item/item-group'
import { Text } from '~/components/ouro/text/text'
import { Button } from '~/components/ouro/button/button'

import { formatServingsLabel } from '~/lib/quantity'
import { CoverProvenanceBadge } from '~/components/recipe/CoverProvenanceBadge'
import { listImageProps } from '~/lib/image-loading'
import { ShowMore, type ShowMoreLoadProps } from '~/components/ouro/collapsible/show-more'

export interface PantryRecipeCard {
  id: string
  title: string
  description?: string
  coverImageUrl?: string | null
  coverProvenanceLabel?: string | null
  cookTimeMinutes?: number
  difficulty?: 'Easy' | 'Medium' | 'Hard'
  servings?: string
}

export interface RecipeGridProps {
  recipes: PantryRecipeCard[]
  /** Recipes across every page when the grid shows part of a longer list. */
  totalCount?: number
  emptyTitle?: string
  emptyMessage?: string
  emptyCtaHref?: string | null
  loadMore?: Pick<ShowMoreLoadProps, 'hasMore' | 'loading' | 'href' | 'onShowMore'>
}

export function RecipeGrid({
  recipes,
  totalCount = recipes.length,
  emptyTitle = 'No recipes yet',
  emptyMessage = 'Start by creating your first recipe for this pantry.',
  emptyCtaHref = '/recipes/new',
  loadMore,
}: RecipeGridProps) {
  if (recipes.length === 0) {
    return (
      <Empty headingLevel={2} align="start" description={<>
        <Text tone="muted" className="mt-2">{emptyMessage}</Text>
        {emptyCtaHref ? (
          <div className="mt-4">
            <Button href={emptyCtaHref}>
              Create recipe
            </Button>
          </div>
        ) : null}
      </>} title={emptyTitle} />
    )
  }

  // A row is its cover, its title and "Serves 4" under it, as the Apple app lists recipes
  // (desk target.md, G6).
  const rows = recipes.map((recipe, index) => {
    const servings = formatServingsLabel(recipe.servings)
    return (
      <Item
        key={recipe.id}
        as="article"
        href={`/recipes/${recipe.id}`}
        title={recipe.title}
        description={servings ? <Text size="sm">{servings}</Text> : undefined}
        media={recipe.coverImageUrl ? (
          <img src={recipe.coverImageUrl} alt="" {...listImageProps(index)} />
        ) : (
          <CoverPlaceholder aria-hidden="true" title={recipe.title} shape="bleed" />
        )}
        mediaSize="md"
        actions={recipe.coverProvenanceLabel ? <CoverProvenanceBadge label={recipe.coverProvenanceLabel} /> : undefined}
      />
    )
  })

  return (
    <section aria-label="Recipes">
      <SectionHeader title="Recipes" meta={`${totalCount} ${totalCount === 1 ? 'recipe' : 'recipes'}`} className="mb-2" />
      {loadMore ? (
        <ShowMore
          {...loadMore}
          // HX ShowMore lists rows without lines between them; draw the hairline the divided group
          // draws, so a growing list reads as the same plain rows (desk target.md, G6).
          className="sj-hairline-rows"
          items={rows}
          showMoreLabel="Show more recipes"
          loadedLabel={(count) => `Showing ${count} recipes`}
          noMoreLabel={`Showing ${recipes.length} recipes`}
        />
      ) : (
        <ItemGroup aria-label="Recipes" variant="divided">{rows}</ItemGroup>
      )}
    </section>
  )
}
