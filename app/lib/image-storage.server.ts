import { photoVariantKeys } from "~/lib/photo-variants";
import { FOOD_IMAGE_TYPES, IMAGE_MAX_FILE_SIZE } from "~/lib/recipe-image";
import {
  captureEvent,
  captureException,
  type PostHogServerConfig,
} from "~/lib/analytics-server";

export { IMAGE_MAX_FILE_SIZE };
export const RECIPE_IMAGE_TYPES = FOOD_IMAGE_TYPES;

const JPEG_SOI = 0xd8;
const JPEG_APP1 = 0xe1;
const JPEG_APP13 = 0xed;
const JPEG_SOS = 0xda;
const JPEG_EOI = 0xd9;
const EXIF_HEADER = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]);

interface ImageValidationMessages {
  invalidType: string;
  fileTooLarge: string;
}

interface ValidateImageFileOptions {
  allowedTypes?: readonly string[];
  messages: ImageValidationMessages;
}

interface StoreImageOptions {
  bucket?: R2Bucket;
  file: File;
  namespace: string;
  now?: () => number;
  randomId?: () => string;
}

interface DeleteStoredImageOptions {
  bucket?: R2Bucket;
  imageUrl: string | null | undefined;
}

export function hasUploadedImageFile(value: FormDataEntryValue | null): value is File {
  return value instanceof File && value.size > 0;
}

export function validateImageFile(file: File, options: ValidateImageFileOptions): string | null {
  const typeAllowed = options.allowedTypes
    ? options.allowedTypes.includes(file.type)
    : file.type.startsWith("image/");

  if (!typeAllowed) {
    return options.messages.invalidType;
  }

  if (file.size > IMAGE_MAX_FILE_SIZE) {
    return options.messages.fileTooLarge;
  }

  return null;
}

function bytesStartWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

export type DetectedImageMimeType = "image/gif" | "image/jpeg" | "image/png" | "image/webp";

const GIF87A_SIGNATURE = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] as const;
const GIF89A_SIGNATURE = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] as const;

/**
 * The image format the bytes really are, from their signature, or null for anything else. The one
 * sniffer every upload path uses, so the web and API paths accept exactly the same bytes.
 */
export function detectImageMimeType(bytes: Uint8Array): DetectedImageMimeType | null {
  if (bytesStartWith(bytes, GIF87A_SIGNATURE) || bytesStartWith(bytes, GIF89A_SIGNATURE)) {
    return "image/gif";
  }
  if (bytesStartWith(bytes, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (bytesStartWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytesStartWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/** The most multipart body an image upload may send: the image limit plus room for the other fields. */
export const IMAGE_UPLOAD_MULTIPART_MAX_BYTES = IMAGE_MAX_FILE_SIZE + 512 * 1024;

/**
 * Reads a multipart image upload's form data, or answers null as soon as the body passes
 * IMAGE_UPLOAD_MULTIPART_MAX_BYTES, whether by its declared length or while streaming, so an
 * oversized body is never buffered whole.
 */
export async function imageUploadFormDataWithinLimit(request: Request): Promise<FormData | null> {
  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > IMAGE_UPLOAD_MULTIPART_MAX_BYTES) {
    return null;
  }

  if (!request.body) {
    return request.formData();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > IMAGE_UPLOAD_MULTIPART_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const replayHeaders: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "content-length") {
      replayHeaders[key] = value;
    }
  });
  const replayBytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    replayBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const RequestConstructor = request.constructor as new (input: string, init: RequestInit) => Request;
  return await new RequestConstructor(request.url, {
    method: request.method,
    headers: replayHeaders,
    body: new Blob([replayBytes.buffer]),
  }).formData();
}

export async function validateImageFileForStorage(
  file: File,
  options: ValidateImageFileOptions,
): Promise<string | null> {
  const basicError = validateImageFile(file, options);
  if (basicError) return basicError;

  if (file.size === 0) {
    return options.messages.invalidType;
  }

  // Trust the bytes, not the client-declared type: the sniffed format must
  // match the declared one. GIF is only accepted when the caller lists it
  // explicitly (profile photos); food photos never accept it.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const detectedType = detectImageMimeType(bytes);
  if (
    detectedType === null ||
    (detectedType === "image/gif" && !options.allowedTypes?.includes("image/gif")) ||
    detectedType !== file.type
  ) {
    return options.messages.invalidType;
  }

  return null;
}

export function getImageExtension(fileName: string): string {
  if (!fileName.includes(".")) {
    return "jpg";
  }

  const extension = fileName.split(".").pop()?.trim().toLowerCase();
  return extension || "jpg";
}

function concatBytes(chunks: Uint8Array[], totalLength: number): Uint8Array {
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

function hasPrefix(bytes: Uint8Array, prefix: Uint8Array): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((byte, index) => bytes[index] === byte);
}

function readExifUint16(bytes: Uint8Array, offset: number, littleEndian: boolean): number {
  return littleEndian
    ? bytes[offset] | (bytes[offset + 1] << 8)
    : (bytes[offset] << 8) | bytes[offset + 1];
}

function readExifUint32(bytes: Uint8Array, offset: number, littleEndian: boolean): number {
  return littleEndian
    ? (
        bytes[offset] |
        (bytes[offset + 1] << 8) |
        (bytes[offset + 2] << 16) |
        (bytes[offset + 3] << 24)
      ) >>> 0
    : (
        (bytes[offset] << 24) |
        (bytes[offset + 1] << 16) |
        (bytes[offset + 2] << 8) |
        bytes[offset + 3]
      ) >>> 0;
}

function parseExifOrientation(app1Payload: Uint8Array): number | null {
  if (!hasPrefix(app1Payload, EXIF_HEADER) || app1Payload.length < 32) {
    return null;
  }

  const tiffOffset = EXIF_HEADER.length;
  const littleEndian = app1Payload[tiffOffset] === 0x49 && app1Payload[tiffOffset + 1] === 0x49;
  const bigEndian = app1Payload[tiffOffset] === 0x4d && app1Payload[tiffOffset + 1] === 0x4d;
  if (!littleEndian && !bigEndian) {
    return null;
  }
  if (readExifUint16(app1Payload, tiffOffset + 2, littleEndian) !== 42) {
    return null;
  }

  const ifdOffset = readExifUint32(app1Payload, tiffOffset + 4, littleEndian);
  const ifdStart = tiffOffset + ifdOffset;
  if (ifdStart + 2 > app1Payload.length) {
    return null;
  }

  const entryCount = readExifUint16(app1Payload, ifdStart, littleEndian);
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdStart + 2 + index * 12;
    if (entryOffset + 12 > app1Payload.length) {
      return null;
    }

    const tag = readExifUint16(app1Payload, entryOffset, littleEndian);
    const type = readExifUint16(app1Payload, entryOffset + 2, littleEndian);
    const count = readExifUint32(app1Payload, entryOffset + 4, littleEndian);
    if (tag === 0x0112 && type === 3 && count === 1) {
      const orientation = readExifUint16(app1Payload, entryOffset + 8, littleEndian);
      return orientation >= 2 && orientation <= 8 ? orientation : null;
    }
  }

  return null;
}

/** An Exif payload ("Exif\0\0" + big-endian TIFF) whose only tag is Orientation. */
function buildOrientationExifPayload(orientation: number): Uint8Array {
  const payload = new Uint8Array(32);
  payload.set(EXIF_HEADER, 0);
  payload[6] = 0x4d;
  payload[7] = 0x4d;
  payload[8] = 0x00;
  payload[9] = 0x2a;
  payload[10] = 0x00;
  payload[11] = 0x00;
  payload[12] = 0x00;
  payload[13] = 0x08;
  payload[14] = 0x00;
  payload[15] = 0x01;
  payload[16] = 0x01;
  payload[17] = 0x12;
  payload[18] = 0x00;
  payload[19] = 0x03;
  payload[20] = 0x00;
  payload[21] = 0x00;
  payload[22] = 0x00;
  payload[23] = 0x01;
  payload[24] = 0x00;
  payload[25] = orientation;
  return payload;
}

function buildOrientationApp1Segment(orientation: number): Uint8Array {
  const payload = buildOrientationExifPayload(orientation);
  const segmentLength = payload.length + 2;
  return new Uint8Array([
    0xff,
    JPEG_APP1,
    (segmentLength >> 8) & 0xff,
    segmentLength & 0xff,
    ...payload,
  ]);
}

/** Called only for bytes already sniffed as JPEG, so they start with the SOI marker. */
function stripJpegApp1Segments(bytes: Uint8Array): Uint8Array {
  const keptSegments: Uint8Array[] = [];
  let offset = 2;
  let stripped = false;
  let orientation: number | null = null;

  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    if (marker === JPEG_SOS || marker === JPEG_EOI) {
      break;
    }

    const segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
    const segmentEnd = offset + 2 + segmentLength;
    if (segmentLength < 2 || segmentEnd > bytes.length) {
      return bytes;
    }

    if (marker === JPEG_APP13) {
      // Photoshop IPTC block: can carry a city, a location and a byline.
      stripped = true;
    } else if (marker === JPEG_APP1) {
      stripped = true;
      orientation ??= parseExifOrientation(bytes.subarray(offset + 4, segmentEnd));
    } else {
      const segment = bytes.subarray(offset, segmentEnd);
      keptSegments.push(segment);
    }
    offset = segmentEnd;
  }

  if (!stripped) {
    return bytes;
  }

  const chunks: Uint8Array[] = [bytes.subarray(0, 2)];
  if (orientation !== null) {
    chunks.push(buildOrientationApp1Segment(orientation));
  }
  chunks.push(...keptSegments);
  const remainder = bytes.subarray(offset);
  chunks.push(remainder);
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  return concatBytes(chunks, totalLength);
}

/**
 * Orientation from an Exif block stored without the JPEG "Exif\0\0" prefix (PNG eXIf and WebP
 * EXIF chunks are bare TIFF), tolerating writers that include the prefix anyway.
 */
function parseBareExifOrientation(payload: Uint8Array): number | null {
  if (hasPrefix(payload, EXIF_HEADER)) {
    return parseExifOrientation(payload);
  }
  return parseExifOrientation(concatBytes([EXIF_HEADER, payload], EXIF_HEADER.length + payload.length));
}

function bareOrientationExif(orientation: number): Uint8Array {
  return buildOrientationExifPayload(orientation).subarray(EXIF_HEADER.length);
}

const PNG_SIGNATURE_LENGTH = 8;
/** PNG ancillary chunks that carry Exif (with GPS), free text, XMP (iTXt "XML:com.adobe.xmp") or a timestamp. */
const PNG_METADATA_CHUNKS = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

let pngCrcTable: Uint32Array | null = null;

function pngCrc32(bytes: Uint8Array): number {
  if (!pngCrcTable) {
    pngCrcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      pngCrcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = pngCrcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildPngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  for (let index = 0; index < 4; index += 1) {
    chunk[4 + index] = type.charCodeAt(index);
  }
  chunk.set(data, 8);
  view.setUint32(8 + data.length, pngCrc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

function chunkTypeAt(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

/**
 * Drops PNG metadata chunks. Every other chunk is copied byte for byte, so its CRC stays valid.
 * An eXIf chunk with an orientation is replaced by one holding only that orientation, because
 * browsers apply it when drawing. Bytes after IEND are dropped. A file whose chunk structure is
 * broken before IEND is stored unchanged, as malformed JPEGs are, rather than guessed at: real
 * camera and phone files are well formed, and only the uploader's own crafted file is affected.
 */
function stripPngMetadata(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kept: Uint8Array[] = [bytes.subarray(0, PNG_SIGNATURE_LENGTH)];
  let offset = PNG_SIGNATURE_LENGTH;
  let changed = false;

  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) {
      return bytes;
    }
    const chunkEnd = offset + 12 + view.getUint32(offset);
    if (chunkEnd > bytes.length) {
      return bytes;
    }

    const type = chunkTypeAt(bytes, offset + 4);
    if (PNG_METADATA_CHUNKS.has(type)) {
      changed = true;
      const orientation =
        type === "eXIf" ? parseBareExifOrientation(bytes.subarray(offset + 8, chunkEnd - 4)) : null;
      if (orientation !== null) {
        kept.push(buildPngChunk("eXIf", bareOrientationExif(orientation)));
      }
    } else {
      kept.push(bytes.subarray(offset, chunkEnd));
    }
    offset = chunkEnd;

    if (type === "IEND") {
      changed ||= offset < bytes.length;
      break;
    }
  }

  if (!changed) {
    return bytes;
  }
  return concatBytes(kept, kept.reduce((sum, chunk) => sum + chunk.length, 0));
}

const WEBP_HEADER_LENGTH = 12;
const WEBP_VP8X_EXIF_FLAG = 0x08;
const WEBP_VP8X_XMP_FLAG = 0x04;

function buildWebpChunk(fourcc: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(8 + data.length + (data.length % 2));
  for (let index = 0; index < 4; index += 1) {
    chunk[index] = fourcc.charCodeAt(index);
  }
  new DataView(chunk.buffer).setUint32(4, data.length, true);
  chunk.set(data, 8);
  return chunk;
}

/**
 * Drops WebP "EXIF" and "XMP " chunks and clears their flags in the VP8X header. ICCP, ALPH,
 * animation and bitstream chunks are copied byte for byte. An EXIF chunk with an orientation is
 * replaced by one holding only that orientation (its flag stays set): most browsers ignore WebP
 * Exif orientation, but keeping it means no browser draws the photo differently after upload.
 * Bytes past the RIFF size are dropped. A file whose chunk structure is broken inside the RIFF
 * size is stored unchanged, as malformed JPEGs and PNGs are.
 */
function stripWebpMetadata(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffEnd = Math.min(bytes.length, 8 + view.getUint32(4, true));
  const kept: Uint8Array[] = [];
  let offset = WEBP_HEADER_LENGTH;
  let changed = riffEnd < bytes.length;
  let vp8xIndex = -1;
  let keptExif = false;

  while (offset < riffEnd) {
    if (offset + 8 > riffEnd) {
      return bytes;
    }
    const dataLength = view.getUint32(offset + 4, true);
    const chunkEnd = offset + 8 + dataLength + (dataLength % 2);
    if (chunkEnd > riffEnd) {
      return bytes;
    }

    const fourcc = chunkTypeAt(bytes, offset);
    if (fourcc === "EXIF" || fourcc === "XMP ") {
      changed = true;
      const orientation =
        fourcc === "EXIF" ? parseBareExifOrientation(bytes.subarray(offset + 8, offset + 8 + dataLength)) : null;
      if (orientation !== null) {
        kept.push(buildWebpChunk("EXIF", bareOrientationExif(orientation)));
        keptExif = true;
      }
    } else {
      if (fourcc === "VP8X" && vp8xIndex === -1 && dataLength >= 1) {
        vp8xIndex = kept.length;
      }
      kept.push(bytes.subarray(offset, chunkEnd));
    }
    offset = chunkEnd;
  }

  if (!changed) {
    return bytes;
  }

  if (vp8xIndex !== -1) {
    const vp8x = Uint8Array.from(kept[vp8xIndex]);
    vp8x[8] &= ~(WEBP_VP8X_XMP_FLAG | (keptExif ? 0 : WEBP_VP8X_EXIF_FLAG));
    kept[vp8xIndex] = vp8x;
  }

  const bodyLength = kept.reduce((sum, chunk) => sum + chunk.length, 0);
  const header = Uint8Array.from(bytes.subarray(0, WEBP_HEADER_LENGTH));
  new DataView(header.buffer).setUint32(4, 4 + bodyLength, true);
  return concatBytes([header, ...kept], WEBP_HEADER_LENGTH + bodyLength);
}

/**
 * Removes location and other private metadata from an upload before it is stored and served
 * publicly. The format is taken from the bytes, not the declared type or file name.
 */
async function stripUploadMetadata(file: File): Promise<File> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const detectedType = detectImageMimeType(bytes);
  const stripped =
    detectedType === "image/jpeg"
      ? stripJpegApp1Segments(bytes)
      : detectedType === "image/png"
        ? stripPngMetadata(bytes)
        : detectedType === "image/webp"
          ? stripWebpMetadata(bytes)
          : bytes;

  if (stripped === bytes) {
    return file;
  }

  const strippedFileBytes = Uint8Array.from(stripped);
  return new File([strippedFileBytes], file.name, {
    type: file.type,
    lastModified: file.lastModified,
  });
}

async function fileToDataUrl(file: File): Promise<string> {
  const storedFile = await stripUploadMetadata(file);
  const bytes = new Uint8Array(await storedFile.arrayBuffer());
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return `data:${storedFile.type};base64,${btoa(binary)}`;
}

export async function storeImage({
  bucket,
  file,
  namespace,
  now = Date.now,
  randomId = () => crypto.randomUUID(),
}: StoreImageOptions): Promise<string> {
  if (!bucket) {
    return fileToDataUrl(file);
  }

  const key = `${namespace}/${now()}-${randomId()}.${getImageExtension(file.name)}`;
  const storedFile = await stripUploadMetadata(file);

  await bucket.put(key, storedFile, {
    httpMetadata: {
      contentType: storedFile.type,
    },
  });

  return `/photos/${key}`;
}

export function getStoredImageKey(imageUrl: string | null | undefined): string | null {
  if (!imageUrl?.startsWith("/photos/")) {
    return null;
  }

  return imageUrl.replace("/photos/", "");
}

export async function deleteStoredImage({ bucket, imageUrl }: DeleteStoredImageOptions): Promise<boolean> {
  const key = getStoredImageKey(imageUrl);

  if (!bucket || !key) {
    return false;
  }

  await bucket.delete(key);
  // A deleted photo takes its size variants with it; R2 ignores keys that were never generated.
  await bucket.delete(photoVariantKeys(key));
  return true;
}

interface DeleteStoredImageWithCaptureOptions extends DeleteStoredImageOptions {
  /** Controlled `spoonjoy.storage.*` event name for a delete failure. */
  event: `spoonjoy.storage.${string}`;
  /** Resolved server PostHog config; capture is a no-op when disabled. */
  postHogConfig: PostHogServerConfig;
  /** Workers `ctx.waitUntil`, so capture outlives the response. Optional. */
  waitUntil?: (promise: Promise<unknown>) => void;
  /** Distinct id for the event/exception (a user id when known). */
  distinctId?: string;
  /** Extra controlled, privacy-safe metadata to attach to the event. */
  extras?: Record<string, unknown>;
}

/**
 * Delete an R2 object and, if the delete throws, record it instead of letting
 * the error escape. R2 delete failures leave an orphaned object behind; on a
 * cleanup path (recipe create/edit rollback, avatar removal) a thrown delete
 * also masks the real error that triggered the cleanup. We capture the
 * exception plus a controlled `spoonjoy.storage.*` event, then swallow — the
 * delete is best-effort and must not break the user's request.
 *
 * Returns the `deleteStoredImage` result on success, or `false` if the delete
 * threw (the failure was captured).
 */
export async function deleteStoredImageWithCapture({
  bucket,
  imageUrl,
  event,
  postHogConfig,
  waitUntil,
  distinctId = "server",
  extras,
}: DeleteStoredImageWithCaptureOptions): Promise<boolean> {
  try {
    return await deleteStoredImage({ bucket, imageUrl });
  } catch (error) {
    if (postHogConfig.enabled) {
      const run = (promise: Promise<unknown>) => {
        if (waitUntil) {
          waitUntil(promise);
        } else {
          void promise;
        }
      };
      run(captureException(postHogConfig, { error, distinctId, extras }));
      run(captureEvent(postHogConfig, { event, distinctId, properties: extras }));
    }
    return false;
  }
}
