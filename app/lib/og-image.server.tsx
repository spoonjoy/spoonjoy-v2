import {
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  type CookbookOgInput,
  type PageOgInput,
  type RecipeOgInput,
} from "~/lib/og-metadata";
export {
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  PAGE_OG_CARDS,
  absoluteUrlFromPreferredBase,
  absoluteUrlFromRequest,
  cookbookOgPath,
  pageOgInput,
  pageOgPath,
  recipeOgPath,
} from "~/lib/og-metadata";
export type { CookbookOgInput, PageOgInput, RecipeOgInput } from "~/lib/og-metadata";

const COLORS = {
  paper: "#f8f5ee",
  flour: "#eee7da",
  ink: "#28231d",
  inkSoft: "#655f55",
  brass: "#a66b2e",
  tomato: "#a84f3c",
  action: "#b66134",
  charcoal: "#211d18",
  white: "#fffdf8",
} as const;

const OG_HEADERS = {
  "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
};

const DYNAMIC_OG_HEADERS = {
  "Cache-Control": "public, no-cache, must-revalidate",
};

const SVG_CONTENT_TYPE = "image/svg+xml; charset=utf-8";

export interface OgExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export function recipeOgDescription(input: Pick<RecipeOgInput, "description" | "chefUsername">) {
  const description = input.description?.trim();
  return description && description.length > 0
    ? description
    : `A Spoonjoy recipe by ${input.chefUsername}.`;
}

export function cookbookRecipeLabel(recipeCount: number) {
  return `${recipeCount} ${recipeCount === 1 ? "recipe" : "recipes"}`;
}

function dynamicOgHeaders(cacheKey?: string) {
  if (!cacheKey) return OG_HEADERS;
  const etag = weakOgEtag(cacheKey);
  return {
    ...DYNAMIC_OG_HEADERS,
    ETag: etag,
    "X-Spoonjoy-OG-Cover-Key": etag,
  };
}

function weakOgEtag(cacheKey: string) {
  let hash = 2166136261;
  for (let index = 0; index < cacheKey.length; index += 1) {
    hash ^= cacheKey.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `W/"og-${(hash >>> 0).toString(16)}-${cacheKey.length}"`;
}

export async function createRecipeOgImageResponse(input: RecipeOgInput, _ctx?: OgExecutionContext, cacheKey?: string) {
  const description = recipeOgDescription(input);
  return svgResponse(createRecipeOgElement(input, description), dynamicOgHeaders(cacheKey));
}

export async function createCookbookOgImageResponse(input: CookbookOgInput, _ctx?: OgExecutionContext, cacheKey?: string) {
  const recipeLabel = cookbookRecipeLabel(input.recipeCount);
  return svgResponse(createCookbookOgElement(input, recipeLabel), dynamicOgHeaders(cacheKey));
}

export async function createPageOgImageResponse(input: PageOgInput, _ctx?: OgExecutionContext) {
  return svgResponse(createPageOgElement(input), OG_HEADERS);
}

export function createRecipeOgElement(input: RecipeOgInput, description: string) {
  const titleLines = wrapSvgLines(input.title, 14, 3);
  const descriptionLines = wrapSvgLines(description, 30, 4);
  const byline = ["By", input.chefUsername, input.servingsLabel].filter(Boolean).join("  /  ");

  return svgShell(input.title, [
    mediaPanelSvg({ imageUrl: input.coverImageUrl, title: input.title, fallbackLabel: "Recipe" }),
    `<rect x="624" y="0" width="576" height="630" fill="${COLORS.paper}" />`,
    textBlock({ lines: ["SPOONJOY RECIPE"], x: 686, y: 106, fontSize: 24, lineHeight: 24, weight: 700, fill: COLORS.brass, family: "ui", letterSpacing: 6 }),
    textBlock({ lines: titleLines, x: 686, y: 182, fontSize: 70, lineHeight: 66, weight: 800, fill: COLORS.ink, family: "display" }),
    `<rect x="686" y="386" width="5" height="118" fill="${COLORS.action}" />`,
    textBlock({ lines: descriptionLines, x: 710, y: 408, fontSize: 27, lineHeight: 36, weight: 500, fill: COLORS.inkSoft, family: "serif" }),
    textBlock({ lines: [byline.toUpperCase()], x: 686, y: 560, fontSize: 21, lineHeight: 21, weight: 700, fill: COLORS.inkSoft, family: "ui", letterSpacing: 3 }),
  ]);
}

export function createCookbookOgElement(input: CookbookOgInput, recipeLabel: string) {
  const images = input.coverImageUrls
    .filter((url): url is string => Boolean(url && url.length > 0))
    .slice(0, 4);
  const titleLines = wrapSvgLines(input.title, 14, 4);

  return svgShell(input.title, [
    `<rect x="0" y="0" width="624" height="630" fill="${COLORS.charcoal}" />`,
    images.length > 0 ? cookbookGridSvg(images) : cookbookFallbackSvg(input.title),
    `<rect x="624" y="0" width="576" height="630" fill="${COLORS.paper}" />`,
    textBlock({ lines: titleLines, x: 686, y: 190, fontSize: 72, lineHeight: 68, weight: 800, fill: COLORS.ink, family: "display" }),
    textBlock({ lines: [`BY ${input.authorUsername.toUpperCase()}`, recipeLabel.toUpperCase()], x: 686, y: 470, fontSize: 24, lineHeight: 40, weight: 700, fill: COLORS.inkSoft, family: "ui", letterSpacing: 3 }),
    `<rect x="686" y="548" width="220" height="5" fill="${COLORS.action}" />`,
  ]);
}

export function createPageOgElement(input: PageOgInput) {
  const displayUrl = input.slug === "api" ? "spoonjoy.app/api" : "spoonjoy.app/api/playground";
  const titleLines = wrapSvgLines(input.title, 16, 3);
  const descriptionLines = wrapSvgLines(input.description, 34, 4);

  return svgShell(input.title, [
    `<rect x="0" y="0" width="528" height="630" fill="${COLORS.charcoal}" />`,
    textBlock({ lines: [input.eyebrow.toUpperCase()], x: 54, y: 82, fontSize: 24, lineHeight: 24, weight: 700, fill: COLORS.brass, family: "ui", letterSpacing: 5 }),
    `<rect x="54" y="130" width="148" height="148" fill="none" stroke="${COLORS.brass}" stroke-width="2" />`,
    textBlock({ lines: ["sj"], x: 88, y: 236, fontSize: 86, lineHeight: 86, weight: 800, fill: COLORS.paper, family: "display" }),
    highlightsSvg(input.highlights),
    `<rect x="528" y="0" width="672" height="630" fill="${COLORS.paper}" />`,
    textBlock({ lines: ["SPOONJOY"], x: 598, y: 104, fontSize: 24, lineHeight: 24, weight: 700, fill: COLORS.brass, family: "ui", letterSpacing: 6 }),
    textBlock({ lines: titleLines, x: 598, y: 184, fontSize: 72, lineHeight: 70, weight: 800, fill: COLORS.ink, family: "display" }),
    `<rect x="598" y="396" width="5" height="118" fill="${COLORS.action}" />`,
    textBlock({ lines: descriptionLines, x: 622, y: 416, fontSize: 28, lineHeight: 37, weight: 500, fill: COLORS.inkSoft, family: "serif" }),
    textBlock({ lines: [displayUrl.toUpperCase()], x: 598, y: 568, fontSize: 22, lineHeight: 22, weight: 700, fill: COLORS.brass, family: "ui", letterSpacing: 3 }),
  ]);
}

function svgResponse(svg: string, headers: Record<string, string>) {
  return new Response(svg, {
    headers: {
      ...headers,
      "Content-Type": SVG_CONTENT_TYPE,
      "X-Content-Type-Options": "nosniff",
      "X-OG-Width": String(OG_IMAGE_WIDTH),
      "X-OG-Height": String(OG_IMAGE_HEIGHT),
    },
  });
}

function svgShell(title: string, children: string[]) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_IMAGE_WIDTH}" height="${OG_IMAGE_HEIGHT}" viewBox="0 0 ${OG_IMAGE_WIDTH} ${OG_IMAGE_HEIGHT}" role="img" aria-label="${escapeAttribute(title.trim())}">`,
    `<style>text{font-family:Georgia,serif}.ui{font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif}.display{font-family:Fraunces,Georgia,serif}.serif{font-family:Fraunces,Georgia,serif}</style>`,
    ...children,
    `</svg>`,
  ].join("");
}

function mediaPanelSvg({
  imageUrl,
  title,
  fallbackLabel,
}: {
  imageUrl: string | null;
  title: string;
  fallbackLabel: string;
}) {
  const fallbackLines = wrapSvgLines(title, 12, 4);
  return [
    `<rect x="0" y="0" width="624" height="630" fill="${COLORS.charcoal}" />`,
    imageUrl
      ? `<image href="${escapeAttribute(imageUrl)}" x="0" y="0" width="624" height="630" preserveAspectRatio="xMidYMid slice" />`
      : [
          `<rect x="0" y="0" width="624" height="630" fill="${COLORS.paper}" />`,
          `<rect x="40" y="40" width="544" height="550" fill="none" stroke="${COLORS.brass}" stroke-width="2" />`,
          textBlock({ lines: [fallbackLabel.toUpperCase()], x: 58, y: 110, fontSize: 24, lineHeight: 24, weight: 700, fill: COLORS.brass, family: "ui", letterSpacing: 5 }),
          textBlock({ lines: fallbackLines, x: 58, y: 220, fontSize: 78, lineHeight: 74, weight: 800, fill: COLORS.ink, family: "display" }),
        ].join(""),
    `<rect x="0" y="480" width="624" height="150" fill="${COLORS.charcoal}" fill-opacity="0.62" />`,
    textBlock({ lines: ["SPOONJOY"], x: 42, y: 568, fontSize: 28, lineHeight: 28, weight: 700, fill: COLORS.white, family: "ui", letterSpacing: 6 }),
  ].join("");
}

function cookbookGridSvg(images: string[]) {
  const boxes = images.length === 1
    ? [{ x: 40, y: 40, width: 544, height: 550 }]
    : images.length === 2
      ? [
          { x: 40, y: 40, width: 272, height: 550 },
          { x: 312, y: 40, width: 272, height: 550 },
        ]
      : [
          { x: 40, y: 40, width: 272, height: 275 },
          { x: 312, y: 40, width: 272, height: 275 },
          { x: 40, y: 315, width: 272, height: 275 },
          { x: 312, y: 315, width: 272, height: 275 },
        ];

  return [
    `<rect x="40" y="40" width="544" height="550" fill="none" stroke="${COLORS.brass}" stroke-width="1" />`,
    ...images.map((imageUrl, index) => {
      const box = boxes[index];
      return `<image href="${escapeAttribute(imageUrl)}" x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" preserveAspectRatio="xMidYMid slice" />`;
    }),
  ].join("");
}

function cookbookFallbackSvg(title: string) {
  return [
    `<rect x="40" y="40" width="544" height="550" fill="${COLORS.paper}" stroke="${COLORS.brass}" stroke-width="1" />`,
    textBlock({ lines: ["SPOONJOY"], x: 84, y: 112, fontSize: 26, lineHeight: 26, weight: 700, fill: COLORS.brass, family: "ui", letterSpacing: 6 }),
    textBlock({ lines: wrapSvgLines(title, 11, 4), x: 84, y: 262, fontSize: 82, lineHeight: 78, weight: 800, fill: COLORS.ink, family: "display" }),
    `<rect x="84" y="520" width="220" height="4" fill="${COLORS.action}" />`,
  ].join("");
}

function highlightsSvg(highlights: string[]) {
  let x = 54;
  let y = 482;
  return highlights.map((highlight) => {
    const width = Math.max(104, Math.min(190, highlight.length * 12 + 34));
    if (x + width > 474) {
      x = 54;
      y += 50;
    }
    const svg = [
      `<rect x="${x}" y="${y}" width="${width}" height="34" fill="none" stroke="${COLORS.brass}" stroke-width="1" />`,
      textBlock({ lines: [highlight.toUpperCase()], x: x + 14, y: y + 23, fontSize: 17, lineHeight: 17, weight: 700, fill: COLORS.white, family: "ui", letterSpacing: 1 }),
    ].join("");
    x += width + 12;
    return svg;
  }).join("");
}

function textBlock({
  lines,
  x,
  y,
  fontSize,
  lineHeight,
  weight,
  fill,
  family,
  letterSpacing = 0,
}: {
  lines: string[];
  x: number;
  y: number;
  fontSize: number;
  lineHeight: number;
  weight: number;
  fill: string;
  family: "display" | "serif" | "ui";
  letterSpacing?: number;
}) {
  const tspans = lines.map((line, index) =>
    `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeText(line)}</tspan>`
  ).join("");
  const letterSpacingAttribute = letterSpacing > 0 ? ` letter-spacing="${letterSpacing}"` : "";
  return `<text class="${family}" x="${x}" y="${y}" font-size="${fontSize}" font-weight="${weight}" fill="${fill}"${letterSpacingAttribute}>${tspans}</text>`;
}

function wrapSvgLines(value: string, maxChars: number, maxLines: number) {
  const words = value.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  for (const word of words) {
    const current = lines.at(-1);
    if (!current) {
      lines.push(word);
      continue;
    }
    if (`${current} ${word}`.length <= maxChars) {
      lines[lines.length - 1] = `${current} ${word}`;
      continue;
    }
    if (lines.length >= maxLines) {
      lines[lines.length - 1] = ellipsize(current, maxChars);
      return lines;
    }
    lines.push(word);
  }

  return lines.map((line) => ellipsize(line, maxChars));
}

function ellipsize(value: string, maxChars: number) {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}

function escapeText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(value: string) {
  return escapeText(value)
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
