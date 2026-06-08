import { FOOD_IMAGE_TYPES, IMAGE_MAX_FILE_SIZE } from "~/lib/recipe-image";

export { IMAGE_MAX_FILE_SIZE };
export const RECIPE_IMAGE_TYPES = FOOD_IMAGE_TYPES;

const JPEG_SOI = 0xd8;
const JPEG_APP1 = 0xe1;
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

function detectImageMimeType(bytes: Uint8Array): string | null {
  if (bytesStartWith(bytes, [0x47, 0x49, 0x46, 0x38])) {
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

export async function validateImageFileForStorage(
  file: File,
  options: ValidateImageFileOptions,
): Promise<string | null> {
  const basicError = validateImageFile(file, options);
  if (basicError) return basicError;

  if (file.size === 0) {
    return options.messages.invalidType;
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const detectedType = detectImageMimeType(bytes);
  if (
    detectedType === null ||
    detectedType === "image/gif" ||
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

function isJpegUpload(file: File): boolean {
  return file.type === "image/jpeg" || /\.(jpe?g)$/i.test(file.name);
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

function buildOrientationApp1Segment(orientation: number): Uint8Array {
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

  const segmentLength = payload.length + 2;
  return new Uint8Array([
    0xff,
    JPEG_APP1,
    (segmentLength >> 8) & 0xff,
    segmentLength & 0xff,
    ...payload,
  ]);
}

function stripJpegApp1Segments(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== JPEG_SOI) {
    return bytes;
  }

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

    if (marker === JPEG_APP1) {
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

async function stripUploadMetadata(file: File): Promise<File> {
  if (!isJpegUpload(file)) {
    return file;
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const stripped = stripJpegApp1Segments(bytes);

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
  return true;
}
