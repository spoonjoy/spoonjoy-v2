import * as Headless from '@headlessui/react'
import clsx from 'clsx'
import React, { forwardRef } from 'react'
import { TouchTarget } from './button'
import { Link } from './link'

const neutralTone = 'bg-[color-mix(in_srgb,var(--sj-charcoal)_7%,var(--sj-panel-solid))] text-[var(--sj-ink)] group-data-hover:bg-[color-mix(in_srgb,var(--sj-charcoal)_11%,var(--sj-panel-solid))]'
const attentionTone = 'bg-[color-mix(in_srgb,var(--sj-brass)_13%,var(--sj-panel-solid))] text-[var(--sj-brass)] group-data-hover:bg-[color-mix(in_srgb,var(--sj-brass)_19%,var(--sj-panel-solid))]'
const actionTone = 'bg-[color-mix(in_srgb,var(--sj-tomato)_12%,var(--sj-panel-solid))] text-[var(--sj-tomato)] group-data-hover:bg-[color-mix(in_srgb,var(--sj-tomato)_18%,var(--sj-panel-solid))]'
const growthTone = 'bg-[color-mix(in_srgb,var(--sj-herb)_12%,var(--sj-panel-solid))] text-[var(--sj-herb)] group-data-hover:bg-[color-mix(in_srgb,var(--sj-herb)_18%,var(--sj-panel-solid))]'

const colors = {
  red: actionTone,
  orange: actionTone,
  amber: attentionTone,
  yellow: attentionTone,
  lime: growthTone,
  green: growthTone,
  emerald: growthTone,
  teal: growthTone,
  cyan: neutralTone,
  sky: neutralTone,
  blue: neutralTone,
  indigo: neutralTone,
  violet: neutralTone,
  purple: neutralTone,
  fuchsia: actionTone,
  pink: actionTone,
  rose: actionTone,
  zinc: neutralTone,
}

type BadgeProps = { color?: keyof typeof colors }

export function Badge({ color = 'zinc', className, ...props }: BadgeProps & React.ComponentPropsWithoutRef<'span'>) {
  return (
    <span
      {...props}
      className={clsx(
        className,
        'inline-flex items-center gap-x-1.5 rounded-[var(--sj-radius-small)] px-1.5 py-0.5 text-sm/5 font-medium sm:text-xs/5 forced-colors:outline',
        colors[color]
      )}
    />
  )
}

export const BadgeButton = forwardRef(function BadgeButton(
  {
    color = 'zinc',
    className,
    children,
    ...props
  }: BadgeProps & { className?: string; children: React.ReactNode } & (
      | ({ href?: never } & Omit<Headless.ButtonProps, 'as' | 'className'>)
      | ({ href: string } & Omit<React.ComponentPropsWithoutRef<typeof Link>, 'className'>)
    ),
  ref: React.ForwardedRef<HTMLElement>
) {
  let classes = clsx(
    className,
    'group relative inline-flex rounded-[var(--sj-radius-small)] focus:not-data-focus:outline-hidden data-focus:outline-2 data-focus:outline-offset-2 data-focus:outline-[var(--sj-brass)]'
  )

  return typeof props.href === 'string' ? (
    <Link {...props} className={classes} ref={ref as React.ForwardedRef<HTMLAnchorElement>}>
      <TouchTarget>
        <Badge color={color}>{children}</Badge>
      </TouchTarget>
    </Link>
  ) : (
    <Headless.Button {...props} className={classes} ref={ref}>
      <TouchTarget>
        <Badge color={color}>{children}</Badge>
      </TouchTarget>
    </Headless.Button>
  )
})
