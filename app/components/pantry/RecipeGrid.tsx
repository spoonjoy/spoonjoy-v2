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
      <section className="border border-dashed border-zinc-300 rounded-sm bg-zinc-50 p-5 dark:border-zinc-700 dark:bg-zinc-900/50">
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
        <Subheading level={2}>Recipes</Subheading>
        <Text className="text-xs">{recipes.length} total</Text>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {recipes.map((recipe) => {
          const href = recipe.href ?? `/recipes/${recipe.id}`
          const displayImageUrl = getDisplayRecipeImageUrl(recipe.imageUrl)

          return (
            <article
              key={recipe.id}
              className="group relative overflow-hidden rounded-sm border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
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
                  <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
                    <UtensilsCrossed className="h-5 w-5" aria-hidden="true" />
                    <span className="text-xs tracking-wide">No photo</span>
                  </div>
                )}

                {/* Quick actions — subtle top-right icons */}
                <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    aria-label={`Share ${recipe.title}`}
                    onClick={() => onShare?.(recipe.id)}
                    className="rounded-sm bg-white/80 p-1.5 text-zinc-600 backdrop-blur-sm transition-colors hover:bg-white hover:text-zinc-900 dark:bg-zinc-900/80 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-white"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Save ${recipe.title}`}
                    onClick={() => onSave?.(recipe.id)}
                    className="rounded-sm bg-white/80 p-1.5 text-zinc-600 backdrop-blur-sm transition-colors hover:bg-white hover:text-zinc-900 dark:bg-zinc-900/80 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-white"
                  >
                    <Bookmark className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Editorial text below — clean, minimal */}
              <div className="px-4 py-3">
                <Link href={href} className="hover:underline">
                  <Heading level={3} className="text-base/6 font-semibold tracking-tight">
                    {recipe.title}
                  </Heading>
                </Link>

                {/* Minimal metadata row */}
                {(recipe.servings || recipe.chefName) && (
                  <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                    {recipe.servings && <span>Serves {recipe.servings}</span>}
                    {recipe.servings && recipe.chefName && <span className="mx-1">·</span>}
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
