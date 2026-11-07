import { useActionData, useSubmit } from "react-router";
import { ImageField } from "~/components/ouro/image-field/image-field";
import { resolveChefAvatarUrl } from "~/lib/chef-avatar";
import type { AccountSettingsActionResult } from "~/lib/account-settings.server";
import { IMAGE_MAX_FILE_SIZE, PROFILE_IMAGE_ACCEPT } from "~/lib/recipe-image";

/**
 * The chef's profile photo on Account settings: HX's image field, round and cropped, which saves a
 * chosen photo as soon as it is cropped and removes the saved one, each as its own form post.
 */
export function ProfilePhotoField({ photoUrl }: { photoUrl: string | null }) {
  const actionData = useActionData<AccountSettingsActionResult>();
  const submit = useSubmit();
  const savedPhotoUrl = actionData?.photoUrl || photoUrl;

  const upload = (file: File | null) => {
    // A chosen photo is posted at once, so taking it back out of the field only clears its preview.
    if (!file) return;
    const formData = new FormData();
    formData.append("intent", "uploadPhoto");
    formData.append("photo", file);
    submit(formData, { method: "post", encType: "multipart/form-data" });
  };

  const remove = () => {
    const formData = new FormData();
    formData.append("intent", "removePhoto");
    submit(formData, { method: "post" });
  };

  // Only this field's own upload errors belong here; the page banner shows every other form's.
  const error = actionData?.intent === "uploadPhoto" && actionData.error ? actionData.message : undefined;

  return (
    <ImageField
      // A new saved photo starts the field afresh, showing the saved photo instead of the chosen file.
      key={savedPhotoUrl ?? "none"}
      className="mt-4 max-w-48"
      label="Profile photo"
      hideLabel
      alt="Profile photo"
      description="JPG, PNG, GIF, or WebP. 5 MB max."
      src={resolveChefAvatarUrl(savedPhotoUrl)}
      accept={PROFILE_IMAGE_ACCEPT}
      maxSize={IMAGE_MAX_FILE_SIZE}
      shape="circle"
      crop={{ title: "Crop your photo", outputWidth: 512 }}
      // The field always shows a photo, the default avatar until the chef saves one.
      changeLabel={savedPhotoUrl ? "Change photo" : "Upload photo"}
      removeLabel="Remove photo"
      error={error}
      onFileChange={upload}
      onRemove={photoUrl ? remove : undefined}
    />
  );
}
