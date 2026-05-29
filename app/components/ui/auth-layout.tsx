import type React from 'react'
import { SpoonjoyLogo } from './spoonjoy-logo'

interface AuthLayoutProps {
  children: React.ReactNode
  /**
   * Editorial copy for the marketing column. Defaults to the sign-in voice used
   * by /login. Sign-up and the connector consent screen (/oauth/authorize) pass
   * their own so a signed-in user authorizing an app never reads "Sign in to…".
   */
  eyebrow?: string
  title?: string
  description?: string
}

export function AuthLayout({
  children,
  eyebrow = 'Kitchen sign-in',
  title = 'Keep the good recipes close.',
  description = 'Sign in to cook, fork, save, and remember the recipes that actually make it to your table.',
}: AuthLayoutProps) {
  return (
    <main className="sj-page min-h-dvh">
      <div className="grid min-h-dvh lg:grid-cols-[minmax(0,0.92fr)_minmax(24rem,0.58fr)]">
        <section className="flex flex-col justify-between px-5 py-7 sm:px-8 lg:px-12">
          <a href="/" className="inline-flex min-h-11 items-center gap-2 font-sj-display text-2xl font-semibold text-[var(--sj-ink)] no-underline lg:hidden">
            <SpoonjoyLogo size={28} />
            SPOONJOY
          </a>
          <div className="max-w-2xl py-16">
            <p className="sj-eyebrow">{eyebrow}</p>
            <h1 className="font-sj-display mt-3 text-5xl/12 font-semibold text-[var(--sj-ink)] sm:text-6xl/14">
              {title}
            </h1>
            <p className="mt-5 max-w-xl text-base/7 text-[var(--sj-ink-soft)]">
              {description}
            </p>
          </div>
          <p className="hidden border-t border-[var(--sj-border)] pt-4 text-sm text-[var(--sj-ink-soft)] sm:block">
            Bone paper, charcoal ink, and a kitchen that follows you from phone to table.
          </p>
        </section>
        <section className="flex items-center border-t border-[var(--sj-border)] px-5 py-8 sm:px-8 lg:border-l lg:border-t-0 lg:px-12">
          <div className="w-full max-w-md">
            {children}
            <p className="mt-8 text-center text-xs text-[var(--sj-ink-soft)]">
              <a className="underline hover:text-[var(--sj-ink)]" href="/privacy">Privacy</a>
              <span aria-hidden="true"> · </span>
              <a className="underline hover:text-[var(--sj-ink)]" href="/terms">Terms</a>
            </p>
          </div>
        </section>
      </div>
    </main>
  )
}
