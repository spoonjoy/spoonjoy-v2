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

  const chefLine = (
    <div className="mt-5 flex items-center gap-2">
      <span data-testid="chef-avatar">
        <Avatar
          src={resolvedChefPhotoUrl}
          initials={chefName.charAt(0).toUpperCase()}
          alt={chefName}
          className="size-9 border border-[var(--sj-border)]"
        />
      </span>
      <p className="font-sj-ui text-sm font-semibold text-[var(--sj-ink-soft)]">
        By{' '}
        {resolvedChefHref ? (
          <Link href={resolvedChefHref} className="text-[var(--sj-ink)] underline decoration-[var(--sj-border-strong)] underline-offset-4 hover:text-[var(--sj-brass)]">
            <strong>{chefName}</strong>
          </Link>
        ) : (
          <strong className="text-[var(--sj-ink)]">{chefName}</strong>
        )}
      </p>
    </div>
  )

  return (
    <header className="w-full border-b border-[var(--sj-border-strong)]">
      <div className="mx-auto grid max-w-[94rem] lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
        {displayImageUrl ? (
          <div
            data-testid="recipe-image"
            className="min-h-[70svh] bg-[var(--sj-photo-charcoal)] lg:min-h-[calc(100svh-4.75rem)]"
          >
            <img
              src={displayImageUrl}
              alt={`Photo of ${title}`}
              className="h-full min-h-[70svh] w-full object-cover lg:min-h-[calc(100svh-4.75rem)]"
            />
          </div>
        ) : (
          <div
            data-testid="recipe-image-placeholder"
            className="flex min-h-[70svh] items-center justify-center bg-[var(--sj-flour)] lg:min-h-[calc(100svh-4.75rem)]"
          >
            <div className="flex flex-col items-center gap-3 text-[var(--sj-ink-soft)]">
              <div className="rounded-[var(--sj-radius-control)] border border-[var(--sj-border-strong)] p-5">
                <ImageOff className="size-12 sm:size-16" aria-hidden="true" />
              </div>
              <span className="font-sj-ui text-sm font-semibold uppercase tracking-[0.16em]">No image available</span>
            </div>
          </div>
        )}

        <div className="flex min-h-[70svh] flex-col px-5 py-8 sm:px-8 lg:min-h-[calc(100svh-4.75rem)] lg:px-12 lg:py-10">
          <div className="flex items-center justify-between border-b border-[var(--sj-border)] pb-4">
            <div className="inline-flex items-center gap-3 font-sj-ui text-sm font-bold">
              <span className="sj-nav-mark" aria-hidden="true">SJ</span>
              <span>Recipe</span>
            </div>
            <span className="font-sj-ui text-xs font-bold uppercase tracking-[0.18em] text-[var(--sj-ink-soft)]">Cookbook view</span>
          </div>

          <div className="mt-10">
            <p className="sj-eyebrow">Origin recipe</p>
            <h1 className="font-sj-display mt-8 max-w-4xl break-words text-6xl/14 font-extrabold text-[var(--sj-ink)] sm:text-7xl/16 lg:text-8xl/18">
              {title}
            </h1>
            {chefLine}
            {description && (
              <p className="mt-6 max-w-2xl border-l-[3px] border-[var(--sj-brass)] pl-5 text-lg/8 text-[var(--sj-ink-soft)] sm:text-xl/8">
                {description}
              </p>
            )}
          </div>

          <div className="mt-auto pt-10">
            <div className="grid gap-4 sm:grid-cols-[minmax(16rem,26rem)_auto] sm:items-center sm:justify-between">
              <ScaleSelector
                value={scaleFactor}
                onChange={onScaleChange}
                displayValue={scaledServings}
              />
              {onClearProgress && (
                <button
                  type="button"
                  onClick={onClearProgress}
                  className="font-sj-ui text-left text-xs font-semibold uppercase tracking-[0.14em] text-[var(--sj-ink-soft)] hover:text-[var(--sj-tomato)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sj-brass)] sm:text-right"
                  data-testid="clear-progress-button"
                >
                  Clear progress
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
