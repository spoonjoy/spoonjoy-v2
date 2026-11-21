import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Avatar } from "~/components/ouro/avatar/avatar";
import { markPicturesReady } from "~/lib/ouro/avatar-pictures";

// A 2x2 PNG that always loads, and one that never does.
const photo =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4AWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const broken = "data:image/png;base64,broken";

const roots: Root[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) flushSync(() => root.unmount());
  for (const host of hosts.splice(0)) host.remove();
  vi.unstubAllGlobals();
});

/** A photo at an address the page has not used, so no earlier test has marked or loaded it. */
async function freshPicture(): Promise<string> {
  const blob = await (await fetch(photo)).blob();
  return URL.createObjectURL(blob);
}

/** Resolves once the browser has loaded or failed the address, with the image still in hand. */
function settled(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  return new Promise((resolve) => {
    image.onload = image.onerror = () => resolve(image);
    image.src = src;
  });
}

/**
 * Makes every image created from now on report itself incomplete, as a fresh image for an address the
 * browser already holds can on Linux CI and Edge. Avatar's first-frame check then sees what the issue describes.
 */
function incompleteImages(): void {
  class Incomplete extends window.Image {
    override get complete(): boolean {
      return false;
    }
  }
  vi.stubGlobal("Image", Incomplete);
}

/** Renders in one synchronous commit, layout effects included, so the DOM read after it is the first paint. */
function firstPaint(src: string | undefined, name = "Ana Lind"): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  const root = createRoot(host);
  roots.push(root);
  flushSync(() => root.render(<Avatar name={name} src={src} />));
  return host.querySelector<HTMLElement>('[data-ouro="avatar"]')!;
}

/** The letters the avatar draws, as its `::before` content resolves in the browser. */
function drawn(avatar: HTMLElement): string {
  const letters = avatar.querySelector<HTMLElement>("[data-ouro-avatar-initials]");
  const content = letters ? getComputedStyle(letters, "::before").content : "none";
  return content.startsWith('"') ? (JSON.parse(content) as string) : "";
}

describe("Avatar with pictures the app marked ready", () => {
  it("draws a marked picture on its first frame, though a fresh image for it is not complete yet", async () => {
    const src = await freshPicture();
    markPicturesReady([await settled(src)]);
    incompleteImages();
    const avatar = firstPaint(src);
    expect(avatar.getAttribute("data-image")).toBe("loaded");
    expect(avatar.querySelector("img")?.getAttribute("src")).toBe(src);
    expect(drawn(avatar)).toBe("");
  });

  it("draws initials on the first frame for a picture the app did not mark, while a fresh image is incomplete", async () => {
    const src = await freshPicture();
    await settled(src);
    incompleteImages();
    const avatar = firstPaint(src);
    expect(avatar.querySelector("img")).toBeNull();
    expect(drawn(avatar)).toBe("AL");
    await expect.poll(() => avatar.getAttribute("data-image")).toBe("loaded");
  });

  it("does not mark an image that has not loaded yet", async () => {
    const src = await freshPicture();
    const pending = new Image();
    pending.src = src;
    markPicturesReady([pending]);
    incompleteImages();
    const avatar = firstPaint(src);
    expect(avatar.querySelector("img")).toBeNull();
    expect(drawn(avatar)).toBe("AL");
    await expect.poll(() => avatar.getAttribute("data-image")).toBe("loaded");
  });

  it("does not mark an image that failed to load", async () => {
    const failed = await settled(broken);
    expect(failed.naturalWidth).toBe(0);
    markPicturesReady([failed]);
    incompleteImages();
    const avatar = firstPaint(broken);
    expect(avatar.querySelector("img")).toBeNull();
    expect(drawn(avatar)).toBe("AL");
    await expect.poll(() => avatar.getAttribute("data-image")).toBe("error");
  });
});
