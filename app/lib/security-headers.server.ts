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
 *   clickjacking. (Kept alongside, not replaced by, a future CSP.)
 * - `Referrer-Policy` — send only the origin on cross-origin navigations.
 * - `Permissions-Policy` — drop powerful features the app doesn't use. It
 *   intentionally does NOT touch `publickey-credentials-*`, so passkeys keep
 *   their default `self` allowance.
 *
 * A Content-Security-Policy is deliberately out of scope here: a useful CSP
 * needs nonce/hash handling for the SSR hydration scripts plus a report sink,
 * so it belongs in its own change rather than bolted on report-only with
 * nowhere to report.
 */

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

/**
 * Return a copy of `response` with the baseline security headers added.
 *
 * Rebuilds the response so a streamed SSR body, a redirect (null body +
 * `Location`), or an immutable `Response.redirect` result all pick the headers
 * up uniformly. Existing headers are preserved; the security headers win on
 * any key collision.
 */
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
