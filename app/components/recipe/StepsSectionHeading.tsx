import clsx from 'clsx'
import { Heading } from '../ui/heading'
import { Text } from '../ui/text'

export interface StepsSectionHeadingProps {
  /** Whether any ingredient or step output is checked off, so there is progress to clear */
  hasProgress: boolean
  /** Unchecks every ingredient and step output */
  onClearProgress: () => void
}

/**
 * The Steps section's heading, its "Tap ingredients as you go" hint and Clear progress.
 *
 * Clear progress is always laid out at its full size and only becomes visible once something is
 * checked, so the first check moves nothing on the page (it used to appear in the recipe header and
 * push everything below it down). While there is nothing to clear it is invisible, disabled and
 * hidden from assistive technology. It sits with the Steps heading, next to the checklist it clears,
 * as on the native app's recipe page (spoonjoy-apple #143).
 */
export function StepsSectionHeading({ hasProgress, onClearProgress }: StepsSectionHeadingProps) {
  return (
    // A phone has no room for the hint and Clear progress on one line, so there Clear progress
    // trails the Steps heading and the hint takes the line below; on a wider screen the hint keeps
    // the trailing edge and Clear progress sits just before it.
    <div className="mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-6 gap-y-2 border-t border-[var(--sj-border-strong)] pt-6 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
      <div className="col-start-1 row-start-1">
        <p className="sj-eyebrow sj-print-hidden">Cook mode</p>
        <Heading level={2} className="mt-3 print:mt-0 text-3xl/9 font-semibold tracking-normal sm:text-4xl/11">
          Steps
        </Heading>
      </div>
      <button
        type="button"
        onClick={onClearProgress}
        disabled={!hasProgress}
        aria-hidden={hasProgress ? undefined : true}
        data-state={hasProgress ? 'shown' : 'reserved'}
        data-testid="clear-progress-button"
        className={clsx(
          // A 44px tap target whose negative margin keeps it as tall as a line of text.
          'font-sj-ui col-start-2 row-start-1 -my-3.5 inline-flex min-h-11 items-center whitespace-nowrap text-xs font-semibold uppercase tracking-[0.14em] text-[var(--sj-ink-soft)] hover:text-[var(--sj-tomato)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sj-brass)] print:hidden',
          // Fades in and out; with reduced motion it simply appears and disappears.
          'motion-safe:transition-[opacity,visibility] motion-safe:duration-200 motion-safe:ease-out',
          hasProgress ? 'visible opacity-100' : 'invisible opacity-0',
        )}
      >
        Clear progress
      </button>
      <Text className="col-span-2 row-start-2 font-sj-ui text-xs uppercase tracking-[0.18em] print:hidden sm:col-span-1 sm:col-start-3 sm:row-start-1">
        Tap ingredients as you go
      </Text>
    </div>
  )
}
