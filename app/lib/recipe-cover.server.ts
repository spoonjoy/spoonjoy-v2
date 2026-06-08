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
  _recipe: RecipeIdentity,
  covers: RecipeCover[],
): string | null {
  const currentCover = sortCoversDesc(covers)[0];
  if (!currentCover) {
    return null;
  }
  if (currentCover.stylizedImageUrl && currentCover.stylizedImageUrl.length > 0) {
    return currentCover.stylizedImageUrl;
  }
  if (currentCover.imageUrl && currentCover.imageUrl.length > 0) {
    return currentCover.imageUrl;
  }
  return null;
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
  const accessibleTitle = safeTitle || "Recipe placeholder";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" preserveAspectRatio="xMidYMid slice">` +
    `<title>${accessibleTitle}</title>` +
    `<rect width="1024" height="1024" fill="#fbfaf4"/>` +
    `<circle cx="512" cy="512" r="238" fill="#4b91dc"/>` +
    `<path d="M342 492c10-91 80-156 170-156s160 65 170 156v67c0 96-77 173-170 173s-170-77-170-173v-67z" fill="#ffd94f"/>` +
    `<path d="M333 383c-42-6-75-42-75-86 0-48 39-87 87-87 12 0 24 3 35 7 22-56 77-96 141-96 75 0 137 54 149 125 11-5 23-8 36-8 48 0 87 39 87 87s-39 87-87 87H333z" fill="#fffefa"/>` +
    `<circle cx="426" cy="492" r="34" fill="#28231d"/>` +
    `<circle cx="598" cy="492" r="34" fill="#28231d"/>` +
    `<circle cx="416" cy="481" r="9" fill="#fffefa"/>` +
    `<circle cx="588" cy="481" r="9" fill="#fffefa"/>` +
    `<path d="M316 642c42 54 103 82 196 82s154-28 196-82c-52 28-112 33-196 33s-144-5-196-33z" fill="#28231d"/>` +
    `<path d="M392 620c34-72 88-66 120-18 32-48 86-54 120 18-54 24-89 10-120-20-31 30-66 44-120 20z" fill="#28231d"/>` +
    `<circle cx="512" cy="512" r="248" fill="none" stroke="#28231d" stroke-opacity=".18" stroke-width="12"/>` +
    `</svg>`;
  const bytes = new TextEncoder().encode(svg);
  const base64 = Buffer.from(bytes).toString("base64");
  return { url: `data:image/svg+xml;base64,${base64}`, bytes };
}
