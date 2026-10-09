import { describe, expect, it } from "vitest";
import {
  isPhotoVariantKey,
  PHOTO_VARIANT_WIDTHS,
  photoSrcSet,
  photoVariantKey,
  photoVariantKeys,
  photoVariantUrl,
  photoVariantWidthFor,
} from "~/lib/photo-variants";

describe("photo variants", () => {
  it("stores each variant beside the original under variants/w<width>/", () => {
    expect(photoVariantKey("recipes/u/r/1-a.jpg", 512)).toBe("variants/w512/recipes/u/r/1-a.jpg.webp");
    expect(photoVariantKeys("covers/1-a.png")).toEqual([
      "variants/w256/covers/1-a.png.webp",
      "variants/w512/covers/1-a.png.webp",
      "variants/w1024/covers/1-a.png.webp",
      "variants/w1536/covers/1-a.png.webp",
    ]);
    expect(isPhotoVariantKey("variants/w256/covers/1-a.png.webp")).toBe(true);
    expect(isPhotoVariantKey("covers/1-a.png")).toBe(false);
  });

  it("rounds a requested width up to the next variant and caps it at the largest", () => {
    expect(photoVariantWidthFor("1")).toBe(256);
    expect(photoVariantWidthFor("256")).toBe(256);
    expect(photoVariantWidthFor("257")).toBe(512);
    expect(photoVariantWidthFor("1024")).toBe(1024);
    expect(photoVariantWidthFor("1200")).toBe(1536);
    expect(photoVariantWidthFor("999999")).toBe(1536);
  });

  it("ignores missing and malformed widths", () => {
    for (const value of [null, undefined, "", "0", "-5", "12.5", "abc", "0256", "1000000", " 256"]) {
      expect(photoVariantWidthFor(value)).toBeNull();
    }
  });

  it("asks for a variant of relative and absolute photo URLs", () => {
    expect(photoVariantUrl("/photos/covers/1-a.jpg", 512)).toBe("/photos/covers/1-a.jpg?w=512");
    expect(photoVariantUrl("https://spoonjoy.app/photos/covers/1-a.jpg", 256)).toBe(
      "https://spoonjoy.app/photos/covers/1-a.jpg?w=256",
    );
  });

  it("leaves URLs without variants unchanged", () => {
    for (const url of [
      "https://images.example.com/a.jpg",
      "/photos/",
      "/avatars/a.png",
      "/photos/covers/1-a.jpg?w=512",
      "/photos/covers/1-a.jpg#top",
      "/photos/variants/w256/covers/1-a.jpg.webp",
      "data:image/png;base64,AAAA",
      "http://[invalid",
    ]) {
      expect(photoVariantUrl(url, 512)).toBe(url);
    }
  });

  it("builds a srcset of every variant for stored photos only", () => {
    expect(photoSrcSet("/photos/covers/1-a.jpg")).toBe(
      PHOTO_VARIANT_WIDTHS.map((width) => `/photos/covers/1-a.jpg?w=${width} ${width}w`).join(", "),
    );
    expect(photoSrcSet("https://images.example.com/a.jpg")).toBeUndefined();
    expect(photoSrcSet(null)).toBeUndefined();
    expect(photoSrcSet(undefined)).toBeUndefined();
    expect(photoSrcSet("")).toBeUndefined();
  });
});
