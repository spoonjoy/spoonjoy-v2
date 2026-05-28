/**
 * WebAuthn (passkey) client flows.
 *
 * Browser-side orchestration that talks to the `/auth/webauthn/*` endpoints
 * and drives `navigator.credentials` via `@simplewebauthn/browser`.
 *
 * `fetch` and the `@simplewebauthn/browser` functions are injectable so the
 * flow logic is unit-testable without a real authenticator or network.
 */

import {
  startAuthentication as defaultStartAuthentication,
  startRegistration as defaultStartRegistration,
  browserSupportsWebAuthn as defaultBrowserSupportsWebAuthn,
} from "@simplewebauthn/browser";

export type PasskeyResult =
  | { ok: true; redirectTo?: string }
  | { ok: false; error: string };

export interface RegisterPasskeyDeps {
  fetchImpl?: typeof fetch;
  startRegistration?: typeof defaultStartRegistration;
}

export interface AuthenticatePasskeyDeps {
  fetchImpl?: typeof fetch;
  startAuthentication?: typeof defaultStartAuthentication;
}

export function browserSupportsPasskeys(
  supports: typeof defaultBrowserSupportsWebAuthn = defaultBrowserSupportsWebAuthn,
): boolean {
  try {
    return supports();
  } catch {
    return false;
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error || `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

/**
 * Register a new passkey for the logged-in user.
 * 1. fetch registration options
 * 2. prompt the authenticator (startRegistration)
 * 3. post the attestation for verification
 */
export async function registerPasskey(deps: RegisterPasskeyDeps = {}): Promise<PasskeyResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const startReg = deps.startRegistration ?? defaultStartRegistration;

  const optionsResponse = await fetchImpl("/auth/webauthn/register/options", { method: "POST" });
  if (!optionsResponse.ok) {
    return { ok: false, error: await readError(optionsResponse) };
  }
  const optionsJSON = await optionsResponse.json();

  let attestation;
  try {
    attestation = await startReg({ optionsJSON });
  } catch (error) {
    return { ok: false, error: passkeyCeremonyError(error) };
  }

  const verifyResponse = await fetchImpl("/auth/webauthn/register/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response: attestation }),
  });
  if (!verifyResponse.ok) {
    return { ok: false, error: await readError(verifyResponse) };
  }

  return { ok: true };
}

/**
 * Sign in with a passkey (username-first).
 * 1. fetch authentication options for the email
 * 2. prompt the authenticator (startAuthentication)
 * 3. post the assertion for verification; on success a session cookie is set
 */
export async function authenticatePasskey(
  email: string,
  redirectTo: string | undefined,
  deps: AuthenticatePasskeyDeps = {},
): Promise<PasskeyResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const startAuth = deps.startAuthentication ?? defaultStartAuthentication;

  const optionsResponse = await fetchImpl("/auth/webauthn/authenticate/options", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!optionsResponse.ok) {
    return { ok: false, error: await readError(optionsResponse) };
  }
  const optionsJSON = await optionsResponse.json();

  let assertion;
  try {
    assertion = await startAuth({ optionsJSON });
  } catch (error) {
    return { ok: false, error: passkeyCeremonyError(error) };
  }

  const verifyResponse = await fetchImpl("/auth/webauthn/authenticate/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, response: assertion, redirectTo }),
  });
  if (!verifyResponse.ok) {
    return { ok: false, error: await readError(verifyResponse) };
  }

  const body = (await verifyResponse.json()) as { redirectTo?: string };
  return { ok: true, redirectTo: body.redirectTo };
}

function passkeyCeremonyError(error: unknown): string {
  // The browser SDK throws a DOMException (NotAllowedError) when the user
  // cancels or the ceremony times out. Surface a friendly message rather
  // than the raw error.
  if (error instanceof Error && error.name === "NotAllowedError") {
    return "Passkey prompt was dismissed or timed out.";
  }
  return error instanceof Error ? error.message : "Passkey ceremony failed.";
}
