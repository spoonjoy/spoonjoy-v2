import { describe, expect, it } from "vitest";
import { isTransparent } from "./color";

describe("computed color transparency", () => {
  it.each([
    "rgba(0, 0, 0, 0)",
    "rgba(255, 127, 23, 0)",
    "rgb(255 127 23 / 0)",
    "rgb(100% 50% 0% / 0%)",
    "oklab(0 0 0 / 0)",
    "oklch(0.5 0.1 90 / 0)",
    "lab(50 10 -10 / 0)",
    "lch(50 10 90 / 0)",
    "color(display-p3 1 0.5 0 / 0)",
    "color(srgb 1 0 0 / 0e-10)",
  ])("recognizes exact zero alpha in %s", (color) => {
    expect(isTransparent(color)).toBe(true);
  });

  it.each([
    "rgb(0, 0, 0)",
    "rgba(0, 0, 0, 1)",
    "rgba(0, 0, 0, 0.000001)",
    "rgb(0 0 0 / 0.000001%)",
    "oklab(0 0 0 / 0.000001)",
    "oklch(0.5 0.1 90)",
    "color(display-p3 0 0 0 / 1e-999)",
    "color(srgb 0 0 0)",
  ])("rejects painted backgrounds even with tiny alpha in %s", (color) => {
    expect(isTransparent(color)).toBe(false);
  });

  it.each([
    "",
    "transparent",
    "not-a-color",
    "var(--background)",
    "oklab(0 0 / 0)",
    "oklab(0 0 0 / none)",
    "oklab(0 0 0 / NaN)",
    "oklab(0 0 0 / 0 garbage)",
    "oklab(0 0 0 / 0 / 0)",
    "oklab(0 0 0 / -0.1)",
    "rgba(0, 0, 0, 2)",
    "rgba(0, 0, 0, 0) trailing",
    "mystery(0 0 0 / 0)",
    "color(mystery 0 0 0 / 0)",
  ])("fails explicitly for unsupported computed colors: %s", (color) => {
    expect(() => isTransparent(color)).toThrow(/Unsupported computed color/);
  });
});
