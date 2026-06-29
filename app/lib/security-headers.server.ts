/**
 * Baseline security response headers + a report-only Content-Security-Policy,
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
 * `Content-Security-Policy-Report-Only` is built per-request by
 * {@link buildContentSecurityPolicy}. It is still NON-enforcing (report-only):
 * it never blocks a request, only POSTs violations to `/csp-report`.
 *
 * `script-src` is **nonce-based**: a per-request nonce ({@link generateNonce},
 * generated once in `workers/app.ts`) is threaded both into this header AND into
 * the SSR shell's inline `<script>`s (theme-flash guard + React Router's
 * `<Scripts>`/`<ScrollRestoration>`, via `AppLoadContext` → `NonceContext`), and
 * `'unsafe-inline'` is dropped from `script-src`. Under report-only this surfaces
 * any inline script lacking the nonce (e.g. a third-party snippet) before
 * enforcing. `style-src` deliberately KEEPS `'unsafe-inline'`: a CSP nonce covers
 * `<style>` elements but NOT inline `style="…"` attributes, which React emits
 * everywhere — so a nonce cannot replace `'unsafe-inline'` for styles. Flipping
 * report-only → enforce is the remaining follow-up, after a clean report-only
 * window confirms nothing legitimate is blocked.
 */

/**
 * CSP directives, keyed in serialization order. `script-src` varies with the
 * per-request `nonce`; every other directive is static. Each non-`self` origin
 * is justified against a real dependency: PostHog (`us-assets.i.posthog.com`
 * bundle, `us.i.posthog.com` ingest), Google Fonts (`fonts.googleapis.com`
 * stylesheet, `fonts.gstatic.com` files). `img-src` stays broad (`https:`) for
 * the report-only pass and is tightened later.
 */
function cspDirectives(nonce?: string): Record<string, readonly string[]> {
  return {
    "default-src": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "form-action": ["'self'"],
    "script-src": nonce
      ? ["'self'", `'nonce-${nonce}'`, "https://us-assets.i.posthog.com"]
      : ["'self'", "https://us-assets.i.posthog.com"],
    "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    "font-src": ["'self'", "https://fonts.gstatic.com"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "connect-src": ["'self'", "https://us.i.posthog.com", "https://us-assets.i.posthog.com"],
    "report-uri": ["/csp-report"],
  };
}

/**
 * Serialize the report-only CSP for a response. Pass the per-request `nonce` for
 * HTML renders (so the SSR inline scripts validate); omit it for non-HTML
 * responses (redirects, CORS preflight, resource routes) which carry no inline
 * script and therefore need no nonce in `script-src`.
 */
export function buildContentSecurityPolicy(nonce?: string): string {
  return Object.entries(cspDirectives(nonce))
    .map(([directive, sources]) => [directive, ...sources].join(" "))
    .join("; ");
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
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

/**
 * Return a copy of `response` with the baseline security headers + the
 * report-only CSP added. Pass the per-request `nonce` for HTML renders so the
 * CSP's nonce-based `script-src` matches the SSR inline-script nonces.
 *
 * Rebuilds the response so a streamed SSR body, a redirect (null body +
 * `Location`), or an immutable `Response.redirect` result all pick the headers
 * up uniformly. Existing headers are preserved; the security headers win on
 * any key collision.
 */
export function withSecurityHeaders(response: Response, nonce?: string): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  headers.set(
    "Content-Security-Policy-Report-Only",
    buildContentSecurityPolicy(nonce),
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
