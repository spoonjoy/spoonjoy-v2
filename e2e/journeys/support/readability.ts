// Readability measured from what the browser actually paints, for text and controls drawn over a
// photo or anything else token arithmetic can't see.
//
//   - measureTextContrast(locator): the WCAG contrast of an element's text against the pixels
//     painted behind each glyph line. It screenshots each line box with the glyphs hidden (their
//     fill made transparent, so the colour, `currentColor` state layers and the photo underneath
//     are unchanged), composites the text colour over every pixel and keeps the worst one. It
//     then screenshots the line with the glyphs shown and counts pixels painted exactly in the
//     text colour, so a layer drawn over the text (which elementFromPoint can miss) shows up as
//     missing glyphs. Text whose own web font hasn't loaded fails: it would measure a fallback.
//   - measureFocusIndicator(locator): the focused element's outline, compared pixel for pixel with
//     the same spot with the outline hidden, along the middle of each straight edge.
//   - coveringElements(locator): what sits on top of the element at its centre and corners, for an
//     element that must not be hidden under a fixed bar.
//
// Every result is a number or a thrown error: a colour the parser doesn't know, a line box off
// screen or an empty sample is an error, never a pass.
import type { Locator, Page } from "@playwright/test";
import sharp from "sharp";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Rgba extends Rgb {
  /** 0 to 1. */
  a: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// WCAG 2.2 large text: at least 24 CSS px, or at least 18.66 px (14 pt) and bold.
const LARGE_TEXT_PX = 24;
const LARGE_BOLD_TEXT_PX = 18.66;

export const TEXT_CONTRAST = 4.5;
export const LARGE_TEXT_CONTRAST = 3;
export const NON_TEXT_CONTRAST = 3;

/** Parses a computed CSS colour: rgb(), rgba() or color(srgb ...). Anything else throws. */
export function parseCssColor(value: string): Rgba {
  const text = value.trim();
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(text);
  if (rgb) {
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: parseAlpha(rgb[4]) };
  }
  const srgb = /^color\(\s*srgb\s+([\d.e+-]+)\s+([\d.e+-]+)\s+([\d.e+-]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(text);
  if (srgb) {
    return {
      r: clamp(Number(srgb[1])) * 255,
      g: clamp(Number(srgb[2])) * 255,
      b: clamp(Number(srgb[3])) * 255,
      a: parseAlpha(srgb[4]),
    };
  }
  throw new Error(`Unknown colour format "${value}": the contrast can't be measured.`);
}

function parseAlpha(value: string | undefined): number {
  if (value === undefined) return 1;
  return value.endsWith("%") ? Number(value.slice(0, -1)) / 100 : Number(value);
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
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

interface Pixels {
  data: Buffer;
  width: number;
  height: number;
  /** Image pixels per CSS pixel. */
  scale: number;
  /** The CSS-pixel clip the screenshot was taken of. */
  clip: Box;
}

// A whole-pixel clip around `box`, which must lie inside the viewport.
async function screenshotPixels(page: Page, box: Box, what: string): Promise<Pixels> {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error(`No viewport size: can't measure ${what}.`);
  const x = Math.floor(box.x);
  const y = Math.floor(box.y);
  const right = Math.ceil(box.x + box.width);
  const bottom = Math.ceil(box.y + box.height);
  if (x < 0 || y < 0 || right > viewport.width || bottom > viewport.height || right <= x || bottom <= y) {
    throw new Error(`${what} is not inside the viewport (${JSON.stringify(box)} in ${viewport.width}x${viewport.height}): it can't be measured.`);
  }
  const clip = { x, y, width: right - x, height: bottom - y };
  const png = await page.screenshot({ clip, animations: "disabled", caret: "hide" });
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, scale: info.width / clip.width, clip };
}

function pixelAt(pixels: Pixels, column: number, row: number): Rgb {
  const offset = (row * pixels.width + column) * 4;
  return { r: pixels.data[offset], g: pixels.data[offset + 1], b: pixels.data[offset + 2] };
}

export interface TextContrast {
  label: string;
  /** The worst contrast between the text colour and any pixel behind its glyph lines, unrounded. */
  minimum: number;
  /** The contrast WCAG AA asks of this text: 3 for large text, 4.5 otherwise. */
  required: number;
  largeText: boolean;
  textColor: string;
  lines: number;
  pixels: number;
  /** The pixel behind the text where the worst contrast was found. */
  worstBackground: string;
  /** The fewest pixels, on any one line, painted in the text colour where the background was not. */
  fewestGlyphPixels: number;
}

/** A line must show at least this many pixels in the text colour to count as painted. */
export const MIN_GLYPH_PIXELS = 5;
// How far, per 0-255 channel, a fully covered glyph pixel may be from the composited text colour.
const GLYPH_TOLERANCE = 6;
// How far a pixel must move between the hidden and shown screenshots to count as glyph.
const GLYPH_CHANGE = 24;

interface TextRun {
  color: string;
  opacity: number;
  fontSize: number;
  fontWeight: number;
  family: string;
  fontLoaded: boolean;
  rects: Box[];
}

// Every visible text run inside the element, with the colour its glyphs are filled with.
async function textRuns(locator: Locator): Promise<TextRun[]> {
  return locator.evaluate((element) => {
    const runs: Array<{ color: string; opacity: number; fontSize: number; fontWeight: number; family: string; fontLoaded: boolean; rects: Array<{ x: number; y: number; width: number; height: number }> }> = [];
    // FontFaceSet.check (is this font loaded?), bound once; it is not Playwright's checkbox check().
    const fontIsLoaded = document.fonts.check.bind(document.fonts);
    const loadedFamilies = new Set(
      Array.from(document.fonts).filter((face) => face.status === "loaded").map((face) => face.family.replace(/^["']|["']$/g, "")),
    );
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      const parent = node.parentElement;
      if (!parent) continue;
      const style = getComputedStyle(parent);
      if (style.visibility !== "visible" || style.display === "none") continue;
      let opacity = 1;
      for (let current: Element | null = parent; current; current = current.parentElement) {
        opacity *= Number(getComputedStyle(current).opacity);
      }
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = Array.from(range.getClientRects())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }));
      // -webkit-text-fill-color is what fills the glyphs; it resolves to `color` unless set.
      const fill = style.getPropertyValue("-webkit-text-fill-color") || style.color;
      // The family the text asks for first, which must be a loaded web font, not a fallback.
      const family = style.fontFamily.split(",")[0].trim().replace(/^["']|["']$/g, "");
      const fontLoaded =
        loadedFamilies.has(family) &&
        fontIsLoaded(`${style.fontStyle} ${style.fontWeight} ${style.fontSize} "${family}"`, node.textContent);
      runs.push({ color: fill, opacity, fontSize: parseFloat(style.fontSize), fontWeight: Number(style.fontWeight), family, fontLoaded, rects });
    }
    return runs;
  });
}

// Hides the glyphs without changing `color`, so currentColor borders, icons and state layers keep
// painting exactly as they do with the text shown. CSSOM style changes are allowed under QA's CSP.
async function setGlyphsHidden(locator: Locator, hidden: boolean): Promise<void> {
  await locator.evaluate((element, hide) => {
    for (const target of [element, ...Array.from(element.querySelectorAll("*"))]) {
      const style = (target as HTMLElement | SVGElement).style;
      if (hide) style.setProperty("-webkit-text-fill-color", "transparent", "important");
      else style.removeProperty("-webkit-text-fill-color");
    }
  }, hidden);
}

/** The worst contrast between an element's text and the pixels painted behind it. */
export async function measureTextContrast(page: Page, locator: Locator, label: string): Promise<TextContrast> {
  const runs = await textRuns(locator);
  const rects = runs.flatMap((run) => run.rects);
  if (rects.length === 0) throw new Error(`${label} has no visible text to measure.`);
  const colors = new Set(runs.map((run) => `${run.color} @${run.opacity}`));
  if (colors.size !== 1) throw new Error(`${label} mixes text colours (${[...colors].join(", ")}); measure each part separately.`);
  const fallback = runs.find((each) => !each.fontLoaded);
  if (fallback) throw new Error(`${label}: its font "${fallback.family}" has not loaded, so the text would be measured in a fallback font.`);
  const run = runs[0];
  const parsed = parseCssColor(run.color);
  const text: Rgba = { ...parsed, a: parsed.a * run.opacity };
  const largeText = runs.every((each) => each.fontSize >= LARGE_TEXT_PX || (each.fontSize >= LARGE_BOLD_TEXT_PX && each.fontWeight >= 700));

  await setGlyphsHidden(locator, true);
  const backgrounds: Pixels[] = [];
  try {
    for (const [index, rect] of rects.entries()) {
      backgrounds.push(await screenshotPixels(page, rect, `${label}, line ${index + 1}`));
    }
  } finally {
    await setGlyphsHidden(locator, false);
  }

  let minimum = Number.POSITIVE_INFINITY;
  let worstBackground: Rgb = { r: 0, g: 0, b: 0 };
  let pixels = 0;
  let fewestGlyphPixels = Number.POSITIVE_INFINITY;
  for (const [index, rect] of rects.entries()) {
    const hidden = backgrounds[index];
    const shown = await screenshotPixels(page, rect, `${label}, line ${index + 1} with its text`);
    if (shown.width !== hidden.width || shown.height !== hidden.height) throw new Error(`${label}, line ${index + 1}: the two screenshots differ in size.`);
    let glyphPixels = 0;
    for (let row = 0; row < hidden.height; row += 1) {
      for (let column = 0; column < hidden.width; column += 1) {
        const background = pixelAt(hidden, column, row);
        const expected = composite(text, background);
        const ratio = contrastRatio(expected, background);
        pixels += 1;
        if (ratio < minimum) {
          minimum = ratio;
          worstBackground = background;
        }
        const actual = pixelAt(shown, column, row);
        const moved = Math.max(Math.abs(actual.r - background.r), Math.abs(actual.g - background.g), Math.abs(actual.b - background.b));
        const off = Math.max(Math.abs(actual.r - expected.r), Math.abs(actual.g - expected.g), Math.abs(actual.b - expected.b));
        if (moved >= GLYPH_CHANGE && off <= GLYPH_TOLERANCE) glyphPixels += 1;
      }
    }
    fewestGlyphPixels = Math.min(fewestGlyphPixels, glyphPixels);
  }
  if (pixels === 0 || !Number.isFinite(minimum)) throw new Error(`${label}: no pixels behind the text were measured.`);
  return {
    label,
    minimum,
    required: largeText ? LARGE_TEXT_CONTRAST : TEXT_CONTRAST,
    largeText,
    textColor: run.color,
    lines: rects.length,
    pixels,
    worstBackground: `rgb(${worstBackground.r}, ${worstBackground.g}, ${worstBackground.b})`,
    fewestGlyphPixels,
  };
}

export interface FocusIndicator {
  label: string;
  focusVisible: boolean;
  outlineStyle: string;
  outlineWidth: number;
  outlineColor: string;
  /** The worst contrast between an outline pixel and the same pixel without the outline, unrounded. */
  minimum: number;
  pixels: number;
}

/**
 * Measures the focused element's outline: the worst contrast, along the middle line of each
 * straight edge, between the outline and what is painted there without it (WCAG 2.4.13's
 * change of contrast, and 1.4.11's 3:1 against the adjacent colours).
 */
export async function measureFocusIndicator(page: Page, locator: Locator, label: string): Promise<FocusIndicator> {
  const style = await locator.evaluate((element) => {
    const computed = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      focused: document.activeElement === element,
      focusVisible: element.matches(":focus-visible"),
      outlineStyle: computed.outlineStyle,
      outlineWidth: parseFloat(computed.outlineWidth),
      outlineOffset: parseFloat(computed.outlineOffset),
      outlineColor: computed.outlineColor,
      radius: parseFloat(computed.borderTopLeftRadius) || 0,
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  });
  if (!style.focused) throw new Error(`${label} does not have focus, so its focus indicator can't be measured.`);
  const result = {
    label,
    focusVisible: style.focusVisible,
    outlineStyle: style.outlineStyle,
    outlineWidth: style.outlineWidth,
    outlineColor: style.outlineColor,
  };
  if (style.outlineStyle === "none" || !(style.outlineWidth > 0)) return { ...result, minimum: 1, pixels: 0 };

  const reach = style.outlineOffset + style.outlineWidth;
  const area = {
    x: style.box.x - reach - 1,
    y: style.box.y - reach - 1,
    width: style.box.width + 2 * (reach + 1),
    height: style.box.height + 2 * (reach + 1),
  };
  const focused = await screenshotPixels(page, area, `${label}'s focus outline`);
  await locator.evaluate((element) => (element as HTMLElement).style.setProperty("outline-color", "transparent", "important"));
  let unfocused: Pixels;
  try {
    unfocused = await screenshotPixels(page, area, `${label} without its focus outline`);
  } finally {
    await locator.evaluate((element) => (element as HTMLElement).style.removeProperty("outline-color"));
  }

  // The outline's middle line, in CSS px, skipping the rounded corners.
  const middle = style.outlineOffset + style.outlineWidth / 2;
  const corner = style.radius + reach;
  const left = style.box.x - middle;
  const right = style.box.x + style.box.width + middle;
  const top = style.box.y - middle;
  const bottom = style.box.y + style.box.height + middle;
  const points: Array<[number, number]> = [];
  for (let x = style.box.x + corner; x <= style.box.x + style.box.width - corner; x += 1 / focused.scale) {
    points.push([x, top], [x, bottom]);
  }
  for (let y = style.box.y + corner; y <= style.box.y + style.box.height - corner; y += 1 / focused.scale) {
    points.push([left, y], [right, y]);
  }
  let minimum = Number.POSITIVE_INFINITY;
  for (const [x, y] of points) {
    const column = Math.floor((x - focused.clip.x) * focused.scale);
    const row = Math.floor((y - focused.clip.y) * focused.scale);
    const ratio = contrastRatio(pixelAt(focused, column, row), pixelAt(unfocused, column, row));
    minimum = Math.min(minimum, ratio);
  }
  if (points.length === 0 || !Number.isFinite(minimum)) throw new Error(`${label}: no outline pixels were measured.`);
  return { ...result, minimum, pixels: points.length };
}

/**
 * What is painted on top of the element at its centre, just inside each corner and at the middle
 * of each edge, described by
 * tag, id, class and label. An empty list means nothing covers it. A point outside the viewport
 * counts as covered: the person can't see it there.
 */
export async function coveringElements(locator: Locator): Promise<string[]> {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const inset = 2;
    const points: Array<[string, number, number]> = [
      ["centre", rect.x + rect.width / 2, rect.y + rect.height / 2],
      ["top left", rect.left + inset, rect.top + inset],
      ["top right", rect.right - inset, rect.top + inset],
      ["bottom left", rect.left + inset, rect.bottom - inset],
      ["bottom right", rect.right - inset, rect.bottom - inset],
      ["top edge", rect.x + rect.width / 2, rect.top + inset],
      ["bottom edge", rect.x + rect.width / 2, rect.bottom - inset],
      ["left edge", rect.left + inset, rect.y + rect.height / 2],
      ["right edge", rect.right - inset, rect.y + rect.height / 2],
    ];
    const describe = (node: Element) => {
      const label = node.getAttribute("aria-label");
      const id = node.id ? `#${node.id}` : "";
      const className = typeof node.className === "string" && node.className ? `.${node.className.trim().split(/\s+/).slice(0, 3).join(".")}` : "";
      return `${node.tagName.toLowerCase()}${id}${className}${label ? `[aria-label="${label}"]` : ""}`;
    };
    const covered: string[] = [];
    for (const [where, x, y] of points) {
      if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) {
        covered.push(`${where}: outside the viewport`);
        continue;
      }
      const top = document.elementFromPoint(x, y);
      if (!top || (top !== element && !element.contains(top))) {
        // Name the outermost fixed or sticky ancestor too, which is usually the real cover.
        let cover: Element | null = top;
        for (let current = top; current; current = current.parentElement) {
          const position = getComputedStyle(current).position;
          if (position === "fixed" || position === "sticky") cover = current;
        }
        covered.push(`${where}: ${top ? describe(top) : "nothing"}${cover && cover !== top ? ` in ${describe(cover)}` : ""}`);
      }
    }
    return covered;
  });
}
