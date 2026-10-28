// Text contrast measured from what the browser paints, for the text axe cannot judge: text over a
// photo, a gradient, a pseudo-element or anything else it cannot read a single colour from.
//
// For each line box of the text, the line is scrolled into view, checked for anything painted on
// top of it, and screenshotted with the glyphs hidden (their fill made transparent, so the colour,
// `currentColor` borders and state layers and the photo underneath are unchanged). The text
// colour, with the opacity it is painted at, is composited over every pixel of that screenshot and
// the worst ratio is kept. Text inside a faded ancestor (opacity below 1) is screenshotted twice,
// as painted and with that ancestor at full opacity, so the fade is applied once (contrast.ts). Anything
// that stops a measurement (a colour format the parser does not know, a line that cannot be brought
// into view, an image that does not load, more than one faded ancestor) is an error, never a pass.
// Text covered by an open modal dialog's layer and hidden from assistive technology (the page
// behind the dialog) is inactive, which WCAG 1.4.3 exempts. So is a line an open popup covers (a
// Select's list, a Menu, a Popover), as Ouro UI's audit hides it: what a popup paints over the
// text is the popup's own, and the scan with the popup closed measures the line in full. An
// inactive line is skipped: the element is judged by its other lines, and passes as inactive only
// when it has no other line.
import type { Locator, Page } from "@playwright/test";
import sharp from "sharp";
import { formatRgb, parseCssColor, requiredTextContrast, worstContrastOver, type Rgb, type Rgba } from "./contrast";

export interface ContrastMeasurement {
  target: string;
  /** Why axe could not decide. */
  axeReason: string;
  passed: boolean;
  /** The worst contrast between the text colour and any pixel painted behind its lines. */
  ratio?: number;
  required?: number;
  textColor?: string;
  worstBackground?: string;
  lines?: number;
  pixels?: number;
  /** Set when there was no text to judge, and why. */
  note?: string;
  /** Set when the text is inactive (behind an overlay, hidden from assistive technology). */
  inactive?: string;
  /** Why the text could not be measured. A measurement that could not be taken fails. */
  error?: string;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TextRun {
  fill: string;
  /** The opacity of the one faded ancestor the text is inside, or 1. */
  opacity: number;
  fontSize: number;
  fontWeight: number;
  lines: number;
  blocker?: string;
}

type LineResult = { box: Box; run: number } | { blocker: string } | { inactive: string };

const IMAGE_TIMEOUT_MS = 10_000;

// Page-side helpers, installed once per document. Kept in one function so each evaluate below can
// reach them without shipping its own copy.
function installHelpers(): void {
  const page = window as unknown as { __sjContrast?: unknown };
  if (page.__sjContrast) return;
  const describe = (node: Element) => {
    const label = node.getAttribute("aria-label");
    const id = node.id ? `#${node.id}` : "";
    const className = typeof node.className === "string" && node.className.trim() ? `.${node.className.trim().split(/\s+/).slice(0, 3).join(".")}` : "";
    return `${node.tagName.toLowerCase()}${id}${className}${label ? `[aria-label="${label}"]` : ""}`;
  };
  const visibleText = (node: Node) =>
    node.nodeType === Node.TEXT_NODE && /\S/.test(node.textContent ?? "") && !!node.parentElement && getComputedStyle(node.parentElement).visibility === "visible";
  // axe judges an element by the text nodes directly inside it; an element whose text is all in
  // its descendants is measured by those.
  const textNodes = (element: Element): Text[] => {
    const own = Array.from(element.childNodes).filter(visibleText) as Text[];
    if (own.length > 0) return own;
    const all: Text[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (visibleText(node)) all.push(node as Text);
    return all;
  };
  const rectsOf = (node: Text) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
  };
  // A form field's text is its value, not a text node: it is measured over the field's content
  // box, the area inside its border and padding where the value is drawn.
  const NOT_TEXT_INPUTS = new Set(["checkbox", "radio", "range", "color", "file", "hidden", "image"]);
  const isField = (element: Element): element is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =>
    (element instanceof HTMLInputElement && !NOT_TEXT_INPUTS.has(element.type)) || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
  const contentBox = (element: Element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const left = box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
    const top = box.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop);
    const right = box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
    const bottom = box.bottom - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom);
    return new DOMRect(left, top, right - left, bottom - top);
  };
  // Date and time fields draw their parts (or blanks) even with no value.
  const DRAWN_WHEN_EMPTY = new Set(["date", "datetime-local", "month", "time", "week"]);
  const fieldText = (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): "value" | "placeholder" | "empty" => {
    const value = element instanceof HTMLSelectElement ? (element.selectedOptions[0]?.text ?? "") : element.value;
    if (/\S/.test(value) || (element instanceof HTMLInputElement && DRAWN_WHEN_EMPTY.has(element.type))) return "value";
    return "placeholder" in element && /\S/.test(element.placeholder) ? "placeholder" : "empty";
  };
  const emptyField = (element: Element) => isField(element) && fieldText(element) === "empty";
  const sources = (element: Element): Array<{ styled: Element; pseudo?: string; rects: () => DOMRect[] }> => {
    if (isField(element)) {
      const shown = fieldText(element);
      if (shown === "empty" || getComputedStyle(element).visibility !== "visible") return [];
      const rects = () => [contentBox(element)].filter((rect) => rect.width > 0 && rect.height > 0);
      return [{ styled: element, pseudo: shown === "placeholder" ? "::placeholder" : undefined, rects }];
    }
    return textNodes(element).map((node) => ({ styled: node.parentElement as Element, rects: () => rectsOf(node) }));
  };
  const lines = (element: Element) => sources(element).flatMap((source, run) => source.rects().map((rect) => ({ run, rect })));
  const runs = (element: Element) =>
    sources(element).map((source) => {
      const parent = source.styled;
      const style = getComputedStyle(parent, source.pseudo);
      const run = {
        fill: style.getPropertyValue("-webkit-text-fill-color") || style.color,
        opacity: 1,
        fontSize: parseFloat(style.fontSize),
        fontWeight: Number(style.fontWeight),
        lines: source.rects().length,
        blocker: undefined as string | undefined,
      };
      const clip = style.getPropertyValue("-webkit-background-clip") || style.backgroundClip;
      if (clip === "text") run.blocker = `${describe(parent)} paints its text with background-clip: text`;
      const faded: Element[] = [];
      for (let each: Element | null = parent; each; each = each.parentElement) {
        const computed = getComputedStyle(each);
        if (Number(computed.opacity) < 1) {
          faded.push(each);
          run.opacity = Number(computed.opacity);
        }
        if (computed.filter !== "none") run.blocker = `${describe(each)} has filter: ${computed.filter}`;
        if (computed.mixBlendMode !== "normal") run.blocker = `${describe(each)} has mix-blend-mode: ${computed.mixBlendMode}`;
      }
      // One faded group can be undone for a second screenshot; nested ones cannot be separated.
      if (faded.length > 1) run.blocker = `its text is inside ${faded.length} faded ancestors (${faded.map(describe).join(", ")})`;
      return run;
    });
  // Inline style overrides with their previous values, so they can be put back exactly.
  const saved = new Map<HTMLElement | SVGElement, Map<string, [string, string]>>();
  const override = (node: Element, property: string, value: string) => {
    const style = (node as HTMLElement).style;
    if (!style) return;
    let props = saved.get(node as HTMLElement);
    if (!props) saved.set(node as HTMLElement, (props = new Map()));
    if (!props.has(property)) props.set(property, [style.getPropertyValue(property), style.getPropertyPriority(property)]);
    style.setProperty(property, value, "important");
  };
  const restore = () => {
    for (const [node, props] of saved) {
      for (const [property, [value, priority]] of props) {
        if (value) node.style.setProperty(property, value, priority);
        else node.style.removeProperty(property);
      }
    }
    saved.clear();
  };
  // Whether every colour a layer paints is transparent or its own text colour: a line drawn with
  // the text, as a strike-through is, and not a veil or a glow.
  const GRADIENT_WORDS = new Set(["none", "linear-gradient", "repeating-linear-gradient", "calc", "to", "left", "right", "top", "bottom", "center", "deg", "turn", "rad", "px", "em", "rem", "lh", "e"]);
  const COLOR = /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)|transparent/g;
  const paintsOnlyTextColor = (style: CSSStyleDeclaration) =>
    transparent(style.backgroundColor) &&
    (style.getPropertyValue("backdrop-filter") || "none") === "none" &&
    style.boxShadow === "none" &&
    parseFloat(style.borderTopWidth) + parseFloat(style.borderRightWidth) + parseFloat(style.borderBottomWidth) + parseFloat(style.borderLeftWidth) === 0 &&
    Array.from(style.backgroundImage.matchAll(COLOR)).every(([color]) => transparent(color) || color === style.color) &&
    // Nothing else that could name a colour or an image: only gradient syntax is left.
    (style.backgroundImage.replace(COLOR, "").replace(/currentcolor/gi, "").match(/[a-z][a-z-]*/gi) ?? []).every((word) => GRADIENT_WORDS.has(word.toLowerCase()));
  // A line drawn over the text inside the element in the text's own colour (a strike across a
  // checked item's label): hidden from assistive technology, holding no text, absolutely
  // positioned, ignoring the pointer, coming after the text, so painted on top of it, and painting
  // nothing but the text's colour. It is part of the text, as a text decoration would be.
  const drawnWithText = (element: Element, node: Element) => {
    const first = textNodes(element)[0];
    if (node === element || !first || !element.contains(node)) return false;
    const style = getComputedStyle(node);
    return (
      node.getAttribute("aria-hidden") === "true" &&
      !/\S/.test(node.textContent ?? "") &&
      (style.position === "absolute" || style.position === "fixed") &&
      style.pointerEvents === "none" &&
      style.color === getComputedStyle(first.parentElement as Element).color &&
      paintsOnlyTextColor(style) &&
      (first.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    );
  };
  // Hides what is drawn with the text: the glyphs, their decorations and any line drawnWithText.
  // Everything behind the text, and any other overlay, keeps painting.
  const hideText = (element: Element) => {
    for (const node of [element, ...Array.from(element.querySelectorAll("*"))]) {
      override(node, "-webkit-text-fill-color", "transparent");
      override(node, "text-decoration-color", "transparent");
      override(node, "text-emphasis-color", "transparent");
      override(node, "text-shadow", "none");
      if (drawnWithText(element, node)) override(node, "visibility", "hidden");
    }
  };
  // Whether a layer paints anything of its own over the point: a background colour or image, a
  // backdrop filter, replaced content (an image, video, canvas, svg or frame), or text at the point,
  // its own or in its ::before or ::after. A transparent layer, such as a link stretched over a
  // card to make it one target, hides nothing.
  const transparent = (color: string) => /^rgba?\(.*,\s*0\)$|^transparent$|\/\s*0\)$/.test(color.trim());
  const paintsAt = (layer: Element, x: number, y: number) => {
    if (layer instanceof HTMLImageElement || layer instanceof HTMLVideoElement || layer instanceof HTMLCanvasElement || layer instanceof SVGElement || layer instanceof HTMLIFrameElement) return true;
    for (const pseudo of [undefined, "::before", "::after"]) {
      const style = getComputedStyle(layer, pseudo);
      if (pseudo && (style.content === "none" || style.content === "normal")) continue;
      if (!transparent(style.backgroundColor) || style.backgroundImage !== "none") return true;
      if ((style.getPropertyValue("backdrop-filter") || "none") !== "none") return true;
      if (pseudo && style.content !== '""' && style.content !== "''") return true;
    }
    return Array.from(layer.childNodes).some((node) => {
      if (node.nodeType !== Node.TEXT_NODE || !/\S/.test(node.textContent ?? "")) return false;
      const range = document.createRange();
      range.selectNodeContents(node);
      return Array.from(range.getClientRects()).some((rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
    });
  };
  // The first layer that paints over the point above the element's text, or null when the text
  // (the element, or a part of it that holds its text) is the first. A layer inside the element
  // that holds none of its text, such as a veil drawn over it, covers it like any other, unless it
  // is drawnWithText. The element's pointer-events are forced on, since hit testing skips an
  // element that ignores the pointer.
  const coverAt = (element: Element, x: number, y: number): Element | "nothing" | null => {
    const texts = textNodes(element);
    // Before pointer-events change, which drawnWithText reads.
    const drawn = new Set(Array.from(element.querySelectorAll("*")).filter((node) => drawnWithText(element, node)));
    for (const node of [element, ...Array.from(element.querySelectorAll("*"))]) override(node, "pointer-events", "auto");
    try {
      const layers = document.elementsFromPoint(x, y);
      if (layers.length === 0) return "nothing";
      for (const layer of layers) {
        if (layer === element || texts.some((text) => layer.contains(text))) return null;
        if (drawn.has(layer)) continue;
        if (layer.contains(element)) return null;
        if (paintsAt(layer, x, y)) return layer;
      }
      return "nothing";
    } finally {
      restore();
    }
  };
  // Puts the faded ancestor of one text run at full opacity, for the second screenshot.
  const unfade = (element: Element, run: number) => {
    for (let each: Element | null = sources(element)[run]?.styled ?? null; each; each = each.parentElement) {
      if (Number(getComputedStyle(each).opacity) < 1) override(each, "opacity", "1");
    }
  };
  // An open modal dialog that does not hold the element: a <dialog> shown with showModal(), or a
  // shown dialog role that does not say it is modeless (aria-modal="false", as a toast does).
  // Base UI's modal dialogs leave out aria-modal and hide the rest of the page instead, which the
  // caller checks.
  const modalOver = (element: Element) =>
    Array.from(document.querySelectorAll('dialog, [role="dialog"], [role="alertdialog"], [aria-modal="true"]')).find(
      (modal) =>
        !modal.contains(element) &&
        modal.getAttribute("aria-modal") !== "false" &&
        (modal instanceof HTMLDialogElement ? modal.matches(":modal") : modal.checkVisibility({ visibilityProperty: true })),
    ) ?? null;
  // The open popup a layer over the text belongs to: a Base UI portal, exposed to assistive
  // technology, that does not hold the text (Ouro UI's audit finds a popup's layers the same way).
  const popupOf = (cover: Element, element: Element) => {
    const portal = cover.closest("[data-base-ui-portal]");
    return portal && !portal.contains(element) && !portal.closest('[aria-hidden="true"], [inert]') ? portal : null;
  };
  page.__sjContrast = { describe, lines, runs, emptyField, hideText, unfade, restore, coverAt, modalOver, popupOf };
}

interface Helpers {
  describe(node: Element): string;
  lines(element: Element): Array<{ run: number; rect: DOMRect }>;
  runs(element: Element): TextRun[];
  emptyField(element: Element): boolean;
  hideText(element: Element): void;
  unfade(element: Element, run: number): void;
  restore(): void;
  coverAt(element: Element, x: number, y: number): Element | "nothing" | null;
  modalOver(element: Element): Element | null;
  popupOf(cover: Element, element: Element): Element | null;
}

// Brings line `index` of the element's text into view and returns its box, or why it can't be
// measured, or why it is inactive.
async function lineInView(locator: Locator, index: number): Promise<LineResult> {
  return locator.evaluate(async (element, { index, timeout }) => {
    const helpers = (window as unknown as { __sjContrast: Helpers }).__sjContrast;
    const inside = (rect: DOMRect) => rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
    let line = helpers.lines(element)[index];
    if (!line) return { blocker: `line ${index + 1} disappeared` };
    if (!inside(line.rect)) {
      element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      line = helpers.lines(element)[index];
    }
    if (line && !inside(line.rect)) {
      const { rect } = line;
      window.scrollBy({ left: rect.left + rect.width / 2 - innerWidth / 2, top: rect.top + rect.height / 2 - innerHeight / 2, behavior: "instant" });
      line = helpers.lines(element)[index];
    }
    if (!line || !inside(line.rect)) return { blocker: `line ${index + 1} cannot be scrolled fully into view` };

    // What covers the line at its start, middle or end, if anything. A line in view can still sit
    // under a fixed bar, so a covered line is centred once and checked again.
    const pointsOf = (rect: DOMRect) => {
      const middle = rect.top + rect.height / 2;
      return [rect.left + Math.min(2, rect.width / 2), rect.left + rect.width / 2, rect.right - Math.min(2, rect.width / 2)].map((x) => [x, middle] as const);
    };
    // Each covered point, with the layer over it, or "nothing" when the element is not hit there
    // at all (clipped away, for instance).
    const coversOf = (rect: DOMRect) => pointsOf(rect).map(([x, y]) => helpers.coverAt(element, x, y)).filter((cover) => cover !== null);
    const name = (cover: Element | "nothing") => (cover === "nothing" ? "nothing the page can name" : helpers.describe(cover));
    let covers = coversOf(line.rect);
    if (covers.length > 0) {
      element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
      line = helpers.lines(element)[index];
      if (!line || !inside(line.rect)) return { blocker: `line ${index + 1} is covered by ${name(covers[0])} and cannot be moved clear of it` };
      covers = coversOf(line.rect);
    }
    if (covers.length > 0) {
      // Inactive only behind an open modal dialog that hides the text from assistive technology,
      // with what covers it a layer the page can name, or under an open popup's layers. (A dialog
      // over part of the line leaves the rest showing, still behind the dialog and as inactive.)
      const hidden = element.closest('[aria-hidden="true"], [inert]');
      const modal = helpers.modalOver(element);
      if (hidden && modal && covers.every((cover) => cover !== "nothing")) {
        return { inactive: `behind ${name(covers[0])} while ${helpers.describe(modal)} is open, and hidden from assistive technology by ${helpers.describe(hidden)}` };
      }
      const popups = covers.map((cover) => (cover === "nothing" ? null : helpers.popupOf(cover, element)));
      if (popups.every(Boolean)) return { inactive: `behind ${name(covers[0])}, part of the open popup ${helpers.describe(popups[0]!)}` };
      return { blocker: `line ${index + 1} is covered by ${name(covers[0])}` };
    }
    const points = pointsOf(line.rect);

    // Wait for whatever is painted behind the text: an <img>, or a CSS background image.
    const loads: Array<Promise<unknown>> = [];
    const waiting: string[] = [];
    for (const [x, y] of points) {
      for (const layer of document.elementsFromPoint(x, y)) {
        if (layer instanceof HTMLImageElement && !layer.complete) {
          waiting.push(layer.currentSrc || layer.src);
          loads.push(new Promise((resolve) => {
            layer.addEventListener("load", resolve, { once: true });
            layer.addEventListener("error", resolve, { once: true });
          }));
        }
        for (const match of getComputedStyle(layer).backgroundImage.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
          const image = new Image();
          image.src = match[1];
          if (!image.complete) {
            waiting.push(match[1]);
            loads.push(image.decode().catch(() => undefined));
          }
        }
      }
    }
    const loaded = await Promise.race([
      Promise.all(loads).then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), timeout)),
    ]);
    if (!loaded) return { blocker: `an image behind line ${index + 1} did not load in ${timeout / 1000} s: ${waiting.map((src) => new URL(src, location.href).pathname).join(", ")}` };
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    line = helpers.lines(element)[index];
    if (!line || !inside(line.rect)) return { blocker: `line ${index + 1} moved out of view` };
    return { box: { x: line.rect.x, y: line.rect.y, width: line.rect.width, height: line.rect.height }, run: line.run };
  }, { index, timeout: IMAGE_TIMEOUT_MS });
}

// The pixels painted in `box` (CSS px), as RGBA. The box is shrunk to whole pixels inside it, so
// a neighbouring border or edge never counts as the text's background.
async function pixelsIn(page: Page, box: Box): Promise<Uint8Array> {
  let x = Math.ceil(box.x);
  let y = Math.ceil(box.y);
  let right = Math.floor(box.x + box.width);
  let bottom = Math.floor(box.y + box.height);
  if (right <= x) [x, right] = [Math.floor(box.x), Math.ceil(box.x + box.width)];
  if (bottom <= y) [y, bottom] = [Math.floor(box.y), Math.ceil(box.y + box.height)];
  // Device pixels: averaging them into CSS pixels would soften the darkest and lightest ones.
  const png = await page.screenshot({ clip: { x, y, width: right - x, height: bottom - y }, animations: "disabled", caret: "hide", scale: "device" });
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/** Saves the window's and every scrolled box's position, to put back with restoreScroll(). */
export async function saveScroll(page: Page): Promise<void> {
  await page.evaluate(() => {
    const saved: Array<[Element | Window, number, number]> = [[window, scrollX, scrollY]];
    for (const node of Array.from(document.querySelectorAll("*"))) {
      if (node.scrollTop !== 0 || node.scrollLeft !== 0) saved.push([node, node.scrollLeft, node.scrollTop]);
    }
    (window as unknown as { __sjSavedScroll?: typeof saved }).__sjSavedScroll = saved;
  });
}

export async function restoreScroll(page: Page): Promise<void> {
  await page.evaluate(() => {
    const holder = window as unknown as { __sjSavedScroll?: Array<[Element | Window, number, number]> };
    const all = Array.from(document.querySelectorAll("*")).filter((node) => node.scrollTop !== 0 || node.scrollLeft !== 0);
    for (const node of all) node.scrollTo({ left: 0, top: 0, behavior: "instant" });
    for (const [target, left, top] of holder.__sjSavedScroll ?? []) target.scrollTo({ left, top, behavior: "instant" });
    delete holder.__sjSavedScroll;
  });
}

/**
 * The worst WCAG contrast between an element's text and the pixels painted behind it. Each text run
 * (a text node and the style it is painted with) is judged against the contrast its own size and
 * weight need, and the element passes only when every line of every run does.
 */
export async function measureTextContrast(page: Page, selector: string, axeReason: string): Promise<ContrastMeasurement> {
  const base = { target: selector, axeReason };
  const locator = page.locator(selector);
  const count = await locator.count();
  if (count !== 1) return { ...base, passed: false, error: `the selector matches ${count} elements` };
  await page.evaluate(installHelpers);
  const runs = await locator.evaluate((element) => (window as unknown as { __sjContrast: Helpers }).__sjContrast.runs(element));
  if (runs.length === 0) {
    const empty = await locator.evaluate((element) => (window as unknown as { __sjContrast: Helpers }).__sjContrast.emptyField(element));
    if (empty) return { ...base, passed: true, note: "it is an empty field with no placeholder, so it shows no text" };
    return { ...base, passed: false, error: "it has no visible text" };
  }
  const colors: Rgba[] = [];
  for (const run of runs) {
    if (run.blocker) return { ...base, passed: false, error: run.blocker };
    try {
      colors.push(parseCssColor(run.fill));
    } catch (error) {
      return { ...base, passed: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  const lines = runs.reduce((sum, run) => sum + run.lines, 0);
  let worst: { margin: number; ratio: number; required: number; background: Rgb; run: number } | null = null;
  let pixels = 0;
  let inactive: string | undefined;
  for (let index = 0; index < lines; index += 1) {
    const line = await lineInView(locator, index);
    if ("inactive" in line) {
      inactive ??= line.inactive;
      continue;
    }
    if ("blocker" in line) return { ...base, passed: false, textColor: runs[0].fill, error: line.blocker };
    const run = runs[line.run];
    await locator.evaluate((element) => (window as unknown as { __sjContrast: Helpers }).__sjContrast.hideText(element));
    let rgba: Uint8Array;
    let unfaded: Uint8Array | undefined;
    try {
      rgba = await pixelsIn(page, line.box);
      if (run.opacity < 1) {
        await locator.evaluate((element, which) => (window as unknown as { __sjContrast: Helpers }).__sjContrast.unfade(element, which), line.run);
        unfaded = await pixelsIn(page, line.box);
      }
    } finally {
      await page.evaluate(() => (window as unknown as { __sjContrast: Helpers }).__sjContrast.restore());
    }
    const required = requiredTextContrast(run.fontSize, run.fontWeight);
    const each = worstContrastOver(colors[line.run], rgba, unfaded && { opacity: run.opacity, unfaded });
    pixels += each.pixels;
    const margin = each.ratio / required;
    if (!worst || margin < worst.margin) worst = { margin, ratio: each.ratio, required, background: each.background, run: line.run };
  }
  if (!worst && inactive) return { ...base, passed: true, inactive };
  if (!worst) return { ...base, passed: false, error: "no line of its text could be measured" };
  return {
    ...base,
    passed: worst.ratio >= worst.required,
    ratio: Math.floor(worst.ratio * 100) / 100,
    required: worst.required,
    textColor: runs[worst.run].fill,
    worstBackground: formatRgb(worst.background),
    lines,
    pixels,
  };
}
