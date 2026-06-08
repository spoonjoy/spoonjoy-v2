import { ImageOff } from 'lucide-react'
import type { ReactNode } from 'react'
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
  /** Cover image URL derived via getRecipeCoverImageUrl. Null means no photo. */
  coverImageUrl?: string | null
  /** Servings text (e.g., "Serves 4") */
  servings?: string
  /** Current scale factor */
  scaleFactor: number
  /** Callback when scale factor changes */
  onScaleChange: (value: number) => void
  /** Reset checked ingredients/steps progress */
  onClearProgress?: () => void
  /** Contextual recipe navigation and primary actions */
  masthead?: ReactNode
  /** Source/import/fork attribution when this recipe has one */
  provenance?: ReactNode
}

/**
 * Recipe header with prominent image, title, chef info, and scaling controls.
 *
 * Features:
 * - PROMINENT hero-style recipe image (or placeholder)
 * - Mobile-first design for kitchen use
 * - Integrated ScaleSelector with scaled servings text
 * - Optional masthead actions for desktop and first-viewport clarity
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
  masthead,
  provenance,
}: RecipeHeaderProps) {
  // Scale the servings text based on the scale factor
  const scaledServings = servings ? scaleServingsText(servings, scaleFactor) : undefined
  const displayImageUrl = coverImageUrl && coverImageUrl.length > 0 ? coverImageUrl : undefined
  const resolvedChefHref = chefProfileHref ?? (chefId ? `/users/${chefId}` : undefined)
  const resolvedChefPhotoUrl = resolveChefAvatarUrl(chefPhotoUrl)

  const chefIdentity = (
    <>
      <span data-testid="chef-avatar">
        <Avatar
          src={resolvedChefPhotoUrl}
          initials={chefName.charAt(0).toUpperCase()}
          alt={chefName}
          className="size-9 border border-[var(--sj-border)]"
        />
      </span>
      <span className="font-sj-ui text-sm font-semibold text-[var(--sj-ink-soft)]">
        By <strong className="text-[var(--sj-ink)]">{chefName}</strong>
      </span>
    </>
  )

  const chefLine = resolvedChefHref ? (
    <Link
      href={resolvedChefHref}
      aria-label={chefName}
      className="mt-5 inline-flex min-h-11 items-center gap-2 no-underline hover:[&_strong]:text-[var(--sj-brass)]"
    >
      {chefIdentity}
    </Link>
  ) : (
    <div className="mt-5 flex min-h-11 items-center gap-2">
      {chefIdentity}
    </div>
  )

  return (
    <header className="w-full overflow-hidden border-b border-[var(--sj-border-strong)]">
      <div
        className="grid lg:min-h-[clamp(34rem,72svh,50rem)] lg:grid-cols-[minmax(0,58vw)_minmax(28rem,1fr)] xl:grid-cols-[minmax(0,60vw)_minmax(30rem,1fr)]"
        data-testid="recipe-header-layout"
      >
        {displayImageUrl ? (
          <div
            data-testid="recipe-image"
            className="h-[36svh] min-h-[16rem] max-h-[20rem] bg-[var(--sj-photo-charcoal)] lg:h-[clamp(34rem,72svh,50rem)] lg:max-h-none lg:min-h-0"
          >
            <img
              src={displayImageUrl}
              alt={`Photo of ${title}`}
              className="h-full min-h-[16rem] w-full object-cover lg:min-h-0"
            />
          </div>
        ) : (
          <div
            data-testid="recipe-image-placeholder"
            className="flex h-[36svh] min-h-[16rem] max-h-[20rem] items-center justify-center bg-[var(--sj-flour)] lg:h-[clamp(34rem,72svh,50rem)] lg:max-h-none lg:min-h-0"
          >
            <div className="flex flex-col items-center gap-3 text-[var(--sj-ink-soft)]">
              <div className="rounded-[var(--sj-radius-control)] border border-[var(--sj-border-strong)] p-5">
                <ImageOff className="size-12 sm:size-16" aria-hidden="true" />
              </div>
              <span className="font-sj-ui text-sm font-semibold uppercase tracking-[0.16em]">No image available</span>
            </div>
          </div>
        )}

        <div className="flex flex-col justify-center px-5 py-6 sm:px-8 sm:py-8 lg:min-h-[clamp(34rem,72svh,50rem)] lg:px-10 lg:py-10 xl:px-14">
          {masthead ? (
            <div className="border-b border-[var(--sj-border)] pb-4" data-testid="recipe-masthead">
              {masthead}
            </div>
          ) : null}

          <div className="mt-6 max-w-[43rem] lg:mt-10">
            <h1 className="font-sj-display max-w-4xl break-words text-5xl/12 font-extrabold text-[var(--sj-ink)] sm:text-6xl/14 xl:text-7xl/16 2xl:text-8xl/18">
              {title}
            </h1>
            {chefLine}
            {provenance ? (
              <div className="mt-4 max-w-2xl border-t border-[var(--sj-border)] pt-4" data-testid="recipe-header-provenance">
                {provenance}
              </div>
            ) : null}
            {description && (
              <p className="mt-6 max-w-2xl border-l-[3px] border-[var(--sj-brass)] pl-5 text-lg/8 text-[var(--sj-ink-soft)] sm:text-xl/8">
                {description}
              </p>
            )}
          </div>

          <div className="mt-8 max-w-[43rem]" data-testid="recipe-header-controls">
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
                  className="font-sj-ui inline-flex min-h-11 items-center justify-start text-left text-xs font-semibold uppercase tracking-[0.14em] text-[var(--sj-ink-soft)] hover:text-[var(--sj-tomato)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sj-brass)] sm:justify-end sm:text-right"
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
