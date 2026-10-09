/**
 * Recipe import for a signed-in cook on the website.
 *
 * The bearer-token API (`POST /api/v1/recipes/import`) and this path share one pipeline,
 * `importRecipeFromSource`. That pipeline owns the per-chef daily import quota (ImageGenLedger
 * kind "import"), the SSRF-guarded page fetch and the persistence. This module adds only what a
 * cookie session needs on top of it:
 *
 * - form parsing and size limits, including the photo checks (type and size) before any quota
 *   is spent;
 * - the same provider gate the API applies (no OpenAI key, no import);
 * - the same per-IP request limiter the API applies (`API_IP_RATE_LIMITER`);
 * - a per-form import id, so a double submit opens the one recipe instead of writing two;
 * - a check for a link the cook already imported, so a repeat costs no quota and makes no copy;
 * - plain-language messages for every failure the pipeline reports.
 *
 * It never uses the pipeline's dry run: a dry run skips the quota, and a session import always
 * writes the recipe the cook then reviews in the editor.
 */
import type { PrismaClient } from "@prisma/client";
import type { AppLoadContext } from "react-router";
import {
  ImportRecipeError,
  importRecipeFromSource,
  type ImportRecipeCode,
  type ImportRecipeDeps,
  type NativeRecipeImportSource,
  RECIPE_PHOTO_MAX_BYTES,
  RECIPE_PHOTO_TYPES,
} from "~/lib/recipe-import.server";
import { enforceRateLimit } from "~/lib/rate-limit.server";
import { IMPORT_DAILY_CAP, PHOTO_IMPORT_DAILY_CAP } from "~/lib/image-gen-ledger.server";
import { captureException, resolvePostHogServerConfig } from "~/lib/analytics-server";

export const IMPORT_URL_MAX_LENGTH = 2048;
export const IMPORT_TEXT_MAX_LENGTH = 20000;

export type SessionImportKind = "link" | "text" | "photo";

export interface SessionImportInput {
  kind: SessionImportKind;
  importId: string;
  url?: string;
  text?: string;
  photo?: Blob;
}

export type SessionImportOutcome =
  | { ok: true; recipeId: string }
  | {
      ok: false;
      kind: SessionImportKind;
      message: string;
      existingRecipe?: { id: string; title: string };
    };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const IMPORT_MESSAGES = {
  linkMissing: "Paste the link to the recipe you want to bring in.",
  linkInvalid: "That doesn't look like a web link. It should start with https://.",
  linkTooLong: "That link is too long to read. Try the page's shorter address.",
  textMissing: "Paste the recipe: its title, ingredients and steps.",
  textTooLong: `That's more text than one recipe needs. Paste up to ${IMPORT_TEXT_MAX_LENGTH.toLocaleString("en-US")} characters.`,
  photoMissing: "Choose a photo of the recipe.",
  photoType: "Spoonjoy can read a JPEG, PNG, WebP or GIF photo. Try another photo, or paste the recipe instead.",
  photoTooLarge: `That photo is over ${RECIPE_PHOTO_MAX_BYTES / (1024 * 1024)} MB. Try a smaller one, or a screenshot of it.`,
  unavailable: "Importing isn't switched on here yet. You can still write the recipe below.",
  busy: "That's a lot of imports at once. Wait a minute, then try again.",
  failed: "Something went wrong while bringing that recipe in. Try again, or write it below.",
} as const;

const PIPELINE_MESSAGES: Record<ImportRecipeCode, string> = {
  "bad-url": IMPORT_MESSAGES.linkInvalid,
  "fetch-blocked": "Spoonjoy can only read public web pages. Check the link, or paste the recipe instead.",
  "fetch-timeout": "That site took too long to answer. Try again, or paste the recipe instead.",
  "fetch-too-large": "That page is too big to read. Paste the recipe instead.",
  "fetch-failed": "That site wouldn't share the page. Paste the recipe instead.",
  "not-html": "That link isn't a web page. Paste the recipe instead.",
  "no-content": "We couldn't find a recipe there. Paste the recipe text instead.",
  "llm-failed": "Recipe reading isn't working right now. Try again in a few minutes, or write the recipe below.",
  "rate-limited": `You've brought in ${IMPORT_DAILY_CAP} recipes today, the daily limit. You can import more tomorrow, or write this one below.`,
  "title-conflict": "You already have recipes with this title. Rename one of them, then import again.",
  "oembed-failed": "We couldn't read that video. Paste the recipe from its description instead.",
  "video-unavailable": "That video isn't available. Paste the recipe from its description instead.",
  "bad-image": IMPORT_MESSAGES.photoType,
};

const PHOTO_MESSAGES: Partial<Record<ImportRecipeCode, string>> = {
  "no-content": "We couldn't read a recipe in that photo. Try a sharper photo with the whole recipe in it, or paste the recipe instead.",
  "rate-limited": `You've read ${PHOTO_IMPORT_DAILY_CAP} recipe photos today, the daily limit. Paste the recipe instead, or try the photo tomorrow.`,
};

const TEXT_NO_CONTENT_MESSAGE = "We couldn't find a recipe in that text. Include the ingredients and the steps.";

/** The recipe id a session import writes, derived from the form's import id. */
export function sessionImportRecipeId(importId: string): string {
  return `recipe_import_${importId.toLowerCase()}`;
}

export function parseSessionImportForm(
  formData: FormData,
): { ok: true; input: SessionImportInput } | { ok: false; kind: SessionImportKind; message: string } {
  const rawKind = formData.get("importKind")?.toString();
  const kind: SessionImportKind = rawKind === "text" || rawKind === "photo" ? rawKind : "link";
  // The page sets an id per submission once it has loaded; a form sent before that gets a
  // fresh one (it just has no double-submit protection).
  const rawImportId = formData.get("importId")?.toString() ?? "";
  if (rawImportId && !UUID_PATTERN.test(rawImportId)) {
    return { ok: false, kind, message: IMPORT_MESSAGES.failed };
  }
  const importId = rawImportId || crypto.randomUUID();

  if (kind === "text") {
    const text = formData.get("text")?.toString() ?? "";
    if (!text.trim()) return { ok: false, kind, message: IMPORT_MESSAGES.textMissing };
    if (text.length > IMPORT_TEXT_MAX_LENGTH) return { ok: false, kind, message: IMPORT_MESSAGES.textTooLong };
    return { ok: true, input: { kind, importId, text } };
  }

  if (kind === "photo") {
    const photo = formData.get("photo");
    if (!(photo instanceof Blob) || photo.size === 0) return { ok: false, kind, message: IMPORT_MESSAGES.photoMissing };
    if (!(RECIPE_PHOTO_TYPES as readonly string[]).includes(photo.type)) {
      return { ok: false, kind, message: IMPORT_MESSAGES.photoType };
    }
    if (photo.size > RECIPE_PHOTO_MAX_BYTES) return { ok: false, kind, message: IMPORT_MESSAGES.photoTooLarge };
    return { ok: true, input: { kind, importId, photo } };
  }

  const url = formData.get("url")?.toString().trim() ?? "";
  if (!url) return { ok: false, kind, message: IMPORT_MESSAGES.linkMissing };
  if (url.length > IMPORT_URL_MAX_LENGTH) return { ok: false, kind, message: IMPORT_MESSAGES.linkTooLong };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, kind, message: IMPORT_MESSAGES.linkInvalid };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, kind, message: IMPORT_MESSAGES.linkInvalid };
  }
  return { ok: true, input: { kind, importId, url: parsed.toString() } };
}

type SessionImportEnv = NonNullable<ImportRecipeDeps["env"]> & {
  PHOTOS?: R2Bucket;
  API_IP_RATE_LIMITER?: Parameters<typeof enforceRateLimit>[0]["ipLimiter"];
};

export interface SessionImportArgs {
  db: PrismaClient;
  userId: string;
  input: SessionImportInput;
  request: Request;
  context: AppLoadContext;
  /** Test seams for the pipeline's network, model and parser. */
  pipeline?: Pick<ImportRecipeDeps, "fetchImpl" | "llmRunner" | "ingredientParser" | "imageGenRunner" | "now">;
}

export async function importRecipeForSession(args: SessionImportArgs): Promise<SessionImportOutcome> {
  const { db, userId, input, request, context } = args;
  const env = (context.cloudflare?.env ?? {}) as SessionImportEnv;
  const recipeId = sessionImportRecipeId(input.importId);

  // A second submit of the same form opens the recipe the first one wrote.
  const replay = await db.recipe.findFirst({
    where: { id: recipeId, chefId: userId, deletedAt: null },
    select: { id: true },
  });
  if (replay) return { ok: true, recipeId: replay.id };

  if (input.kind === "link") {
    const existing = await db.recipe.findFirst({
      where: { chefId: userId, sourceUrl: input.url, deletedAt: null },
      select: { id: true, title: true },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      return {
        ok: false,
        kind: input.kind,
        message: `You already brought this one in as “${existing.title}”.`,
        existingRecipe: existing,
      };
    }
  }

  // The API answers provider_secret_required without an OpenAI key; this is the same gate.
  if (!env.OPENAI_API_KEY?.trim()) {
    return { ok: false, kind: input.kind, message: IMPORT_MESSAGES.unavailable };
  }

  const rateLimit = await enforceRateLimit({
    authorization: null,
    ip: request.headers.get("CF-Connecting-IP"),
    ipLimiter: env.API_IP_RATE_LIMITER,
  });
  if (!rateLimit.allowed) {
    return { ok: false, kind: input.kind, message: IMPORT_MESSAGES.busy };
  }

  const source: NativeRecipeImportSource = input.kind === "text"
    ? { type: "text", text: input.text! }
    : input.kind === "photo"
      ? { type: "photo", photo: new Uint8Array(await input.photo!.arrayBuffer()), contentType: input.photo!.type }
      : { type: "url", url: input.url! };

  const deps: ImportRecipeDeps = {
    db,
    env,
    bucket: env.PHOTOS,
    waitUntil: context.cloudflare?.ctx?.waitUntil
      ? context.cloudflare.ctx.waitUntil.bind(context.cloudflare.ctx)
      : undefined,
    logger: console,
    analyticsDistinctId: userId,
    ...args.pipeline,
  };

  try {
    // Not a dry run, so the pipeline writes the recipe under the id it is given.
    await importRecipeFromSource({ chefId: userId, source, recipeId }, deps);
    return { ok: true, recipeId };
  } catch (error) {
    if (error instanceof ImportRecipeError) {
      const message = (input.kind === "photo" ? PHOTO_MESSAGES[error.code] : undefined)
        ?? (error.code === "no-content" && input.kind === "text" ? TEXT_NO_CONTENT_MESSAGE : undefined)
        ?? PIPELINE_MESSAGES[error.code];
      return { ok: false, kind: input.kind, message };
    }
    // A thrown write is not proof nothing landed (a concurrent submit of the same form, or an
    // error reported after commit): open the recipe if it is there.
    const landed = await db.recipe
      .findFirst({ where: { id: recipeId, chefId: userId, deletedAt: null }, select: { id: true } })
      .catch(() => null);
    if (landed) return { ok: true, recipeId: landed.id };

    const postHogConfig = resolvePostHogServerConfig(env);
    await captureException(postHogConfig, {
      error,
      distinctId: userId,
      route: new URL(request.url).pathname,
      method: request.method,
      extras: { feature: "recipe_import_web", importKind: input.kind },
    }).catch(() => undefined);
    return { ok: false, kind: input.kind, message: IMPORT_MESSAGES.failed };
  }
}
