/**
 * Baseline security response headers + a mode-controlled Content-Security-Policy,
 * applied to every Worker response by {@link withSecurityHeaders}.
 *
 * Static headers (never depend on per-request state):
 * - `Strict-Transport-Security` — pin HTTPS for two years (incl. subdomains).
 *   Ignored by browsers over plain HTTP, so local dev is unaffected.
 * - `X-Content-Type-Options: nosniff` — stop MIME sniffing.
 * - `X-Frame-Options: DENY` — Spoonjoy is never meant to be framed; blocks
 *   clickjacking. (Kept alongside, not replaced by, the CSP.)
 * - `Referrer-Policy` — send only the origin on cross-origin navigations.
 * - `Permissions-Policy` — drop powerful features the app doesn't use. It
 *   intentionally does NOT touch `publickey-credentials-*`, so passkeys keep
 *   their default `self` allowance.
 *
 * `SPOONJOY_CSP_MODE=enforce` emits `Content-Security-Policy`; other runtime
 * values emit `Content-Security-Policy-Report-Only`, which deployment
 * preflight allows for production/QA only through the auditable break-glass
 * rollback path.
 *
 * `script-src` is **nonce-based**: a per-request nonce ({@link generateNonce},
 * generated once in `workers/app.ts`) is threaded both into this header AND into
 * the SSR shell's inline `<script>`s (theme-flash guard + React Router's
 * `<Scripts>`/`<ScrollRestoration>`, via `AppLoadContext` → `NonceContext`), and
 * `'unsafe-inline'` is dropped from `script-src`. Under report-only this surfaces
 * any inline script lacking the nonce (e.g. a third-party snippet) before
 * enforcing. `style-src` deliberately KEEPS `'unsafe-inline'`: a CSP nonce covers
 * `<style>` elements but NOT inline `style="…"` attributes, which React emits
 * everywhere — so a nonce cannot replace `'unsafe-inline'` for styles.
 */

/**
 * CSP directives, keyed in serialization order. `script-src` varies with the
 * per-request `nonce`; every other directive is static except PostHog origins.
 * Each non-`self` origin is justified against a real dependency: PostHog
 * (configured ingestion + asset origins), Google Fonts (`fonts.googleapis.com`
 * stylesheet, `fonts.gstatic.com` files). `img-src` stays broad (`https:`)
 * because legacy/imported recipe and profile images can still be external.
 */
const DEFAULT_POSTHOG_INGEST_ORIGIN = "https://us.i.posthog.com";
const DEFAULT_POSTHOG_ASSETS_ORIGIN = "https://us-assets.i.posthog.com";

interface PostHogCspEnv {
  VITE_POSTHOG_HOST?: string | null;
}

export interface PostHogCspOrigins {
  ingestOrigin: string;
  assetsOrigin: string;
}

interface WranglerPostHogEnvironment {
  vars?: unknown;
}

interface WranglerPostHogConfig extends WranglerPostHogEnvironment {
  env?: unknown;
}

function safeHttpsOrigin(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;

  if (/\s/.test(value) || !URL.canParse(value)) {
    return null;
  }

  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname) {
    return null;
  }
  return url.origin;
}

function postHogAssetsOriginFor(ingestOrigin: string): string {
  const url = new URL(ingestOrigin);
  const postHogIngest = url.hostname.match(/^([a-z0-9-]+)\.i\.posthog\.com$/i);
  if (postHogIngest) {
    return `https://${postHogIngest[1].toLowerCase()}-assets.i.posthog.com`;
  }
  return ingestOrigin;
}

export function resolvePostHogCspOrigins(env?: PostHogCspEnv | null): PostHogCspOrigins {
  const ingestOrigin = safeHttpsOrigin(env?.VITE_POSTHOG_HOST) ?? DEFAULT_POSTHOG_INGEST_ORIGIN;
  return {
    ingestOrigin,
    assetsOrigin: postHogAssetsOriginFor(ingestOrigin),
  };
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function resolvePostHogBuildHost(
  wrangler: WranglerPostHogConfig,
  environment?: string,
): string {
  const root = objectValue(wrangler);
  const environmentConfig = environment
    ? objectValue(objectValue(root?.env)?.[environment])
    : root;
  if (!environmentConfig) {
    throw new Error(`Wrangler environment ${environment ?? "production"} is missing.`);
  }

  const configured = objectValue(environmentConfig.vars)?.VITE_POSTHOG_HOST;
  const raw = typeof configured === "string" ? configured.trim() : "";
  const origin = safeHttpsOrigin(raw);
  if (!origin || raw !== origin) {
    throw new Error(
      `Wrangler environment ${environment ?? "production"} must define an origin-only HTTPS VITE_POSTHOG_HOST.`,
    );
  }
  return origin;
}

function uniqueSources(sources: readonly string[]): readonly string[] {
  return Array.from(new Set(sources));
}

function cspDirectives(
  nonce?: string,
  env?: PostHogCspEnv | null,
): Record<string, readonly string[]> {
  const postHog = resolvePostHogCspOrigins(env);
  return {
    "default-src": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "form-action": ["'self'"],
    "script-src": nonce
      ? uniqueSources(["'self'", `'nonce-${nonce}'`, postHog.assetsOrigin])
      : uniqueSources(["'self'", postHog.assetsOrigin]),
    "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    "font-src": ["'self'", "https://fonts.gstatic.com"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "connect-src": uniqueSources(["'self'", postHog.ingestOrigin, postHog.assetsOrigin]),
    "report-uri": ["/csp-report"],
    // Modern Reporting API: `report-to` names a group defined by the
    // `Reporting-Endpoints` response header (see SECURITY_HEADERS). Kept
    // alongside the deprecated-but-still-supported `report-uri` so violations
    // are reported across both legacy and current browsers (Chrome has
    // deprecated `report-uri`) during the report-only window.
    "report-to": ["csp-endpoint"],
  };
}

/**
 * Serialize the CSP for a response. Pass the per-request `nonce` for
 * HTML renders (so the SSR inline scripts validate); omit it for non-HTML
 * responses (redirects, CORS preflight, resource routes) which carry no inline
 * script and therefore need no nonce in `script-src`.
 */
export function buildContentSecurityPolicy(
  nonce?: string,
  env?: PostHogCspEnv | null,
): string {
  return Object.entries(cspDirectives(nonce, env))
    .map(([directive, sources]) => [directive, ...sources].join(" "))
    .join("; ");
}

export type ContentSecurityPolicyMode = "enforce" | "report-only";

interface ContentSecurityPolicyEnv {
  SPOONJOY_CSP_MODE?: string | null;
  VITE_POSTHOG_HOST?: string | null;
}

export function resolveContentSecurityPolicyMode(
  env?: ContentSecurityPolicyEnv | null,
): ContentSecurityPolicyMode {
  return env?.SPOONJOY_CSP_MODE?.trim().toLowerCase() === "enforce"
    ? "enforce"
    : "report-only";
}

/**
 * A fresh per-request CSP nonce: 16 cryptographically-random bytes, base64.
 * Generated once per request in `workers/app.ts` and used for BOTH the CSP
 * `script-src` here and the SSR inline `<script>` nonces (threaded via
 * `AppLoadContext`), so the two always match.
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** Static, nonce-independent security headers. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  // Isolate the browsing context from cross-origin windows (defense-in-depth vs
  // tabnabbing / cross-window XS-Leaks). `allow-popups` keeps any popups the app
  // opens working; Spoonjoy uses redirect-based OAuth and `noopener` popups, so
  // it never relies on a cross-origin `window.opener`.
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  // Defines the `csp-endpoint` reporting group named by the CSP `report-to`
  // directive — points modern browsers' Reporting API at the same sink route.
  "Reporting-Endpoints": 'csp-endpoint="/csp-report"',
};

/**
 * Return a copy of `response` with the baseline security headers + the selected
 * CSP mode added. Pass the per-request `nonce` for HTML renders so the CSP's
 * nonce-based `script-src` matches the SSR inline-script nonces.
 *
 * Rebuilds the response so a streamed SSR body, a redirect (null body +
 * `Location`), or an immutable `Response.redirect` result all pick the headers
 * up uniformly. Existing headers are preserved; the security headers win on
 * any key collision, except an explicit `Referrer-Policy: no-referrer`, which
 * is stricter than the baseline for sensitive callback routes.
 */
export function withSecurityHeaders(
  response: Response,
  nonce?: string,
  env?: ContentSecurityPolicyEnv | null,
): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (name === "Referrer-Policy" && headers.get(name)?.trim().toLowerCase() === "no-referrer") {
      continue;
    }
    headers.set(name, value);
  }
  const cspHeaderName = resolveContentSecurityPolicyMode(env) === "enforce"
    ? "Content-Security-Policy"
    : "Content-Security-Policy-Report-Only";
  headers.delete("Content-Security-Policy");
  headers.delete("Content-Security-Policy-Report-Only");
  headers.set(cspHeaderName, buildContentSecurityPolicy(nonce, env));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
