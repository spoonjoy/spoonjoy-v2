import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestRoutesStub } from "../../utils";
import type { ImageFieldProps } from "~/components/ouro/image-field/image-field";
import { ProfilePhotoField } from "~/components/account/ProfilePhotoField";
import { resolveChefAvatarUrl } from "~/lib/chef-avatar";
import type { AccountSettingsActionResult } from "~/lib/account-settings.server";

// useSubmit and useActionData are mocked, so the test checks what the field posts and shows, and
// HX's ImageField is replaced by a probe of the props it gets.
const mockSubmit = vi.fn();
let mockActionData: AccountSettingsActionResult | undefined;
vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useSubmit: () => mockSubmit, useActionData: () => mockActionData };
});

let field: ImageFieldProps | undefined;
vi.mock("~/components/ouro/image-field/image-field", () => ({
  ImageField: (props: ImageFieldProps) => {
    field = props;
    return null;
  },
}));

function renderField(photoUrl: string | null, actionData?: AccountSettingsActionResult) {
  mockActionData = actionData;
  const Stub = createTestRoutesStub([
    { path: "/account/settings", Component: () => <ProfilePhotoField photoUrl={photoUrl} />, loader: () => null },
  ]);
  return render(<Stub initialEntries={["/account/settings"]} />);
}

async function rendered(photoUrl: string | null, actionData?: AccountSettingsActionResult): Promise<ImageFieldProps> {
  renderField(photoUrl, actionData);
  await waitFor(() => expect(field).toBeDefined());
  return field!;
}

beforeEach(() => {
  field = undefined;
  mockActionData = undefined;
  mockSubmit.mockClear();
});

describe("ProfilePhotoField", () => {
  it("is a round, cropped HX image field that takes JPG, PNG, GIF and WebP up to 5 MB", async () => {
    const props = await rendered(null);
    expect(props).toMatchObject({
      label: "Profile photo",
      alt: "Profile photo",
      accept: "image/jpeg,image/png,image/gif,image/webp",
      maxSize: 5 * 1024 * 1024,
      shape: "circle",
      crop: { title: "Crop your photo", outputWidth: 512 },
      changeLabel: "Upload photo",
      removeLabel: "Remove photo",
    });
  });

  it("shows the default avatar and offers no Remove without a photo", async () => {
    const props = await rendered(null);
    expect(props.src).toBe(resolveChefAvatarUrl(null));
    expect(props.onRemove).toBeUndefined();
  });

  it("shows the saved photo, or the one the last upload returned", async () => {
    expect(await rendered("https://example.com/me.jpg")).toMatchObject({ src: "https://example.com/me.jpg", changeLabel: "Change photo" });
    field = undefined;
    expect((await rendered("https://example.com/me.jpg", { success: true, intent: "uploadPhoto", photoUrl: "/photos/new.jpg" } as AccountSettingsActionResult)).src).toBe("/photos/new.jpg");
  });

  it("posts a cropped photo as soon as it is chosen", async () => {
    const props = await rendered(null);
    const photo = new File(["x"], "photo.jpg", { type: "image/jpeg" });
    props.onFileChange?.(photo);
    const [formData, options] = mockSubmit.mock.calls[0]!;
    expect((formData as FormData).get("intent")).toBe("uploadPhoto");
    expect((formData as FormData).get("photo")).toBe(photo);
    expect(options).toEqual({ method: "post", encType: "multipart/form-data" });
  });

  it("posts nothing when a chosen photo is taken back out of the field", async () => {
    const props = await rendered(null);
    props.onFileChange?.(null);
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("posts removePhoto when the chef removes the saved photo", async () => {
    const props = await rendered("https://example.com/me.jpg");
    props.onRemove?.();
    const [formData, options] = mockSubmit.mock.calls[0]!;
    expect((formData as FormData).get("intent")).toBe("removePhoto");
    expect(options).toEqual({ method: "post" });
  });

  it("shows an upload's error, and not another form's", async () => {
    expect((await rendered(null, { success: false, intent: "uploadPhoto", error: "file_too_large", message: "File size exceeds 5MB limit" } as AccountSettingsActionResult)).error).toBe("File size exceeds 5MB limit");
    field = undefined;
    expect((await rendered(null, { success: false, intent: "updateUserInfo", error: "x", message: "Other form" } as AccountSettingsActionResult)).error).toBeUndefined();
  });
});
