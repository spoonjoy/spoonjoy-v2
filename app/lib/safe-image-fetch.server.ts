import { FOOD_IMAGE_TYPES, IMAGE_MAX_FILE_SIZE, RECIPE_IMAGE_TYPE_MESSAGE } from "~/lib/recipe-image";
import { isBlockedHost } from "~/lib/recipe-import-fetch.server";
import { validateImageFileForStorage } from "~/lib/image-storage.server";

const IMAGE_FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

export interface SafeImageFetchResult {
  bytes: Uint8Array;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
}

interface SafeImageFetchDeps {
  fetchImpl?: typeof fetch;
  maxBytes?: number;
}

function validateImageUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Cannot parse image URL: ${rawUrl}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported image URL scheme: ${parsed.protocol}`);
  }
  if (isBlockedHost(parsed.hostname)) {
    throw new Error(`Image URL hostname is blocked: ${parsed.hostname}`);
  }
  if (parsed.pathname.toLowerCase().endsWith(".gif")) {
    throw new Error("GIF image URLs are not supported");
  }

  return parsed;
}

function normalizeImageContentType(value: string | null): SafeImageFetchResult["contentType"] {
  const normalized = value?.split(";")[0]?.trim().toLowerCase();
  if ((FOOD_IMAGE_TYPES as readonly string[]).includes(normalized ?? "")) {
    return normalized as SafeImageFetchResult["contentType"];
  }
  throw new Error(`Image content-type rejected: ${value ?? "(none)"}`);
}

function extensionFor(contentType: SafeImageFetchResult["contentType"]): SafeImageFetchResult["extension"] {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
  try {
    return await fetchImpl(url, {
      redirect: "manual",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readCappedResponseBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (bytes.byteLength > maxBytes) {
      throw new Error("Image exceeds 5MB cap");
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("Image exceeds 5MB cap");
        throw new Error("Image exceeds 5MB cap");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readValidatedImageBytes(
  response: Response,
  currentUrl: URL,
  maxBytes: number,
): Promise<SafeImageFetchResult> {
  if (!response.ok) {
    throw new Error(`Image fetch failed: ${response.status}`);
  }

  const contentType = normalizeImageContentType(response.headers.get("content-type"));
  const bytes = await readCappedResponseBytes(response, maxBytes);

  const fileName = currentUrl.pathname.split("/").pop() || `cover.${extensionFor(contentType)}`;
  const fileBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(fileBuffer).set(bytes);
  const validationError = await validateImageFileForStorage(
    new File([fileBuffer], fileName, { type: contentType }),
    {
      allowedTypes: FOOD_IMAGE_TYPES,
      messages: {
        invalidType: RECIPE_IMAGE_TYPE_MESSAGE,
        fileTooLarge: "Image must be less than 5MB",
      },
    },
  );
  if (validationError) {
    throw new Error(validationError);
  }

  return { bytes, contentType, extension: extensionFor(contentType) };
}

export async function fetchSafeImageBytes(
  rawUrl: string,
  deps: SafeImageFetchDeps = {},
): Promise<SafeImageFetchResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const maxBytes = deps.maxBytes ?? IMAGE_MAX_FILE_SIZE;
  let currentUrl = validateImageUrl(rawUrl);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    let response: Response;
    try {
      response = await fetchWithTimeout(fetchImpl, currentUrl.toString());
    } catch (err) {
      if (err && (err as { name?: string }).name === "AbortError") {
        throw new Error("Image fetch timed out after 15s");
      }
      throw err;
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error(`Image redirect missing Location: ${response.status}`);
      }
      currentUrl = validateImageUrl(new URL(location, currentUrl).toString());
      continue;
    }

    return readValidatedImageBytes(response, currentUrl, maxBytes);
  }

  throw new Error("Image redirect limit exceeded");
}
