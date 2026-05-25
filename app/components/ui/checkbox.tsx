import * as Headless from '@headlessui/react'
import clsx from 'clsx'
import type React from 'react'

export function CheckboxGroup({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      data-slot="control"
      {...props}
      className={clsx(
        className,
        // Basic groups
        'space-y-3',
        // With descriptions
        'has-data-[slot=description]:space-y-6 has-data-[slot=description]:**:data-[slot=label]:font-medium'
      )}
    />
  )
}

export function CheckboxField({
  className,
  ...props
}: { className?: string } & Omit<Headless.FieldProps, 'as' | 'className'>) {
  return (
    <Headless.Field
      data-slot="field"
      {...props}
      className={clsx(
        className,
        // Base layout
        'grid grid-cols-[1.125rem_1fr] gap-x-4 gap-y-1 sm:grid-cols-[1rem_1fr]',
        // Control layout
        '*:data-[slot=control]:col-start-1 *:data-[slot=control]:row-start-1 *:data-[slot=control]:mt-0.75 sm:*:data-[slot=control]:mt-1',
        // Label layout
        '*:data-[slot=label]:col-start-2 *:data-[slot=label]:row-start-1',
        // Description layout
        '*:data-[slot=description]:col-start-2 *:data-[slot=description]:row-start-2',
        // With description
        'has-data-[slot=description]:**:data-[slot=label]:font-medium'
      )}
    />
  )
}

const base = [
  // Basic layout
  'relative isolate flex size-4.5 items-center justify-center rounded-[var(--sj-radius-small)] sm:size-4',
  // Background color + shadow applied to inset pseudo element, so shadow blends with border in light mode
  'before:absolute before:inset-0 before:-z-10 before:rounded-[var(--sj-radius-small)] before:bg-[var(--sj-field)] before:shadow-sm',
  // Background color when checked
  'group-data-checked:before:bg-(--checkbox-checked-bg)',
  // Background color is moved to control and shadow is removed in dark mode so hide `before` pseudo
  'dark:before:hidden',
  // Background color applied to control in dark mode
  'dark:bg-[color-mix(in_srgb,var(--sj-bone)_5%,transparent)] dark:group-data-checked:bg-(--checkbox-checked-bg)',
  // Border
  'border border-[var(--sj-border)] group-data-checked:border-transparent group-data-hover:group-data-checked:border-transparent group-data-hover:border-[var(--sj-border-strong)] group-data-checked:bg-(--checkbox-checked-border)',
  'dark:border-[var(--sj-border)] dark:group-data-checked:border-[var(--sj-border)] dark:group-data-hover:group-data-checked:border-[var(--sj-border)] dark:group-data-hover:border-[var(--sj-border-strong)]',
  // Inner highlight shadow
  'after:absolute after:inset-0 after:rounded-[var(--sj-radius-small)] after:shadow-[inset_0_1px_color-mix(in_srgb,var(--sj-bone)_18%,transparent)]',
  'dark:after:-inset-px dark:after:hidden dark:after:rounded-[var(--sj-radius-small)] dark:group-data-checked:after:block',
  // Focus ring
  'group-data-focus:outline-2 group-data-focus:outline-offset-2 group-data-focus:outline-[var(--sj-brass)]',
  // Disabled state
  'group-data-disabled:opacity-50',
  'group-data-disabled:border-[var(--sj-border-strong)] group-data-disabled:bg-[color-mix(in_srgb,var(--sj-charcoal)_5%,transparent)] group-data-disabled:[--checkbox-check:color-mix(in_srgb,var(--sj-charcoal)_50%,transparent)] group-data-disabled:before:bg-transparent',
  'dark:group-data-disabled:border-[var(--sj-border)] dark:group-data-disabled:bg-[color-mix(in_srgb,var(--sj-bone)_4%,transparent)] dark:group-data-disabled:[--checkbox-check:color-mix(in_srgb,var(--sj-bone)_50%,transparent)] dark:group-data-checked:group-data-disabled:after:hidden',
  // Forced colors mode
  'forced-colors:[--checkbox-check:HighlightText] forced-colors:[--checkbox-checked-bg:Highlight] forced-colors:group-data-disabled:[--checkbox-check:Highlight]',
  'dark:forced-colors:[--checkbox-check:HighlightText] dark:forced-colors:[--checkbox-checked-bg:Highlight] dark:forced-colors:group-data-disabled:[--checkbox-check:Highlight]',
]

const neutralCheckbox = '[--checkbox-check:var(--sj-paper)] [--checkbox-checked-bg:var(--sj-charcoal)] [--checkbox-checked-border:var(--sj-charcoal)]'
const inverseCheckbox = '[--checkbox-check:var(--sj-ink)] [--checkbox-checked-bg:var(--sj-paper)] [--checkbox-checked-border:var(--sj-border-strong)]'
const actionCheckbox = '[--checkbox-check:var(--sj-paper)] [--checkbox-checked-bg:var(--sj-tomato)] [--checkbox-checked-border:var(--sj-tomato)]'
const attentionCheckbox = '[--checkbox-check:var(--sj-paper)] [--checkbox-checked-bg:var(--sj-brass)] [--checkbox-checked-border:var(--sj-brass)]'
const growthCheckbox = '[--checkbox-check:var(--sj-paper)] [--checkbox-checked-bg:var(--sj-herb)] [--checkbox-checked-border:var(--sj-herb)]'

const colors = {
  'dark/zinc': neutralCheckbox,
  'dark/white': inverseCheckbox,
  white: inverseCheckbox,
  dark: neutralCheckbox,
  zinc: neutralCheckbox,
  red: actionCheckbox,
  orange: actionCheckbox,
  amber: attentionCheckbox,
  yellow: attentionCheckbox,
  lime: growthCheckbox,
  green: growthCheckbox,
  emerald: growthCheckbox,
  teal: growthCheckbox,
  cyan: neutralCheckbox,
  sky: neutralCheckbox,
  blue: neutralCheckbox,
  indigo: neutralCheckbox,
  violet: neutralCheckbox,
  purple: neutralCheckbox,
  fuchsia: actionCheckbox,
  pink: actionCheckbox,
  rose: actionCheckbox,
}

type Color = keyof typeof colors

export function Checkbox({
  color = 'amber',
  className,
  ...props
}: {
  color?: Color
  className?: string
} & Omit<Headless.CheckboxProps, 'as' | 'className'>) {
  return (
    <Headless.Checkbox
      data-slot="control"
      {...props}
      className={clsx(className, 'group inline-flex focus:outline-hidden')}
    >
      <span className={clsx([base, colors[color]])}>
        <svg
          className="size-4 stroke-(--checkbox-check) opacity-0 group-data-checked:opacity-100 sm:h-3.5 sm:w-3.5"
          viewBox="0 0 14 14"
          fill="none"
        >
          {/* Checkmark icon */}
          <path
            className="opacity-100 group-data-indeterminate:opacity-0"
            d="M3 8L6 11L11 3.5"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Indeterminate icon */}
          <path
            className="opacity-0 group-data-indeterminate:opacity-100"
            d="M3 7H11"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </Headless.Checkbox>
  )
}
