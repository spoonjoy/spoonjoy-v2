import { describe, expect, it } from "vitest";
import { isPictureReady, markPicturesReady, rememberPicture } from "~/lib/ouro/avatar-pictures";

// A 1x1 PNG that always loads, and an address that never does.
const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** An image at a fresh address, once the browser has loaded or failed it. */
async function settledImage(src?: string): Promise<HTMLImageElement> {
  const address = src ?? URL.createObjectURL(await (await fetch(pixel)).blob());
  const image = new Image();
  await new Promise((resolve) => {
    image.onload = image.onerror = resolve;
    image.src = address;
  });
  return image;
}

describe("avatar pictures", () => {
  it("keeps a loaded image the app marks under the src it set, and skips one with no src attribute or no picture", async () => {
    const loaded = await settledImage();
    const src = loaded.getAttribute("src")!;
    expect(isPictureReady(src)).toBe(false);
    const failed = await settledImage("data:image/png;base64,broken");
    const bare = new Image();
    markPicturesReady([loaded, failed, bare]);
    expect(isPictureReady(src)).toBe(true);
    expect(isPictureReady("data:image/png;base64,broken")).toBe(false);
  });

  it("drops the oldest picture it keeps once it holds more than a few hundred", async () => {
    const image = await settledImage();
    rememberPicture("first", image);
    for (let index = 0; index < 256; index++) rememberPicture(`later-${index}`, image);
    expect(isPictureReady("first")).toBe(false);
    expect(isPictureReady("later-255")).toBe(true);
  });
});
