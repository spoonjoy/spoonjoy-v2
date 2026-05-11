import type { PrismaClient, RecipeCover } from "@prisma/client";

export interface CreateCoverInput {
  recipeId: string;
  imageUrl: string;
  stylizedImageUrl?: string | null;
  sourceType: "ai-placeholder" | "import" | "chef-upload" | "spoon";
  sourceSpoonId?: string | null;
}

export interface RecipeIdentity {
  id: string;
  title: string;
}

export async function createCover(
  db: PrismaClient,
  input: CreateCoverInput,
): Promise<RecipeCover> {
  return db.recipeCover.create({
    data: {
      recipeId: input.recipeId,
      imageUrl: input.imageUrl,
      stylizedImageUrl: input.stylizedImageUrl ?? null,
      sourceType: input.sourceType,
      sourceSpoonId: input.sourceSpoonId ?? null,
    },
  });
}

export async function listCoversForRecipe(
  db: PrismaClient,
  recipeId: string,
): Promise<RecipeCover[]> {
  return db.recipeCover.findMany({
    where: { recipeId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

export async function getCurrentCover(
  db: PrismaClient,
  recipeId: string,
): Promise<RecipeCover | null> {
  return db.recipeCover.findFirst({
    where: { recipeId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

function sortCoversDesc(covers: RecipeCover[]): RecipeCover[] {
  return [...covers].sort((a, b) => {
    const aTime = a.createdAt.getTime();
    const bTime = b.createdAt.getTime();
    if (aTime !== bTime) return bTime - aTime;
    if (a.id === b.id) return 0;
    return a.id < b.id ? 1 : -1;
  });
}

export function getRecipeCoverImageUrl(
  recipe: RecipeIdentity,
  covers: RecipeCover[],
): string {
  const sorted = sortCoversDesc(covers);
  for (const cover of sorted) {
    if (cover.stylizedImageUrl && cover.stylizedImageUrl.length > 0) {
      return cover.stylizedImageUrl;
    }
    if (cover.imageUrl && cover.imageUrl.length > 0) {
      return cover.imageUrl;
    }
  }
  return makeFallbackPlaceholderSvg(recipe.title).url;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function makeFallbackPlaceholderSvg(title: string): {
  url: string;
  bytes: Uint8Array;
} {
  const safeTitle = xmlEscape(title);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" preserveAspectRatio="xMidYMid slice">` +
    `<rect width="1024" height="1024" fill="#f5ecd9"/>` +
    `<text x="512" y="540" text-anchor="middle" font-family="Georgia, serif" font-size="64" font-style="italic" fill="#b86138">${safeTitle}</text>` +
    `</svg>`;
  const bytes = new TextEncoder().encode(svg);
  const base64 = Buffer.from(bytes).toString("base64");
  return { url: `data:image/svg+xml;base64,${base64}`, bytes };
}
