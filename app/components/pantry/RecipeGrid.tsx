import { Empty } from '~/components/ouro/empty/empty'
import { UtensilsCrossed } from 'lucide-react'
import { Heading } from '~/components/ouro/text/heading'
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
  chefName?: string
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

  const rows = recipes.map((recipe, index) => {
    const meta = [formatServingsLabel(recipe.servings), recipe.chefName].filter(Boolean).join(' • ')
    return (
      <Item
        key={recipe.id}
        as="article"
        // HX ShowMore lists rows without lines between them, so a growing list outlines each row.
        variant={loadMore ? 'outline' : undefined}
        href={`/recipes/${recipe.id}`}
        title={recipe.title}
        description={recipe.description || meta ? (
          <>
            {recipe.description ? <Text lines={2}>{recipe.description}</Text> : null}
            {meta ? <Text size="sm">{meta}</Text> : null}
          </>
        ) : undefined}
        media={recipe.coverImageUrl ? (
          <img src={recipe.coverImageUrl} alt="" {...listImageProps(index)} />
        ) : (
          <span className="sj-on-photo flex flex-col items-center justify-center gap-1 bg-[var(--sj-photo-charcoal)]">
            <UtensilsCrossed className="h-5 w-5" aria-hidden="true" />
            <span className="font-sj-ui text-xs font-semibold">Cover coming soon</span>
          </span>
        )}
        mediaSize="lg"
        mediaAbove="sm"
        actions={recipe.coverProvenanceLabel ? <CoverProvenanceBadge label={recipe.coverProvenanceLabel} /> : undefined}
        stackBelow="sm"
      />
    )
  })

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-3">
        <Heading level={2} size="xl">Recipes</Heading>
        <p className="text-base/6 text-[var(--sj-ink-soft)] font-sj-ui text-xs uppercase tracking-[0.14em]">{totalCount} total</p>
      </div>
      {loadMore ? (
        <ShowMore
          {...loadMore}
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
