// The accessibility gate shared by the journeys' expectAccessible(), the HX census, the explore
// survey and the Storybook check. It fails closed:
//
//   - Every axe violation fails, whatever its impact.
//   - Every check axe could not decide (an "incomplete" result) fails, unless a stronger
//     measurement settles it. Only colour contrast has one: axe gives up on text over a photo, a
//     gradient, a pseudo-element or anything it cannot read a colour from, so the gate measures
//     the pixels the browser paints behind that text instead (measureTextContrast below) and
//     fails unless the worst pixel meets WCAG 1.4.3 (4.5:1, or 3:1 for large text). A measurement
//     that cannot be taken is a failure too, never a pass.
//   - Both themes. The app follows the system's colour scheme, so the gate checks the page in the
//     theme it is showing, switches the system scheme to the other one and checks again, then puts
//     it back. A page that does not follow the switch fails: its other theme went unchecked.
import type { Locator, Page } from "@playwright/test";
import type { AxeResults, CheckResult, NodeResult, Result } from "axe-core";
import sharp from "sharp";
import { runAxe, type AxeScope } from "./axe";
import { formatRatio, formatRgb, parseCssColor, requiredTextContrast, worstContrastOver, type Rgb, type Rgba } from "./contrast";

export type ColorScheme = "light" | "dark";
export const COLOR_SCHEMES: readonly ColorScheme[] = ["light", "dark"];

export interface AxeFinding {
  rule: string;
  impact: string | null;
  help: string;
  target: string;
  message: string;
}

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
  /** Why the text could not be measured. A measurement that could not be taken fails. */
  error?: string;
}

export interface SchemeAudit {
  scheme: ColorScheme;
  violations: AxeFinding[];
  /** Checks axe could not decide and nothing stronger settled. */
  unresolved: AxeFinding[];
  /** Text axe could not judge for contrast, measured from the painted pixels. */
  contrast: ContrastMeasurement[];
}

export interface AuditOptions {
  scope?: AxeScope;
}

const SETTLE_TIMEOUT_MS = 10_000;

function selectorOf(node: NodeResult): string | null {
  return node.target.length === 1 && typeof node.target[0] === "string" ? node.target[0] : null;
}

function targetText(node: NodeResult): string {
  return node.target.map((part) => (Array.isArray(part) ? part.join(" >>> ") : String(part))).join(" | ");
}

function checkMessages(node: NodeResult): string {
  const checks: CheckResult[] = [...node.any, ...node.all, ...node.none];
  const messages = checks.map((check) => check.message).filter((message) => message);
  return messages.length > 0 ? messages.join("; ") : (node.failureSummary ?? "");
}

function findingsOf(result: Result): AxeFinding[] {
  return result.nodes.map((node) => ({
    rule: result.id,
    impact: result.impact ?? node.impact ?? null,
    help: result.help,
    target: targetText(node),
    message: checkMessages(node),
  }));
}

/** Every finding that fails the gate, one line each. Empty when the page passed. */
export function auditFailures(audit: SchemeAudit): string[] {
  const lines: string[] = [];
  for (const finding of audit.violations) {
    lines.push(`[${audit.scheme}] violation ${finding.rule} (${finding.impact ?? "no impact"}): ${finding.target}: ${finding.message || finding.help}`);
  }
  for (const finding of audit.unresolved) {
    lines.push(`[${audit.scheme}] unresolved ${finding.rule}: ${finding.target}: ${finding.message || finding.help}`);
  }
  for (const measured of audit.contrast) {
    if (measured.passed) continue;
    if (measured.error !== undefined) {
      lines.push(`[${audit.scheme}] color-contrast could not be measured: ${measured.target}: ${measured.error} (axe: ${measured.axeReason})`);
    } else {
      lines.push(
        `[${audit.scheme}] color-contrast measured ${formatRatio(measured.ratio ?? 0)}, needs ${measured.required}:1: ${measured.target}: ` +
          `text ${measured.textColor} over ${measured.worstBackground} (axe: ${measured.axeReason})`,
      );
    }
  }
  return lines;
}

/** A failure message for every audit, or null when every theme passed. */
export function describeAuditFailures(audits: readonly SchemeAudit[]): string | null {
  const lines = audits.flatMap(auditFailures);
  if (lines.length === 0) return null;
  return `Accessibility failures (${lines.length}):\n${lines.map((line) => `  ${line}`).join("\n")}`;
}

/** Turns axe's results into an audit, with the contrast axe could not judge still to be measured. */
export function classifyAxeResults(scheme: ColorScheme, results: Pick<AxeResults, "violations" | "incomplete">): {
  audit: SchemeAudit;
  contrastToMeasure: Array<{ node: NodeResult; axeReason: string }>;
} {
  const audit: SchemeAudit = { scheme, violations: results.violations.flatMap(findingsOf), unresolved: [], contrast: [] };
  const contrastToMeasure: Array<{ node: NodeResult; axeReason: string }> = [];
  for (const result of results.incomplete) {
    if (result.id !== "color-contrast") {
      audit.unresolved.push(...findingsOf(result));
      continue;
    }
    for (const node of result.nodes) contrastToMeasure.push({ node, axeReason: checkMessages(node) });
  }
  return { audit, contrastToMeasure };
}

/**
 * Waits until the page has stopped changing what it paints: web fonts loaded, the images in view
 * decoded and every finite animation or transition finished (a theme switch starts colour
 * transitions). Endless animations, such as a spinner, are left running.
 */
export async function settle(page: Page): Promise<void> {
  const outcome = await page.evaluate(async (timeout) => {
    const deadline = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), timeout));
    const work = (async () => {
      await document.fonts.ready;
      const inView = Array.from(document.images).filter((image) => {
        const rect = image.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
      });
      await Promise.all(inView.map((image) => image.decode().catch(() => undefined)));
      const finite = document.getAnimations().filter((animation) => {
        const end = animation.effect?.getComputedTiming().endTime;
        return animation.playState === "running" && typeof end === "number" && Number.isFinite(end);
      });
      await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return "settled" as const;
    })();
    return Promise.race([work, deadline]);
  }, SETTLE_TIMEOUT_MS);
  if (outcome === "timeout") {
    throw new Error(`The page was still loading images or animating after ${SETTLE_TIMEOUT_MS / 1000} s, so it could not be checked.`);
  }
}

async function shownScheme(page: Page): Promise<ColorScheme> {
  return (await page.evaluate(() => document.documentElement.classList.contains("dark"))) ? "dark" : "light";
}

/** Switches the system colour scheme and waits for the page to follow it. */
export async function showColorScheme(page: Page, scheme: ColorScheme): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme });
  try {
    await page.waitForFunction((dark) => document.documentElement.classList.contains("dark") === dark, scheme === "dark", { timeout: 5_000 });
  } catch {
    throw new Error(`The page did not switch to its ${scheme} theme when the system did, so its ${scheme} theme could not be checked.`);
  }
  await settle(page);
}

interface TextInfo {
  fill: string;
  opacity: number;
  fontSize: number;
  fontWeight: number;
  lines: number;
  blocker?: string;
}

// The element's own text (axe judges each element by the text nodes directly inside it): its
// colour, the opacity it is painted with, its size and how many line boxes it has.
async function ownText(locator: Locator): Promise<TextInfo> {
  return locator.evaluate((element) => {
    const describe = (node: Element) => `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ""}`;
    const texts = Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
    const style = getComputedStyle(element);
    const info = {
      fill: style.getPropertyValue("-webkit-text-fill-color") || style.color,
      opacity: 1,
      fontSize: parseFloat(style.fontSize),
      fontWeight: Number(style.fontWeight),
      lines: 0,
      blocker: undefined as string | undefined,
    };
    for (const node of texts) {
      const range = document.createRange();
      range.selectNodeContents(node);
      info.lines += Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0).length;
    }
    if (info.lines === 0) info.blocker = "it has no visible text of its own";
    const clip = style.getPropertyValue("-webkit-background-clip") || style.backgroundClip;
    if (clip === "text") info.blocker = "its text is painted with background-clip: text";
    for (let node: Element | null = element; node; node = node.parentElement) {
      const each = getComputedStyle(node);
      info.opacity *= Number(each.opacity);
      if (each.filter !== "none") info.blocker = `${describe(node)} has filter: ${each.filter}`;
      if (each.mixBlendMode !== "normal") info.blocker = `${describe(node)} has mix-blend-mode: ${each.mixBlendMode}`;
    }
    return info;
  });
}

interface LineBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Brings line `index` of the element's own text into view and returns its box, or why it can't be
// measured: still out of view, or covered by something else at its start, middle or end.
async function lineInView(locator: Locator, index: number): Promise<LineBox | { blocker: string }> {
  return locator.evaluate(async (element, { index, timeout }) => {
    const lineAt = () => {
      const rects: DOMRect[] = [];
      for (const node of Array.from(element.childNodes)) {
        if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        rects.push(...Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0));
      }
      return rects[index];
    };
    const inside = (rect: DOMRect) => rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
    let rect = lineAt();
    if (!rect) return { blocker: `line ${index + 1} disappeared` };
    if (!inside(rect)) {
      element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      rect = lineAt();
    }
    if (rect && !inside(rect)) {
      window.scrollBy({ left: rect.left + rect.width / 2 - innerWidth / 2, top: rect.top + rect.height / 2 - innerHeight / 2, behavior: "instant" });
      rect = lineAt();
    }
    if (!rect || !inside(rect)) return { blocker: `line ${index + 1} cannot be scrolled fully into view` };

    const describe = (node: Element) => {
      const label = node.getAttribute("aria-label");
      const id = node.id ? `#${node.id}` : "";
      const className = typeof node.className === "string" && node.className.trim() ? `.${node.className.trim().split(/\s+/).slice(0, 3).join(".")}` : "";
      return `${node.tagName.toLowerCase()}${id}${className}${label ? `[aria-label="${label}"]` : ""}`;
    };
    const middle = rect.top + rect.height / 2;
    const points = [rect.left + Math.min(2, rect.width / 2), rect.left + rect.width / 2, rect.right - Math.min(2, rect.width / 2)];
    const layers = new Set<Element>();
    for (const x of points) {
      const top = document.elementFromPoint(x, middle);
      if (!top || (top !== element && !element.contains(top))) {
        return { blocker: `line ${index + 1} is covered by ${top ? describe(top) : "nothing the page can name"}` };
      }
      for (const layer of document.elementsFromPoint(x, middle)) layers.add(layer);
    }

    // Wait for whatever is painted behind the text: an <img>, or a CSS background image.
    const loads: Array<Promise<unknown>> = [];
    for (const layer of layers) {
      if (layer instanceof HTMLImageElement) loads.push(layer.decode().catch(() => undefined));
      const background = getComputedStyle(layer).backgroundImage;
      for (const match of background.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
        const image = new Image();
        image.src = match[1];
        loads.push(image.decode().catch(() => undefined));
      }
    }
    const loaded = await Promise.race([
      Promise.all(loads).then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), timeout)),
    ]);
    if (!loaded) return { blocker: `an image behind line ${index + 1} did not finish loading` };
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    rect = lineAt();
    if (!rect || !inside(rect)) return { blocker: `line ${index + 1} moved out of view` };
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }, { index, timeout: SETTLE_TIMEOUT_MS });
}

// Hides the glyphs of the element (and its descendants) without changing `color`, so borders,
// icons and state layers drawn in currentColor keep painting exactly as with the text shown.
// CSSOM style changes are allowed under QA's Content-Security-Policy, unlike a <style> element.
async function setGlyphsHidden(locator: Locator, hidden: boolean): Promise<void> {
  await locator.evaluate((element, hide) => {
    type Saved = { value: string; priority: string };
    const store = element as Element & { __sjSavedFill?: Map<Element, Saved> };
    if (hide) {
      const saved = new Map<Element, Saved>();
      for (const node of [element, ...Array.from(element.querySelectorAll("*"))]) {
        const style = (node as HTMLElement).style;
        if (!style) continue;
        saved.set(node, { value: style.getPropertyValue("-webkit-text-fill-color"), priority: style.getPropertyPriority("-webkit-text-fill-color") });
        style.setProperty("-webkit-text-fill-color", "transparent", "important");
      }
      store.__sjSavedFill = saved;
      return;
    }
    for (const [node, { value, priority }] of store.__sjSavedFill ?? []) {
      const style = (node as HTMLElement).style;
      if (value) style.setProperty("-webkit-text-fill-color", value, priority);
      else style.removeProperty("-webkit-text-fill-color");
    }
    delete store.__sjSavedFill;
  }, hidden);
}

// The pixels painted in `box` (CSS px), as RGBA. The box is shrunk to whole pixels inside it, so
// a neighbouring border or edge never counts as the text's background.
async function pixelsIn(page: Page, box: LineBox): Promise<Uint8Array> {
  let x = Math.ceil(box.x);
  let y = Math.ceil(box.y);
  let right = Math.floor(box.x + box.width);
  let bottom = Math.floor(box.y + box.height);
  if (right <= x) [x, right] = [Math.floor(box.x), Math.ceil(box.x + box.width)];
  if (bottom <= y) [y, bottom] = [Math.floor(box.y), Math.ceil(box.y + box.height)];
  const png = await page.screenshot({ clip: { x, y, width: right - x, height: bottom - y }, animations: "disabled", caret: "hide", scale: "css" });
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

// The window's and every scrolled box's position, to put back after measuring.
async function saveScroll(page: Page): Promise<void> {
  await page.evaluate(() => {
    const saved: Array<[Element | Window, number, number]> = [[window, scrollX, scrollY]];
    for (const node of Array.from(document.querySelectorAll("*"))) {
      if (node.scrollTop !== 0 || node.scrollLeft !== 0) saved.push([node, node.scrollLeft, node.scrollTop]);
    }
    (window as unknown as { __sjSavedScroll?: typeof saved }).__sjSavedScroll = saved;
  });
}

async function restoreScroll(page: Page): Promise<void> {
  await page.evaluate(() => {
    const holder = window as unknown as { __sjSavedScroll?: Array<[Element | Window, number, number]> };
    const all = Array.from(document.querySelectorAll("*")).filter((node) => node.scrollTop !== 0 || node.scrollLeft !== 0);
    for (const node of all) node.scrollTo({ left: 0, top: 0, behavior: "instant" });
    for (const [target, left, top] of holder.__sjSavedScroll ?? []) target.scrollTo({ left, top, behavior: "instant" });
    delete holder.__sjSavedScroll;
  });
}

/**
 * The worst WCAG contrast between an element's own text and the pixels painted behind it: each
 * line box is screenshotted with the glyphs hidden, the text colour (with the opacity it is
 * painted at) is composited over every pixel, and the lowest ratio is kept.
 */
export async function measureTextContrast(page: Page, selector: string, axeReason: string): Promise<ContrastMeasurement> {
  const base = { target: selector, axeReason };
  const locator = page.locator(selector);
  const count = await locator.count();
  if (count !== 1) return { ...base, passed: false, error: `the selector matches ${count} elements` };
  const info = await ownText(locator);
  if (info.blocker) return { ...base, passed: false, error: info.blocker };
  let fill: Rgba;
  try {
    fill = parseCssColor(info.fill);
  } catch (error) {
    return { ...base, passed: false, error: error instanceof Error ? error.message : String(error) };
  }
  const text: Rgba = { ...fill, a: fill.a * info.opacity };
  const required = requiredTextContrast(info.fontSize, info.fontWeight);

  let ratio = Number.POSITIVE_INFINITY;
  let worst: Rgb = { r: 0, g: 0, b: 0 };
  let pixels = 0;
  for (let index = 0; index < info.lines; index += 1) {
    const line = await lineInView(locator, index);
    if ("blocker" in line) return { ...base, passed: false, required, textColor: info.fill, error: line.blocker };
    await setGlyphsHidden(locator, true);
    let rgba: Uint8Array;
    try {
      rgba = await pixelsIn(page, line);
    } finally {
      await setGlyphsHidden(locator, false);
    }
    const each = worstContrastOver(text, rgba);
    pixels += each.pixels;
    if (each.ratio < ratio) {
      ratio = each.ratio;
      worst = each.background;
    }
  }
  return {
    ...base,
    passed: ratio >= required,
    ratio: Math.floor(ratio * 100) / 100,
    required,
    textColor: info.fill,
    worstBackground: formatRgb(worst),
    lines: info.lines,
    pixels,
  };
}

/** Audits the page in the theme it is showing now. */
export async function auditShownScheme(page: Page, options: AuditOptions = {}): Promise<SchemeAudit> {
  await settle(page);
  const scheme = await shownScheme(page);
  const results = await runAxe(page, options.scope);
  const { audit, contrastToMeasure } = classifyAxeResults(scheme, results);
  if (contrastToMeasure.length === 0) return audit;
  await saveScroll(page);
  try {
    for (const { node, axeReason } of contrastToMeasure) {
      const selector = selectorOf(node);
      audit.contrast.push(
        selector === null
          ? { target: targetText(node), axeReason, passed: false, error: "it is inside a frame or shadow root, which this check cannot measure" }
          : await measureTextContrast(page, selector, axeReason),
      );
    }
  } finally {
    await restoreScroll(page);
  }
  return audit;
}

/**
 * Audits the page in both themes: the one it shows first, then the other, switched through the
 * system colour scheme, which is then put back.
 */
export async function auditAccessibility(page: Page, options: AuditOptions = {}): Promise<SchemeAudit[]> {
  const first = await shownScheme(page);
  const second: ColorScheme = first === "dark" ? "light" : "dark";
  const audits = [await auditShownScheme(page, options)];
  await showColorScheme(page, second);
  try {
    audits.push(await auditShownScheme(page, options));
  } finally {
    await showColorScheme(page, first);
  }
  return audits;
}
