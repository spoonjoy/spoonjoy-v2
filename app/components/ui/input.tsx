import * as Headless from '@headlessui/react'
import clsx from 'clsx'
import React, { forwardRef } from 'react'

export function InputGroup({ children }: React.ComponentPropsWithoutRef<'span'>) {
  return (
    <span
      data-slot="control"
      className={clsx(
        'relative isolate block',
        'has-[[data-slot=icon]:first-child]:[&_input]:pl-10 has-[[data-slot=icon]:last-child]:[&_input]:pr-10 sm:has-[[data-slot=icon]:first-child]:[&_input]:pl-8 sm:has-[[data-slot=icon]:last-child]:[&_input]:pr-8',
        '*:data-[slot=icon]:pointer-events-none *:data-[slot=icon]:absolute *:data-[slot=icon]:top-3 *:data-[slot=icon]:z-10 *:data-[slot=icon]:size-5 sm:*:data-[slot=icon]:top-2.5 sm:*:data-[slot=icon]:size-4',
        '[&>[data-slot=icon]:first-child]:left-3 sm:[&>[data-slot=icon]:first-child]:left-2.5 [&>[data-slot=icon]:last-child]:right-3 sm:[&>[data-slot=icon]:last-child]:right-2.5',
        '*:data-[slot=icon]:text-[var(--sj-ink-soft)]'
      )}
    >
      {children}
    </span>
  )
}

const dateTypes = ['date', 'datetime-local', 'month', 'time', 'week']
type DateType = (typeof dateTypes)[number]

export const Input = forwardRef(function Input(
  {
    className,
    ...props
  }: {
    className?: string
    type?: 'email' | 'number' | 'password' | 'search' | 'tel' | 'text' | 'url' | DateType
  } & Omit<Headless.InputProps, 'as' | 'className'>,
  ref: React.ForwardedRef<HTMLInputElement>
) {
  const dataInvalid = (props as { 'data-invalid'?: boolean })['data-invalid']
  const ariaInvalid = props['aria-invalid'] ?? props.invalid ?? dataInvalid

  return (
    <span
      data-slot="control"
      className={clsx([
        className,
        // Basic layout
        'relative block w-full',
        // Background color + shadow applied to inset pseudo element, so shadow blends with border in light mode
        'before:absolute before:inset-px before:rounded-[var(--sj-radius-small)] before:bg-[var(--sj-field)] before:shadow-sm',
        // Focus ring
        'after:pointer-events-none after:absolute after:inset-0 after:rounded-[var(--sj-radius-small)] after:ring-transparent after:ring-inset sm:focus-within:after:ring-2 sm:focus-within:after:ring-[var(--sj-brass)]',
        // Disabled state
        'has-data-disabled:opacity-50 has-data-disabled:before:bg-[color-mix(in_srgb,var(--sj-field)_72%,transparent)] has-data-disabled:before:shadow-none',
      ])}
    >
      <Headless.Input
        ref={ref}
        {...props}
        invalid={Boolean(ariaInvalid)}
        className={clsx([
          // Date classes
          props.type &&
            dateTypes.includes(props.type) && [
              '[&::-webkit-datetime-edit-fields-wrapper]:p-0',
              '[&::-webkit-date-and-time-value]:min-h-[1.5em]',
              '[&::-webkit-datetime-edit]:inline-flex',
              '[&::-webkit-datetime-edit]:p-0',
              '[&::-webkit-datetime-edit-year-field]:p-0',
              '[&::-webkit-datetime-edit-month-field]:p-0',
              '[&::-webkit-datetime-edit-day-field]:p-0',
              '[&::-webkit-datetime-edit-hour-field]:p-0',
              '[&::-webkit-datetime-edit-minute-field]:p-0',
              '[&::-webkit-datetime-edit-second-field]:p-0',
              '[&::-webkit-datetime-edit-millisecond-field]:p-0',
              '[&::-webkit-datetime-edit-meridiem-field]:p-0',
            ],
          // Basic layout
          'relative block min-h-11 w-full appearance-none rounded-[var(--sj-radius-small)] px-[calc(--spacing(3.5)-1px)] py-[calc(--spacing(2.75)-1px)] sm:px-[calc(--spacing(3)-1px)] sm:py-[calc(--spacing(1.75)-1px)]',
          // Typography
          'font-sj-ui text-base/6 text-[var(--sj-ink)] placeholder:text-[var(--sj-ink-soft)] sm:text-sm/6',
          // Border
          'border border-[var(--sj-border-strong)] data-hover:border-[var(--sj-brass)]',
          // Background color
          'bg-transparent',
          // Hide default focus styles
          'focus:outline-hidden',
          // Invalid state
          'data-invalid:border-[var(--sj-tomato)] data-invalid:data-hover:border-[var(--sj-tomato)]',
          // Disabled state
          'data-disabled:border-[var(--sj-border)] data-disabled:bg-[color-mix(in_srgb,var(--sj-field)_64%,transparent)] data-hover:data-disabled:border-[var(--sj-border)]',
          // System icons
          'dark:scheme-dark',
        ])}
      />
    </span>
  )
})
