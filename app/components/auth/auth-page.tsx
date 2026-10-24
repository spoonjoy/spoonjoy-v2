import type React from 'react'
import { Link } from '~/components/ouro/link/link'
import { SpoonjoyLogo } from '../spoonjoy-logo'
import { AuthLayout } from '~/components/ouro/auth-layout/auth-layout'

interface AuthLayoutProps {
  children: React.ReactNode
  formTitle: string
  /**
   * Editorial copy for the marketing column. Defaults to the sign-in voice used
   * by /login. Sign-up and the connector consent screen (/oauth/authorize) pass
   * their own so a signed-in user authorizing an app never reads "Sign in to…".
   */
  eyebrow?: string
  title?: string
  description?: string
}

/** Spoonjoy's editorial copy stays app-owned; the actual auth card is released Ouro UI. */
export function AuthPage({
  children,
  formTitle,
  eyebrow = 'Kitchen sign-in',
  title = 'Keep the good recipes close.',
  description = 'Sign in to cook, fork, save, and remember the recipes that actually make it to your table.',
}: AuthLayoutProps) {
  // Wrap in <div>, not <main>: root.tsx already renders a single <main id="main">
  // around every page. Nesting another <main> here breaks landmark navigation.
  // The marketing title is <h2> so the page's actual <h1> (the form title like
  // "Log in") stays at level 1, preserving a single h1 per page.
  return (
    <div className="sj-page min-h-dvh">
      <div className="grid min-h-dvh lg:grid-cols-[minmax(0,0.92fr)_minmax(24rem,0.58fr)]" data-fold-halves="">
        <section className="flex flex-col justify-between px-5 py-7 sm:px-8 lg:px-12">
          <Link href="/" data-fold-hide="" tone="secondary" inline={false} className="inline-flex items-center gap-2 lg:hidden">
            <SpoonjoyLogo size={28} />
            <span className="font-sj-display text-2xl font-semibold">SPOONJOY</span>
          </Link>
          <div className="max-w-2xl py-16">
            <p className="sj-eyebrow">{eyebrow}</p>
            <h2 className="font-sj-display mt-3 text-5xl/12 font-semibold text-[var(--sj-ink)] sm:text-6xl/14">
              {title}
            </h2>
            <p className="mt-5 max-w-xl text-base/7 text-[var(--sj-ink-soft)]">
              {description}
            </p>
          </div>
          <p className="hidden border-t border-[var(--sj-border)] pt-4 text-sm text-[var(--sj-ink-soft)] sm:block">
            Your recipes, cookbooks and shopping list, on your phone and at the table.
          </p>
        </section>
        <section className="flex items-center border-t border-[var(--sj-border)] px-5 py-8 sm:px-8 lg:border-l lg:border-t-0 lg:px-12">
          <div className="w-full max-w-md">
            <AuthLayout as="div" title={formTitle} className="min-h-0 w-full">
              {children}
            </AuthLayout>
            <p className="mt-8 text-center text-xs text-[var(--sj-ink-soft)]">
              <Link href="/privacy" tone="secondary">Privacy</Link>
              <span aria-hidden="true"> · </span>
              <Link href="/terms" tone="secondary">Terms</Link>
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
