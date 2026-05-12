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
});
