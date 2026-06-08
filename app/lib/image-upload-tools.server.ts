import { ApiAuthError } from "~/lib/api-auth.server";
import {
  storeImage,
  validateImageFileForStorage,
} from "~/lib/image-storage.server";
import {
  FOOD_IMAGE_TYPES,
  FOOD_IMAGE_TYPE_MESSAGE,
  FOOD_IMAGE_SIZE_MESSAGE,
} from "~/lib/recipe-image";

export type FoodImageMimeType = (typeof FOOD_IMAGE_TYPES)[number];
export type FoodImageUploadNamespace = "recipes" | "spoons";

export interface FoodImageUploadInput {
  imageBase64: string;
  mimeType: string;
  filename: string;
  ownerId: string;
  namespace: FoodImageUploadNamespace;
  bucket?: R2Bucket;
  allowLocalImageFallback?: boolean;
}

export interface FoodImageUploadResult {
  imageUrl: string;
  mimeType: FoodImageMimeType;
  sizeBytes: number;
}

function decodeBase64Bytes(value: string): Uint8Array {
  const compact = value.replace(/\s+/g, "");
  if (!compact || compact.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    throw new ApiAuthError("imageBase64 must be valid base64", 400);
  }

  const binary = atob(compact);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function foodImageMimeType(value: string): FoodImageMimeType {
  if (!FOOD_IMAGE_TYPES.includes(value as FoodImageMimeType)) {
    throw new ApiAuthError(FOOD_IMAGE_TYPE_MESSAGE, 400);
  }
  return value as FoodImageMimeType;
}

function fileFromBytes(bytes: Uint8Array, filename: string, type: FoodImageMimeType): File {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new File([buffer], filename, { type });
}

export async function validateFoodImageDataUrl(value: string): Promise<void> {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(value);
  if (!match) {
    throw new ApiAuthError("Image data URL must be a valid food photo.", 400);
  }
  const type = foodImageMimeType(match[1].toLowerCase());
  const bytes = decodeBase64Bytes(match[2]);
  const validationError = await validateImageFileForStorage(
    fileFromBytes(bytes, "image-upload", type),
    {
      allowedTypes: FOOD_IMAGE_TYPES,
      messages: {
        invalidType: FOOD_IMAGE_TYPE_MESSAGE,
        fileTooLarge: FOOD_IMAGE_SIZE_MESSAGE,
      },
    },
  );
  if (validationError) {
    throw new ApiAuthError(validationError, 400);
  }
}

export async function uploadFoodImage({
  imageBase64,
  mimeType,
  filename,
  ownerId,
  namespace,
  bucket,
  allowLocalImageFallback,
}: FoodImageUploadInput): Promise<FoodImageUploadResult> {
  const type = foodImageMimeType(mimeType);
  const bytes = decodeBase64Bytes(imageBase64);
  const file = fileFromBytes(bytes, filename, type);
  const validationError = await validateImageFileForStorage(file, {
    allowedTypes: FOOD_IMAGE_TYPES,
    messages: {
      invalidType: FOOD_IMAGE_TYPE_MESSAGE,
      fileTooLarge: FOOD_IMAGE_SIZE_MESSAGE,
    },
  });
  if (validationError) {
    throw new ApiAuthError(validationError, 400);
  }
  if (!bucket && !allowLocalImageFallback) {
    throw new ApiAuthError("Image uploads require the PHOTOS bucket.", 503);
  }

  const imageUrl = await storeImage({
    bucket,
    file,
    namespace: `${namespace}/${ownerId}/uploads`,
  });
  return { imageUrl, mimeType: type, sizeBytes: bytes.byteLength };
}
