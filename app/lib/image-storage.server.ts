export const IMAGE_MAX_FILE_SIZE = 5 * 1024 * 1024;
export const RECIPE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

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

async function fileToDataUrl(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return `data:${file.type};base64,${btoa(binary)}`;
}

export async function storeImage({ bucket, file, namespace, now = Date.now }: StoreImageOptions): Promise<string> {
  if (!bucket) {
    return fileToDataUrl(file);
  }

  const key = `${namespace}/${now()}.${getImageExtension(file.name)}`;

  await bucket.put(key, file, {
    httpMetadata: {
      contentType: file.type,
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
