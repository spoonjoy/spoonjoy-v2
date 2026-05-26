export const IMAGE_MAX_FILE_SIZE = 5 * 1024 * 1024;
export const RECIPE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

const JPEG_SOI = 0xd8;
const JPEG_APP1 = 0xe1;
const JPEG_SOS = 0xda;
const JPEG_EOI = 0xd9;

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

function stripJpegApp1Segments(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== JPEG_SOI) {
    return bytes;
  }

  const chunks: Uint8Array[] = [bytes.subarray(0, 2)];
  let totalLength = 2;
  let offset = 2;
  let stripped = false;

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
    } else {
      const segment = bytes.subarray(offset, segmentEnd);
      chunks.push(segment);
      totalLength += segment.length;
    }
    offset = segmentEnd;
  }

  if (!stripped) {
    return bytes;
  }

  const remainder = bytes.subarray(offset);
  chunks.push(remainder);
  totalLength += remainder.length;
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
