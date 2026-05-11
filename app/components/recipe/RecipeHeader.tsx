import { ImageOff } from 'lucide-react'
import { Heading } from '../ui/heading'
import { Text } from '../ui/text'
import { Link } from '../ui/link'
import { Avatar } from '../ui/avatar'
import { ScaleSelector } from './ScaleSelector'
import { scaleServingsText } from '~/lib/quantity'

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
  /** Cover image URL derived via getRecipeCoverImageUrl. May be a data URL (SVG fallback). */
  coverImageUrl?: string
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
  coverImageUrl,
  servings,
  scaleFactor,
  onScaleChange,
  onClearProgress,
}: RecipeHeaderProps) {
  // Scale the servings text based on the scale factor
  const scaledServings = servings ? scaleServingsText(servings, scaleFactor) : undefined
  const displayImageUrl = coverImageUrl && coverImageUrl.length > 0 ? coverImageUrl : undefined
  const resolvedChefHref = chefProfileHref ?? (chefId ? `/users/${chefId}` : undefined)

  return (
    <header className="w-full">
      {/* Hero Image Section - PROMINENT and beautiful */}
      <div className="px-4 pt-5 sm:px-6 lg:px-8">
        {displayImageUrl ? (
          <div
            data-testid="recipe-image"
            className="relative mx-auto aspect-[4/3] w-full max-w-6xl overflow-hidden rounded-[2rem] border border-[var(--sj-border)] bg-[var(--sj-flour)] shadow-[var(--sj-shadow)] sm:aspect-[16/9] lg:aspect-[21/9]"
          >
            <img
              src={displayImageUrl}
              alt={`Photo of ${title}`}
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.08),transparent_38%,rgba(0,0,0,0.44))]" aria-hidden="true" />
          </div>
        ) : (
          <div
            data-testid="recipe-image-placeholder"
            className="relative mx-auto flex aspect-[4/3] w-full max-w-6xl items-center justify-center overflow-hidden rounded-[2rem] border border-[var(--sj-border)] bg-[color-mix(in_srgb,var(--sj-flour)_72%,transparent)] shadow-[var(--sj-shadow-soft)] sm:aspect-[16/9] lg:aspect-[21/9]"
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,color-mix(in_srgb,var(--sj-brass)_20%,transparent),transparent_32%),radial-gradient(circle_at_70%_30%,color-mix(in_srgb,var(--sj-herb)_18%,transparent),transparent_34%)]" aria-hidden="true" />
            <div className="relative flex flex-col items-center gap-3 text-[var(--sj-ink-soft)]">
              <div className="rounded-full border border-[var(--sj-border)] bg-[var(--sj-panel-solid)] p-5 shadow-[var(--sj-shadow-soft)]">
                <ImageOff className="size-12 sm:size-16" aria-hidden="true" />
              </div>
              <span className="font-sj-ui text-sm font-semibold uppercase tracking-[0.16em]">No image available</span>
            </div>
          </div>
        )}
      </div>

      {/* Content Section */}
      <div className="relative mx-auto -mt-10 max-w-4xl px-4 pb-6 sm:px-6 sm:pb-8 lg:px-8">
        <div className="sj-panel rounded-[2rem] p-5 sm:p-7">
        {/* Title and Chef Info */}
        <div className="mb-4">
          <p className="sj-eyebrow mb-4">Recipe</p>
          <Heading level={1} className="break-words text-4xl/11 font-bold tracking-[-0.04em] sm:text-5xl/13 lg:text-6xl/15">
            {title}
          </Heading>
          <div className="mt-2 flex items-center gap-2">
            <span data-testid="chef-avatar">
              <Avatar
                src={chefPhotoUrl}
                initials={chefName.charAt(0).toUpperCase()}
                alt={chefName}
                className="size-9 border border-[var(--sj-border)]"
              />
            </span>
            <Text>
              By{' '}
              {resolvedChefHref ? (
                <Link href={resolvedChefHref} className="sj-link">
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
          <div className="mb-6 rounded-[1.5rem] border border-[var(--sj-border)] bg-[color-mix(in_srgb,var(--sj-flour)_54%,transparent)] p-4 sm:p-6">
            <Text className="text-base leading-relaxed sm:text-lg">{description}</Text>
          </div>
        )}

        {/* Scaling Section */}
        <div className="flex flex-col gap-3 rounded-[1.5rem] border border-[var(--sj-border)] bg-[color-mix(in_srgb,var(--sj-panel-solid)_72%,transparent)] p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="font-sj-ui text-sm font-semibold uppercase tracking-[0.12em] text-[var(--sj-ink-soft)]">Servings:</span>
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
              className="font-sj-ui text-left text-xs font-semibold uppercase tracking-[0.14em] text-[var(--sj-ink-soft)] hover:text-[var(--sj-tomato)] sm:text-right"
              data-testid="clear-progress-button"
            >
              Clear progress
            </button>
          )}
        </div>
        </div>
      </div>
    </header>
  )
}
