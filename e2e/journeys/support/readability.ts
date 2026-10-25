// Readability measured from what the browser actually paints, for text and controls drawn over a
// photo or anything else token arithmetic can't see.
//
//   - measureTextContrast(locator): the WCAG contrast of an element's text against the pixels
//     painted behind each glyph line. It screenshots each line box with the glyphs hidden (their
//     fill made transparent, so the colour, `currentColor` state layers and the photo underneath
//     are unchanged), composites the text colour over every pixel and keeps the worst one. It
//     then screenshots the line with the glyphs shown and requires glyph pixels in every
//     one-em-wide slice of the line, so a layer drawn over any part of the text (which
//     elementFromPoint can miss) shows up as missing glyphs. Text whose own web font hasn't loaded fails: it would measure a fallback.
//   - measureFocusIndicator(locator): the focused element's outline, compared pixel for pixel with
//     the same spot with the outline hidden, along the middle of each straight edge.
//   - measureBoundaryContrast(locator): whether a control's shape shows, the contrast between its
//     painted edge (border, or fill where the border is clear) and the pixels just outside it.
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
  /** Pixels painted at least GLYPH_COVERAGE of the way from the background to the text colour. */
  glyphPixels: number;
  /** One-em-wide slices of the text's lines with no glyph pixel: text hidden or covered there. */
  emptySlices: number;
}

// A glyph pixel moves from the background at least this far towards the composited text colour
// (antialiased edges move part way), and stays on that line: anything drawn over the text pushes
// it off, so it doesn't count.
const GLYPH_COVERAGE = 0.6;
const GLYPH_OVERSHOOT = 1.2;
const GLYPH_OFF_LINE = 12;

// How far `actual` moved from `background` towards `expected` (0 = not at all, 1 = all the way),
// and how far, per 0-255 channel, it strayed from that straight line.
export function glyphCoverage(background: Rgb, expected: Rgb, actual: Rgb): { coverage: number; offLine: number } {
  const d = [expected.r - background.r, expected.g - background.g, expected.b - background.b];
  const v = [actual.r - background.r, actual.g - background.g, actual.b - background.b];
  const length = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  if (length < 1) return { coverage: 0, offLine: 0 };
  const coverage = (v[0] * d[0] + v[1] * d[1] + v[2] * d[2]) / length;
  const offLine = Math.max(...v.map((value, index) => Math.abs(value - coverage * d[index])));
  return { coverage, offLine };
}

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
  const lines = runs.flatMap((each) => each.rects.map((rect) => ({ rect, em: each.fontSize })));
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
  let glyphPixels = 0;
  let emptySlices = 0;
  for (const [index, { rect, em }] of lines.entries()) {
    const hidden = backgrounds[index];
    const shown = await screenshotPixels(page, rect, `${label}, line ${index + 1} with its text`);
    if (shown.width !== hidden.width || shown.height !== hidden.height) throw new Error(`${label}, line ${index + 1}: the two screenshots differ in size.`);
    const sliceCount = Math.max(1, Math.floor(rect.width / em));
    const painted = Array.from({ length: sliceCount }, () => false);
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
        const { coverage, offLine } = glyphCoverage(background, expected, pixelAt(shown, column, row));
        if (coverage >= GLYPH_COVERAGE && coverage <= GLYPH_OVERSHOOT && offLine <= GLYPH_OFF_LINE) {
          glyphPixels += 1;
          painted[Math.min(sliceCount - 1, Math.floor((column / hidden.width) * sliceCount))] = true;
        }
      }
    }
    emptySlices += painted.filter((slice) => !slice).length;
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
    glyphPixels,
    emptySlices,
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

/** Raw RGBA pixels of a screenshot of `clip` (CSS px), `scale` image pixels per CSS pixel. */
export interface PixelGrid {
  data: Uint8Array;
  width: number;
  height: number;
  scale: number;
  clip: Box;
}

export interface EdgeContrast {
  /** The worst, over every point along the straight edges, of the boundary's contrast with what is just outside. */
  minimum: number;
  points: number;
  edge: "top" | "bottom" | "left" | "right";
  inside: Rgb;
  outside: Rgb;
}

// The pixel just outside the edge is this far out, past any antialiased edge pixel. Its image pixel
// can reach half a CSS pixel further at 1x, so a focus outline must start at least
// OUTSIDE_DISTANCE + 0.5 px out, or the sample would read the outline as the photo.
export const OUTSIDE_DISTANCE = 1.5;
const OUTLINE_CLEARANCE = OUTSIDE_DISTANCE + 0.5;

/**
 * The contrast between a component's boundary and the pixels around it (WCAG 1.4.11), for a box
 * drawn into `pixels`. At each image pixel along the middle of each straight edge (the rounded
 * corners are skipped), the boundary is the pixel in the edge band (the border width, at least
 * 1 CSS px: the border if it is painted, else the fill under it) that contrasts most with the
 * pixel OUTSIDE_DISTANCE outside the edge; the result is the worst such point.
 */
export function edgeContrast(pixels: PixelGrid, box: Box, borderWidth: number, radius: number): EdgeContrast {
  const at = (x: number, y: number): Rgb => {
    const column = Math.floor((x - pixels.clip.x) * pixels.scale);
    const row = Math.floor((y - pixels.clip.y) * pixels.scale);
    if (column < 0 || row < 0 || column >= pixels.width || row >= pixels.height) {
      throw new Error(`The edge sample (${x}, ${y}) is outside the screenshot.`);
    }
    const offset = (row * pixels.width + column) * 4;
    return { r: pixels.data[offset], g: pixels.data[offset + 1], b: pixels.data[offset + 2] };
  };
  const step = 1 / pixels.scale;
  const band = Math.max(1, borderWidth);
  const depths: number[] = [];
  for (let depth = step / 2; depth < band; depth += step) depths.push(depth);
  const skip = radius + 1;
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  // Each edge: a point on it at `t` along its length, and its outward normal.
  const edges = [
    { edge: "top", from: box.x + skip, to: right - skip, point: (t: number) => [t, box.y], normal: [0, -1] },
    { edge: "bottom", from: box.x + skip, to: right - skip, point: (t: number) => [t, bottom], normal: [0, 1] },
    { edge: "left", from: box.y + skip, to: bottom - skip, point: (t: number) => [box.x, t], normal: [-1, 0] },
    { edge: "right", from: box.y + skip, to: bottom - skip, point: (t: number) => [right, t], normal: [1, 0] },
  ] as const;
  let worst: EdgeContrast | null = null;
  let points = 0;
  for (const { edge, from, to, point, normal } of edges) {
    for (let t = from + step / 2; t <= to; t += step) {
      const [x, y] = point(t);
      const outside = at(x + normal[0] * OUTSIDE_DISTANCE, y + normal[1] * OUTSIDE_DISTANCE);
      let best = { ratio: 0, inside: outside };
      for (const depth of depths) {
        const inside = at(x - normal[0] * depth, y - normal[1] * depth);
        const ratio = contrastRatio(inside, outside);
        if (ratio > best.ratio) best = { ratio, inside };
      }
      points += 1;
      if (!worst || best.ratio < worst.minimum) worst = { minimum: best.ratio, points: 0, edge, inside: best.inside, outside };
    }
  }
  if (!worst) throw new Error(`The box ${JSON.stringify(box)} has no straight edge to measure past its ${radius}px corners.`);
  return { ...worst, points };
}

export interface BoundaryContrast {
  label: string;
  /** The worst contrast between the component's boundary (border or fill) and the pixels just outside it, unrounded. */
  minimum: number;
  points: number;
  edge: string;
  borderColor: string;
  backgroundColor: string;
  /** The boundary and outside pixels at the worst point. */
  worstBoundary: string;
  worstOutside: string;
}

function rgbText({ r, g, b }: Rgb): string {
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Whether the component's shape can be seen: the contrast between its painted boundary (its
 * border, or its fill where the border is clear) and the pixels just outside it, as painted, in
 * its current state. Measure text first in the same state: its screenshots finish the state's
 * transitions, and an element that moves while it is measured is an error.
 */
export async function measureBoundaryContrast(page: Page, locator: Locator, label: string): Promise<BoundaryContrast> {
  const read = () =>
    locator.evaluate((element) => {
      const computed = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const outline = computed.outlineStyle !== "none" && parseFloat(computed.outlineWidth) > 0;
      return {
        box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        borderWidth: Math.max(...["Top", "Right", "Bottom", "Left"].map((side) => parseFloat(computed.getPropertyValue(`border-${side.toLowerCase()}-width`)) || 0)),
        radius: Math.max(...["top-left", "top-right", "bottom-left", "bottom-right"].map((corner) => parseFloat(computed.getPropertyValue(`border-${corner}-radius`)) || 0)),
        borderColor: computed.borderTopColor,
        backgroundColor: computed.backgroundColor,
        outlineGap: outline ? parseFloat(computed.outlineOffset) : null,
      };
    });
  const before = await read();
  if (before.outlineGap !== null && before.outlineGap < OUTLINE_CLEARANCE) {
    throw new Error(`${label}'s outline is ${before.outlineGap}px from its edge, where the pixels outside the boundary are sampled.`);
  }
  const reach = OUTSIDE_DISTANCE + 1;
  const shot = await screenshotPixels(
    page,
    { x: before.box.x - reach, y: before.box.y - reach, width: before.box.width + 2 * reach, height: before.box.height + 2 * reach },
    `${label}'s edges`,
  );
  const after = await read();
  if (JSON.stringify(after.box) !== JSON.stringify(before.box)) {
    throw new Error(`${label} moved while its edges were measured (${JSON.stringify(before.box)} then ${JSON.stringify(after.box)}).`);
  }
  const result = edgeContrast(shot, before.box, before.borderWidth, before.radius);
  return {
    label,
    minimum: result.minimum,
    points: result.points,
    edge: result.edge,
    borderColor: before.borderColor,
    backgroundColor: before.backgroundColor,
    worstBoundary: rgbText(result.inside),
    worstOutside: rgbText(result.outside),
  };
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
