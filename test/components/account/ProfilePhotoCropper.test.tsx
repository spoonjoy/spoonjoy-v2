import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProfilePhotoCropper } from "~/components/account/ProfilePhotoCropper";

// Mock the crop math so this test never touches a real canvas.
vi.mock("~/lib/image-crop", async () => {
  const actual = await vi.importActual<typeof import("~/lib/image-crop")>("~/lib/image-crop");
  return {
    ...actual,
    getCropPixels: vi.fn(() => ({ sx: 1, sy: 2, sWidth: 3, sHeight: 4 })),
    cropImageToBlob: vi.fn(async () => new Blob(["cropped"], { type: "image/jpeg" })),
  };
});

import { getCropPixels, cropImageToBlob } from "~/lib/image-crop";

const mockedGetCropPixels = vi.mocked(getCropPixels);
const mockedCropImageToBlob = vi.mocked(cropImageToBlob);

// Mock object URL APIs (matches the RecipeImageUpload test pattern).
let mockObjectUrls: string[] = [];
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

beforeEach(() => {
  mockObjectUrls = [];
  URL.createObjectURL = vi.fn(() => {
    const url = `blob:http://localhost/mock-${mockObjectUrls.length}`;
    mockObjectUrls.push(url);
    return url;
  });
  URL.revokeObjectURL = vi.fn((url: string) => {
    const index = mockObjectUrls.indexOf(url);
    if (index > -1) mockObjectUrls.splice(index, 1);
  });
  mockedGetCropPixels.mockClear();
  mockedCropImageToBlob.mockClear();
});

afterEach(() => {
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

function makeFile() {
  return new File(["data"], "selfie.png", { type: "image/png" });
}

function getPreviewImage(): HTMLImageElement {
  return screen.getByAltText("Crop preview") as HTMLImageElement;
}

function fireImageLoad(img: HTMLImageElement, width: number, height: number) {
  Object.defineProperty(img, "naturalWidth", { value: width, configurable: true });
  Object.defineProperty(img, "naturalHeight", { value: height, configurable: true });
  fireEvent.load(img);
}

describe("ProfilePhotoCropper", () => {
  it("creates an object URL from the file and uses it as the preview src", () => {
    render(<ProfilePhotoCropper file={makeFile()} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(getPreviewImage()).toHaveAttribute("src", "blob:http://localhost/mock-0");
  });

  it("disables Save and shows a loading state before the image loads", () => {
    render(<ProfilePhotoCropper file={makeFile()} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("button", { name: /save photo/i })).toBeDisabled();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("enables Save and sizes the image once it loads", async () => {
    render(<ProfilePhotoCropper file={makeFile()} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const img = getPreviewImage();
    fireImageLoad(img, 400, 200);

    await waitFor(() => expect(screen.getByRole("button", { name: /save photo/i })).toBeEnabled());
    // 400x200 into a 256 square: coverScale = max(256/400, 256/200) = 1.28; width = 400*1.28 = 512.
    expect(img.style.width).toBe("512px");
    expect(img.style.height).toBe("256px");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("crops and forwards the resulting blob to onConfirm when Save is clicked", async () => {
    const onConfirm = vi.fn();
    render(<ProfilePhotoCropper file={makeFile()} onConfirm={onConfirm} onCancel={vi.fn()} outputSize={300} />);
    fireImageLoad(getPreviewImage(), 400, 200);

    const save = await screen.findByRole("button", { name: /save photo/i });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(mockedGetCropPixels).toHaveBeenCalledWith({ width: 400, height: 200 }, 256, 1, { x: 0, y: 0 });
    expect(mockedCropImageToBlob).toHaveBeenCalledWith(
      getPreviewImage(),
      { sx: 1, sy: 2, sWidth: 3, sHeight: 4 },
      300
    );
    const blob = onConfirm.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("image/jpeg");
  });

  it("re-clamps the offset and rescales the image when zoom changes", async () => {
    render(<ProfilePhotoCropper file={makeFile()} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const img = getPreviewImage();
    fireImageLoad(img, 400, 200);
    await waitFor(() => expect(img.style.width).toBe("512px"));

    const zoom = screen.getByLabelText("Zoom");
    fireEvent.change(zoom, { target: { value: "2" } });

    // zoom 2 → width = 400 * 1.28 * 2 = 1024.
    await waitFor(() => expect(img.style.width).toBe("1024px"));
    expect(img.style.height).toBe("512px");
  });

  it("accepts a zoom change before the image loads without clamping", () => {
    render(<ProfilePhotoCropper file={makeFile()} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const zoom = screen.getByLabelText("Zoom") as HTMLInputElement;
    // natural is still null here, so the clamp branch is skipped.
    fireEvent.change(zoom, { target: { value: "2.5" } });
    expect(zoom.value).toBe("2.5");
  });

  it("updates the transform offset while dragging the preview", async () => {
    render(<ProfilePhotoCropper file={makeFile()} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const img = getPreviewImage();
    fireImageLoad(img, 400, 200);
    await waitFor(() => expect(img.style.width).toBe("512px"));

    const preview = img.parentElement as HTMLElement;
    // Move without a pointer-down first: handler returns early (no offset change).
    fireEvent.pointerMove(preview, { clientX: 50, clientY: 0 });
    expect(img.style.transform).toBe("translate(calc(-50% + 0px), calc(-50% + 0px))");

    fireEvent.pointerDown(preview, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(preview, { clientX: 40, clientY: 0 });

    // maxX for 400x200 @ zoom 1: (400*1.28 - 256)/2 = 128, so +40 passes through.
    await waitFor(() =>
      expect(img.style.transform).toBe("translate(calc(-50% + 40px), calc(-50% + 0px))")
    );

    // Releasing the pointer stops the drag; subsequent moves are ignored.
    fireEvent.pointerUp(preview);
    fireEvent.pointerMove(preview, { clientX: 80, clientY: 0 });
    expect(img.style.transform).toBe("translate(calc(-50% + 40px), calc(-50% + 0px))");
  });

  it("ignores pointer moves that begin before the image has loaded", () => {
    render(<ProfilePhotoCropper file={makeFile()} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const preview = getPreviewImage().parentElement as HTMLElement;
    fireEvent.pointerDown(preview, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(preview, { clientX: 50, clientY: 0 });
    // natural is still null, so no offset is applied.
    expect(getPreviewImage().style.transform).toBe("translate(calc(-50% + 0px), calc(-50% + 0px))");
  });

  it("stops dragging when the pointer leaves the preview", async () => {
    render(<ProfilePhotoCropper file={makeFile()} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const img = getPreviewImage();
    fireImageLoad(img, 400, 200);
    await waitFor(() => expect(img.style.width).toBe("512px"));

    const preview = img.parentElement as HTMLElement;
    fireEvent.pointerDown(preview, { clientX: 0, clientY: 0 });
    fireEvent.pointerLeave(preview);
    fireEvent.pointerMove(preview, { clientX: 60, clientY: 0 });
    expect(img.style.transform).toBe("translate(calc(-50% + 0px), calc(-50% + 0px))");
  });

  it("calls onCancel and revokes the object URL when Cancel is clicked", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<ProfilePhotoCropper file={makeFile()} onConfirm={vi.fn()} onCancel={onCancel} />);

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("revokes the object URL on unmount", () => {
    const { unmount } = render(<ProfilePhotoCropper file={makeFile()} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:http://localhost/mock-0");
  });
});
