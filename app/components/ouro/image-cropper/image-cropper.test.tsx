import { useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, server, userEvent } from "vitest/browser";
import { ImageCropper, type ImageCropperProps } from "~/components/ouro/image-cropper/image-cropper";
import { clampOffset, coverScale, cropRect } from "~/components/ouro/image-cropper/image-cropper-styles";
import { act } from "~/lib/ouro/testing/act";
import { watchAnnouncements } from "~/lib/ouro/testing/announcements";

const roots: Root[] = [];
let mounted: Element[] = [];

/** A photo whose left half is red and right half blue. */
async function photo(width = 400, height = 200, name = "beach.png"): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#ff0000";
  context.fillRect(0, 0, width / 2, height);
  context.fillStyle = "#0000ff";
  context.fillRect(width / 2, 0, width / 2, height);
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((result) => resolve(result!), "image/png"));
  return new File([blob], name, { type: "image/png" });
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

function Harness(props: Partial<ImageCropperProps> & { onCropped: (file: File) => void; onOpen?: (open: boolean) => void }) {
  const { onCropped, onOpen, ...rest } = props;
  const [open, setOpen] = useState(true);
  return (
    <ImageCropper
      image={null}
      {...rest}
      open={open}
      onOpenChange={(next) => {
        onOpen?.(next);
        setOpen(next);
      }}
      onCrop={onCropped}
    />
  );
}

async function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return { host, root };
}

const area = () => document.querySelector<HTMLElement>('[data-ouro-part="area"]')!;
const image = () => area().querySelector("img")!;
const save = () => page.getByRole("button", { name: "Save" });
/** The cropper's own status region, apart from the zoom slider's. */
const status = () => document.querySelector<HTMLElement>('[data-ouro="image-cropper"] > p[role="status"]')!;
const loaded = () => expect.poll(() => area().hasAttribute("aria-busy")).toBe(false);
/** The photo's offset from the frame's centre, in pixels, from its `translate`. */
const offsetOf = () => [...image().style.translate.matchAll(/([+-])\s*(\d+(?:\.\d+)?)px/g)].map(([, sign, value]) => (sign === "-" ? -Number(value) : Number(value)));

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
});

describe("ImageCropper geometry", () => {
  it("covers the frame, keeps the image over it, and reads the crop in the image's pixels", () => {
    const image = { width: 400, height: 200 };
    const frame = { width: 288, height: 288 };
    expect(coverScale(image, frame)).toBe(1.44);
    expect(clampOffset(image, frame, 1.44, { x: 500, y: 20 })).toEqual({ x: 144, y: 0 });
    expect(clampOffset(image, frame, 1.44, { x: -500, y: -20 })).toEqual({ x: -144, y: -0 });
    expect(clampOffset({ width: 10, height: 10 }, frame, 1, { x: 5, y: 5 })).toEqual({ x: 0, y: 0 });
    expect(cropRect(image, frame, 1.44, { x: 0, y: 0 })).toEqual({ x: 100, y: 0, width: 200, height: 200 });
  });
});

describe("ImageCropper", () => {
  it("opens as a dialog with the photo in a named crop area and a zoom slider, Save waiting for the photo", async () => {
    const file = await photo();
    await render(<Harness image={file} onCropped={() => {}} />);
    await expect.element(page.getByRole("dialog", { name: "Crop photo" })).toBeVisible();
    await expect.element(page.getByRole("application", { name: "Photo to crop" })).toHaveAccessibleDescription("Drag the photo, or move it with the arrow keys, to choose what shows. Plus and minus zoom.");
    await expect.element(page.getByRole("slider", { name: "Zoom" })).toBeInTheDocument();
    await loaded();
    await expect.element(save()).toBeEnabled();
    expect(image().src).toMatch(/^blob:/);
    await expect.poll(() => area().getBoundingClientRect().width).toBe(288);
    expect(area().getBoundingClientRect().height).toBe(288);
    expect(document.querySelector('[data-ouro="image-cropper"]')!.getAttribute("data-shape")).toBe("rect");
  });

  it("saves the centre of the photo at the output size, named after the file, and closes", async () => {
    const onCropped = vi.fn<(file: File) => void>();
    const onOpen = vi.fn();
    await render(<Harness image={await photo()} onCropped={onCropped} onOpen={onOpen} outputWidth={100} type="image/png" />);
    await loaded();
    await userEvent.click(save());
    await expect.poll(() => onCropped.mock.calls.length).toBe(1);
    const cropped = onCropped.mock.calls[0]![0];
    expect(cropped.name).toBe("beach.png");
    expect(cropped.type).toBe("image/png");
    const bitmap = await createImageBitmap(cropped);
    expect([bitmap.width, bitmap.height]).toEqual([100, 100]);
    expect(await pixel(cropped, 10, 50)).toEqual([255, 0, 0]);
    expect(await pixel(cropped, 90, 50)).toEqual([0, 0, 255]);
    expect(onOpen).toHaveBeenCalledWith(false);
  });

  it("moves the photo the way the arrow keys point, ten times further with Shift, and never past its edge", async () => {
    const onCropped = vi.fn<(file: File) => void>();
    await render(<Harness image={await photo()} onCropped={onCropped} outputWidth={100} type="image/png" />);
    await loaded();
    area().focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(offsetOf()).toEqual([-10, 0]);
    await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowUp}{ArrowDown}");
    expect(offsetOf()).toEqual([10, 0]);
    await userEvent.keyboard("{Shift>}{ArrowRight}{ArrowRight}{ArrowRight}{/Shift}");
    expect(offsetOf()).toEqual([144, 0]);
    await userEvent.keyboard("a");
    await userEvent.click(save());
    await expect.poll(() => onCropped.mock.calls.length).toBe(1);
    // Moved all the way right, the frame shows the photo's left, red edge.
    expect(await pixel(onCropped.mock.calls[0]![0], 95, 50)).toEqual([255, 0, 0]);
  });

  it("centres the photo in a right-to-left page and saves the part that shows", async () => {
    document.documentElement.dir = "rtl";
    try {
      const onCropped = vi.fn<(file: File) => void>();
      await render(<Harness image={await photo()} onCropped={onCropped} outputWidth={100} type="image/png" />);
      await loaded();
      const centre = (rect: DOMRect) => [rect.left + rect.width / 2, rect.top + rect.height / 2];
      await expect.poll(() => centre(image().getBoundingClientRect()).map(Math.round)).toEqual(centre(area().getBoundingClientRect()).map(Math.round));
      area().focus();
      await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}");
      // Where the red half meets the blue one, across the frame, as it shows on screen.
      const photoBox = image().getBoundingClientRect();
      const frameBox = area().getBoundingClientRect();
      const seam = ((photoBox.left + photoBox.width / 2 - frameBox.left) / frameBox.width) * 100;
      expect(seam).toBeGreaterThan(60);
      expect(seam).toBeLessThan(75);
      await userEvent.click(save());
      await expect.poll(() => onCropped.mock.calls.length).toBe(1);
      const cropped = onCropped.mock.calls[0]![0];
      expect(await pixel(cropped, Math.floor(seam) - 3, 50)).toEqual([255, 0, 0]);
      expect(await pixel(cropped, Math.ceil(seam) + 3, 50)).toEqual([0, 0, 255]);
    } finally {
      document.documentElement.removeAttribute("dir");
    }
  });

  it("zooms with Plus and Minus and the slider, between one and three times", async () => {
    await render(<Harness image={await photo()} onCropped={() => {}} />);
    await loaded();
    const width = () => image().getBoundingClientRect().width;
    expect(Math.round(width())).toBe(576);
    area().focus();
    await userEvent.keyboard("+=");
    expect(Math.round(width())).toBe(691);
    await userEvent.keyboard("-_-");
    expect(Math.round(width())).toBe(576);
    const slider = page.getByRole("slider", { name: "Zoom" }).element() as HTMLInputElement;
    slider.focus();
    await userEvent.keyboard("{End}");
    await expect.poll(() => Math.round(width())).toBe(1728);
    await expect.element(page.getByRole("slider", { name: "Zoom" })).toHaveAttribute("aria-valuetext", "300%");
  });

  it("moves the photo with a drag", async () => {
    if (server.browser !== "chromium") return;
    await render(<Harness image={await photo()} onCropped={() => {}} />);
    await loaded();
    const box = area().getBoundingClientRect();
    const centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    await commands.drag({ from: [centre.x, centre.y], to: [centre.x + 40, centre.y + 30], steps: 6, durationMs: 200 });
    await expect.poll(offsetOf).toEqual([40, 0]);
  });

  it("frames a circle for a profile photo and a rectangle of the aspect", async () => {
    const file = await photo();
    const { root } = await render(<Harness image={file} onCropped={() => {}} shape="circle" />);
    expect(parseFloat(getComputedStyle(area()).borderTopLeftRadius)).toBeGreaterThanOrEqual(144);
    await act(async () => root.render(<Harness image={file} onCropped={() => {}} aspect={16 / 9} title="Crop cover" />));
    await expect.element(page.getByRole("dialog", { name: "Crop cover" })).toBeVisible();
    await expect.poll(() => area().getBoundingClientRect().height).toBe(162);
  });

  it("crops a Blob or an image address too, naming the file photo", async () => {
    const onCropped = vi.fn<(file: File) => void>();
    const file = await photo(200, 200);
    const blob = new Blob([await file.arrayBuffer()], { type: "image/png" });
    const { root } = await render(<Harness image={blob} onCropped={onCropped} outputWidth={20} />);
    await loaded();
    await userEvent.click(save());
    await expect.poll(() => onCropped.mock.calls.length).toBe(1);
    expect(onCropped.mock.calls[0]![0].name).toBe("photo.jpg");
    expect(onCropped.mock.calls[0]![0].type).toBe("image/jpeg");
    const reader = new FileReader();
    const address = await new Promise<string>((resolve) => {
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(file);
    });
    // Save closed the first dialog; a new one opens on the address.
    await act(async () => root.render(<Harness key="address" image={address} onCropped={onCropped} type="image/webp" />));
    await loaded();
    expect(image().src).toBe(address);
    expect(image().crossOrigin).toBe("anonymous");
  });

  it("starts a new photo centred at the smallest zoom", async () => {
    const first = await photo();
    const { root } = await render(<Harness image={first} onCropped={() => {}} />);
    await loaded();
    area().focus();
    await userEvent.keyboard("+{ArrowLeft}");
    await act(async () => root.render(<Harness image={await photo(300, 300, "b.png")} onCropped={() => {}} />));
    await loaded();
    expect(offsetOf()).toEqual([0, 0]);
    expect(Math.round(image().getBoundingClientRect().width)).toBe(288);
  });

  it("ignores keys and drags before the photo loads, and shows nothing without one", async () => {
    await render(<Harness image={null} onCropped={() => {}} />);
    expect(area().querySelector("img")).toBeNull();
    area().focus();
    await userEvent.keyboard("{ArrowLeft}+");
    await expect.element(save()).toBeDisabled();
    expect(area().getAttribute("aria-busy")).toBe("true");
  });

  it("closes on Cancel without cropping", async () => {
    const onCropped = vi.fn();
    const onOpen = vi.fn();
    await render(<Harness image={await photo()} onCropped={onCropped} onOpen={onOpen} labels={{ cancel: undefined }} />);
    await loaded();
    await userEvent.click(page.getByRole("button", { name: "Cancel" }));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(false);
    expect(onCropped).not.toHaveBeenCalled();
  });

  it.each([
    ["a file the browser cannot decode", () => new File(["not a picture"], "scan.heic", { type: "image/heic" })],
    ["an address it cannot read", () => "data:image/png;base64,AAAA"],
  ])("says so, stops waiting and tells the app when it cannot open %s", async (_name, make) => {
    const announced = watchAnnouncements();
    const onError = vi.fn();
    await render(<Harness image={make()} onCropped={() => {}} onError={onError} />);
    await expect.poll(() => onError.mock.calls).toEqual([["open"]]);
    const message = "This photo could not be opened. Choose another one.";
    await expect.poll(() => status().textContent).toBe(message);
    await expect.element(page.getByText(message)).toBeVisible();
    expect(area().hasAttribute("aria-busy")).toBe(false);
    await expect.element(page.getByRole("application", { name: "Photo to crop" })).toHaveAccessibleDescription(/could not be opened/);
    await expect.element(save()).toBeDisabled();
    await expect.element(page.getByRole("slider", { name: "Zoom" })).toBeDisabled();
    expect(area().querySelector("img")!.style.visibility).toBe("hidden");
    expect(announced.count(message)).toBe(1);
    announced.stop();
  });

  it("says so and stays open, so Save can be tried again, when the browser cannot encode the image", async () => {
    const announced = watchAnnouncements();
    const onCropped = vi.fn();
    const onOpen = vi.fn();
    const onError = vi.fn();
    const file = await photo();
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(null));
    await render(<Harness image={file} onCropped={onCropped} onOpen={onOpen} onError={onError} labels={{ save: "Use photo", saveError: "Nicht gespeichert." }} />);
    await loaded();
    await userEvent.click(page.getByRole("button", { name: "Use photo" }));
    await expect.poll(() => status().textContent).toBe("Nicht gespeichert.");
    await expect.element(page.getByRole("button", { name: "Use photo" })).toBeEnabled();
    expect(onError).toHaveBeenCalledExactlyOnceWith("save");
    expect(announced.count("Nicht gespeichert.")).toBe(1);
    await userEvent.click(page.getByRole("button", { name: "Use photo" }));
    await expect.poll(() => onError.mock.calls.length).toBe(2);
    await expect.poll(() => announced.count("Nicht gespeichert.")).toBe(2);
    expect(onCropped).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    toBlob.mockRestore();
    await userEvent.click(page.getByRole("button", { name: "Use photo" }));
    await expect.poll(() => onCropped.mock.calls.length).toBe(1);
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(false);
    announced.stop();
  });

  it("lets an error thrown by onCrop reach the app instead of hiding it", async () => {
    const thrown = new Error("upload failed");
    const reasons: unknown[] = [];
    const listener = (event: PromiseRejectionEvent) => {
      event.preventDefault();
      reasons.push(event.reason);
    };
    // Vitest prints an unhandled rejection that a page listener also sees.
    vi.spyOn(console, "error").mockImplementation(() => {});
    window.addEventListener("unhandledrejection", listener);
    try {
      const onError = vi.fn();
      const onOpen = vi.fn();
      await render(
        <Harness
          image={await photo()}
          onCropped={() => {
            throw thrown;
          }}
          onOpen={onOpen}
          onError={onError}
        />,
      );
      await loaded();
      await userEvent.click(save());
      await expect.poll(() => reasons).toEqual([thrown]);
      expect(onError).not.toHaveBeenCalled();
      expect(onOpen).not.toHaveBeenCalled();
      expect(status().textContent).toBe("");
      await expect.element(save()).toBeEnabled();
    } finally {
      window.removeEventListener("unhandledrejection", listener);
    }
  });
});

describe("ImageCropper development messages", () => {
  it.each([
    ["aspect", { aspect: 0 }, "aspect={0} is not a ratio; it is the width over the height, above 0", "<ImageCropper aspect={16 / 9} />"],
    ["shape", { shape: "oval" }, 'shape="oval" is not a shape; use "rect" or "circle"', '<ImageCropper shape="circle" />'],
    ["type", { type: "image/gif" }, 'type="image/gif" is not an image format the browser saves', '<ImageCropper type="image/jpeg" />'],
    ["onChange", { onChange: () => {} }, "onChange is not a prop", "<ImageCropper onCrop={(file) => {}} />"],
    ["src", { src: "/a.png" }, "src is not a prop", "<ImageCropper image={file} />"],
    ["aspectRatio", { aspectRatio: 1 }, "aspectRatio is not a prop", "<ImageCropper aspect={16 / 9} />"],
    ["round", { round: true }, "round is not a prop", '<ImageCropper shape="circle" />'],
  ])("explains %s with the fix", async (_name, extra, problem, fix) => {
    await render(<Harness onCropped={() => {}} {...(extra as Partial<ImageCropperProps>)} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] ImageCropper: ${problem}. Fix: ${fix}.`);
  });

  it("renders to a string while closed", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(<ImageCropper open={false} onOpenChange={() => {}} image={null} onCrop={() => {}} />);
    expect(html).toBe("");
    expect(error).not.toHaveBeenCalled();
  });
});
