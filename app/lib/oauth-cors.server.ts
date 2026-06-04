const OAUTH_CORS_PATHS = new Set([
  "/oauth/register",
  "/oauth/token",
  "/oauth/revoke",
]);

export const OAUTH_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "Retry-After",
  "Access-Control-Max-Age": "86400",
} as const;

export function applyOAuthCorsHeaders(response: Response): Response {
  for (const [key, value] of Object.entries(OAUTH_CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

export function oauthCorsPreflightResponse(request: Request): Response | null {
  if (request.method !== "OPTIONS") return null;

  const { pathname } = new URL(request.url);
  if (!OAUTH_CORS_PATHS.has(pathname)) return null;

  return new Response(null, { status: 204, headers: OAUTH_CORS_HEADERS });
}
