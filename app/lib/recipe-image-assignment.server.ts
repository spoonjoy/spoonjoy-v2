import { ApiAuthError } from "~/lib/api-auth.server";
import { validateFoodImageDataUrl } from "~/lib/image-upload-tools.server";

export interface RecipeImageAssignmentInput {
  imageUrl: string;
  ownerId: string;
  bucket?: R2Bucket;
  allowLocalImageFallback?: boolean;
}

export interface SpoonPhotoAssignmentInput {
  photoUrl: string;
  ownerId: string;
  bucket?: R2Bucket;
  allowLocalImageFallback?: boolean;
}

function cleanUploadedImageUrlError(fieldName: string): ApiAuthError {
  return new ApiAuthError(`${fieldName} must be a clean Spoonjoy uploaded image URL.`, 400);
}

function storedPhotoKey(imageUrl: string, fieldName: string): string | null {
  if (!imageUrl.startsWith("/photos/")) return null;
  if (imageUrl.includes("?") || imageUrl.includes("#")) {
    throw cleanUploadedImageUrlError(fieldName);
  }

  const key = imageUrl.slice("/photos/".length);
  let decoded: string;
  try {
    decoded = decodeURIComponent(key);
  } catch {
    throw cleanUploadedImageUrlError(fieldName);
  }
  if (decoded !== key || decoded.includes("\\") || decoded.split("/").some((part) => !part || part === "." || part === "..")) {
    throw cleanUploadedImageUrlError(fieldName);
  }
  return key;
}

function belongsToOwnerUpload(key: string, ownerId: string): boolean {
  return key.startsWith(`recipes/${ownerId}/`) || key.startsWith(`spoons/${ownerId}/`);
}

function belongsToOwnerSpoonUpload(key: string, ownerId: string): boolean {
  return key.startsWith(`spoons/${ownerId}/`);
}

export async function validateRecipeImageAssignment({
  imageUrl,
  ownerId,
  bucket,
  allowLocalImageFallback,
}: RecipeImageAssignmentInput): Promise<void> {
  if (imageUrl.startsWith("data:")) {
    if (bucket || !allowLocalImageFallback) {
      throw new ApiAuthError("Data URL recipe images require missing bucket storage and explicit local image fallback.", 400);
    }
    await validateFoodImageDataUrl(imageUrl);
    return;
  }

  const key = storedPhotoKey(imageUrl, "Recipe imageUrl");
  if (!key) {
    throw new ApiAuthError("Recipe imageUrl must be a Spoonjoy uploaded image URL.", 400);
  }
  if (!belongsToOwnerUpload(key, ownerId)) {
    throw new ApiAuthError("Recipe imageUrl must belong to the recipe owner.", 400);
  }
  if (!bucket) {
    throw new ApiAuthError("Stored recipe image assignment requires the PHOTOS bucket.", 503);
  }
  const object = await bucket.get(key);
  if (!object) {
    throw new ApiAuthError("Recipe imageUrl does not exist in storage.", 400);
  }
}

export async function validateSpoonPhotoAssignment({
  photoUrl,
  ownerId,
  bucket,
  allowLocalImageFallback,
}: SpoonPhotoAssignmentInput): Promise<{ stylizable: boolean }> {
  if (photoUrl.startsWith("data:")) {
    if (bucket || !allowLocalImageFallback) {
      throw new ApiAuthError("Data URL spoon photos require missing bucket storage and explicit local image fallback.", 400);
    }
    await validateFoodImageDataUrl(photoUrl);
    return { stylizable: true };
  }

  const key = storedPhotoKey(photoUrl, "Spoon photoUrl");
  if (!key) {
    return { stylizable: false };
  }
  if (!belongsToOwnerSpoonUpload(key, ownerId)) {
    throw new ApiAuthError("Spoon photoUrl must belong to the spoon owner.", 400);
  }
  if (!bucket) {
    throw new ApiAuthError("Stored spoon photo assignment requires the PHOTOS bucket.", 503);
  }
  const object = await bucket.get(key);
  if (!object) {
    throw new ApiAuthError("Spoon photoUrl does not exist in storage.", 400);
  }
  return { stylizable: true };
}
