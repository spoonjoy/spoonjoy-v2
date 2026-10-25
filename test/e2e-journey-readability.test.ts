// The colour maths behind the landing readability journey (e2e/journeys/support/readability.ts):
// computed colours parse exactly, an unknown format fails instead of passing, and contrast follows
// WCAG 2.2's relative luminance.
import { describe, expect, it } from "vitest";
import { composite, contrastRatio, glyphCoverage, parseCssColor, relativeLuminance } from "../e2e/journeys/support/readability";

describe("parseCssColor", () => {
  it("reads the rgb() and rgba() forms browsers compute", () => {
    expect(parseCssColor("rgb(40, 35, 29)")).toEqual({ r: 40, g: 35, b: 29, a: 1 });
    expect(parseCssColor("rgba(40, 35, 29, 0.5)")).toEqual({ r: 40, g: 35, b: 29, a: 0.5 });
    expect(parseCssColor("rgb(40 35 29 / 50%)")).toEqual({ r: 40, g: 35, b: 29, a: 0.5 });
  });

  it("reads color(srgb ...), which color-mix() computes to", () => {
    expect(parseCssColor("color(srgb 1 0.5 0 / 0.76)")).toEqual({ r: 255, g: 127.5, b: 0, a: 0.76 });
    expect(parseCssColor("color(srgb 0 0 0)")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  it("throws on a format it can't measure", () => {
    expect(() => parseCssColor("oklab(0.5 0 0)")).toThrow(/Unknown colour format/);
    expect(() => parseCssColor("currentcolor")).toThrow(/Unknown colour format/);
  });
});

describe("contrast", () => {
  it("matches WCAG's extremes and a known pair", () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 5);
    // #767676 on white is the classic 4.54:1.
    expect(contrastRatio({ r: 0x76, g: 0x76, b: 0x76 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(4.54, 2);
  });

  it("is the same in either order", () => {
    const a = { r: 40, g: 35, b: 29 };
    const b = { r: 251, g: 250, b: 244 };
    expect(contrastRatio(a, b)).toBe(contrastRatio(b, a));
  });

  it("composites translucent text over its background", () => {
    expect(composite({ r: 255, g: 255, b: 255, a: 0.5 }, { r: 0, g: 0, b: 0 })).toEqual({ r: 127.5, g: 127.5, b: 127.5 });
    expect(composite({ r: 10, g: 20, b: 30, a: 1 }, { r: 200, g: 200, b: 200 })).toEqual({ r: 10, g: 20, b: 30 });
  });
});

describe("glyphCoverage", () => {
  const background = { r: 40, g: 35, b: 29 };
  const text = { r: 250, g: 248, b: 240 };

  it("reads a fully painted glyph pixel as 1 and an untouched one as 0, both on the line", () => {
    expect(glyphCoverage(background, text, text)).toEqual({ coverage: 1, offLine: 0 });
    expect(glyphCoverage(background, text, background)).toEqual({ coverage: 0, offLine: 0 });
  });

  it("reads an antialiased edge as part coverage", () => {
    const half = composite({ ...text, a: 0.5 }, background);
    expect(glyphCoverage(background, text, half).coverage).toBeCloseTo(0.5, 5);
  });

  it("puts a pixel tinted by a layer over the text off the line", () => {
    const tinted = composite({ r: 200, g: 30, b: 30, a: 0.5 }, text);
    expect(glyphCoverage(background, text, tinted).offLine).toBeGreaterThan(12);
  });

  it("gives no coverage when text and background are the same colour", () => {
    expect(glyphCoverage(background, background, text)).toEqual({ coverage: 0, offLine: 0 });
  });
});
