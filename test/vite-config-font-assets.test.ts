// @vitest-environment node
import { describe, expect, it } from "vitest";
import { inlinesAsset } from "../vite.config";

describe("font files in the client build", () => {
  it("keeps every font a file, which font-src 'self' allows, and leaves other assets to Vite's default", () => {
    expect(inlinesAsset("/repo/app/fonts/ibm-plex-sans-condensed-700-cyrillic-ext.woff2")).toBe(false);
    expect(inlinesAsset("/repo/app/fonts/legacy.woff")).toBe(false);
    expect(inlinesAsset("/repo/app/assets/icon.svg")).toBeUndefined();
    expect(inlinesAsset("/repo/app/assets/photo.png")).toBeUndefined();
  });
});
