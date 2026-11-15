/**
 * Sign-in outcomes per account.
 *
 * Every sign-in path (web password, passkey, Apple/Google/GitHub on the web, and
 * the native Apple and password exchanges) reports one
 * `spoonjoy.auth.sign_in_succeeded` or `spoonjoy.auth.sign_in_failed` event, so
 * "has this person got back in?" is a PostHog query rather than a guess.
 *
 * Identity rules:
 *   - success: distinct id is the account id.
 *   - failure: the account id when the identifier matched an account, else the
 *     native install id (`native_install:<id>`), else a shared anonymous id.
 *     The raw email or username is never sent.
 *   - a native success that carries an install id also links that install's
 *     earlier anonymous events to the account (`$identify`).
 */

export const SIGN_IN_SUCCEEDED_EVENT = "spoonjoy.auth.sign_in_succeeded";
export const SIGN_IN_FAILED_EVENT = "spoonjoy.auth.sign_in_failed";

export type SignInOutcomeMethod = "password" | "passkey" | "apple" | "google" | "github";
export type SignInPlatform = "web" | "ios" | "macos" | "native";

/** Captures one controlled `spoonjoy.*` event; the auth telemetry sink's `captureEvent` fits. */
export type SignInEventCapture = (event: string, distinctId: string, properties: Record<string, unknown>) => void;
/** Links an anonymous id's earlier events to an account. */
export type SignInIdentifyCapture = (distinctId: string, anonDistinctId: string) => void;

export interface SignInClient {
  platform: SignInPlatform;
  appVersion?: string | null;
  installId?: string | null;
}

export interface SignInSuccess extends SignInClient {
  method: SignInOutcomeMethod;
  userId: string;
  newAccount?: boolean;
}

export interface SignInFailure extends SignInClient {
  method: SignInOutcomeMethod;
  /** A stable machine code (`invalid_credentials`, `rate_limited`, `invalid_state`, ...), never free text. */
  failureReason: string;
  /** The account the typed identifier matched, when it matched one. */
  matchedUserId?: string | null;
}

export function nativeInstallDistinctId(installId: string): string {
  return `native_install:${installId}`;
}

function clientProperties(client: SignInClient) {
  return {
    platform: client.platform,
    app_version: client.appVersion ?? null,
    install_id: client.installId ?? null,
  };
}

export function recordSignInSucceeded(
  capture: SignInEventCapture,
  success: SignInSuccess,
  identify?: SignInIdentifyCapture,
): void {
  capture(SIGN_IN_SUCCEEDED_EVENT, success.userId, {
    method: success.method,
    ...clientProperties(success),
    new_account: success.newAccount ?? false,
  });
  if (success.installId && identify) {
    identify(success.userId, nativeInstallDistinctId(success.installId));
  }
}

export function recordSignInFailed(capture: SignInEventCapture, failure: SignInFailure): void {
  const distinctId = failure.matchedUserId
    ?? (failure.installId
      ? nativeInstallDistinctId(failure.installId)
      : failure.platform === "web" ? "anonymous_web_sign_in" : "anonymous_native_app");
  capture(SIGN_IN_FAILED_EVENT, distinctId, {
    method: failure.method,
    ...clientProperties(failure),
    failure_reason: failure.failureReason,
    account_matched: Boolean(failure.matchedUserId),
  });
}
