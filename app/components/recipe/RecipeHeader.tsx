import { ImageOff, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from '../ui/link'
import { Avatar } from '../ui/avatar'
import { ScaleSelector } from './ScaleSelector'
import { scaleServingsText } from '~/lib/quantity'
import { resolveChefAvatarUrl } from '~/lib/chef-avatar'
import { CoverProvenanceBadge } from './CoverProvenanceBadge'
import type { CookSyncStatus } from '~/lib/cook-session-sync'
import { CookSyncStatusLine } from './CookSyncStatusLine'
import { HERO_IMAGE_PROPS } from '~/lib/image-loading'

function normalizeCoverPlaceholderLabel(label: string) {
  return label === 'Awaiting first chef photo' ? 'Awaiting first photo' : label
}

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
  /** Human-readable provenance for the active cover. */
  coverProvenanceLabel?: string | null
  /** Placeholder copy when no cover image is available. */
  coverPlaceholderLabel?: string
  /** Active cover generation metadata while an original waits on the editorial variant. */
  activeCoverProcessing?: {
    coverId: string
    activeVariant: 'image' | 'stylized'
    targetVariant: 'stylized'
    status: string
    generationStatus: string
  } | null
  /** Servings text (e.g., "Serves 4") */
  servings?: string
  /** Current scale factor */
  scaleFactor: number
  /** Callback when scale factor changes */
  onScaleChange: (value: number) => void
  /** Reset checked ingredients/steps progress */
  onClearProgress?: () => void
  /** Whether cook progress is saved to the cook's account; omitted when progress stays on this device */
  progressSyncStatus?: CookSyncStatus | null
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
// On paper the scale control is gone, so the printed page says what the quantities are for: the
// (scaled) yield, and the scale whenever it is not the recipe as written.
export function printYieldLine(scaledServings: string | undefined, scaleFactor: number): string | null {
  const parts: string[] = []
  if (scaledServings) parts.push(`Yield: ${scaledServings}`)
  if (scaleFactor !== 1) parts.push(`Quantities at ${parseFloat(scaleFactor.toFixed(2))}× the recipe`)
  return parts.length > 0 ? parts.join(' · ') : null
}

export function RecipeHeader({
  title,
  description,
  chefName,
  chefId,
  chefProfileHref,
  chefPhotoUrl,
  coverImageUrl,
  coverProvenanceLabel,
  coverPlaceholderLabel = 'Cover coming soon',
  activeCoverProcessing,
  servings,
  scaleFactor,
  onScaleChange,
  onClearProgress,
  progressSyncStatus,
  masthead,
  provenance,
}: RecipeHeaderProps) {
  // Scale the servings text based on the scale factor
  const scaledServings = servings ? scaleServingsText(servings, scaleFactor) : undefined
  const displayImageUrl = coverImageUrl && coverImageUrl.length > 0 ? coverImageUrl : undefined
  const resolvedChefHref = chefProfileHref ?? (chefId ? `/users/${chefId}` : undefined)
  const resolvedChefPhotoUrl = resolveChefAvatarUrl(chefPhotoUrl)
  const displayCoverPlaceholderLabel = normalizeCoverPlaceholderLabel(coverPlaceholderLabel)
  const printYield = printYieldLine(scaledServings, scaleFactor)

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
    <header className="sj-recipe-header w-full overflow-hidden border-b border-[var(--sj-border-strong)]">
      <div
        className="sj-recipe-header-layout grid lg:min-h-[clamp(34rem,72svh,50rem)] lg:grid-cols-[minmax(0,58vw)_minmax(28rem,1fr)] xl:grid-cols-[minmax(0,60vw)_minmax(30rem,1fr)]"
        data-testid="recipe-header-layout"
      >
        {displayImageUrl ? (
          <div
            data-testid="recipe-image"
            className="sj-recipe-hero relative h-[36svh] min-h-[16rem] max-h-[20rem] bg-[var(--sj-photo-charcoal)] lg:h-[clamp(34rem,72svh,50rem)] lg:max-h-none lg:min-h-0 print:h-[3in] print:min-h-0 print:max-h-[3in] print:bg-transparent"
          >
            <img
              src={displayImageUrl}
              alt={`Photo of ${title}`}
              {...HERO_IMAGE_PROPS}
              className="h-full min-h-[16rem] w-full object-cover lg:min-h-0 print:min-h-0"
            />
            <CoverProvenanceBadge
              label={coverProvenanceLabel}
              className="absolute bottom-4 left-4 max-w-[calc(100%-2rem)] print:hidden"
            />
            {activeCoverProcessing ? (
              <span
                role="status"
                aria-live="polite"
                className="print:hidden absolute left-4 top-4 inline-flex min-h-7 max-w-[calc(100%-2rem)] items-center gap-2 border border-[rgba(255,252,246,0.76)] bg-[rgba(37,34,31,0.96)] px-2 font-sj-ui text-xs font-semibold text-[var(--sj-paper)] shadow-[0_3px_18px_rgba(0,0,0,0.45)] [text-shadow:0_1px_1px_rgba(0,0,0,0.62)]"
              >
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                Styling cover
              </span>
            ) : null}
          </div>
        ) : (
          <div
            data-testid="recipe-image-placeholder"
            className="flex h-[36svh] min-h-[16rem] max-h-[20rem] items-center justify-center bg-[var(--sj-flour)] lg:h-[clamp(34rem,72svh,50rem)] lg:max-h-none lg:min-h-0 print:hidden"
          >
            <div className="flex flex-col items-center gap-3 text-[var(--sj-ink-soft)]">
              <div className="rounded-[var(--sj-radius-control)] border border-[var(--sj-border-strong)] p-5">
                <ImageOff className="size-12 sm:size-16" aria-hidden="true" />
              </div>
              <span className="font-sj-ui text-sm font-semibold">{displayCoverPlaceholderLabel}</span>
            </div>
          </div>
        )}

        <div className="sj-recipe-header-body flex flex-col justify-center px-5 py-6 sm:px-8 sm:py-8 lg:min-h-[clamp(34rem,72svh,50rem)] lg:px-10 lg:py-10 xl:px-14 print:min-h-0 print:px-0 print:py-4">
          {masthead ? (
            <div className="border-b border-[var(--sj-border)] sm:pb-4 print:hidden" data-testid="recipe-masthead">
              {masthead}
            </div>
          ) : null}

          <div className="mt-6 max-w-[43rem] lg:mt-10 print:mt-0 print:max-w-none">
            <h1 className="font-sj-display max-w-4xl break-words text-5xl/12 font-extrabold text-[var(--sj-ink)] sm:text-6xl/14 xl:text-7xl/16 2xl:text-8xl/18 print:text-4xl/11">
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

          {printYield ? (
            <p className="hidden font-sj-ui text-sm font-semibold text-[var(--sj-ink)] print:mt-4 print:block" data-testid="recipe-print-yield">
              {printYield}
            </p>
          ) : null}

          <div className="mt-8 max-w-[43rem] print:hidden" data-testid="recipe-header-controls">
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
            {progressSyncStatus ? <CookSyncStatusLine status={progressSyncStatus} /> : null}
          </div>
        </div>
      </div>
    </header>
  )
}
