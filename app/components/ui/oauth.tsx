import clsx from 'clsx'
import { Button } from './button'

export type OAuthProvider = 'google' | 'github' | 'apple'

const providerStyles: Record<OAuthProvider, { label: string }> = {
  google: {
    label: 'Continue with Google',
  },
  github: {
    label: 'Continue with GitHub',
  },
  apple: {
    label: 'Continue with Apple',
  },
}

interface OAuthButtonProps {
  provider: OAuthProvider
  className?: string
  /**
   * Where to return after sign-in (e.g. the connector's /oauth/authorize URL).
   * Carried explicitly in the form action so it survives even when the Referer
   * header is stripped (in-app browsers, strict referrer policies) — relying on
   * the Referer dropped users on /recipes instead of back where they started.
   */
  redirectTo?: string
}

export function OAuthButton({ provider, className, redirectTo }: OAuthButtonProps) {
  const { label } = providerStyles[provider]

  // Native GET navigation — deliberately NOT POST. Spoonjoy's service worker
  // (public/sw.js) calls clients.claim(), so it controls every open page. A
  // controlled client aborts a top-level navigation whose response is a
  // *cross-origin* redirect (net::ERR_ABORTED) — which is exactly what OAuth
  // start returns (302 to appleid.apple.com / accounts.google.com / github.com).
  // The SW resolves GET navigations in-worker via respondWith(fetch(...)), so a
  // GET reaches the provider; a POST was bypassed by the SW and hit the native
  // path that aborts. redirectTo rides as a query param (serialized from the
  // hidden input, so it survives Referer stripping) and the route's loader reads
  // it from the query exactly as the old POST action did.
  return (
    <form action={`/auth/${provider}`} method="get">
      {redirectTo ? <input type="hidden" name="redirectTo" value={redirectTo} /> : null}
      <Button type="submit" className={clsx('w-full', className)}>
        {label}
      </Button>
    </form>
  )
}

interface OAuthDividerProps {
  className?: string
}

export function OAuthDivider({ className }: OAuthDividerProps) {
  return (
    <div
      data-testid="oauth-separator"
      className={clsx('flex items-center', className)}
    >
      <div className="flex-1 border-t border-[var(--sj-border)]" />
      <span className="px-4 text-sm text-[var(--sj-ink-soft)]">or</span>
      <div className="flex-1 border-t border-[var(--sj-border)]" />
    </div>
  )
}

interface OAuthButtonGroupProps {
  providers?: OAuthProvider[]
  className?: string
  redirectTo?: string
}

export function OAuthButtonGroup({ providers = ['google', 'github', 'apple'], className, redirectTo }: OAuthButtonGroupProps) {
  if (providers.length === 0) return null

  return (
    <div className={clsx('flex flex-col gap-3', className)}>
      {providers.map((provider) => (
        <OAuthButton key={provider} provider={provider} redirectTo={redirectTo} />
      ))}
    </div>
  )
}

interface OAuthErrorProps {
  error: string | undefined
  className?: string
}

export function OAuthError({ error, className }: OAuthErrorProps) {
  if (!error) return null

  const messages: Record<string, string> = {
    account_exists: 'An account with this email already exists. Please log in to link your account.',
    email_required: 'An email address is required to create an account. Please allow email access and try again.',
    email_unverified: 'Your OAuth provider must return a verified email address before Spoonjoy can use it for sign-in.',
    invalid_state: 'Your OAuth session expired or could not be verified. Please try again.',
    invalid_code: 'The OAuth provider did not return a usable authorization code. Please try again.',
    invalid_code_verifier: 'Your OAuth security verifier was missing. Please try again.',
    invalid_request: 'That OAuth callback method is not supported. Please start sign-in again.',
    login_required: 'Please log in before linking a new OAuth provider.',
    oauth_unconfigured: 'OAuth is not configured for this environment yet. Email/password login still works.',
    provider_account_taken: 'That OAuth account is already linked to another Spoonjoy account.',
    provider_already_linked: 'That OAuth provider is already linked to your account.',
  }

  const message = messages[error] ?? 'Something went wrong. Please try again.'

  return (
    <div
      role="alert"
      className={clsx(
        'rounded-[var(--sj-radius-small)] border border-[var(--sj-tomato)] bg-[color-mix(in_srgb,var(--sj-tomato)_10%,var(--sj-panel-solid))] p-3 text-sm text-[var(--sj-tomato)]',
        className
      )}
    >
      {message}
    </div>
  )
}
