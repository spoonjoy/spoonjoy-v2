import type { Route } from "./+types/robots.txt";
import { resolveIssuerOrigin } from "~/lib/oauth-metadata.server";

// Private or non-content paths kept out of the index.
const DISALLOWED = [
  "/account/",
  "/api/",
  "/oauth/",
  "/auth/",
  "/login",
  "/signup",
  "/logout",
  "/shopping-list",
  "/search",
  "/developers/playground",
];

export async function loader({ request, context }: Route.LoaderArgs) {
  const origin = resolveIssuerOrigin(request.url, context.cloudflare?.env?.SPOONJOY_BASE_URL);
  const body = [
    "User-agent: *",
    "Allow: /",
    ...DISALLOWED.map((path) => `Disallow: ${path}`),
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
