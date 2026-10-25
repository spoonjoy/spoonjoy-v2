// WCAG contrast arithmetic for colours the browser reports and pixels it paints. No browser here:
// support/accessibility.ts measures the page and uses these to judge what it measured.

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Rgba extends Rgb {
  /** 0 to 1. */
  a: number;
}

// WCAG 2.2 large text: at least 24 CSS px, or at least 18.66 px (14 pt) and bold.
const LARGE_TEXT_PX = 24;
const LARGE_BOLD_TEXT_PX = 18.66;
const BOLD_WEIGHT = 700;

/** WCAG 1.4.3: text. */
export const TEXT_CONTRAST = 4.5;
/** WCAG 1.4.3: large text. */
export const LARGE_TEXT_CONTRAST = 3;

/** Parses a computed CSS colour: rgb(), rgba() or color(srgb ...). Anything else throws. */
export function parseCssColor(value: string): Rgba {
  const text = value.trim();
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(text);
  if (rgb) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: parseAlpha(rgb[4]) };
  const srgb = /^color\(\s*srgb\s+([\d.e+-]+)\s+([\d.e+-]+)\s+([\d.e+-]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(text);
  if (srgb) {
    return { r: unit(Number(srgb[1])) * 255, g: unit(Number(srgb[2])) * 255, b: unit(Number(srgb[3])) * 255, a: parseAlpha(srgb[4]) };
  }
  throw new Error(`Unknown colour format "${value}": its contrast can't be measured.`);
}

function parseAlpha(value: string | undefined): number {
  if (value === undefined) return 1;
  return unit(value.endsWith("%") ? Number(value.slice(0, -1)) / 100 : Number(value));
}

function unit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function linear(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** `top` painted over an opaque `bottom`. */
export function composite(top: Rgba, bottom: Rgb): Rgb {
  return {
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
  };
}

export function isLargeText(fontSizePx: number, fontWeight: number): boolean {
  return fontSizePx >= LARGE_TEXT_PX || (fontSizePx >= LARGE_BOLD_TEXT_PX && fontWeight >= BOLD_WEIGHT);
}

/** The contrast WCAG AA asks of text at this size and weight. */
export function requiredTextContrast(fontSizePx: number, fontWeight: number): number {
  return isLargeText(fontSizePx, fontWeight) ? LARGE_TEXT_CONTRAST : TEXT_CONTRAST;
}

export interface WorstContrast {
  /** The lowest contrast between the text colour and any one pixel. */
  ratio: number;
  /** The pixel where it was found. */
  background: Rgb;
  pixels: number;
}

/**
 * The worst contrast between `text` (composited over each pixel, so a translucent colour is judged
 * as painted) and every pixel of an RGBA buffer. An empty buffer throws: no pixels is no evidence.
 */
export function worstContrastOver(text: Rgba, rgba: Uint8Array): WorstContrast {
  if (rgba.length === 0 || rgba.length % 4 !== 0) throw new Error(`Expected RGBA pixels, got ${rgba.length} bytes.`);
  let ratio = Number.POSITIVE_INFINITY;
  let background: Rgb = { r: 0, g: 0, b: 0 };
  for (let offset = 0; offset < rgba.length; offset += 4) {
    const pixel = { r: rgba[offset], g: rgba[offset + 1], b: rgba[offset + 2] };
    const each = contrastRatio(composite(text, pixel), pixel);
    if (each < ratio) {
      ratio = each;
      background = pixel;
    }
  }
  return { ratio, background, pixels: rgba.length / 4 };
}

export function formatRgb({ r, g, b }: Rgb): string {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

/** Two decimals, rounded down, so a printed ratio never looks better than the measured one. */
export function formatRatio(ratio: number): string {
  return `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`;
}
