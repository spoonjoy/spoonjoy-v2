import { ImageOff } from 'lucide-react'
import { Link } from '../ui/link'
import { Avatar } from '../ui/avatar'
import { ScaleSelector } from './ScaleSelector'
import { scaleServingsText } from '~/lib/quantity'
import { resolveChefAvatarUrl } from '~/lib/chef-avatar'

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
  const resolvedChefPhotoUrl = resolveChefAvatarUrl(chefPhotoUrl)

  return (
    <header className="w-full">
      <div className="mx-auto max-w-7xl lg:px-8">
        {displayImageUrl ? (
          <div
            data-testid="recipe-image"
            className="sj-food-photo mx-auto aspect-[4/5] w-full sm:aspect-[16/9] lg:aspect-[2.18/1]"
          >
            <img
              src={displayImageUrl}
              alt={`Photo of ${title}`}
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-x-0 bottom-0 z-10 p-5 sm:p-8 lg:p-10">
              <p className="sj-kicker-dark">Recipe</p>
              <h1 className="font-sj-display sj-on-photo mt-4 max-w-5xl break-words text-5xl/12 font-bold tracking-[-0.04em] sm:text-7xl/18 lg:text-8xl/20">
                {title}
              </h1>
              <div className="mt-4 flex items-center gap-2">
                <span data-testid="chef-avatar">
                  <Avatar
                    src={resolvedChefPhotoUrl}
                    initials={chefName.charAt(0).toUpperCase()}
                    alt={chefName}
                    className="size-9 border border-[var(--sj-photo-line)]"
                  />
                </span>
                <p className="font-sj-ui sj-on-photo-muted text-sm font-semibold">
                  By{' '}
                  {resolvedChefHref ? (
                    <Link href={resolvedChefHref} className="sj-on-photo underline decoration-[var(--sj-photo-line)] underline-offset-4 hover:text-[var(--sj-on-photo-warm)]">
                      <strong>{chefName}</strong>
                    </Link>
                  ) : (
                    <strong className="sj-on-photo">{chefName}</strong>
                  )}
                </p>
              </div>
              {description && (
                <p className="sj-on-photo-muted mt-5 max-w-2xl text-base/7 sm:text-lg/8">{description}</p>
              )}
            </div>
          </div>
        ) : (
          <div
            data-testid="recipe-image-placeholder"
            className="sj-dark-canvas relative mx-auto flex aspect-[4/5] w-full items-center justify-center overflow-hidden border border-[var(--sj-border)] sm:aspect-[16/9] lg:aspect-[2.18/1]"
          >
            <div className="sj-on-photo relative flex flex-col items-center gap-3">
              <div className="rounded-[var(--sj-radius-control)] border border-[var(--sj-photo-line)] bg-[var(--sj-photo-glass)] p-5">
                <ImageOff className="size-12 sm:size-16" aria-hidden="true" />
              </div>
              <span className="font-sj-ui text-sm font-semibold uppercase tracking-[0.16em]">No image available</span>
            </div>
            <div className="absolute inset-x-0 bottom-0 z-10 p-5 sm:p-8 lg:p-10">
              <p className="sj-kicker-dark">Recipe</p>
              <h1 className="font-sj-display sj-on-photo mt-4 max-w-5xl break-words text-5xl/12 font-bold tracking-[-0.04em] sm:text-7xl/18 lg:text-8xl/20">
                {title}
              </h1>
              <div className="mt-4 flex items-center gap-2">
                <span data-testid="chef-avatar">
                  <Avatar
                    src={resolvedChefPhotoUrl}
                    initials={chefName.charAt(0).toUpperCase()}
                    alt={chefName}
                    className="size-9 border border-[var(--sj-photo-line)]"
                  />
                </span>
                <p className="font-sj-ui sj-on-photo-muted text-sm font-semibold">
                  By{' '}
                  {resolvedChefHref ? (
                    <Link href={resolvedChefHref} className="sj-on-photo underline decoration-[var(--sj-photo-line)] underline-offset-4 hover:text-[var(--sj-on-photo-warm)]">
                      <strong>{chefName}</strong>
                    </Link>
                  ) : (
                    <strong className="sj-on-photo">{chefName}</strong>
                  )}
                </p>
              </div>
              {description && (
                <p className="sj-on-photo-muted mt-5 max-w-2xl text-base/7 sm:text-lg/8">{description}</p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="mx-auto max-w-5xl px-3 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 border-y border-[var(--sj-border)] py-3 sm:flex-row sm:items-center sm:justify-between">
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
    </header>
  )
}
