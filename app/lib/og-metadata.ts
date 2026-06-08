export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

export interface RecipeOgInput {
  title: string;
  description: string | null;
  chefUsername: string;
  servingsLabel: string | null;
  coverImageUrl: string | null;
}

export interface CookbookOgInput {
  title: string;
  authorUsername: string;
  recipeCount: number;
  coverImageUrls: Array<string | null>;
}

export interface PageOgInput {
  slug: string;
  eyebrow: string;
  title: string;
  description: string;
  highlights: string[];
}

export const PAGE_OG_CARDS = {
  api: {
    slug: "api",
    eyebrow: "API v1",
    title: "Spoonjoy Developer Platform",
    description: "Build clients on Spoonjoy's public Chef graph, REST API, OAuth, MCP, session auth, and bearer credentials.",
    highlights: ["REST API", "OAuth/PKCE", "MCP", "Playground"],
  },
  "api-playground": {
    slug: "api-playground",
    eyebrow: "Generated playground",
    title: "Spoonjoy API Playground",
    description: "Try every Spoonjoy API v1, OAuth, delegated approval, and MCP operation from the generated developer playground.",
    highlights: ["Session auth", "Bearer tests", "PKCE helper", "OpenAPI"],
  },
} satisfies Record<string, PageOgInput>;

export function absoluteUrlFromRequest(requestUrl: string, value: string): string;
export function absoluteUrlFromRequest(requestUrl: string, value: string | null): string | null;
export function absoluteUrlFromRequest(requestUrl: string, value: string | null) {
  if (!value) return null;
  try {
    return new URL(value, requestUrl).toString();
  } catch {
    return value;
  }
}

export function absoluteUrlFromPreferredBase({
  requestUrl,
  baseUrl,
  path,
  fallbackBaseUrl = "https://spoonjoy.app",
}: {
  requestUrl?: string;
  baseUrl?: string | null;
  path: string;
  fallbackBaseUrl?: string;
}) {
  const preferredBaseUrl = baseUrl?.trim() || requestUrl || fallbackBaseUrl;
  return absoluteUrlFromRequest(preferredBaseUrl, path);
}

export function recipeOgPath(recipeId: string) {
  return `/og/recipes/${encodeURIComponent(recipeId)}.png`;
}

export function cookbookOgPath(cookbookId: string) {
  return `/og/cookbooks/${encodeURIComponent(cookbookId)}.png`;
}

export function pageOgPath(slug: string) {
  return `/og/pages/${encodeURIComponent(slug)}.png`;
}

export function pageOgInput(slug: string): PageOgInput | null {
  return PAGE_OG_CARDS[slug as keyof typeof PAGE_OG_CARDS] ?? null;
}
