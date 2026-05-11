import { makeFallbackPlaceholderSvg } from "~/lib/recipe-cover.server";

export { makeFallbackPlaceholderSvg };

export interface ImageGenEnv {
  OPENAI_API_KEY?: string;
}

export interface ImageGenRunner {
  textToImage(prompt: string, opts: { model: string }): Promise<{ url: string }>;
  imageToImage(
    srcUrl: string,
    prompt: string,
    opts: { model: string },
  ): Promise<{ url: string }>;
}

export interface ImageGenDeps {
  env: ImageGenEnv;
  runner: ImageGenRunner;
  fetchImpl?: typeof fetch;
  bucket?: R2Bucket;
  now?: () => number;
}

export interface StylizationResult {
  url: string;
  usedModel: "gpt-image-1" | "dall-e-3";
}

export const IMAGE_FALLBACK_ERROR_CODES = [
  "model_not_found",
  "model_unsupported",
  "404",
] as const;

export class ImageGenError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "ImageGenError";
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export function composePlaceholderPrompt(
  title: string,
  description: string | null,
): string {
  const descClause = description ? `, ${description}` : "";
  return (
    `Warm editorial food photograph of ${title}${descClause}. ` +
    `Plated on cream ceramic with brass-toned cutlery, soft golden afternoon light, weathered oak surface. ` +
    `Style: intimate cookbook photography, muted palette of cream, terracotta, sage, and brass. ` +
    `Single dish, shallow depth of field. No text, no watermarks, no people.`
  );
}

export function composeStylizationPrompt(): string {
  return (
    `Restyle this photograph as warm editorial cookbook photography. ` +
    `Preserve the dish, plating, and composition exactly. ` +
    `Shift lighting to soft golden afternoon tones; palette becomes cream, terracotta, sage, brass. ` +
    `Do not add or remove dish elements; this is a stylistic transformation.`
  );
}

export function composeStylizationFallbackPrompt(title: string): string {
  return (
    `Restyle this photograph of ${title} as warm editorial cookbook photography. ` +
    `Imagine the original plating; preserve the dish, plating, and composition exactly. ` +
    `Soft golden afternoon tones; palette of cream, terracotta, sage, brass. ` +
    `Single dish, shallow depth of field. No text, no watermarks, no people.`
  );
}

function isFallbackError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code !== "string") return false;
  return (IMAGE_FALLBACK_ERROR_CODES as readonly string[]).includes(code);
}

async function uploadToCoverBucket(
  url: string,
  deps: ImageGenDeps,
): Promise<string> {
  if (!deps.bucket) return url;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new ImageGenError(`Image fetch failed with status ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const stamp = (deps.now ?? Date.now)();
  const key = `covers/${stamp}.png`;
  await deps.bucket.put(key, bytes, {
    httpMetadata: { contentType: "image/png" },
  });
  return `/photos/${key}`;
}

export async function generatePlaceholderImage(
  title: string,
  description: string | null,
  deps: ImageGenDeps,
): Promise<string> {
  const prompt = composePlaceholderPrompt(title, description);
  let runnerResult: { url: string };
  try {
    runnerResult = await deps.runner.textToImage(prompt, { model: "dall-e-3" });
  } catch (cause) {
    throw new ImageGenError("Placeholder image generation failed", { cause });
  }
  return uploadToCoverBucket(runnerResult.url, deps);
}

export async function stylizeSpoonPhoto(
  rawPhotoUrl: string,
  title: string,
  deps: ImageGenDeps,
): Promise<StylizationResult> {
  const prompt = composeStylizationPrompt();
  try {
    const primary = await deps.runner.imageToImage(rawPhotoUrl, prompt, {
      model: "gpt-image-1",
    });
    const url = await uploadToCoverBucket(primary.url, deps);
    return { url, usedModel: "gpt-image-1" };
  } catch (primaryErr) {
    if (!isFallbackError(primaryErr)) {
      throw new ImageGenError("Stylization failed", { cause: primaryErr });
    }
    try {
      const fallback = await deps.runner.textToImage(
        composeStylizationFallbackPrompt(title),
        { model: "dall-e-3" },
      );
      const url = await uploadToCoverBucket(fallback.url, deps);
      return { url, usedModel: "dall-e-3" };
    } catch (fallbackErr) {
      throw new ImageGenError("Stylization fallback failed", { cause: fallbackErr });
    }
  }
}

export interface OpenAIImageClient {
  images: {
    generate(args: {
      prompt: string;
      model: string;
      n: number;
      size: string;
    }): Promise<{ data?: Array<{ url?: string }> }>;
    edit(args: {
      image: string;
      prompt: string;
      model: string;
    }): Promise<{ data?: Array<{ url?: string }> }>;
  };
}

export function createOpenAIImageRunner(
  client: OpenAIImageClient,
): ImageGenRunner {
  return {
    async textToImage(prompt, opts) {
      const response = await client.images.generate({
        prompt,
        model: opts.model,
        n: 1,
        size: "1024x1024",
      });
      const url = response.data?.[0]?.url;
      if (!url) {
        throw new ImageGenError("OpenAI returned no image URL for textToImage");
      }
      return { url };
    },
    async imageToImage(srcUrl, prompt, opts) {
      const response = await client.images.edit({
        image: srcUrl,
        prompt,
        model: opts.model,
      });
      const url = response.data?.[0]?.url;
      if (!url) {
        throw new ImageGenError("OpenAI returned no image URL for imageToImage");
      }
      return { url };
    },
  };
}
