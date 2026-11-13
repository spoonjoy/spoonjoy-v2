import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const MANIFEST_PATH = resolve(
  __dirname,
  "..",
  "..",
  "public",
  "manifest.webmanifest",
);

describe("public/manifest.webmanifest", () => {
  it("exists at public/manifest.webmanifest", () => {
    expect(existsSync(MANIFEST_PATH)).toBe(true);
  });

  it("parses as valid JSON", () => {
    const raw = readFileSync(MANIFEST_PATH, "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("contains the required PWA fields", () => {
    const m = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    expect(m.name).toBeTypeOf("string");
    expect(m.short_name).toBeTypeOf("string");
    expect(m.start_url).toBe("/");
    expect(m.display).toBe("standalone");
    expect(m.theme_color).toBeTypeOf("string");
    expect(m.background_color).toBeTypeOf("string");
  });

  it("lists 192 + 512 PNG icons at expected paths", () => {
    const m = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    expect(Array.isArray(m.icons)).toBe(true);
    const icons = m.icons as Array<{ src: string; sizes: string; type: string }>;
    const i192 = icons.find((i) => i.src === "/icons/sj-192.png");
    const i512 = icons.find((i) => i.src === "/icons/sj-512.png");
    expect(i192).toBeDefined();
    expect(i192?.sizes).toBe("192x192");
    expect(i192?.type).toBe("image/png");
    expect(i512).toBeDefined();
    expect(i512?.sizes).toBe("512x512");
    expect(i512?.type).toBe("image/png");
  });

  // iOS uses these for a saved PWA's home-screen icon, so they must be the app icon itself: a full
  // cream tile with the mark inset, not the bare mark run to the edges.
  it.each(["public/icons/sj-192.png", "public/icons/sj-512.png"])("%s is the padded app icon", async (file) => {
    const { default: sharp } = await import("sharp");
    const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3));
    const cream = [248, 245, 236];
    const edge = Math.floor(info.width * 0.15);
    for (const [x, y] of [[0, 0], [info.width - 1, info.height - 1], [edge, info.height / 2], [info.width - 1 - edge, info.height / 2]]) {
      for (const [i, channel] of pixel(Math.floor(x), Math.floor(y)).entries()) expect(Math.abs(channel - cream[i])).toBeLessThanOrEqual(3);
    }
    expect(pixel(info.width / 2, Math.floor(info.height * 0.4)).every((channel) => channel < 40)).toBe(true);
  });
});
