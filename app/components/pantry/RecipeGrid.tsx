import { Bookmark, Share2, UtensilsCrossed } from 'lucide-react'
import { Subheading } from '../ui/heading'
import { Link } from '../ui/link'
import { Text } from '../ui/text'
import { Button } from '../ui/button'

export interface PantryRecipeCard {
  id: string
  title: string
  description?: string
  coverImageUrl?: string
  cookTimeMinutes?: number
  difficulty?: 'Easy' | 'Medium' | 'Hard'
  servings?: string
  chefName?: string
  href?: string
}

export interface RecipeGridProps {
  recipes: PantryRecipeCard[]
  emptyTitle?: string
  emptyMessage?: string
  emptyCtaHref?: string | null
  onShare?: (recipeId: string) => void
  onSave?: (recipeId: string) => void
}

export function RecipeGrid({
  recipes,
  emptyTitle = 'No recipes yet',
  emptyMessage = 'Start by creating your first recipe for this pantry.',
  emptyCtaHref = '/recipes/new',
  onShare,
  onSave,
}: RecipeGridProps) {
  if (recipes.length === 0) {
    return (
      <section className="rounded-[var(--sj-radius-hero)] border border-dashed border-[var(--sj-border-strong)] bg-[color-mix(in_srgb,var(--sj-flour)_55%,transparent)] p-6">
        <Subheading level={2}>{emptyTitle}</Subheading>
        <Text className="mt-2">{emptyMessage}</Text>
        {emptyCtaHref ? (
          <div className="mt-4">
            <Button href={emptyCtaHref}>
              Create Recipe
            </Button>
          </div>
        ) : null}
      </section>
    )
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-3">
        <Subheading level={2} className="text-2xl/8">Recipes</Subheading>
        <Text className="font-sj-ui text-xs uppercase tracking-[0.14em]">{recipes.length} total</Text>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {recipes.map((recipe) => {
          const href = recipe.href ?? `/recipes/${recipe.id}`
          const displayImageUrl = recipe.coverImageUrl && recipe.coverImageUrl.length > 0 ? recipe.coverImageUrl : undefined
          const hasQuickActions = Boolean(onShare || onSave)

          return (
            <article
              key={recipe.id}
              className="group relative"
            >
              <div className="sj-photo-tile aspect-[4/5] rounded-[var(--sj-radius-photo)]">
                <Link href={href} aria-label={recipe.title} className="absolute inset-0 z-10 no-underline" />
                {displayImageUrl ? (
                  <img
                    src={displayImageUrl}
                    alt={recipe.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-[#17120f] text-[#fff7e8]">
                    <UtensilsCrossed className="h-5 w-5" aria-hidden="true" />
                    <span className="font-sj-ui text-xs uppercase tracking-[0.16em]">No photo</span>
                  </div>
                )}

                {hasQuickActions ? (
                  <div className="absolute right-2 top-2 z-20 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    {onShare ? (
                      <button
                        type="button"
                        aria-label={`Share ${recipe.title}`}
                        onClick={() => onShare(recipe.id)}
                        className="rounded-[var(--sj-radius-control)] border border-[var(--sj-border)] bg-[color-mix(in_srgb,var(--sj-panel-solid)_82%,transparent)] p-2 text-[var(--sj-ink-soft)] backdrop-blur-sm transition-colors hover:bg-[var(--sj-panel-solid)] hover:text-[var(--sj-tomato)]"
                      >
                        <Share2 className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                    {onSave ? (
                      <button
                        type="button"
                        aria-label={`Save ${recipe.title}`}
                        onClick={() => onSave(recipe.id)}
                        className="rounded-[var(--sj-radius-control)] border border-[var(--sj-border)] bg-[color-mix(in_srgb,var(--sj-panel-solid)_82%,transparent)] p-2 text-[var(--sj-ink-soft)] backdrop-blur-sm transition-colors hover:bg-[var(--sj-panel-solid)] hover:text-[var(--sj-tomato)]"
                      >
                        <Bookmark className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                ) : null}

                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 p-4">
                  <h3 className="font-sj-display text-2xl/8 font-semibold tracking-[-0.02em] text-[#fff7e8] transition group-hover:text-[#ffe0b0]">
                    {recipe.title}
                  </h3>
                  {recipe.description ? (
                    <p className="mt-2 line-clamp-2 text-sm/5 text-white/72">{recipe.description}</p>
                  ) : null}
                {(recipe.servings || recipe.chefName) && (
                  <p className="font-sj-ui mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-white/70">
                    {recipe.servings && <span>Serves {recipe.servings}</span>}
                    {recipe.servings && recipe.chefName && <span className="mx-1">•</span>}
                    {recipe.chefName && <span>{recipe.chefName}</span>}
                  </p>
                )}
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
