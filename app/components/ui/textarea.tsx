import * as Headless from '@headlessui/react'
import clsx from 'clsx'
import React, { forwardRef } from 'react'

export const Textarea = forwardRef(function Textarea(
  {
    className,
    resizable = true,
    ...props
  }: { className?: string; resizable?: boolean } & Omit<Headless.TextareaProps, 'as' | 'className'>,
  ref: React.ForwardedRef<HTMLTextAreaElement>
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
        'before:absolute before:inset-px before:rounded-[calc(var(--radius-lg)-1px)] before:bg-[var(--sj-field)] before:shadow-sm',
        // Focus ring
        'after:pointer-events-none after:absolute after:inset-0 after:rounded-lg after:ring-transparent after:ring-inset sm:focus-within:after:ring-2 sm:focus-within:after:ring-[var(--sj-brass)]',
        // Disabled state
        'has-data-disabled:opacity-50 has-data-disabled:before:bg-[color-mix(in_srgb,var(--sj-field)_72%,transparent)] has-data-disabled:before:shadow-none',
      ])}
    >
      <Headless.Textarea
        ref={ref}
        {...props}
        invalid={Boolean(ariaInvalid)}
        className={clsx([
          // Basic layout
          'relative block h-full w-full appearance-none rounded-lg px-[calc(--spacing(3.5)-1px)] py-[calc(--spacing(2.5)-1px)] sm:px-[calc(--spacing(3)-1px)] sm:py-[calc(--spacing(1.5)-1px)]',
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
          'disabled:border-[var(--sj-border)] disabled:bg-[color-mix(in_srgb,var(--sj-field)_64%,transparent)] data-hover:disabled:border-[var(--sj-border)]',
          // Resizable
          resizable ? 'resize-y' : 'resize-none',
        ])}
      />
    </span>
  )
})
