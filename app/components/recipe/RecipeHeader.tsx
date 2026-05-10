import { ImageOff } from 'lucide-react'
import { Heading } from '../ui/heading'
import { Text } from '../ui/text'
import { Link } from '../ui/link'
import { Avatar } from '../ui/avatar'
import { ScaleSelector } from './ScaleSelector'
import { scaleServingsText } from '~/lib/quantity'
import { getDisplayRecipeImageUrl } from '~/lib/recipe-image'

export interface RecipeHeaderProps {
  /** Recipe title */
  title: string
  /** Recipe description (optional) */
  description?: string
  /** Chef's display name */
  chefName: string
  /** Chef's user ID for profile link */
  chefId?: string
  /** Canonical chef profile URL. Falls back to /users/:chefId when omitted. */
  chefProfileHref?: string
  /** Chef's photo URL (optional) */
  chefPhotoUrl?: string
  /** URL to recipe image (optional) */
  imageUrl?: string
  /** Servings text (e.g., "Serves 4") */
  servings?: string
  /** Current scale factor */
  scaleFactor: number
  /** Callback when scale factor changes */
  onScaleChange: (value: number) => void
  /** Reset checked ingredients/steps progress */
  onClearProgress?: () => void
}

/**
 * Recipe header with prominent image, title, chef info, and scaling controls.
 *
 * Features:
 * - PROMINENT hero-style recipe image (or placeholder)
 * - Mobile-first design for kitchen use
 * - Integrated ScaleSelector with scaled servings text
 * - Purely presentational — all actions are in SpoonDock
 */
export function RecipeHeader({
  title,
  description,
  chefName,
  chefId,
  chefProfileHref,
  chefPhotoUrl,
  imageUrl,
  servings,
  scaleFactor,
  onScaleChange,
  onClearProgress,
}: RecipeHeaderProps) {
  // Scale the servings text based on the scale factor
  const scaledServings = servings ? scaleServingsText(servings, scaleFactor) : undefined
  const displayImageUrl = getDisplayRecipeImageUrl(imageUrl)
  const resolvedChefHref = chefProfileHref ?? (chefId ? `/users/${chefId}` : undefined)

  return (
    <header className="w-full">
      {/* Hero Image Section - PROMINENT and beautiful */}
      {displayImageUrl ? (
        <div
          data-testid="recipe-image"
          className="relative w-full aspect-[4/3] sm:aspect-[16/9] lg:aspect-[21/9] overflow-hidden bg-zinc-100 dark:bg-zinc-800"
        >
          <img
            src={displayImageUrl}
            alt={`Photo of ${title}`}
            className="w-full h-full object-cover"
          />
          {/* Gradient overlay for text readability on mobile */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent sm:hidden" />
        </div>
      ) : (
        <div
          data-testid="recipe-image-placeholder"
          className="relative w-full aspect-[4/3] sm:aspect-[16/9] lg:aspect-[21/9] bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center"
        >
          <div className="flex flex-col items-center gap-2 text-zinc-400 dark:text-zinc-500">
            <ImageOff className="w-12 h-12 sm:w-16 sm:h-16" aria-hidden="true" />
            <span className="text-sm">No image available</span>
          </div>
        </div>
      )}

      {/* Content Section */}
      <div className="px-4 sm:px-6 lg:px-8 py-6 sm:py-8 max-w-4xl mx-auto">
        {/* Title and Chef Info */}
        <div className="mb-4">
          <Heading level={1} className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight break-words">
            {title}
          </Heading>
          <div className="mt-2 flex items-center gap-2">
            <span data-testid="chef-avatar">
              <Avatar
                src={chefPhotoUrl}
                initials={chefName.charAt(0).toUpperCase()}
                alt={chefName}
                className="size-8"
              />
            </span>
            <Text>
              By{' '}
              {resolvedChefHref ? (
                <Link href={resolvedChefHref} className="hover:underline">
                  <strong>{chefName}</strong>
                </Link>
              ) : (
                <strong>{chefName}</strong>
              )}
            </Text>
          </div>
        </div>

        {/* Description */}
        {description && (
          <div className="mb-6 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl p-4 sm:p-6">
            <Text className="text-base sm:text-lg leading-relaxed">{description}</Text>
          </div>
        )}

        {/* Scaling Section */}
        <div className="flex items-center justify-between gap-3 p-2.5 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Servings:</span>
            <ScaleSelector
              value={scaleFactor}
              onChange={onScaleChange}
              displayValue={scaledServings}
            />
          </div>
          {onClearProgress && (
            <button
              type="button"
              onClick={onClearProgress}
              className="text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              data-testid="clear-progress-button"
            >
              Clear progress
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
