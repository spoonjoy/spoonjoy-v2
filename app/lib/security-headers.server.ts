/**
 * Baseline security response headers, applied to every Worker response.
 *
 * Deliberately the well-understood, low-risk set — nothing here depends on
 * per-page nonces or can silently break a sub-resource:
 *
 * - `Strict-Transport-Security` — pin HTTPS for two years (incl. subdomains).
 *   Ignored by browsers over plain HTTP, so local dev is unaffected.
 * - `X-Content-Type-Options: nosniff` — stop MIME sniffing.
 * - `X-Frame-Options: DENY` — Spoonjoy is never meant to be framed; blocks
 *   clickjacking. (Kept alongside, not replaced by, the CSP.)
 * - `Referrer-Policy` — send only the origin on cross-origin navigations.
 * - `Permissions-Policy` — drop powerful features the app doesn't use. It
 *   intentionally does NOT touch `publickey-credentials-*`, so passkeys keep
 *   their default `self` allowance.
 * - `Content-Security-Policy-Report-Only` — the first, non-enforcing pass of a
 *   CSP (see {@link CSP_REPORT_ONLY}). Report-only never blocks a request; it
 *   only sends violation reports to `/csp-report`, so it is safe to ship before
 *   the app is fully CSP-clean. It keeps `'unsafe-inline'` on `script-src`/
 *   `style-src` because the SSR hydration emits an inline bootstrap script and
 *   inline styles are still in use. Enforcing the policy and replacing
 *   `'unsafe-inline'` with per-request SSR nonces is the documented follow-up.
 */

/**
 * Allowed sources for the report-only Content-Security-Policy, keyed by
 * directive. Each non-`self` origin is justified against a real dependency:
 *
 * - PostHog analytics (`app/lib/analytics.ts`, `app/lib/analytics-server.ts`,
 *   `app/entry.client.tsx`): `us-assets.i.posthog.com` serves the JS bundle and
 *   session-recorder assets; `us.i.posthog.com` is the ingestion endpoint.
 * - Google Fonts (`app/root.tsx`): the stylesheet is served from
 *   `fonts.googleapis.com`, the font files from `fonts.gstatic.com`.
 * - Landing imagery (`app/routes/_index.tsx`) plus recipe covers and avatars
 *   come from varied hosts, so `img-src` stays deliberately broad (`https:`)
 *   for the report-only pass and is tightened later.
 *
 * `'unsafe-inline'` on `script-src`/`style-src` is intentional for this pass —
 * the enforce follow-up swaps it for SSR nonces.
 */
const CSP_DIRECTIVES: Readonly<Record<string, readonly string[]>> = {
  "default-src": ["'self'"],
  "base-uri": ["'self'"],
  "object-src": ["'none'"],
  "frame-ancestors": ["'none'"],
  "form-action": ["'self'"],
  "script-src": ["'self'", "'unsafe-inline'", "https://us-assets.i.posthog.com"],
  "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  "font-src": ["'self'", "https://fonts.gstatic.com"],
  "img-src": ["'self'", "data:", "blob:", "https:"],
  "connect-src": ["'self'", "https://us.i.posthog.com", "https://us-assets.i.posthog.com"],
  "report-uri": ["/csp-report"],
};

/**
 * The serialized report-only Content-Security-Policy header value, built from
 * {@link CSP_DIRECTIVES}.
 */
export const CSP_REPORT_ONLY: string = Object.entries(CSP_DIRECTIVES)
  .map(([directive, sources]) => [directive, ...sources].join(" "))
  .join("; ");

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy-Report-Only": CSP_REPORT_ONLY,
};

/**
 * Return a copy of `response` with the baseline security headers added.
 *
 * Rebuilds the response so a streamed SSR body, a redirect (null body +
 * `Location`), or an immutable `Response.redirect` result all pick the headers
 * up uniformly. Existing headers are preserved; the security headers win on
 * any key collision, except an explicit `Referrer-Policy: no-referrer`, which
 * is stricter than the baseline for sensitive callback routes.
 */
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (name === "Referrer-Policy" && headers.get(name)?.trim().toLowerCase() === "no-referrer") {
      continue;
    }
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
