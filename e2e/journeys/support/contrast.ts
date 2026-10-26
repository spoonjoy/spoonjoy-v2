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

const NUMBER = "(-?[\\d.]+(?:e[+-]?\\d+)?%?|none)";
const OKLAB = new RegExp(`^(oklab|oklch)\\(\\s*${NUMBER}\\s+${NUMBER}\\s+${NUMBER}(?:\\s*/\\s*${NUMBER})?\\s*\\)$`, "i");

/** Parses a computed CSS colour: rgb(), rgba(), color(srgb ...), oklab() or oklch(). Anything else throws. */
export function parseCssColor(value: string): Rgba {
  const text = value.trim();
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(text);
  if (rgb) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: parseAlpha(rgb[4]) };
  const srgb = /^color\(\s*srgb\s+([\d.e+-]+)\s+([\d.e+-]+)\s+([\d.e+-]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(text);
  if (srgb) {
    return { r: unit(Number(srgb[1])) * 255, g: unit(Number(srgb[2])) * 255, b: unit(Number(srgb[3])) * 255, a: parseAlpha(srgb[4]) };
  }
  const ok = OKLAB.exec(text);
  if (ok) {
    const lightness = component(ok[2], 1);
    let a = component(ok[3], 0.4);
    let b = component(ok[4], 0.4);
    if (ok[1].toLowerCase() === "oklch") {
      const hue = (component(ok[4], 1) * Math.PI) / 180;
      [a, b] = [a * Math.cos(hue), a * Math.sin(hue)];
    }
    return { ...oklabToSrgb(lightness, a, b), a: ok[5] === undefined || ok[5] === "none" ? 1 : parseAlpha(ok[5]) };
  }
  throw new Error(`Unknown colour format "${value}": its contrast can't be measured.`);
}

// A CSS Color 4 component: a number, a percentage of `full`, or `none` (zero).
function component(value: string, full: number): number {
  if (value === "none") return 0;
  return value.endsWith("%") ? (Number(value.slice(0, -1)) / 100) * full : Number(value);
}

// OKLab to gamma-encoded sRGB (0 to 255), clipped to the sRGB gamut as a browser paints it.
// Matrices from CSS Color 4, section 18.
function oklabToSrgb(lightness: number, a: number, b: number): Rgb {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const encode = (linearValue: number) => {
    const c = unit(linearValue);
    return (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255;
  };
  return {
    r: encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
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
 *
 * Text inside an ancestor with `opacity` below 1 is not simply its colour faded over the
 * screenshot, since the screenshot is already faded the same way. For that text, `faded` gives the
 * ancestor's opacity and the same pixels painted with it at full opacity (Q). The page paints the
 * whole group at that opacity over what is behind it, so the text pixel is P + opacity × a × (T − Q),
 * where P is the pixel as painted, T the text colour and a its own alpha. Without `faded`, Q is P
 * and this is the plain composite.
 */
export function worstContrastOver(text: Rgba, rgba: Uint8Array, faded?: { opacity: number; unfaded: Uint8Array }): WorstContrast {
  if (rgba.length === 0 || rgba.length % 4 !== 0) throw new Error(`Expected RGBA pixels, got ${rgba.length} bytes.`);
  if (faded && faded.unfaded.length !== rgba.length) throw new Error(`The unfaded pixels (${faded.unfaded.length} bytes) do not match the painted ones (${rgba.length} bytes).`);
  const weight = (faded?.opacity ?? 1) * text.a;
  const clamp = (value: number) => Math.min(255, Math.max(0, value));
  let ratio = Number.POSITIVE_INFINITY;
  let background: Rgb = { r: 0, g: 0, b: 0 };
  for (let offset = 0; offset < rgba.length; offset += 4) {
    const pixel = { r: rgba[offset], g: rgba[offset + 1], b: rgba[offset + 2] };
    const under = faded ? { r: faded.unfaded[offset], g: faded.unfaded[offset + 1], b: faded.unfaded[offset + 2] } : pixel;
    const painted = {
      r: clamp(pixel.r + weight * (text.r - under.r)),
      g: clamp(pixel.g + weight * (text.g - under.g)),
      b: clamp(pixel.b + weight * (text.b - under.b)),
    };
    const each = contrastRatio(painted, pixel);
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
