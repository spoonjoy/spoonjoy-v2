import { makeFallbackPlaceholderSvg } from "~/lib/recipe-cover.server";
import { getStoredImageKey, validateImageFileForStorage } from "~/lib/image-storage.server";
import { FOOD_IMAGE_TYPES, RECIPE_IMAGE_SIZE_MESSAGE, RECIPE_IMAGE_TYPE_MESSAGE } from "~/lib/recipe-image";
import { fetchSafeImageBytes } from "~/lib/safe-image-fetch.server";

export { makeFallbackPlaceholderSvg };

export interface ImageGenEnv {
  OPENAI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  GEMINI_API_KEY?: string;
  GEMINI_IMAGE_MODEL?: string;
  GEMINI_IMAGE_TIMEOUT_MS?: string;
  IMAGE_PROVIDER_PRIMARY?: string;
  IMAGE_PROVIDER_FALLBACKS?: string;
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
  model?: string;
  fetchImpl?: typeof fetch;
  bucket?: R2Bucket;
  now?: () => number;
  randomId?: () => string;
  allowLocalImageFallback?: boolean;
}

type ImageAssetDeps = Pick<
  ImageGenDeps,
  "fetchImpl" | "bucket" | "now" | "randomId" | "allowLocalImageFallback"
>;

export interface ImageEditAttempt {
  provider: string;
  model: string;
  runner: ImageGenRunner;
}

export interface StylizeImageGenDeps extends Omit<ImageGenDeps, "runner"> {
  runner?: ImageGenRunner;
  imageEditAttempts?: ImageEditAttempt[];
}

export interface StylizationResult {
  url: string;
  usedModel: string;
  usedProvider: string;
  attemptFailures?: ImageProviderAttemptError[];
}

export const IMAGE_FALLBACK_ERROR_CODES = [
  "model_not_found",
  "model_unsupported",
  "billing_hard_limit_reached",
  "insufficient_quota",
  "quota_exceeded",
  "rate_limit",
  "rate_limit_exceeded",
  "resource_exhausted",
  "unauthenticated",
  "permission_denied",
  "billing_limit_user_error",
  "404",
] as const;

export const OPENAI_IMAGE_EDIT_MODELS = [
  "gpt-image-2",
  "gpt-image-1.5",
  "gpt-image-1",
  "gpt-image-1-mini",
] as const;

export const DEFAULT_GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";
export const DEFAULT_GEMINI_IMAGE_TIMEOUT_MS = 30_000;

export class ImageGenError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "ImageGenError";
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export class ImageProviderEmptyOutputError extends ImageGenError {
  provider: string;
  operation: "textToImage" | "imageToImage";
  code = "empty_image_data";
  type = "empty_image_data";

  constructor(provider: string, operation: "textToImage" | "imageToImage") {
    super(`${provider} returned no image data for ${operation}`);
    this.name = "ImageProviderEmptyOutputError";
    this.provider = provider;
    this.operation = operation;
  }
}

export class ImageProviderAttemptError extends Error {
  provider: string;
  model: string;
  retryable: boolean;
  code: string | null;
  status: number | null;
  type: string | null;
  requestID: string | null;

  constructor(input: {
    provider: string;
    model: string;
    retryable: boolean;
    cause: unknown;
  }) {
    super(`${input.provider}:${input.model} image edit failed`);
    this.name = "ImageProviderAttemptError";
    (this as { cause?: unknown }).cause = input.cause;
    this.provider = input.provider;
    this.model = input.model;
    this.retryable = input.retryable;
    this.code = errorCode(input.cause);
    this.status = errorStatus(input.cause);
    this.type = errorType(input.cause);
    this.requestID = errorRequestId(input.cause);
  }
}

function stringErrorField(cause: unknown, key: string): string | null {
  if (typeof cause !== "object" || cause === null) return null;
  if (key in cause && typeof (cause as Record<string, unknown>)[key] === "string") {
    return (cause as Record<string, string>)[key];
  }
  if (
    "error" in cause &&
    typeof cause.error === "object" &&
    cause.error !== null &&
    key in cause.error &&
    typeof (cause.error as Record<string, unknown>)[key] === "string"
  ) {
    return (cause.error as Record<string, string>)[key];
  }
  return null;
}

function errorCode(cause: unknown): string | null {
  return stringErrorField(cause, "code");
}

function errorType(cause: unknown): string | null {
  return stringErrorField(cause, "type") ?? stringErrorField(cause, "status");
}

function errorRequestId(cause: unknown): string | null {
  return stringErrorField(cause, "requestID") ?? stringErrorField(cause, "request_id");
}

function errorStatus(cause: unknown): number | null {
  if (typeof cause !== "object" || cause === null) return null;
  if ("status" in cause && typeof cause.status === "number") return cause.status;
  if (
    "error" in cause &&
    typeof cause.error === "object" &&
    cause.error !== null &&
    "code" in cause.error &&
    typeof cause.error.code === "number"
  ) {
    return cause.error.code;
  }
  return null;
}

function normalizedSignal(value: string | number | null): string | null {
  if (value === null) return null;
  return String(value).trim().toLowerCase();
}

export function isImageProviderFallbackError(cause: unknown): boolean {
  if (cause instanceof ImageProviderEmptyOutputError) {
    return true;
  }

  const code = normalizedSignal(errorCode(cause));
  const type = normalizedSignal(errorType(cause));
  if (code !== null && IMAGE_FALLBACK_ERROR_CODES.includes(code as (typeof IMAGE_FALLBACK_ERROR_CODES)[number])) {
    return true;
  }
  if (type !== null && IMAGE_FALLBACK_ERROR_CODES.includes(type as (typeof IMAGE_FALLBACK_ERROR_CODES)[number])) {
    return true;
  }
  const status = errorStatus(cause);
  if (status === null) return false;
  if (IMAGE_FALLBACK_ERROR_CODES.includes(String(status) as (typeof IMAGE_FALLBACK_ERROR_CODES)[number])) {
    return true;
  }
  return status === 401 || status === 403 || status === 408 || status === 429 || status >= 500;
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
    `Create an appetizing editorial food photograph based on the provided dish image. ` +
    `Preserve the actual dish, ingredients, plating, orientation, and overall composition. ` +
    `Improve lighting, color, texture, and background polish so it feels natural, warm, and realistic for a recipe app. ` +
    `Do not add text, logos, utensils, hands, new ingredients, or fantasy elements. ` +
    `Do not crop out the main dish.`
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

async function fileToBase64(file: File): Promise<string> {
  return bytesToBase64(new Uint8Array(await file.arrayBuffer()));
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
  deps: ImageAssetDeps,
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

async function resolveEditSourceFile(rawPhotoUrl: string, deps: ImageAssetDeps): Promise<File> {
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
  deps: ImageAssetDeps,
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
    runnerResult = await deps.runner.textToImage(prompt, { model: deps.model ?? "dall-e-3" });
  } catch (cause) {
    throw new ImageGenError("Placeholder image generation failed", { cause });
  }
  return persistGeneratedImage(runnerResult, deps);
}

export async function stylizeSpoonPhoto(
  rawPhotoUrl: string,
  _title: string,
  deps: StylizeImageGenDeps,
): Promise<StylizationResult> {
  const prompt = composeStylizationPrompt();
  try {
    const sourceFile = await resolveEditSourceFile(rawPhotoUrl, deps);
    const failures: ImageProviderAttemptError[] = [];
    for (const attempt of resolveImageEditAttempts(deps)) {
      try {
        const result = await attempt.runner.imageToImage(sourceFile, prompt, { model: attempt.model });
        const url = await persistGeneratedImage(result, deps);
        return {
          url,
          usedModel: attempt.model,
          usedProvider: attempt.provider,
          ...(failures.length > 0 ? { attemptFailures: failures as ImageProviderAttemptError[] } : {}),
        };
      } catch (cause) {
        const retryable = isImageProviderFallbackError(cause);
        const attemptError = new ImageProviderAttemptError({
          provider: attempt.provider,
          model: attempt.model,
          retryable,
          cause,
        });
        failures.push(attemptError);
        if (!retryable) {
          throw attemptError;
        }
      }
    }
    throw new AggregateError(failures, "All image edit providers failed");
  } catch (cause) {
    throw new ImageGenError("Stylization failed", { cause });
  }
}

function resolveImageEditAttempts(deps: StylizeImageGenDeps): ImageEditAttempt[] {
  if (deps.imageEditAttempts && deps.imageEditAttempts.length > 0) {
    return deps.imageEditAttempts;
  }
  if (deps.runner) {
    return OPENAI_IMAGE_EDIT_MODELS.map((model) => ({
      provider: "openai",
      model,
      runner: deps.runner!,
    }));
  }
  throw new ImageGenError("Image edit runner is required");
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
  throw new ImageProviderEmptyOutputError("OpenAI", operation);
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

export interface GeminiImageRunnerInput {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

type GeminiInlineData = {
  data?: string;
  mimeType?: string;
  mime_type?: string;
};

type GeminiPart = {
  text?: string;
  inlineData?: GeminiInlineData;
  inline_data?: GeminiInlineData;
};

type GeminiGenerateContentResponse = {
  promptFeedback?: {
    blockReason?: string;
  };
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: GeminiPart[];
    };
  }>;
};

const GEMINI_NON_RETRYABLE_NO_IMAGE_REASONS = [
  "blocklist",
  "image_prohibited_content",
  "image_safety",
  "prohibited_content",
  "safety",
  "spii",
] as const;

const IMAGE_TEXT_REFUSAL_PATTERN =
  /\b(can(?:not|'t)|won't|will not)\b.{0,100}\b(assist|comply|create|edit|generate|help|provide)\b|\b(content policy|safety policy|not allowed|disallowed|unsafe|inappropriate)\b/i;

function imageProviderBlockedOutputError(
  provider: string,
  operation: "textToImage" | "imageToImage",
  reason: string,
): ImageGenError & { code: string; type: string } {
  const error = new ImageGenError(`${provider} returned no image data for ${operation}: ${reason}`) as ImageGenError & {
    code: string;
    type: string;
  };
  error.code = "content_policy_violation";
  error.type = "content_policy_violation";
  return error;
}

function geminiNoImageBlockReason(response: GeminiGenerateContentResponse, textParts: string[]): string | null {
  const promptBlockReason = normalizedSignal(response.promptFeedback?.blockReason ?? null);
  if (promptBlockReason !== null) {
    return `prompt blocked: ${promptBlockReason}`;
  }

  for (const candidate of response.candidates ?? []) {
    const finishReason = normalizedSignal(candidate.finishReason ?? null);
    if (
      finishReason !== null &&
      GEMINI_NON_RETRYABLE_NO_IMAGE_REASONS.includes(
        finishReason as (typeof GEMINI_NON_RETRYABLE_NO_IMAGE_REASONS)[number],
      )
    ) {
      return `candidate finished with ${finishReason}`;
    }
  }

  const responseText = textParts.join(" ").trim();
  if (IMAGE_TEXT_REFUSAL_PATTERN.test(responseText)) {
    return "text refusal";
  }
  return null;
}

function geminiContentType(value: string | undefined): GeneratedImageOutput["contentType"] {
  const normalized = value?.split(";")[0]?.trim().toLowerCase();
  if (normalized === "image/jpeg" || normalized === "image/png" || normalized === "image/webp") {
    return normalized;
  }
  return "image/png";
}

function imageOutputFromGemini(
  response: GeminiGenerateContentResponse,
  operation: "textToImage" | "imageToImage",
): GeneratedImageOutput {
  const textParts: string[] = [];
  for (const candidate of response.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const inlineData = part.inlineData ?? part.inline_data;
      if (inlineData?.data) {
        return {
          bytes: base64ToBytes(inlineData.data),
          contentType: geminiContentType(inlineData.mimeType ?? inlineData.mime_type),
        };
      }
      if (part.text) {
        textParts.push(part.text);
      }
    }
  }
  const blockReason = geminiNoImageBlockReason(response, textParts);
  if (blockReason !== null) {
    throw imageProviderBlockedOutputError("Gemini", operation, blockReason);
  }
  throw new ImageProviderEmptyOutputError("Gemini", operation);
}

async function geminiApiError(response: Response): Promise<Error> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const googleError = typeof payload === "object" && payload !== null && "error" in payload
    ? (payload as { error?: { message?: string; status?: string; code?: number } }).error
    : undefined;
  const message = googleError?.message ?? response.statusText;
  const error = new Error(`Gemini image generation failed with status ${response.status}: ${message}`) as Error & {
    status?: number;
    code?: string;
    type?: string;
    error?: unknown;
  };
  error.status = response.status;
  error.code = googleError?.status ?? String(response.status);
  error.type = googleError?.status;
  if (googleError) error.error = googleError;
  return error;
}

export function createGeminiImageRunner({
  apiKey,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_GEMINI_IMAGE_TIMEOUT_MS,
}: GeminiImageRunnerInput): ImageGenRunner {
  async function generateContent(
    model: string,
    parts: GeminiPart[],
    operation: "textToImage" | "imageToImage",
  ): Promise<GeneratedImageOutput> {
    const response = await fetchWithTimeout(
      fetchImpl,
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { responseModalities: ["Image"] },
        }),
      },
      timeoutMs,
    );
    if (!response.ok) {
      throw await geminiApiError(response);
    }
    return imageOutputFromGemini(await response.json() as GeminiGenerateContentResponse, operation);
  }

  return {
    async textToImage(prompt, opts) {
      return generateContent(opts.model, [{ text: prompt }], "textToImage");
    },
    async imageToImage(srcImage, prompt, opts) {
      return generateContent(
        opts.model,
        [
          { text: prompt },
          {
            inline_data: {
              mime_type: srcImage.type || "image/png",
              data: await fileToBase64(srcImage),
            },
          },
        ],
        "imageToImage",
      );
    },
  };
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (cause) {
    if (controller.signal.aborted) {
      throw Object.assign(new Error(`Gemini image generation timed out after ${timeoutMs}ms`), {
        status: 408,
        code: "timeout",
        type: "timeout",
        cause,
      });
    }
    throw cause;
  } finally {
    clearTimeout(timeout);
  }
}
