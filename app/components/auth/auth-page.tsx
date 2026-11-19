import type React from 'react'
import { Link } from '~/components/ouro/link/link'
import { Heading } from '~/components/ouro/text/heading'

interface AuthLayoutProps {
  children: React.ReactNode
  formTitle: string
  /**
   * Editorial copy for the lead. Defaults to the sign-in voice used
   * by /login. Sign-up and the connector consent screen (/oauth/authorize) pass
   * their own so a signed-in user authorizing an app never reads "Sign in to…".
   */
  eyebrow?: string
  title?: string
  description?: string
}

/**
 * The one-book sign-in page (desk target.md, Sign-in): web's editorial lead (eyebrow, Fraunces
 * title, one serif sentence), then the form straight on the paper, as the Apple app draws it,
 * with no card around it. On a wide window the lead and the form sit side by side.
 */
export function AuthPage({
  children,
  formTitle,
  eyebrow = 'Kitchen sign-in',
  title = 'Keep the good recipes close.',
  description = 'Sign in to cook, fork, save, and remember the recipes that actually make it to your table.',
}: AuthLayoutProps) {
  // Wrap in <div>, not <main>: root.tsx already renders a single <main id="main">
  // around every page. Nesting another <main> here breaks landmark navigation.
  // The lead's title is <h2> so the form's title (like "Sign in") stays the
  // page's one <h1>. The navbar above already carries the Spoonjoy wordmark.
  return (
    <div className="sj-page min-h-dvh">
      <div className="mx-auto grid max-w-6xl lg:min-h-dvh lg:grid-cols-[minmax(0,0.92fr)_minmax(24rem,0.58fr)]" data-fold-halves="">
        <section className="flex flex-col justify-between px-5 pt-8 sm:px-8 lg:px-12 lg:py-7">
          <div className="max-w-2xl lg:py-16">
            <p className="sj-eyebrow">{eyebrow}</p>
            <h2 className="font-sj-display mt-3 text-4xl/11 font-semibold text-[var(--sj-ink)] sm:text-6xl/14">
              {title}
            </h2>
            <p className="mt-4 max-w-xl text-base/7 text-[var(--sj-ink-soft)]">
              {description}
            </p>
          </div>
          <p className="hidden border-t border-[var(--sj-border)] pt-4 text-sm text-[var(--sj-ink-soft)] lg:block">
            Your recipes, cookbooks and shopping list, on your phone and at the table.
          </p>
        </section>
        <section className="flex px-5 pt-8 pb-10 sm:px-8 lg:items-center lg:border-l lg:border-[var(--sj-border)] lg:px-12 lg:py-8">
          <div className="w-full max-w-md" data-auth-form="">
            <Heading level={1} size="lg">
              {formTitle}
            </Heading>
            <div className="mt-2">{children}</div>
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
