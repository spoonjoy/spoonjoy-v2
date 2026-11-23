import { Badge } from '~/components/ouro/badge/badge'
import { Spinner } from '~/components/ouro/spinner/spinner'
import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '~/components/ouro/button/button'
import { Popover } from '~/components/ouro/popover/popover'
import { Link } from '~/components/ouro/link/link'
import { Avatar } from '../ouro/avatar/avatar'
import { NumberField } from '~/components/ouro/number-field/number-field'
import { SCALE_RANGE } from '~/components/cook/cook-controller'
import { formatServingsLabel, scaleServingsText } from "~/domains/food-knowledge"
import { resolveChefAvatarUrl } from '~/lib/chef-avatar'
import { CoverProvenanceBadge } from './CoverProvenanceBadge'
import { Cover } from '~/components/ouro/cover/cover'
import type { CookSyncStatus } from '~/lib/cook-session-sync'
import { SyncStatus } from '~/components/ouro/sync-status/sync-status'
import { cookSyncStatusProps } from '~/lib/cook-sync-status'
import { HERO_IMAGE_PROPS } from '~/lib/image-loading'
import { UnitSystemControl } from './UnitSystemControl'

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
  /** The page's main actions (Cook, Save, Add to list), as one row under the description. */
  actions?: ReactNode
  /** Source/import/fork attribution when this recipe has one */
  provenance?: ReactNode
  /** The timed steps added up ("23 min"), first in the meta row; left out when no step is timed. */
  cookTime?: string
}

/** Sync states that need nothing from the cook, so the page doesn't show them. */
const QUIET_SYNC: ReadonlySet<CookSyncStatus> = new Set(['syncing', 'synced'])

/**
 * Recipe header with prominent image, title, chef info, and scaling controls.
 *
 * Features:
 * - PROMINENT hero-style recipe image (or placeholder)
 * - Mobile-first design for kitchen use
 * - The meta row: the cook time, then the Serves capsule, which opens the scale
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
  actions,
  provenance,
  cookTime,
}: RecipeHeaderProps) {
  // Scale the servings text based on the scale factor
  const scaledServings = servings ? scaleServingsText(servings, scaleFactor) : undefined
  // Under the scale it reads as a phrase: a bare "4" says "Serves 4", as the recipe lists do.
  // Labelled before it is scaled, so a number that scales to a fraction ("4 ½") keeps its word too.
  const scaledServingsLabel = servings ? scaleServingsText(formatServingsLabel(servings), scaleFactor) : undefined
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
            className="h-[36svh] min-h-[16rem] max-h-[20rem] lg:h-[clamp(34rem,72svh,50rem)] lg:max-h-none lg:min-h-0 print:hidden"
          >
            <Cover title={title} alt={displayCoverPlaceholderLabel} size="fill" shape="square" className="h-full aspect-auto" />
          </div>
        )}

        <div className="sj-recipe-header-body flex flex-col justify-center px-5 py-6 sm:px-8 sm:py-8 lg:min-h-[clamp(34rem,72svh,50rem)] lg:px-10 lg:py-10 xl:px-14 print:min-h-0 print:px-0 print:py-4">
          {masthead ? (
            <div className="border-b border-[var(--sj-border)] sm:pb-4 print:hidden" data-testid="recipe-masthead">
              {masthead}
            </div>
          ) : null}

          <div className="mt-6 max-w-[43rem] lg:mt-10 print:mt-0 print:max-w-none">
            {/* Core's sj-type-display role (Fraunces 600), as native's displayTitle sets the name; it grows past the role's 3rem at wider breakpoints. */}
            <h1 className="sj-type-display max-w-4xl break-words text-[var(--sj-ink)] sm:text-6xl/14 xl:text-7xl/16 2xl:text-8xl/18 print:text-4xl/11">
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

          {/* The meta row, as the Apple app sets it (desk target.md, Recipe): the cook time, then a
              "Serves 4" capsule that opens the scale. */}
          <div className="mt-8 flex max-w-[43rem] flex-wrap items-center gap-2 print:hidden" data-testid="recipe-header-controls">
            {cookTime ? (
              <>
                <span className="font-sj-ui text-sm font-semibold text-[var(--sj-ink-soft)]">{cookTime}</span>
                <span aria-hidden="true" className="text-[var(--sj-ink-soft)]">·</span>
              </>
            ) : null}
            <Popover
              title="Scale the recipe"
              hideTitle
              align="start"
              trigger={(
                <Button variant="soft" tone="secondary" size="sm" endIcon={ChevronDown} data-testid="recipe-serves-trigger">
                  {scaledServingsLabel ?? `Scale ${Number(scaleFactor.toFixed(2))}×`}
                </Button>
              )}
            >
              <div className="flex w-72 max-w-full flex-col gap-4">
                <NumberField
                  label="Scale"
                  description={scaledServingsLabel}
                  value={scaleFactor}
                  {...SCALE_RANGE}
                  format={{ maximumFractionDigits: 2 }}
                  decrementLabel="Decrease scale"
                  incrementLabel="Increase scale"
                  onValueChange={(next) => {
                    if (next !== null) onScaleChange(next)
                  }}
                />
                <UnitSystemControl />
              </div>
            </Popover>
          </div>
          {/* The Apple app shows nothing here while progress syncs. Syncing and synced stay in the page for
              screen readers and take no room; a problem (offline, signed out, reload) shows under the meta row. */}
          {progressSyncStatus ? (
            <SyncStatus
              className={QUIET_SYNC.has(progressSyncStatus) ? 'sr-only' : 'mt-3 print:hidden'}
              data-testid="cook-sync-status"
              {...cookSyncStatusProps(progressSyncStatus)}
            />
          ) : null}

          {actions ? <div className="mt-6 max-w-[43rem] print:hidden">{actions}</div> : null}

          {printYield ? (
            <p className="hidden font-sj-ui text-sm font-semibold text-[var(--sj-ink)] print:mt-4 print:block" data-testid="recipe-print-yield">
              {printYield}
            </p>
          ) : null}
        </div>
      </div>
    </header>
  )
}
