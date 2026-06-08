import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestRoutesStub } from "../../utils";
import { ProfilePhotoField } from "~/components/account/ProfilePhotoField";
import type { AccountSettingsActionResult } from "~/lib/account-settings.server";

// Mock useSubmit + useActionData so we can assert orchestration without a real
// navigation, and inject server action results directly.
const mockSubmit = vi.fn();
let mockActionData: AccountSettingsActionResult | undefined;
vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useSubmit: () => mockSubmit,
    useActionData: () => mockActionData,
  };
});

// Mock the cropper so this test only exercises the field's orchestration.
let cropperProps: { file: File; onConfirm: (blob: Blob) => void; onCancel: () => void } | null = null;
vi.mock("~/components/account/ProfilePhotoCropper", () => ({
  ProfilePhotoCropper: (props: { file: File; onConfirm: (blob: Blob) => void; onCancel: () => void }) => {
    cropperProps = props;
    return (
      <div data-testid="mock-cropper">
        <button type="button" onClick={() => props.onConfirm(new Blob(["x"], { type: "image/jpeg" }))}>
          mock-save
        </button>
        <button type="button" onClick={() => props.onCancel()}>
          mock-cancel
        </button>
      </div>
    );
  },
}));

function renderField(photoUrl: string | null, actionData?: AccountSettingsActionResult) {
  mockActionData = actionData;
  const Stub = createTestRoutesStub([
    {
      path: "/account/settings",
      Component: () => <ProfilePhotoField photoUrl={photoUrl} />,
      loader: () => null,
    },
  ]);
  return render(<Stub initialEntries={["/account/settings"]} />);
}

function getFileInput(): HTMLInputElement {
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

beforeEach(() => {
  cropperProps = null;
  mockActionData = undefined;
  mockSubmit.mockClear();
});

describe("ProfilePhotoField", () => {
  it("shows the Upload Photo button and no Remove Photo button without a photo", async () => {
    renderField(null);
    expect(await screen.findByRole("button", { name: /upload photo/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove photo/i })).not.toBeInTheDocument();
  });

  it("shows Change Photo and Remove Photo when a photo is present", async () => {
    renderField("https://example.com/me.jpg");
    expect(await screen.findByRole("button", { name: /change photo/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove photo/i })).toBeInTheDocument();
  });

  it("renders the Remove Photo form with the removePhoto intent", async () => {
    renderField("https://example.com/me.jpg");
    const removeButton = await screen.findByRole("button", { name: /remove photo/i });
    const form = removeButton.closest("form") as HTMLFormElement;
    expect(form.querySelector('input[name="intent"]')).toHaveValue("removePhoto");
  });

  it("clicking the upload button triggers the hidden file input", async () => {
    const user = userEvent.setup();
    renderField(null);
    await screen.findByRole("button", { name: /upload photo/i });
    const clickSpy = vi.spyOn(getFileInput(), "click");
    await user.click(screen.getByRole("button", { name: /upload photo/i }));
    expect(clickSpy).toHaveBeenCalled();
  });

  it("uses an explicit profile-photo allow-list that still includes GIF and WebP", async () => {
    renderField(null);
    await screen.findByRole("button", { name: /upload photo/i });

    expect(getFileInput()).toHaveAttribute("accept", "image/jpeg,image/png,image/gif,image/webp");
    expect(screen.getByText(/jpg, png, gif, or webp/i)).toBeInTheDocument();
  });

  it("opens the cropper when a valid file is selected", async () => {
    renderField(null);
    await screen.findByRole("button", { name: /upload photo/i });
    const file = new File(["data"], "ok.png", { type: "image/png" });
    fireEvent.change(getFileInput(), { target: { files: [file] } });

    expect(await screen.findByTestId("mock-cropper")).toBeInTheDocument();
    expect(cropperProps?.file).toBe(file);
  });

  it("submits a multipart FormData with the cropped blob on confirm", async () => {
    renderField(null);
    await screen.findByRole("button", { name: /upload photo/i });
    const file = new File(["data"], "ok.png", { type: "image/png" });
    fireEvent.change(getFileInput(), { target: { files: [file] } });

    await screen.findByTestId("mock-cropper");
    fireEvent.click(screen.getByText("mock-save"));

    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    const [formData, options] = mockSubmit.mock.calls[0];
    expect(formData).toBeInstanceOf(FormData);
    expect((formData as FormData).get("intent")).toBe("uploadPhoto");
    const photo = (formData as FormData).get("photo") as File;
    expect(photo).toBeInstanceOf(File);
    expect(photo.name).toBe("avatar.jpg");
    expect(photo.type).toBe("image/jpeg");
    expect(options).toEqual({ method: "post", encType: "multipart/form-data" });

    // The cropper closes after confirming.
    await waitFor(() => expect(screen.queryByTestId("mock-cropper")).not.toBeInTheDocument());
  });

  it("defaults the photo MIME type when the blob has none", async () => {
    renderField(null);
    await screen.findByRole("button", { name: /upload photo/i });
    fireEvent.change(getFileInput(), { target: { files: [new File(["d"], "ok.png", { type: "image/png" })] } });
    await screen.findByTestId("mock-cropper");

    // Directly invoke onConfirm with a typeless blob to hit the fallback branch.
    cropperProps!.onConfirm(new Blob(["x"]));

    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    const photo = (mockSubmit.mock.calls[0][0] as FormData).get("photo") as File;
    expect(photo.type).toBe("image/jpeg");
  });

  it("closes the cropper and resets the input on cancel", async () => {
    renderField(null);
    await screen.findByRole("button", { name: /upload photo/i });
    const input = getFileInput();
    fireEvent.change(input, { target: { files: [new File(["d"], "ok.png", { type: "image/png" })] } });
    await screen.findByTestId("mock-cropper");

    fireEvent.click(screen.getByText("mock-cancel"));

    await waitFor(() => expect(screen.queryByTestId("mock-cropper")).not.toBeInTheDocument());
    expect(input.value).toBe("");
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("rejects a file with an unsupported type and does not open the cropper", async () => {
    renderField(null);
    await screen.findByRole("button", { name: /upload photo/i });
    fireEvent.change(getFileInput(), { target: { files: [new File(["d"], "bad.svg", { type: "image/svg+xml" })] } });

    expect(await screen.findByText(/please upload an image file/i)).toBeInTheDocument();
    expect(screen.queryByTestId("mock-cropper")).not.toBeInTheDocument();
  });

  it("rejects an oversized file and does not open the cropper", async () => {
    renderField(null);
    await screen.findByRole("button", { name: /upload photo/i });
    const big = new File([new Uint8Array(6 * 1024 * 1024)], "big.png", { type: "image/png" });
    fireEvent.change(getFileInput(), { target: { files: [big] } });

    expect(await screen.findByText(/photo must be less than 5mb/i)).toBeInTheDocument();
    expect(screen.queryByTestId("mock-cropper")).not.toBeInTheDocument();
  });

  it("displays the server action error message", async () => {
    renderField(null, { success: false, error: "file_too_large", message: "File size exceeds 5MB limit" });
    expect(await screen.findByText(/file size exceeds 5mb limit/i)).toBeInTheDocument();
  });
});
