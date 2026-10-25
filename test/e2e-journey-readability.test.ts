// The colour maths behind the landing readability journey (e2e/journeys/support/readability.ts):
// computed colours parse exactly, an unknown format fails instead of passing, and contrast follows
// WCAG 2.2's relative luminance, and a control's edge is compared with the pixels just outside it.
import { describe, expect, it } from "vitest";
import { composite, contrastRatio, edgeContrast, glyphCoverage, parseCssColor, relativeLuminance, type PixelGrid, type Rgb } from "../e2e/journeys/support/readability";

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

describe("edgeContrast", () => {
  const photo: Rgb = { r: 40, g: 38, b: 33 };
  const charcoal: Rgb = { r: 40, g: 35, b: 29 };
  const amber: Rgb = { r: 185, g: 133, b: 75 };
  const line: Rgb = { r: 200, g: 198, b: 190 };

  // A 40x20 CSS px clip at `scale` image pixels per CSS px, painted by `paint(x, y)` in CSS px.
  function grid(scale: number, paint: (x: number, y: number) => Rgb): PixelGrid {
    const clip = { x: 10, y: 10, width: 40, height: 20 };
    const width = clip.width * scale;
    const height = clip.height * scale;
    const data = new Uint8Array(width * height * 4);
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const { r, g, b } = paint(clip.x + (column + 0.5) / scale, clip.y + (row + 0.5) / scale);
        data.set([r, g, b, 255], (row * width + column) * 4);
      }
    }
    return { data, width, height, scale, clip };
  }
  const box = { x: 15, y: 15, width: 30, height: 10 };
  const inBox = (x: number, y: number, inset = 0) =>
    x >= box.x + inset && x < box.x + box.width - inset && y >= box.y + inset && y < box.y + box.height - inset;

  it("reads a fill that merges with the photo as the failing edge", () => {
    const result = edgeContrast(grid(1, (x, y) => (inBox(x, y) ? charcoal : photo)), box, 1, 0);
    expect(result.minimum).toBeCloseTo(contrastRatio(charcoal, photo), 5);
    expect(result.minimum).toBeLessThan(3);
    expect(result.inside).toEqual(charcoal);
    expect(result.outside).toEqual(photo);
  });

  it("reads an amber fill against the same photo as a visible edge, at a phone's 3x too", () => {
    for (const scale of [1, 3]) {
      const result = edgeContrast(grid(scale, (x, y) => (inBox(x, y) ? amber : photo)), box, 1, 0);
      expect(result.minimum).toBeCloseTo(contrastRatio(amber, photo), 5);
      expect(result.points).toBe((2 * (30 - 2) + 2 * (10 - 2)) * scale);
    }
  });

  it("reads a 1px border on a clear button, not the photo inside it", () => {
    const paint = (x: number, y: number) => (inBox(x, y) && !inBox(x, y, 1) ? line : photo);
    expect(edgeContrast(grid(3, paint), box, 1, 0).minimum).toBeCloseTo(contrastRatio(line, photo), 5);
  });

  it("finds the one weak point along an edge", () => {
    const paint = (x: number, y: number) => (inBox(x, y) ? (x > 30 && x < 31 && y < 16 ? photo : amber) : photo);
    const result = edgeContrast(grid(1, paint), box, 1, 0);
    expect(result.minimum).toBe(1);
    expect(result.edge).toBe("top");
  });

  it("skips the rounded corners", () => {
    const corner = (x: number, y: number) => (x < box.x + 4 || x >= box.x + box.width - 4) && (y < box.y + 4 || y >= box.y + box.height - 4);
    const paint = (x: number, y: number) => (inBox(x, y) && !corner(x, y) ? amber : photo);
    expect(edgeContrast(grid(1, paint), box, 1, 3).minimum).toBeCloseTo(contrastRatio(amber, photo), 5);
  });

  it("throws rather than passing when it has nothing to measure or samples off the screenshot", () => {
    const paint = () => photo;
    expect(() => edgeContrast(grid(1, paint), { x: 15, y: 15, width: 4, height: 4 }, 1, 2)).toThrow(/no straight edge/);
    expect(() => edgeContrast(grid(1, paint), { x: 10, y: 15, width: 30, height: 10 }, 1, 0)).toThrow(/outside the screenshot/);
  });
});
