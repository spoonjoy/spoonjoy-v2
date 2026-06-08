import { useRef, useState } from "react";
import { Form, useActionData, useSubmit } from "react-router";
import { Avatar } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { Text } from "~/components/ui/text";
import { resolveChefAvatarUrl } from "~/lib/chef-avatar";
import { ProfilePhotoCropper } from "~/components/account/ProfilePhotoCropper";
import type { AccountSettingsActionResult } from "~/lib/account-settings.server";
import { IMAGE_MAX_FILE_SIZE, PROFILE_IMAGE_ACCEPT, PROFILE_IMAGE_TYPES } from "~/lib/recipe-image";

export function ProfilePhotoField({ photoUrl }: { photoUrl: string | null }) {
  const actionData = useActionData<AccountSettingsActionResult>();
  const submit = useSubmit();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const currentPhotoUrl = resolveChefAvatarUrl(actionData?.photoUrl || photoUrl);
  const buttonText = photoUrl ? "Change Photo" : "Upload Photo";

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    /* istanbul ignore next -- @preserve native file input onChange only fires with a selected file */
    if (!file) return;

    if (!(PROFILE_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      setValidationError("Please upload an image file");
      event.target.value = "";
      return;
    }

    if (file.size > IMAGE_MAX_FILE_SIZE) {
      setValidationError("Photo must be less than 5MB");
      event.target.value = "";
      return;
    }

    setValidationError(null);
    setCropFile(file);
  };

  const handleConfirm = (blob: Blob) => {
    const formData = new FormData();
    formData.append("intent", "uploadPhoto");
    formData.append("photo", new File([blob], "avatar.jpg", { type: blob.type || "image/jpeg" }));
    submit(formData, { method: "post", encType: "multipart/form-data" });
    setCropFile(null);
  };

  const handleCancel = () => {
    setCropFile(null);
    /* istanbul ignore next -- @preserve the input ref is always populated while the field is mounted */
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const errorMessage = validationError ?? (actionData?.error ? actionData.message : null);

  return (
    <div className="mt-4 flex flex-col gap-6 sm:flex-row sm:items-start">
      <Avatar
        src={currentPhotoUrl}
        alt="Profile photo"
        className="size-28 border border-[var(--sj-border)] shadow-[var(--sj-shadow-soft)]"
      />
      <div className="flex-1 space-y-4">
        <div className="flex flex-wrap gap-3">
          <input
            ref={fileInputRef}
            type="file"
            name="photo"
            accept={PROFILE_IMAGE_ACCEPT}
            className="hidden"
            onChange={handleFileChange}
          />
          <Button type="button" plain onClick={handleUploadClick}>
            {buttonText}
          </Button>
          {photoUrl && (
            <Form method="post">
              <input type="hidden" name="intent" value="removePhoto" />
              <Button type="submit" variant="destructive">
                Remove Photo
              </Button>
            </Form>
          )}
        </div>
        {errorMessage && <Text className="text-sm text-[var(--sj-tomato)]">{errorMessage}</Text>}
        <Text className="text-sm">JPG, PNG, GIF, or WebP. Max 5MB.</Text>
      </div>

      {cropFile && <ProfilePhotoCropper file={cropFile} onConfirm={handleConfirm} onCancel={handleCancel} />}
    </div>
  );
}
