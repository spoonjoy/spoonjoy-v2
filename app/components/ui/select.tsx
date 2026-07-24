import * as Headless from '@headlessui/react'
import clsx from 'clsx'
import React, { forwardRef } from 'react'

export const Select = forwardRef(function Select(
  { className, multiple, ...props }: { className?: string } & Omit<Headless.SelectProps, 'as' | 'className'>,
  ref: React.ForwardedRef<HTMLSelectElement>
) {
  const dataInvalid = (props as { 'data-invalid'?: boolean })['data-invalid']
  const ariaInvalid = props['aria-invalid'] ?? props.invalid ?? dataInvalid

  return (
    <span
      data-slot="control"
      className={clsx([
        className,
        // Basic layout
        'group relative block w-full',
        // Background color + shadow applied to inset pseudo element, so shadow blends with border in light mode
        'before:absolute before:inset-px before:rounded-[var(--sj-radius-small)] before:bg-[var(--sj-field)] before:shadow-sm',
        // Focus ring
        'after:pointer-events-none after:absolute after:inset-0 after:rounded-[var(--sj-radius-small)] after:ring-transparent after:ring-inset has-data-focus:after:ring-2 has-data-focus:after:ring-[var(--sj-brass)]',
        // Disabled state
        'has-data-disabled:opacity-50 has-data-disabled:before:bg-[color-mix(in_srgb,var(--sj-field)_72%,transparent)] has-data-disabled:before:shadow-none',
      ])}
    >
      <Headless.Select
        ref={ref}
        multiple={multiple}
        {...props}
        invalid={Boolean(ariaInvalid)}
        className={clsx([
          // Basic layout
          'relative block min-h-11 w-full appearance-none rounded-[var(--sj-radius-small)] py-[calc(--spacing(2.5)-1px)] sm:py-[calc(--spacing(1.5)-1px)]',
          // Horizontal padding
          multiple
            ? 'px-[calc(--spacing(3.5)-1px)] sm:px-[calc(--spacing(3)-1px)]'
            : 'pr-[calc(--spacing(10)-1px)] pl-[calc(--spacing(3.5)-1px)] sm:pr-[calc(--spacing(9)-1px)] sm:pl-[calc(--spacing(3)-1px)]',
          // Options (multi-select)
          '[&_optgroup]:font-semibold',
          // Typography
          'font-sj-ui text-base/6 text-[var(--sj-ink)] placeholder:text-[var(--sj-ink-soft)] sm:text-sm/6 dark:*:text-[var(--sj-ink)]',
          // Border
          'border border-[var(--sj-border-strong)] data-hover:border-[var(--sj-brass)]',
          // Background color
          'bg-transparent dark:*:bg-[var(--sj-panel-solid)]',
          // Hide default focus styles
          'focus:outline-hidden',
          // Invalid state
          'data-invalid:border-[var(--sj-tomato)] data-invalid:data-hover:border-[var(--sj-tomato)]',
          // Disabled state
          'data-disabled:border-[var(--sj-border)] data-disabled:bg-[color-mix(in_srgb,var(--sj-field)_64%,transparent)] data-disabled:opacity-100 data-hover:data-disabled:border-[var(--sj-border)]',
        ])}
      />
      {!multiple && (
        <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
          <svg
            className="size-5 stroke-[var(--sj-ink-soft)] group-has-data-disabled:opacity-55 sm:size-4 forced-colors:stroke-[CanvasText]"
            viewBox="0 0 16 16"
            aria-hidden="true"
            fill="none"
          >
            <path d="M5.75 10.75L8 13L10.25 10.75" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
            <path d="M10.25 5.25L8 3L5.75 5.25" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )}
    </span>
  )
})
