import { ImageOff } from 'lucide-react'
import { Badge } from '~/components/ouro/badge/badge'
import { Spinner } from '~/components/ouro/spinner/spinner'
import type { ReactNode } from 'react'
import { Link } from '~/components/ouro/link/link'
import { Avatar } from '../ouro/avatar/avatar'
import { NumberField } from '~/components/ouro/number-field/number-field'
import { SCALE_RANGE } from '~/components/cook/cook-controller'
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
 * - The scale, as Ouro HX's NumberField, with the scaled servings under it
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
          name={chefName}
          src={resolvedChefPhotoUrl}
          initials={chefName.charAt(0).toUpperCase()}
          alt={chefName}
          size="md"
        />
      </span>
      <span className="font-sj-ui text-sm font-semibold text-[var(--sj-ink-soft)]">
        By <strong className="text-[var(--sj-ink)]">{chefName}</strong>
      </span>
    </>
  )

  const chefLine = resolvedChefHref ? (
    <Link href={resolvedChefHref} aria-label={chefName} tone="secondary" inline={false} className="mt-5 inline-flex items-center gap-2">
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
              <Badge className="print:hidden absolute left-4 top-4 gap-2">
                <Spinner size="sm" label="Styling cover" />
                <span aria-hidden="true">Styling cover</span>
              </Badge>
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
            <div className="sm:max-w-[26rem]">
              <NumberField
                label="Scale"
                description={scaledServings}
                value={scaleFactor}
                {...SCALE_RANGE}
                format={{ maximumFractionDigits: 2 }}
                decrementLabel="Decrease scale"
                incrementLabel="Increase scale"
                onValueChange={(next) => {
                  if (next !== null) onScaleChange(next)
                }}
              />
            </div>
            {progressSyncStatus ? <CookSyncStatusLine status={progressSyncStatus} /> : null}
          </div>
        </div>
      </div>
    </header>
  )
}
