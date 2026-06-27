import type { Route } from "./+types/sitemap.xml";
import { getRequestDb } from "~/lib/route-platform.server";
import { resolveIssuerOrigin } from "~/lib/oauth-metadata.server";
import { buildSitemapXml, type SitemapEntry } from "~/lib/sitemap.server";

// Public, indexable static pages.
const STATIC_PATHS = ["/", "/privacy", "/terms", "/developers", "/api/docs"];

// Cap per entity type. The app is well under this today; if any type ever
// approaches the 50k sitemap limit, split this into a sitemap index by type.
const MAX_PER_TYPE = 5000;

export async function loader({ request, context }: Route.LoaderArgs) {
  const origin = resolveIssuerOrigin(request.url, context.cloudflare?.env?.SPOONJOY_BASE_URL);
  const database = await getRequestDb(context);

  const [recipes, cookbooks, chefs] = await Promise.all([
    // Only recipes with real content (at least one step) — skips thin drafts.
    database.recipe.findMany({
      where: { deletedAt: null, steps: { some: {} } },
      select: { id: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: MAX_PER_TYPE,
    }),
    // Only non-empty cookbooks.
    database.cookbook.findMany({
      where: { recipes: { some: {} } },
      select: { id: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: MAX_PER_TYPE,
    }),
    // Only chefs who have at least one indexable recipe.
    database.user.findMany({
      where: { recipes: { some: { deletedAt: null, steps: { some: {} } } } },
      select: { username: true },
      take: MAX_PER_TYPE,
    }),
  ]);

  const entries: SitemapEntry[] = [
    ...STATIC_PATHS.map((path) => ({ loc: `${origin}${path}` })),
    ...recipes.map((recipe) => ({
      loc: `${origin}/recipes/${recipe.id}`,
      lastmod: recipe.updatedAt.toISOString(),
    })),
    ...cookbooks.map((cookbook) => ({
      loc: `${origin}/cookbooks/${cookbook.id}`,
      lastmod: cookbook.updatedAt.toISOString(),
    })),
    ...chefs.map((chef) => ({
      loc: `${origin}/users/${encodeURIComponent(chef.username)}`,
    })),
  ];

  return new Response(buildSitemapXml(entries), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
