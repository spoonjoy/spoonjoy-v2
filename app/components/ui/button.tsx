import * as Headless from '@headlessui/react'
import clsx from 'clsx'
import React, { forwardRef } from 'react'
import { Link } from './link'

const styles = {
  base: [
    'font-sj-ui relative isolate inline-flex min-h-11 items-center justify-center gap-x-2 rounded-[var(--sj-radius-control)] border text-base/6 font-semibold tracking-[0.01em]',
    'px-[calc(--spacing(4)-1px)] py-[calc(--spacing(2.75)-1px)] shadow-none transition sm:px-[calc(--spacing(3.5)-1px)] sm:py-[calc(--spacing(1.75)-1px)] sm:text-sm/6',
    'focus:not-data-focus:outline-hidden data-focus:outline-2 data-focus:outline-offset-2 data-focus:outline-[var(--sj-brass)]',
    'data-disabled:opacity-50',
    '*:data-[slot=icon]:-mx-0.5 *:data-[slot=icon]:my-0.5 *:data-[slot=icon]:size-5 *:data-[slot=icon]:shrink-0 *:data-[slot=icon]:self-center *:data-[slot=icon]:text-(--btn-icon) sm:*:data-[slot=icon]:my-1 sm:*:data-[slot=icon]:size-4 forced-colors:[--btn-icon:ButtonText] forced-colors:data-hover:[--btn-icon:ButtonText]',
  ],
  default: [
    'border-[var(--sj-action)] bg-[var(--sj-action)] text-[var(--sj-on-photo)] data-active:bg-[var(--sj-action-deep)] data-hover:border-[var(--sj-action-deep)] data-hover:bg-[var(--sj-action-deep)]',
    '[--btn-icon:var(--sj-paper)] data-active:[--btn-icon:var(--sj-paper)] data-hover:[--btn-icon:var(--sj-paper)]',
  ],
  destructive: [
    'border-[var(--sj-tomato)] bg-[color-mix(in_srgb,var(--sj-tomato)_12%,var(--sj-panel-solid))] text-[var(--sj-tomato)] data-active:bg-[color-mix(in_srgb,var(--sj-tomato)_22%,var(--sj-panel-solid))] data-hover:bg-[var(--sj-tomato)] data-hover:text-[var(--sj-paper)]',
    '[--btn-icon:var(--sj-tomato)] data-hover:[--btn-icon:var(--sj-paper)]',
  ],
  plain: [
    'border-[var(--sj-border)] bg-[color-mix(in_srgb,var(--sj-panel-solid)_72%,transparent)] text-[var(--sj-ink)] data-active:bg-[var(--sj-flour)] data-hover:border-[var(--sj-border-strong)] data-hover:bg-[var(--sj-flour)]',
    '[--btn-icon:var(--sj-ink-soft)] data-active:[--btn-icon:var(--sj-ink)] data-hover:[--btn-icon:var(--sj-ink)]',
  ],
}

type ButtonProps = (
  | { variant?: 'default' | 'destructive'; plain?: never }
  | { variant?: never; plain: true }
) & { className?: string; children: React.ReactNode } & (
    | ({ href?: never } & Omit<Headless.ButtonProps, 'as' | 'className'>)
    | ({ href: string } & Omit<React.ComponentPropsWithoutRef<typeof Link>, 'className'>)
  )

export const Button = forwardRef(function Button(
  { variant, plain, className, children, ...props }: ButtonProps,
  ref: React.ForwardedRef<HTMLElement>
) {
  let classes = clsx(
    className,
    styles.base,
    plain ? styles.plain : variant === 'destructive' ? styles.destructive : styles.default
  )

  return typeof props.href === 'string' ? (
    <Link {...props} className={classes} ref={ref as React.ForwardedRef<HTMLAnchorElement>}>
      <TouchTarget>{children}</TouchTarget>
    </Link>
  ) : (
    <Headless.Button {...props} className={clsx(classes, 'cursor-default')} ref={ref}>
      <TouchTarget>{children}</TouchTarget>
    </Headless.Button>
  )
})

/**
 * Expand the hit area to at least 44×44px on touch devices
 */
export function TouchTarget({ children }: { children: React.ReactNode }) {
  return (
    <>
      <span
        data-slot="touch-target"
        className="absolute top-1/2 left-1/2 size-[max(100%,2.75rem)] -translate-x-1/2 -translate-y-1/2 pointer-fine:hidden"
        aria-hidden="true"
      />
      {children}
    </>
  )
}
