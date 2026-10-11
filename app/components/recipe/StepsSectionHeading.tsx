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
 * hidden from assistive technology. It sits on the hint's line, next to the checklist it clears, as
 * the native app's recipe page does (spoonjoy-apple #143).
 */
export function StepsSectionHeading({ hasProgress, onClearProgress }: StepsSectionHeadingProps) {
  return (
    <div className="mb-6 flex flex-col gap-2 border-t border-[var(--sj-border-strong)] pt-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="sj-eyebrow sj-print-hidden">Cook mode</p>
        <Heading level={2} className="mt-3 print:mt-0 text-3xl/9 font-semibold tracking-normal sm:text-4xl/11">
          Steps
        </Heading>
      </div>
      {/* On a phone the hint leads and Clear progress trails; on a wider screen the hint stays at
          the trailing edge and Clear progress appears just before it. */}
      <div className="flex items-center justify-between gap-6 print:hidden sm:justify-end" data-testid="steps-progress-line">
        <Text className="font-sj-ui text-xs uppercase tracking-[0.18em] print:hidden">Tap ingredients as you go</Text>
        <button
          type="button"
          onClick={onClearProgress}
          disabled={!hasProgress}
          aria-hidden={hasProgress ? undefined : true}
          data-state={hasProgress ? 'shown' : 'reserved'}
          data-testid="clear-progress-button"
          className={clsx(
            // A 44px tap target whose negative margin keeps the line as tall as the hint.
            'font-sj-ui -my-3.5 inline-flex min-h-11 shrink-0 items-center text-xs font-semibold uppercase tracking-[0.14em] text-[var(--sj-ink-soft)] hover:text-[var(--sj-tomato)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sj-brass)] sm:order-first',
            // Fades in and out; with reduced motion it simply appears and disappears.
            'motion-safe:transition-[opacity,visibility] motion-safe:duration-200 motion-safe:ease-out',
            hasProgress ? 'visible opacity-100' : 'invisible opacity-0',
          )}
        >
          Clear progress
        </button>
      </div>
    </div>
  )
}
