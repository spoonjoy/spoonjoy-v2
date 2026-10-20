import { Bookmark, Share2, UtensilsCrossed } from 'lucide-react'
import { Heading } from '~/components/ouro/text/heading'
import { Link } from '../navigation/app-link'
import { Text } from '~/components/ouro/text/text'
import { Button } from '../button'
import { RuledEmptyState } from '~/components/cookbook/page'
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
  href?: string
}

export interface RecipeGridProps {
  recipes: PantryRecipeCard[]
  /** Recipes across every page when the grid shows part of a longer list. */
  totalCount?: number
  emptyTitle?: string
  emptyMessage?: string
  emptyCtaHref?: string | null
  onShare?: (recipeId: string) => void
  onSave?: (recipeId: string) => void
  loadMore?: Pick<ShowMoreLoadProps, 'hasMore' | 'loading' | 'href' | 'onShowMore'>
}

export function RecipeGrid({
  recipes,
  totalCount = recipes.length,
  emptyTitle = 'No recipes yet',
  emptyMessage = 'Start by creating your first recipe for this pantry.',
  emptyCtaHref = '/recipes/new',
  onShare,
  onSave,
  loadMore,
}: RecipeGridProps) {
  if (recipes.length === 0) {
    return (
      <RuledEmptyState title={emptyTitle}>
        <Text tone="muted" className="mt-2">{emptyMessage}</Text>
        {emptyCtaHref ? (
          <div className="mt-4">
            <Button href={emptyCtaHref}>
              Create recipe
            </Button>
          </div>
        ) : null}
      </RuledEmptyState>
    )
  }

  const rows = recipes.map((recipe, index) => {
          const href = recipe.href ?? `/recipes/${recipe.id}`
          const displayImageUrl = recipe.coverImageUrl && recipe.coverImageUrl.length > 0 ? recipe.coverImageUrl : undefined
          const hasQuickActions = Boolean(onShare || onSave)
          const servingsLabel = formatServingsLabel(recipe.servings)

          return (
            <article
              key={recipe.id}
              className="group relative border-b border-[var(--sj-border)]"
            >
              <Link
                href={href}
                className="grid gap-4 py-5 no-underline sm:grid-cols-[7rem_minmax(0,1fr)] sm:pr-24"
              >
                <span className="sj-photo-tile block aspect-[4/3] overflow-hidden sm:aspect-square">
                  {displayImageUrl ? (
                    <img
                      src={displayImageUrl}
                      alt=""
                      {...listImageProps(index)}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="sj-on-photo flex h-full w-full flex-col items-center justify-center gap-1 bg-[var(--sj-photo-charcoal)]">
                      <UtensilsCrossed className="h-5 w-5" aria-hidden="true" />
                      <span className="font-sj-ui text-xs font-semibold">Cover coming soon</span>
                    </span>
                  )}
                </span>

                <span className="min-w-0 self-center">
                  <span className="font-sj-display block text-2xl/8 font-semibold tracking-normal text-[var(--sj-ink)] transition group-hover:text-[var(--sj-tomato)]">
                    {recipe.title}
                  </span>
                  <CoverProvenanceBadge label={recipe.coverProvenanceLabel} className="mt-2" />
                  {recipe.description ? (
                    <span className="mt-1 line-clamp-2 block text-base/6 text-[var(--sj-ink-soft)]">{recipe.description}</span>
                  ) : null}
                  {(servingsLabel || recipe.chefName) && (
                    <span className="font-sj-ui mt-3 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--sj-ink-soft)]">
                      {servingsLabel && <span>{servingsLabel}</span>}
                      {servingsLabel && recipe.chefName && <span className="mx-1">•</span>}
                      {recipe.chefName && <span>{recipe.chefName}</span>}
                    </span>
                  )}
                </span>
              </Link>

              {hasQuickActions ? (
                <div className="absolute right-0 top-5 z-20 flex gap-2" data-testid="recipe-grid-actions">
                  {onShare ? (
                    <button
                      type="button"
                      aria-label={`Share ${recipe.title}`}
                      onClick={() => onShare(recipe.id)}
                      className="grid size-10 place-items-center rounded-[var(--sj-radius-control)] border border-[var(--sj-border)] bg-[var(--sj-panel-solid)] text-[var(--sj-ink-soft)] transition-colors hover:border-[var(--sj-border-strong)] hover:text-[var(--sj-tomato)]"
                    >
                      <Share2 className="h-4 w-4" />
                    </button>
                  ) : null}
                  {onSave ? (
                    <button
                      type="button"
                      aria-label={`Save ${recipe.title}`}
                      onClick={() => onSave(recipe.id)}
                      className="grid size-10 place-items-center rounded-[var(--sj-radius-control)] border border-[var(--sj-border)] bg-[var(--sj-panel-solid)] text-[var(--sj-ink-soft)] transition-colors hover:border-[var(--sj-border-strong)] hover:text-[var(--sj-tomato)]"
                    >
                      <Bookmark className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              ) : null}
            </article>
          )
        })

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-3">
        <Heading level={2} size="xl">Recipes</Heading>
        <p className="text-base/6 text-[var(--sj-ink-soft)] font-sj-ui text-xs uppercase tracking-[0.14em]">{totalCount} total</p>
      </div>
      <div className={loadMore ? "border-t border-[var(--sj-border)]" : "sj-list-ruled"}>
        {loadMore ? (
          <ShowMore
            {...loadMore}
            items={rows}
            showMoreLabel="Show more recipes"
            loadedLabel={(count) => `Showing ${count} recipes`}
            noMoreLabel={`Showing ${recipes.length} recipes`}
          />
        ) : rows}
      </div>
    </section>
  )
}
