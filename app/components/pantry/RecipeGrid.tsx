import { Bookmark, Share2, UtensilsCrossed } from 'lucide-react'
import { Heading, Subheading } from '../ui/heading'
import { Link } from '../ui/link'
import { Text } from '../ui/text'
import { Button } from '../ui/button'
import { getDisplayRecipeImageUrl } from '~/lib/recipe-image'

export interface PantryRecipeCard {
  id: string
  title: string
  description?: string
  imageUrl?: string
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
      <section className="rounded-[2rem] border border-dashed border-[var(--sj-border-strong)] bg-[color-mix(in_srgb,var(--sj-flour)_55%,transparent)] p-6">
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
          const displayImageUrl = getDisplayRecipeImageUrl(recipe.imageUrl)
          const hasQuickActions = Boolean(onShare || onSave)

          return (
            <article
              key={recipe.id}
              className="sj-card sj-hover-lift group relative overflow-hidden rounded-[1.6rem]"
            >
              {/* Hero image — dominant, carries visual weight */}
              <div className="relative">
                {displayImageUrl ? (
                  <img
                    src={displayImageUrl}
                    alt={recipe.title}
                    className="aspect-[4/3] w-full object-cover"
                  />
                ) : (
                  <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 bg-[var(--sj-flour)] text-[var(--sj-ink-soft)]">
                    <UtensilsCrossed className="h-5 w-5" aria-hidden="true" />
                    <span className="font-sj-ui text-xs uppercase tracking-[0.16em]">No photo</span>
                  </div>
                )}

                {hasQuickActions ? (
                  <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    {onShare ? (
                      <button
                        type="button"
                        aria-label={`Share ${recipe.title}`}
                        onClick={() => onShare(recipe.id)}
                        className="rounded-full border border-[var(--sj-border)] bg-[color-mix(in_srgb,var(--sj-panel-solid)_82%,transparent)] p-2 text-[var(--sj-ink-soft)] backdrop-blur-sm transition-colors hover:bg-[var(--sj-panel-solid)] hover:text-[var(--sj-tomato)]"
                      >
                        <Share2 className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                    {onSave ? (
                      <button
                        type="button"
                        aria-label={`Save ${recipe.title}`}
                        onClick={() => onSave(recipe.id)}
                        className="rounded-full border border-[var(--sj-border)] bg-[color-mix(in_srgb,var(--sj-panel-solid)_82%,transparent)] p-2 text-[var(--sj-ink-soft)] backdrop-blur-sm transition-colors hover:bg-[var(--sj-panel-solid)] hover:text-[var(--sj-tomato)]"
                      >
                        <Bookmark className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {/* Editorial text below — clean, minimal */}
              <div className="px-4 py-3">
                <Link href={href} className="no-underline hover:text-[var(--sj-tomato)]">
                  <Heading level={3} className="text-xl/7 font-semibold tracking-[-0.02em]">
                    {recipe.title}
                  </Heading>
                </Link>

                {/* Minimal metadata row */}
                {(recipe.servings || recipe.chefName) && (
                  <p className="font-sj-ui mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--sj-ink-soft)]">
                    {recipe.servings && <span>Serves {recipe.servings}</span>}
                    {recipe.servings && recipe.chefName && <span className="mx-1">•</span>}
                    {recipe.chefName && <span>{recipe.chefName}</span>}
                  </p>
                )}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
