import * as Headless from '@headlessui/react'
import clsx from 'clsx'
import React, { forwardRef } from 'react'
import { Link } from './link'

const styles = {
  base: [
    'relative isolate inline-flex items-baseline justify-center gap-x-2 rounded-sm border text-base/6 font-semibold',
    'px-[calc(--spacing(3.5)-1px)] py-[calc(--spacing(2.5)-1px)] sm:px-[calc(--spacing(3)-1px)] sm:py-[calc(--spacing(1.5)-1px)] sm:text-sm/6',
    'focus:not-data-focus:outline-hidden data-focus:outline-2 data-focus:outline-offset-2 data-focus:outline-zinc-500',
    'data-disabled:opacity-50',
    '*:data-[slot=icon]:-mx-0.5 *:data-[slot=icon]:my-0.5 *:data-[slot=icon]:size-5 *:data-[slot=icon]:shrink-0 *:data-[slot=icon]:self-center *:data-[slot=icon]:text-(--btn-icon) sm:*:data-[slot=icon]:my-1 sm:*:data-[slot=icon]:size-4 forced-colors:[--btn-icon:ButtonText] forced-colors:data-hover:[--btn-icon:ButtonText]',
  ],
  default: [
    'border-zinc-300 bg-white text-zinc-900 data-active:bg-zinc-100 data-hover:bg-zinc-50',
    'dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:data-active:bg-zinc-900 dark:data-hover:bg-zinc-900',
    '[--btn-icon:var(--color-zinc-600)] data-active:[--btn-icon:var(--color-zinc-700)] data-hover:[--btn-icon:var(--color-zinc-700)] dark:[--btn-icon:var(--color-zinc-400)] dark:data-active:[--btn-icon:var(--color-zinc-300)] dark:data-hover:[--btn-icon:var(--color-zinc-300)]',
  ],
  destructive: [
    'border-zinc-300 bg-white text-red-700 data-active:bg-zinc-100 data-hover:bg-zinc-50',
    'dark:border-zinc-700 dark:bg-zinc-950 dark:text-red-400 dark:data-active:bg-zinc-900 dark:data-hover:bg-zinc-900',
    '[--btn-icon:var(--color-red-700)] dark:[--btn-icon:var(--color-red-400)]',
  ],
  plain: [
    'border-transparent bg-transparent text-zinc-900 data-active:bg-zinc-100 data-hover:bg-zinc-100',
    'dark:text-zinc-100 dark:data-active:bg-zinc-800 dark:data-hover:bg-zinc-800',
    '[--btn-icon:var(--color-zinc-600)] data-active:[--btn-icon:var(--color-zinc-700)] data-hover:[--btn-icon:var(--color-zinc-700)] dark:[--btn-icon:var(--color-zinc-400)] dark:data-active:[--btn-icon:var(--color-zinc-300)] dark:data-hover:[--btn-icon:var(--color-zinc-300)]',
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
