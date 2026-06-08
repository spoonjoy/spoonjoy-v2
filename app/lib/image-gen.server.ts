import { makeFallbackPlaceholderSvg } from "~/lib/recipe-cover.server";
import { getStoredImageKey, validateImageFileForStorage } from "~/lib/image-storage.server";
import { FOOD_IMAGE_TYPES, RECIPE_IMAGE_SIZE_MESSAGE, RECIPE_IMAGE_TYPE_MESSAGE } from "~/lib/recipe-image";
import { fetchSafeImageBytes } from "~/lib/safe-image-fetch.server";

export { makeFallbackPlaceholderSvg };

export interface ImageGenEnv {
  OPENAI_API_KEY?: string;
}

export interface GeneratedImageOutput {
  bytes?: Uint8Array;
  contentType?: "image/png" | "image/jpeg" | "image/webp";
  url?: string;
}

export interface ImageGenRunner {
  textToImage(prompt: string, opts: { model: string }): Promise<GeneratedImageOutput>;
  imageToImage(
    srcImage: File,
    prompt: string,
    opts: { model: string },
  ): Promise<GeneratedImageOutput>;
}

export interface ImageGenDeps {
  env: ImageGenEnv;
  runner: ImageGenRunner;
  fetchImpl?: typeof fetch;
  bucket?: R2Bucket;
  now?: () => number;
  randomId?: () => string;
  allowLocalImageFallback?: boolean;
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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function extensionForContentType(contentType: GeneratedImageOutput["contentType"]): string {
  switch (contentType) {
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/png":
    default:
      return "png";
  }
}

function detectedImageContentType(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

function normalizedStoredContentType(
  objectContentType: string | undefined,
  bytes: Uint8Array,
): "image/jpeg" | "image/png" | "image/webp" | "" {
  const metadataType = objectContentType?.split(";")[0]?.trim().toLowerCase();
  if (metadataType === "image/jpeg" || metadataType === "image/png" || metadataType === "image/webp") {
    return metadataType;
  }
  return detectedImageContentType(bytes) ?? "";
}

async function fetchGeneratedImageUrl(
  url: string,
  deps: ImageGenDeps,
): Promise<{ bytes: Uint8Array; contentType: GeneratedImageOutput["contentType"] }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new ImageGenError(`Image fetch failed with status ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  return { bytes: new Uint8Array(buffer), contentType: "image/png" };
}

async function validatedEditSourceFile(
  bytes: Uint8Array,
  contentType: string,
  fileName: string,
): Promise<File> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const file = new File([buffer], fileName, { type: contentType });
  const validationError = await validateImageFileForStorage(file, {
    allowedTypes: FOOD_IMAGE_TYPES,
    messages: {
      invalidType: RECIPE_IMAGE_TYPE_MESSAGE,
      fileTooLarge: RECIPE_IMAGE_SIZE_MESSAGE,
    },
  });
  if (validationError) {
    throw new ImageGenError(`Invalid source image: ${validationError}`);
  }
  return file;
}

function fileNameFromPath(path: string, fallback: string): string {
  const name = path.split("/").filter(Boolean).pop();
  return name || fallback;
}

function parseDataImageUrl(rawPhotoUrl: string): { contentType: string; bytes: Uint8Array } | null {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(rawPhotoUrl);
  if (!match) return null;
  return { contentType: match[1].toLowerCase(), bytes: base64ToBytes(match[2]) };
}

async function resolveEditSourceFile(rawPhotoUrl: string, deps: ImageGenDeps): Promise<File> {
  const dataImage = parseDataImageUrl(rawPhotoUrl);
  if (dataImage) {
    return validatedEditSourceFile(dataImage.bytes, dataImage.contentType, "source-image");
  }

  const storedKey = getStoredImageKey(rawPhotoUrl);
  if (storedKey) {
    if (!deps.bucket) {
      throw new ImageGenError("Stored source image bucket is required");
    }
    const object = await deps.bucket.get(storedKey);
    if (!object) {
      throw new ImageGenError("Stored source image not found");
    }
    const body = object as unknown as { arrayBuffer(): Promise<ArrayBuffer> };
    const bytes = new Uint8Array(await body.arrayBuffer());
    const contentType = normalizedStoredContentType(
      object.httpMetadata?.contentType,
      bytes,
    );
    return validatedEditSourceFile(
      bytes,
      contentType,
      fileNameFromPath(storedKey, "source-image"),
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(rawPhotoUrl);
  } catch (cause) {
    throw new ImageGenError("Unsupported source image URL", { cause });
  }
  if (parsed.protocol !== "https:") {
    throw new ImageGenError("Unsupported source image URL");
  }

  const fetched = await fetchSafeImageBytes(rawPhotoUrl, { fetchImpl: deps.fetchImpl });
  return validatedEditSourceFile(
    fetched.bytes,
    fetched.contentType,
    fileNameFromPath(parsed.pathname, `source.${fetched.extension}`),
  );
}

async function persistGeneratedImage(
  output: GeneratedImageOutput,
  deps: ImageGenDeps,
): Promise<string> {
  const hasBytes = output.bytes && output.bytes.length > 0;
  const hasUrl = output.url && output.url.length > 0;
  if (!hasBytes && !hasUrl) {
    throw new ImageGenError("Generated image response did not include bytes or URL");
  }

  const image = hasBytes
    ? { bytes: output.bytes!, contentType: output.contentType ?? "image/png" }
    : await fetchGeneratedImageUrl(output.url!, deps);

  if (!deps.bucket) {
    if (!deps.allowLocalImageFallback) {
      throw new ImageGenError("Generated image bucket is required");
    }
    return `data:${image.contentType};base64,${bytesToBase64(image.bytes)}`;
  }

  const stamp = (deps.now ?? Date.now)();
  const randomId = deps.randomId ? deps.randomId() : crypto.randomUUID();
  const extension = extensionForContentType(image.contentType);
  const key = `covers/${stamp}-${randomId}.${extension}`;
  await deps.bucket.put(key, image.bytes, {
    httpMetadata: { contentType: image.contentType },
  });
  return `/photos/${key}`;
}

export async function generatePlaceholderImage(
  title: string,
  description: string | null,
  deps: ImageGenDeps,
): Promise<string> {
  const prompt = composePlaceholderPrompt(title, description);
  let runnerResult: GeneratedImageOutput;
  try {
    runnerResult = await deps.runner.textToImage(prompt, { model: "dall-e-3" });
  } catch (cause) {
    throw new ImageGenError("Placeholder image generation failed", { cause });
  }
  return persistGeneratedImage(runnerResult, deps);
}

export async function stylizeSpoonPhoto(
  rawPhotoUrl: string,
  _title: string,
  deps: ImageGenDeps,
): Promise<StylizationResult> {
  const prompt = composeStylizationPrompt();
  try {
    const sourceFile = await resolveEditSourceFile(rawPhotoUrl, deps);
    const primary = await deps.runner.imageToImage(sourceFile, prompt, {
      model: "gpt-image-1",
    });
    const url = await persistGeneratedImage(primary, deps);
    return { url, usedModel: "gpt-image-1" };
  } catch (cause) {
    throw new ImageGenError("Stylization failed", { cause });
  }
}

export interface OpenAIImageClient {
  images: {
    generate(args: {
      prompt: string;
      model: string;
      n: number;
      size: string;
      response_format?: "b64_json";
    }): Promise<{ data?: Array<{ url?: string; b64_json?: string }> }>;
    edit(args: {
      image: File;
      prompt: string;
      model: string;
      response_format?: "b64_json";
    }): Promise<{ data?: Array<{ url?: string; b64_json?: string }> }>;
  };
}

function base64ResponseArgs(model: string): { response_format?: "b64_json" } {
  return model.startsWith("gpt-image") ? {} : { response_format: "b64_json" };
}

function imageOutputFromOpenAI(
  response: { data?: Array<{ url?: string; b64_json?: string }> },
  operation: "textToImage" | "imageToImage",
): GeneratedImageOutput {
  const image = response.data?.[0];
  if (image?.b64_json) {
    return { bytes: base64ToBytes(image.b64_json), contentType: "image/png" };
  }
  if (image?.url) {
    return { url: image.url };
  }
  throw new ImageGenError(`OpenAI returned no image data for ${operation}`);
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
        ...base64ResponseArgs(opts.model),
      });
      return imageOutputFromOpenAI(response, "textToImage");
    },
    async imageToImage(srcImage, prompt, opts) {
      const response = await client.images.edit({
        image: srcImage,
        prompt,
        model: opts.model,
        ...base64ResponseArgs(opts.model),
      });
      return imageOutputFromOpenAI(response, "imageToImage");
    },
  };
}
