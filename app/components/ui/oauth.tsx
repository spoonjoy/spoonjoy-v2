import clsx from 'clsx'
import { Button } from './button'

export type OAuthProvider = 'google' | 'apple'

const providerStyles: Record<OAuthProvider, { label: string }> = {
  google: {
    label: 'Continue with Google',
  },
  apple: {
    label: 'Continue with Apple',
  },
}

interface OAuthButtonProps {
  provider: OAuthProvider
  className?: string
}

export function OAuthButton({ provider, className }: OAuthButtonProps) {
  const { label } = providerStyles[provider]

  return (
    <form action={`/auth/${provider}`} method="post">
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
}

export function OAuthButtonGroup({ providers = ['google', 'apple'], className }: OAuthButtonGroupProps) {
  if (providers.length === 0) return null

  return (
    <div className={clsx('flex flex-col gap-3', className)}>
      {providers.map((provider) => (
        <OAuthButton key={provider} provider={provider} />
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
