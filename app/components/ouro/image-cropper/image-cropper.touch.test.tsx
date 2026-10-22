import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { ImageCropper } from "~/components/ouro/image-cropper/image-cropper";
import { act } from "~/lib/ouro/testing/act";

// Runs in the `touch` project: Chromium as a 390x844 phone with a coarse pointer.

let root: Root | undefined;
const nodes: Element[] = [];
afterEach(async () => {
  await act(async () => root?.unmount());
  for (const node of nodes.splice(0)) node.remove();
});

/** A photo whose left half is red and right half blue. */
async function photo(): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 400;
  canvas.height = 200;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#ff0000";
  context.fillRect(0, 0, 200, 200);
  context.fillStyle = "#0000ff";
  context.fillRect(200, 0, 200, 200);
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((result) => resolve(result!), "image/png"));
  return new File([blob], "beach.png", { type: "image/png" });
}

/** The colour of one pixel of an image file, as [r, g, b]. */
async function pixel(file: Blob, x: number, y: number): Promise<number[]> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d")!;
  context.drawImage(bitmap, 0, 0);
  return [...context.getImageData(x, y, 1, 1).data.slice(0, 3)];
}

function Harness({ image, onCrop }: { image: File; onCrop: (file: File) => void }) {
  const [open, setOpen] = useState(true);
  return <ImageCropper open={open} onOpenChange={setOpen} image={image} onCrop={onCrop} outputWidth={100} type="image/png" />;
}

it("keeps the full frame inside the dialog on a phone, moves the photo with a finger and saves what shows", async () => {
  const onCrop = vi.fn<(file: File) => void>();
  const host = document.createElement("div");
  document.body.append(host);
  nodes.push(host);
  root = createRoot(host);
  const image = await photo();
  await act(async () => root!.render(<Harness image={image} onCrop={onCrop} />));
  const area = () => document.querySelector<HTMLElement>('[data-ouro-part="area"]')!;
  await expect.poll(() => area().hasAttribute("aria-busy")).toBe(false);
  // The frame is the 288px the crop is worked out for, not squeezed by the dialog.
  await expect.poll(() => area().getBoundingClientRect().width).toBe(288);
  const dialog = page.getByRole("dialog", { name: "Crop photo" }).element().getBoundingClientRect();
  const frame = area().getBoundingClientRect();
  expect(frame.left).toBeGreaterThanOrEqual(dialog.left);
  expect(frame.right).toBeLessThanOrEqual(dialog.right);
  expect(dialog.right).toBeLessThanOrEqual(window.innerWidth);

  const centre = { x: frame.left + frame.width / 2, y: frame.top + frame.height / 2 };
  await commands.touchDrag({ from: [centre.x, centre.y], to: [centre.x + 40, centre.y + 30], steps: 8, durationMs: 200 });
  const img = area().querySelector("img")!;
  await expect.poll(() => [...img.style.translate.matchAll(/([+-])\s*(\d+(?:\.\d+)?)px/g)].map(([, sign, value]) => (sign === "-" ? -Number(value) : Number(value)))).toEqual([40, 0]);
  const shown = img.getBoundingClientRect();
  // Where the red half meets the blue one, across the frame, as it shows on screen.
  const seam = ((shown.left + shown.width / 2 - frame.left) / frame.width) * 100;
  expect(seam).toBeGreaterThan(55);
  await userEvent.click(page.getByRole("button", { name: "Save" }));
  await expect.poll(() => onCrop.mock.calls.length).toBe(1);
  const cropped = onCrop.mock.calls[0]![0];
  expect(await pixel(cropped, Math.floor(seam) - 3, 50)).toEqual([255, 0, 0]);
  expect(await pixel(cropped, Math.ceil(seam) + 3, 50)).toEqual([0, 0, 255]);
});
