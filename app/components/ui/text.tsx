import clsx from 'clsx'
import { Link } from './link'

export function Text({ className, ...props }: React.ComponentPropsWithoutRef<'p'>) {
  return (
    <p
      data-slot="text"
      {...props}
      className={clsx('text-base/6 text-[var(--sj-ink-soft)]', className)}
    />
  )
}

export function TextLink({ className, ...props }: React.ComponentPropsWithoutRef<typeof Link>) {
  return (
    <Link
      {...props}
      className={clsx(
        'font-sj-ui inline-flex min-h-11 min-w-11 items-center justify-center font-semibold text-[var(--sj-tomato)] underline decoration-[color-mix(in_srgb,var(--sj-tomato)_45%,transparent)] data-hover:text-[var(--sj-brass)] data-hover:decoration-[var(--sj-brass)]',
        className
      )}
    />
  )
}

export function Strong({ className, ...props }: React.ComponentPropsWithoutRef<'strong'>) {
  return <strong {...props} className={clsx('font-medium text-[var(--sj-ink)]', className)} />
}

export function Code({ className, ...props }: React.ComponentPropsWithoutRef<'code'>) {
  return (
    <code
      {...props}
      className={clsx(
        'rounded-sm border border-[var(--sj-border)] bg-[var(--sj-flour)] px-0.5 text-sm font-medium text-[var(--sj-ink)] sm:text-[0.8125rem]',
        className
      )}
    />
  )
}
