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

/** Spoonjoy's own 1200×630 PNG card, for pages with no photo a link preview can show. */
export const SOCIAL_CARD_PATH = "/og/spoonjoy-home.png";

/**
 * Whether a link preview can show this image. iMessage, Slack, Facebook, X and LinkedIn don't
 * render SVG, which is what the /og/* card routes and placeholder covers are, so only photos count.
 */
export function isRasterImageUrl(url: string | null | undefined): url is string {
  if (!url || url.startsWith("data:")) return false;
  const path = url.split(/[?#]/)[0].toLowerCase();
  return !path.endsWith(".svg") && !path.includes("/og/");
}

/** The share image for a page: its first showable photo, made absolute, or Spoonjoy's card. */
export function shareImageUrl(origin: string, photoUrls: Array<string | null | undefined>): string {
  const photo = photoUrls.find(isRasterImageUrl);
  return absoluteUrlFromRequest(origin, photo ?? SOCIAL_CARD_PATH);
}

/** Open Graph and X image tags. Only the card's size is known; crawlers measure a photo themselves. */
export function shareImageMeta(imageUrl: string) {
  const isCard = new URL(imageUrl).pathname === SOCIAL_CARD_PATH;
  return [
    { property: "og:image", content: imageUrl },
    ...(isCard
      ? [
          { property: "og:image:width", content: String(OG_IMAGE_WIDTH) },
          { property: "og:image:height", content: String(OG_IMAGE_HEIGHT) },
          { property: "og:image:type", content: "image/png" },
        ]
      : []),
    { name: "twitter:image", content: imageUrl },
  ];
}
