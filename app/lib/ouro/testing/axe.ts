export { audit, axeExclude, describeFindings, gateRunOptions, measureTextContrast };
export type { GateFinding, Verdict };

import axe from "axe-core";
import { page } from "vitest/browser";
import { requireAxe } from "./axe-version";
import { pressTab } from "./tab";

// The export list comes first because the shadcn CLI drops comments before a file's
// first statement, which would take the JSDoc below with it.

/**
 * What an axe scan leaves out while an Ouro UI Dialog, ConfirmDialog or Sheet is open:
 * Base UI's focus guards. In WebKit they take `role="button"` without a name on purpose,
 * so VoiceOver's virtual cursor stays trapped in the modal, and axe reports
 * `aria-command-name` on them. They are visually hidden.
 *
 * @example
 * // Playwright
 * new AxeBuilder({ page }).exclude(axeExclude)
 * // axe-core
 * axe.run({ include: [document.documentElement], exclude: axeExclude.map((selector) => [selector]) })
 */
const axeExclude: string[] = ["[data-base-ui-focus-guard]"];

/**
 * One node {@link audit} fails: a violation, or a check axe could not decide that no measurement passed.
 *
 * @claim "One node audit fails" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > fails a violation whatever its impact: content outside every landmark is only moderate)
 * @claim "One node audit fails" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > fails text a tag covers, which axe cannot judge)
 */
interface GateFinding {
  /** The axe rule. */
  rule: string;
  /** axe's impact, if it gave one, else null. */
  impact: string | null;
  /** axe's one-line help for the rule. */
  help: string;
  /** The node's selector. */
  target: string;
  /** Why it fails: axe's own summary, or what the measurement found. */
  summary: string;
  /** True when axe left it undecided (`incomplete`) and a measurement failed it. */
  undecided: boolean;
}

/** A measurement's verdict on one node axe could not decide. */
type Verdict = { pass: true } | { pass: false; reason: string };

/**
 * axe's options for {@link audit}: every rule as axe ships it, with every node of the violations
 * and of the undecided checks (axe keeps one node of a result type `resultTypes` leaves out).
 *
 * @claim "axe's options for audit" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > fails text a tag covers, which axe cannot judge)
 */
const gateRunOptions: axe.RunOptions = { resultTypes: ["violations", "incomplete"], elementRef: true };

/**
 * {@link audit}'s findings as readable lines: the rule, its impact and help, and each node with why it fails.
 *
 * @claim "audit 's findings as readable lines" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > describes findings as one line per rule, with its impact and help, and one per node with why it fails)
 */
function describeFindings(findings: GateFinding[]): string {
  const byRule = new Map<string, GateFinding[]>();
  for (const finding of findings) {
    const head = `${finding.undecided ? "undecided " : ""}${finding.rule} (${finding.impact}): ${finding.help}`;
    byRule.set(head, [...(byRule.get(head) ?? []), finding]);
  }
  return [...byRule].map(([head, nodes]) => `${head}\n${nodes.map((node) => `  ${node.target}: ${node.summary}`).join("\n")}`).join("\n");
}

/**
 * An accessibility scan that fails closed: once running transitions finish, runs axe over
 * `context` with every rule, and returns every violation whatever its impact, and every check
 * axe could not decide unless a measurement passes it:
 *
 * - text contrast, only when the worst pixel behind the text meets WCAG 1.4.3 ({@link measureTextContrast});
 * - a link in a block of text, only when, measured from a screenshot, its text color or its
 *   background stands out 3:1 from its block's, or neither differs at all, as axe itself allows;
 * - a popup trigger's `aria-controls`, only when every element it names is on the page or the trigger is collapsed;
 * - focusable content hidden from assistive technology, only when Tab never focuses it while it is still hidden;
 * - an ARIA toggle inside a `<label>`, only when its name and description hold every word of the label;
 * - a field with two labels, only when `aria-labelledby` names it.
 *
 * Anything else axe could not decide fails with axe's own message. A node that leaves the page
 * while it is measured means the page changed under the scan, so it scans the page again, and on
 * the third scan such a node fails. It throws on an axe-core older than the kit's minimum
 * (axe-version.ts), naming the version it found.
 *
 * @example
 * const findings = await audit({ include: [document.documentElement], exclude: axeExclude.map((selector) => [selector]) });
 * expect(describeFindings(findings)).toBe("");
 * @claim "An accessibility scan that fails closed" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > fails a violation whatever its impact: content outside every landmark is only moderate)
 * @claim "An accessibility scan that fails closed" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > measures text once its color transitions finish, as after a switch to dark)
 * @claim "text contrast, only when the worst" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > passes text over a gradient when every pixel behind it meets 4.5:1, and fails faint text over the same gradient)
 * @claim "a link in a block of text," registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > settles a link in running text whose block's background axe cannot read, as under an open list, by measuring the link against the text around it)
 * @claim "a popup trigger's `aria-controls`, only when" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > fails a popup trigger whose expanded popup is missing, and passes it once the popup is there)
 * @claim "focusable content hidden from assistive technology," registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > fails a control hidden from assistive technology under a modal when Tab still reaches it, and passes it when the page is inert)
 * @claim "focusable content hidden from assistive technology," registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > passes a control hidden at rest that shows itself in the event that focuses it, as a toast's dismiss button does)
 * @claim "an ARIA toggle inside a `<label>`, only" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > passes a toggle inside a <label> whose text is its name and description, and fails one whose label says more)
 * @claim "Anything else axe could not decide" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > fails what axe could not decide and the kit does not measure, with axe's own message)
 * @claim "It throws on an axe-core older than the kit's minimum" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > refuses an axe-core older than the kit's minimum, naming the version it needs and the version it found)
 * @claim "A node that leaves the page" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > scans the page again when a node it found leaves the page while it is measured, as a Searching… line does)
 * @claim "A node that leaves the page" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > fails a node that leaves the page each time it is measured, three scans running)
 * @claim "a field with two labels, only when" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > passes a field with two labels when aria-labelledby names it, and fails it when nothing settles which label names it)
 */
async function audit(context: axe.ElementContext): Promise<GateFinding[]> {
  // The registry names axe-core without a version, so an app keeps the one it has; an older one
  // decides some checks differently (link-in-text-block among them), so it must not pass quietly.
  requireAxe(axe.version, "audit");
  // A node that leaves the page while it is measured (a "Searching…" line once results come) means
  // the page changed under the scan: scan the page as it is now, and fail once it never holds still.
  for (let attempt = 1; ; attempt++) {
    try {
      return await auditOnce(context, attempt === 3);
    } catch (error) {
      if (!(error instanceof PageChanged)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
}

/** Thrown when a node the scan found has left the page by the time it is measured. */
class PageChanged extends Error {}

const keptChanging = "it left the page while it was measured, three scans running: the page never held still";

async function auditOnce(context: axe.ElementContext, last: boolean): Promise<GateFinding[]> {
  await settleTransitions();
  const result = await axe.run(context, gateRunOptions);
  const findings: GateFinding[] = [];
  for (const rule of result.violations) {
    for (const node of rule.nodes) {
      findings.push({ rule: rule.id, impact: rule.impact ?? null, help: rule.help, target: node.target.join(" "), summary: node.failureSummary ?? "", undecided: false });
    }
  }
  const undecided = result.incomplete.flatMap((rule) => rule.nodes.map((node) => ({ rule, node })));
  const measured = new Map<axe.NodeResult, Verdict>();
  const gone = (): Verdict => {
    if (!last) throw new PageChanged();
    return { pass: false, reason: keptChanging };
  };
  // Text is measured in groups, one screenshot each: the largest box around it that fits the
  // screen, so a card's or a chart's text shares one picture.
  const byRoot = new Map<Element, { node: axe.NodeResult; element: Element; required: number }[]>();
  for (const { rule, node } of undecided) {
    if (rule.id !== "color-contrast") continue;
    const element = elementOf(node);
    if (!element) {
      measured.set(node, gone());
      continue;
    }
    const data = node.any[0]?.data as { expectedContrastRatio?: string } | undefined;
    const root = screenRoot(element);
    byRoot.set(root, [...(byRoot.get(root) ?? []), { node, element, required: requiredRatio(element, data?.expectedContrastRatio) }]);
  }
  for (const [root, items] of byRoot) {
    const verdicts = await measureTexts(root, items, last);
    for (const [index, item] of items.entries()) {
      // Scrolled for the group, a sticky part of the page can sit over the text: measured alone,
      // centered on the screen, it shows as a reader scrolls to it.
      const verdict = verdicts[index]!.pass || root === item.element ? verdicts[index]! : (await measureTexts(item.element, [item], last))[0]!;
      measured.set(item.node, verdict);
    }
  }
  // A link in a block of text whose colors axe could not read, as when an open list lies over the
  // block where axe reads its background: measured against the text around it from a screenshot.
  for (const { rule, node } of undecided) {
    const block = checksOf(node).find((check) => check.id === "link-in-text-block")?.relatedNodes?.[0];
    if (rule.id !== "link-in-text-block" || !block) continue;
    const link = elementOf(node);
    const parent = elementOf(block);
    measured.set(node, link && parent ? await measureLinkInText(link, parent) : gone());
  }
  // Focusable content hidden from assistive technology: one Tab walk around the page for all of it.
  // Walks move focus, which can show a tooltip, so they run after every other measurement.
  const hiding = undecided.filter(({ node }) => walks(node));
  if (hiding.length > 0) {
    const targets = new Map<axe.NodeResult, HTMLElement[]>();
    for (const { node } of hiding) {
      const hidden = checksOf(node).flatMap((check) => check.relatedNodes ?? []).map((related) => elementOf(related));
      if (hidden.some((entry) => entry === null)) measured.set(node, gone());
      else targets.set(node, hidden as HTMLElement[]);
    }
    const reached = await tabReaches([...targets.values()].flat());
    for (const [node, hidden] of targets) {
      const first = reached.find((element) => hidden.some((target) => target.contains(element)));
      measured.set(node, first ? { pass: false, reason: `Tab reaches ${describe(first)}, which is hidden from assistive technology` } : { pass: true });
    }
  }
  for (const { rule, node } of undecided) {
    const verdict = measured.get(node) ?? decide(rule.id, node, gone);
    if (verdict.pass) continue;
    findings.push({ rule: rule.id, impact: rule.impact ?? null, help: rule.help, target: node.target.join(" "), summary: verdict.reason, undecided: true });
  }
  return findings;
}

/** The checks a node did not pass: in axe's results, an undecided node lists only those. */
const checksOf = (node: axe.NodeResult) => [...node.any, ...node.all, ...node.none];

/** Whether settling a node takes a Tab walk: when the checks it did not pass are about focus under a modal. */
const walks = (node: axe.NodeResult) => checksOf(node).length > 0 && checksOf(node).every((check) => check.id === "focusable-modal-open");

/** Settles one node axe could not decide by what the page holds, where the gate knows how; anything else fails with axe's message. */
function decide(rule: string, node: axe.NodeResult, gone: () => Verdict): Verdict {
  const open = checksOf(node);
  const message = open.map((check) => check.message).join("; ");
  const element = elementOf(node);
  if (!element) return gone();
  if (open.length > 0 && open.every((check) => check.id === "aria-valid-attr-value" && (check.data as { messageKey?: string } | null)?.messageKey === "controlsWithinPopup")) {
    return popupControlsExist(element) ? { pass: true } : { pass: false, reason: message };
  }
  if (open.length > 0 && open.every((check) => check.id === "no-implicit-explicit-label")) {
    return labelSaysNoMore(element) ? { pass: true } : { pass: false, reason: message };
  }
  if (rule === "form-field-multiple-labels") {
    // Which label names the field is settled when aria-labelledby names it, as it outranks every <label>.
    return named(element, "aria-labelledby").length > 0 ? { pass: true } : { pass: false, reason: message };
  }
  return { pass: false, reason: message };
}

/** The element an axe selector names, when it still finds exactly one in the page. */
// The element axe found, while it is still on the page; else the one its selector names.
function elementOf(node: { target: axe.UnlabelledFrameSelector | string[]; element?: HTMLElement }): HTMLElement | null {
  if (node.element?.isConnected) return node.element;
  const { target } = node;
  const selector = target.at(-1);
  if (typeof selector !== "string" || target.length !== 1) return null;
  const found = document.querySelectorAll<HTMLElement>(selector);
  return found.length === 1 ? found[0]! : null;
}

/** An element as a person would find it in a failure: its tag, its id or its text. */
const describe = (element: Element) => `<${element.localName}${element.id ? `#${element.id}` : ""}> "${(element.textContent ?? "").trim().slice(0, 40) || element.getAttribute("aria-label") || ""}"`;

// Whether every element a popup trigger's `aria-controls` names is on the page, or the trigger is
// collapsed (its popup need not exist yet).
function popupControlsExist(element: Element): boolean {
  if (element.getAttribute("aria-expanded") === "false") return true;
  const ids = (element.getAttribute("aria-controls") ?? "").split(/\s+/).filter(Boolean);
  return ids.length > 0 && ids.every((id) => element.ownerDocument.getElementById(id) !== null);
}

// Text as lowercase words.
const words = (text: string | null | undefined) => (text ?? "").toLowerCase().split(/\s+/).filter(Boolean);

// The words of an element's text, each text node apart, as adjacent nodes ("oats" and "1 cup") read as separate words.
function wordsIn(element: Element | null): string[] {
  if (!element) return [];
  const found: string[] = [];
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) found.push(...words(node.textContent));
  return found;
}

// The words of the elements an ID-list attribute (`aria-labelledby`, `aria-describedby`) points at.
const named = (element: Element, attribute: string) => (element.getAttribute(attribute) ?? "").split(/\s+/).flatMap((id) => (id ? wordsIn(element.ownerDocument.getElementById(id)) : []));

// Whether the <label> around an ARIA toggle says nothing its name and description leave out: a
// <label> does not name an ARIA widget, so the words it holds must reach assistive technology another way.
function labelSaysNoMore(element: Element): boolean {
  const conveyed = new Set([...named(element, "aria-labelledby"), ...words(element.getAttribute("aria-label")), ...wordsIn(element), ...named(element, "aria-describedby")]);
  return wordsIn(element.closest("label")).every((word) => conveyed.has(word));
}

// Presses Tab once around the page from where focus is, two frames apart, and returns each element
// inside one of `targets` that Tab focuses while it is still hidden from assistive technology when
// the focus event reaches the document (after the page's own handlers, which may show it). Focus
// goes back where it was.
async function tabReaches(targets: HTMLElement[]): Promise<HTMLElement[]> {
  const start = document.activeElement;
  const stops = document.querySelectorAll("a[href], button, input, select, textarea, [tabindex], [contenteditable]").length;
  const reached = new Set<HTMLElement>();
  const watch = (event: FocusEvent) => {
    const focused = event.target as HTMLElement;
    if (focused.closest('[aria-hidden="true"]') && targets.some((target) => target.contains(focused))) reached.add(focused);
  };
  document.addEventListener("focusin", watch);
  try {
    for (let press = 0; press < stops + 2; press++) {
      await pressTab();
      // A person's next press comes frames later, and a focus trap may send focus back on the next
      // frame (Base UI's does in WebKit): pressing sooner would tab past the trap and out of the page.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
  } finally {
    document.removeEventListener("focusin", watch);
  }
  if (start instanceof HTMLElement && start.isConnected) start.focus();
  return [...reached];
}

// The contrast WCAG 1.4.3 asks of the element's text: axe's own figure when it gave one, else 3:1
// for large text (24px, or 18.66px bold) and 4.5:1 for the rest.
function requiredRatio(element: Element, expected: string | undefined): number {
  const stated = expected ? Number.parseFloat(expected) : Number.NaN;
  if (Number.isFinite(stated)) return stated;
  const style = getComputedStyle(element);
  const size = Number.parseFloat(style.fontSize);
  const bold = Number.parseInt(style.fontWeight, 10) >= 700;
  return size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
}

// A color as sRGB channels from 0 to 255 and alpha from 0 to 1.
interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Any color the browser computes (`oklch(…)`, `color(srgb …)`, `rgb(…)`) as sRGB, by painting it on a canvas. */
function toRgba(color: string): Rgba {
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  context.canvas.width = 1;
  context.canvas.height = 1;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
  return { r: r!, g: g!, b: b!, a: a! / 255 };
}

const linear = (value: number) => {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = ({ r, g, b }: Rgba) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

// WCAG's contrast ratio between two opaque colors.
function contrast(a: Rgba, b: Rgba): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** `top` painted over an opaque `under`. */
const over = (top: Rgba, under: Rgba): Rgba => ({
  r: top.r * top.a + under.r * (1 - top.a),
  g: top.g * top.a + under.g * (1 - top.a),
  b: top.b * top.a + under.b * (1 - top.a),
  a: 1,
});

/** The boxes of the element's own text on the screen, one per line; for a text field, its content box. */
function textBoxes(element: Element): DOMRect[] {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const inset = (side: "Top" | "Right" | "Bottom" | "Left") => Number.parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) + Number.parseFloat(style.getPropertyValue(`padding-${side.toLowerCase()}`));
    return [new DOMRect(box.left + inset("Left"), box.top + inset("Top"), box.width - inset("Left") - inset("Right"), box.height - inset("Top") - inset("Bottom"))];
  }
  const boxes: DOMRect[] = [];
  const range = document.createRange();
  for (const child of element.childNodes) {
    if (child.nodeType !== Node.TEXT_NODE || !child.textContent?.trim()) continue;
    range.selectNodeContents(child);
    boxes.push(...[...range.getClientRects()].filter((box) => box.width > 0 && box.height > 0));
  }
  return boxes;
}

/** A letter's cell on the screen: its corners, in order, and the box around them. */
interface Cell {
  box: DOMRect;
  corners: DOMPoint[];
}

// The cells of SVG text's letters, each turned as it is drawn (text set on a curve turns each
// letter), so a letter is measured against what is behind it and not the box around it. Null for
// other text, and for SVG text with markup inside, which textBoxes measures by its lines.
function letterCells(element: Element): Cell[] | null {
  if (!(element instanceof SVGTextContentElement) || [...element.childNodes].some((child) => child.nodeType !== Node.TEXT_NODE)) return null;
  const matrix = element.getScreenCTM();
  if (!matrix) return null;
  const text = element.textContent ?? "";
  const cells: Cell[] = [];
  for (let index = 0; index < element.getNumberOfChars(); index++) {
    if (!text[index]?.trim()) continue;
    const extent = element.getExtentOfChar(index);
    const start = element.getStartPositionOfChar(index);
    const end = element.getEndPositionOfChar(index);
    const angle = (element.getRotationOfChar(index) * Math.PI) / 180;
    const [cos, sin] = [Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle))];
    const advance = Math.hypot(end.x - start.x, end.y - start.y);
    // The extent is the box around the turned cell, so the cell's height comes from it.
    const height = cos >= sin ? (extent.height - advance * sin) / cos : (extent.width - advance * cos) / sin;
    const center = { x: extent.x + extent.width / 2, y: extent.y + extent.height / 2 };
    const along = { x: Math.cos(angle), y: Math.sin(angle) };
    const across = { x: -along.y, y: along.x };
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([a, b]) => new DOMPoint(center.x + (a! * advance * along.x + b! * height * across.x) / 2, center.y + (a! * advance * along.y + b! * height * across.y) / 2).matrixTransform(matrix));
    const xs = corners.map((corner) => corner.x);
    const ys = corners.map((corner) => corner.y);
    const box = new DOMRect(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    if (box.width > 0 && box.height > 0) cells.push({ box, corners });
  }
  return cells;
}

// Whether a point is inside a cell's corners, which go round it in order.
function insideCell(corners: { x: number; y: number }[], x: number, y: number): boolean {
  const sides = corners.map((corner, index) => {
    const next = corners[(index + 1) % corners.length]!;
    return Math.sign((next.x - corner.x) * (y - corner.y) - (next.y - corner.y) * (x - corner.x));
  });
  return sides.every((side) => side >= 0) || sides.every((side) => side <= 0);
}

// The opacity the element's text is painted with: its own and every ancestor's, multiplied.
function paintedOpacity(element: Element): number {
  let opacity = 1;
  for (let node: Element | null = element; node; node = node.parentElement) opacity *= Number.parseFloat(getComputedStyle(node).opacity);
  return opacity;
}

// Waits for the page's running CSS transitions, such as the colors easing after a switch to dark,
// so text is measured as it rests. Gives up after 3 seconds.
async function settleTransitions(): Promise<void> {
  const running = document.getAnimations().filter((animation) => animation instanceof CSSTransition && animation.playState === "running");
  const finished = Promise.all(running.map((animation) => animation.finished.catch(() => undefined)));
  await Promise.race([finished, new Promise((resolve) => setTimeout(resolve, 3000))]);
}

// The element's box as a canvas, two frames after a change to what it shows. Only the element is
// taken: the browser paints a whole long page's screenshot wrongly away from where it is scrolled.
async function screenshot(element: Element): Promise<CanvasRenderingContext2D> {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const image = new Image();
  image.src = `data:image/png;base64,${await page.screenshot({ save: false, element, animations: "disabled", timeout: 5000 })}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(image, 0, 0);
  return context;
}

/**
 * The rule that hides glyphs while the page behind them is screenshotted: the element's, and all
 * other text on the page too, as a tall heading's descenders reach into the line below, except
 * other text drawn over the element's, which is what it is seen against.
 *
 * @claim "and all other text on the page too" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > measures a heading's second line against the page, not the descenders of the line above)
 * @claim "except other text drawn over the" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > fails text that other text is drawn over, as a tag without a background over a line)
 */
const hideGlyphs =
  "body * { -webkit-text-fill-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; } " +
  "[data-ouro-measure-keep] { -webkit-text-fill-color: currentcolor !important; } " +
  "svg text, svg tspan { fill: transparent !important; stroke: transparent !important; } " +
  "[data-ouro-measure], [data-ouro-measure] * { color: transparent !important; -webkit-text-fill-color: transparent !important; " +
  "fill: transparent !important; stroke: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; caret-color: transparent !important; transition: none !important; } " +
  "[data-ouro-measure-layer] { opacity: 0 !important; transition: none !important; }";

/**
 * Measures text contrast that axe could not judge: waits for running transitions, hides the
 * element's glyphs, screenshots the page and finds the worst pixel behind each line of its
 * text. Anything drawn over the text (an outline, a tag, a veil) counts as behind it, since it
 * is what the text is seen against.
 * Passes when the text color, as painted over that pixel, meets `required` (4.5 or 3). Where an open
 * popup covers the text (its shadow too), the covered part is hidden while it is open, and only what
 * still shows is measured.
 *
 * @example
 * const verdict = await measureTextContrast(label, 4.5);
 * expect(verdict).toEqual({ pass: true });
 * @claim "Measures text contrast that axe could" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > passes text over a gradient when every pixel behind it meets 4.5:1, and fails faint text over the same gradient)
 * @claim "Measures text contrast that axe could" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > measures a line drawn over text as what the text is seen against, though axe never sees it)
 * @claim "Measures text contrast that axe could" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > measures text once its color transitions finish, as after a switch to dark)
 * @claim "Passes when the text color, as" registry/ouro/lib/ouro/testing/axe.ts verify:fileLine(registry/ouro/lib/ouro/testing/axe.ts, /\? 3 : 4\.5;/)
 * @claim "Where an open popup covers the" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > passes text an open popup covers once the popup shuts it off from assistive technology, and measures what still shows)
 * @claim "Where an open popup covers the" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > passes page text a popup's layer covers, which hides it while the popup is open, and measures what still shows)
 * @claim "Where an open popup covers the" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > counts a popup's shadow on the text as the popup's, as it is drawn by the open popup)
 */
async function measureTextContrast(element: Element, required: number): Promise<Verdict> {
  return (await measureTexts(element, [{ element, required }], true))[0]!;
}

// The elements whose own text is drawn over the text of `measured` (half a line's height or more,
// so a line's descenders reaching into the next do not count, even in a face with tall lines),
// outside those elements.
function overlappingText(measured: Element[]): Set<Element> {
  const lines = measured.flatMap((element) => textBoxes(element));
  const kept = new Set<Element>();
  const range = document.createRange();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || kept.has(parent) || !node.textContent?.trim() || measured.some((element) => element.contains(parent))) continue;
    range.selectNodeContents(node);
    const over = [...range.getClientRects()].some((box) =>
      lines.some((line) => Math.min(box.right, line.right) - Math.max(box.left, line.left) > 0 && Math.min(box.bottom, line.bottom) - Math.max(box.top, line.top) >= line.height / 2),
    );
    if (over) kept.add(parent);
  }
  return kept;
}

// The element's largest ancestor (or itself) that fits on the screen, below <body> and within the
// popup layer it is in, if any, since the measuring tells a layer's pixels by hiding it.
function screenRoot(element: Element): Element {
  let root = element;
  for (let parent = element.parentElement; parent && parent !== document.body && !root.hasAttribute("data-base-ui-portal"); parent = parent.parentElement) {
    const box = parent.getBoundingClientRect();
    if (box.width > window.innerWidth || box.height > window.innerHeight) break;
    root = parent;
  }
  return root;
}

// Whether all of an element's text shows: inside every box that clips it up to `root`, and the screen.
function inView(element: Element, root: Element): boolean {
  let clip = new DOMRect(0, 0, window.innerWidth, window.innerHeight);
  for (let parent = element.parentElement; parent; parent = parent === root ? null : parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.overflowX === "visible" && style.overflowY === "visible") continue;
    const box = parent.getBoundingClientRect();
    const left = Math.max(clip.left, box.left);
    const top = Math.max(clip.top, box.top);
    clip = new DOMRect(left, top, Math.min(clip.right, box.right) - left, Math.min(clip.bottom, box.bottom) - top);
  }
  return textBoxes(element).every((box) => box.left >= clip.left - 1 && box.right <= clip.right + 1 && box.top >= clip.top - 1 && box.bottom <= clip.bottom + 1);
}

// Measures each element's text against screenshots of `root`, which holds them all: one, as a
// chart's many axis labels share one picture, unless some text is scrolled out of a box inside it
// (a wide table's last columns), which is scrolled to and taken with the text that then shows.
// Unless this is the `last` try, a node gone from the page throws PageChanged, so the scan runs again.
async function measureTexts(root: Element, items: { element: Element; required: number }[], last: boolean): Promise<Verdict[]> {
  // Centered, so a sticky header does not sit over text that scrolled to the top edge.
  root.scrollIntoView({ block: "center", inline: "nearest" });
  await settleTransitions();
  const verdicts = new Map<{ element: Element; required: number }, Verdict>();
  let pending = [...items];
  while (pending.length > 0) {
    const first = pending[0]!;
    if (first.element.isConnected && !inView(first.element, root)) first.element.scrollIntoView({ block: "nearest", inline: "nearest" });
    const batch = [first, ...pending.slice(1).filter(({ element }) => element.isConnected && inView(element, root))];
    const results = await shoot(root, batch, last);
    for (const [index, item] of batch.entries()) verdicts.set(item, results[index]!);
    pending = pending.filter((item) => !batch.includes(item));
  }
  return items.map((item) => verdicts.get(item)!);
}

// Whether an element lays out as a block, as axe counts one: an inline-block is one too.
const isBlock = (element: Element) => {
  const { display } = getComputedStyle(element);
  return ["block", "list-item", "table", "flex", "grid", "inline-block"].includes(display) || display.startsWith("table-");
};

// An element's text color as painted: its own, times its opacity and every ancestor's.
function paintedColor(element: Element): Rgba {
  const color = toRgba(getComputedStyle(element).color);
  return { ...color, a: color.a * paintedOpacity(element) };
}

// The boxes of the lines of text in `container` on the screen, of the elements `keep` lets in.
function lineBoxes(container: Element, keep: (element: Element) => boolean): { element: Element; box: DOMRect }[] {
  const lines: { element: Element; box: DOMRect }[] = [];
  const range = document.createRange();
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node.parentElement!;
    if (!node.textContent!.trim() || !keep(element) || !element.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
    range.selectNodeContents(node);
    for (const box of range.getClientRects()) {
      if (box.width > 0 && box.height > 0 && box.right > 0 && box.bottom > 0 && box.left < innerWidth && box.top < innerHeight) lines.push({ element, box });
    }
  }
  return lines;
}

// A contrast ratio as axe states it: cut to two decimals.
const cut = (ratio: number) => Math.floor(ratio * 100) / 100;

// Settles axe's link-in-text-block check where axe could not read the colors, by axe's rule for
// it with its options (3:1, the same color allowed), on what a screenshot shows: the link's color
// against its block's, each painted over what is behind it, and, where something between the link
// and the block paints a background of its own, the background behind the link's text against the
// one behind the block's text around it (outside other links and inner blocks). A background is
// the mean of the pixels behind those lines, glyphs hidden, that nothing else covers.
async function measureLinkInText(link: Element, block: Element): Promise<Verdict> {
  link.scrollIntoView({ block: "center", inline: "nearest" });
  await settleTransitions();
  const own = lineBoxes(link, () => true);
  let painted = false;
  for (let element: Element | null = link; element && element !== block; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (toRgba(style.backgroundColor).a > 0 || style.backgroundImage !== "none") painted = true;
  }
  // Without a background of its own, the link's text and the block's are on one surface.
  const around = painted
    ? lineBoxes(block, (element) => {
        if (element.closest('a[href], [role="link"]')) return false;
        for (let parent: Element | null = element; parent && parent !== block; parent = parent.parentElement) if (isBlock(parent)) return false;
        return true;
      })
    : [];
  const unseen = "axe could not judge whether it stands out from the text around it, and no text of it and around it shows to measure";
  if (own.length === 0 || (painted && around.length === 0)) return { pass: false, reason: unseen };
  // A still, transparent box over those lines: its screenshot is the page there.
  const boxes = [...own, ...around].map(({ box }) => box);
  const left = Math.max(0, Math.floor(Math.min(...boxes.map((box) => box.left))));
  const top = Math.max(0, Math.floor(Math.min(...boxes.map((box) => box.top))));
  const right = Math.min(innerWidth, Math.ceil(Math.max(...boxes.map((box) => box.right))));
  const bottom = Math.min(innerHeight, Math.ceil(Math.max(...boxes.map((box) => box.bottom))));
  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  Object.assign(probe.style, { position: "fixed", left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px`, pointerEvents: "none" });
  const hide = document.createElement("style");
  hide.textContent = hideGlyphs;
  document.head.append(hide);
  document.body.append(probe);
  let context: CanvasRenderingContext2D;
  try {
    // A transformed or filtered page places a fixed box by itself, not by the screen.
    const placed = probe.getBoundingClientRect();
    if (Math.abs(placed.left - left) > 0.5 || Math.abs(placed.top - top) > 0.5) throw new Error("the page moves a fixed box away from where it is placed");
    context = await screenshot(probe);
  } catch (error) {
    return { pass: false, reason: `axe could not judge whether it stands out from the text around it, and it could not be screenshotted: ${(error as Error).message.split("\n")[0]}` };
  } finally {
    probe.remove();
    hide.remove();
  }
  const scale = context.canvas.width / (right - left);
  // Whether an element paints nothing of its own, as Base UI's invisible backdrop under a modal
  // menu or list, which lies over the whole screen: no background, border, shadow or own text.
  const bare = new Map<Element, boolean>();
  const paintsNothing = (element: Element) => {
    let known = bare.get(element);
    if (known === undefined) {
      const style = getComputedStyle(element);
      const borders = ["top", "right", "bottom", "left"].some((side) => Number.parseFloat(style.getPropertyValue(`border-${side}-width`)) > 0);
      const text = [...element.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && child.textContent!.trim());
      const replaced = /^(img|svg|canvas|video|iframe|input|textarea|select|object|embed)$/.test(element.localName);
      known = toRgba(style.backgroundColor).a === 0 && style.backgroundImage === "none" && !borders && style.boxShadow === "none" && !text && !replaced;
      bare.set(element, known);
    }
    return known;
  };
  // Whether the line's own element, or what holds it, is the first thing that paints at a point.
  const showsAt = (element: Element, x: number, y: number) => {
    for (const hit of document.elementsFromPoint(x, y)) {
      if (hit.contains(element) || element.contains(hit)) return true;
      if (!paintsNothing(hit)) return false;
    }
    return false;
  };
  // The mean of the pixels behind the lines where the line's own element, or what holds it, shows.
  const behind = (lines: { element: Element; box: DOMRect }[]): Rgba | null => {
    const sum = { r: 0, g: 0, b: 0, count: 0 };
    for (const { element, box } of lines) {
      const x = Math.max(0, Math.floor((box.left - left) * scale));
      const y = Math.max(0, Math.floor((box.top - top) * scale));
      const width = Math.min(context.canvas.width, Math.ceil((box.right - left) * scale)) - x;
      const height = Math.min(context.canvas.height, Math.ceil((box.bottom - top) * scale)) - y;
      if (width <= 0 || height <= 0) continue;
      const pixels = context.getImageData(x, y, width, height).data;
      // Hit-tested once a screen pixel, at its centre.
      const seen = new Map<string, boolean>();
      for (let index = 0; index < pixels.length; index += 4) {
        const pixel = index / 4;
        const pointX = Math.floor(left + (x + (pixel % width) + 0.5) / scale) + 0.5;
        const pointY = Math.floor(top + (y + Math.floor(pixel / width) + 0.5) / scale) + 0.5;
        const key = `${pointX},${pointY}`;
        if (!seen.has(key)) {
          seen.set(key, showsAt(element, pointX, pointY));
        }
        if (!seen.get(key)) continue;
        sum.r += pixels[index]!;
        sum.g += pixels[index + 1]!;
        sum.b += pixels[index + 2]!;
        sum.count++;
      }
    }
    return sum.count > 0 ? { r: sum.r / sum.count, g: sum.g / sum.count, b: sum.b / sum.count, a: 1 } : null;
  };
  const linkBackground = behind(own);
  // Covered wholly, as by an open popup, the link shows nothing to tell apart.
  if (!linkBackground) return { pass: true };
  const blockBackground = painted ? behind(around) : linkBackground;
  if (!blockBackground) return { pass: false, reason: unseen };
  const text = cut(contrast(over(paintedColor(link), linkBackground), over(paintedColor(block), blockBackground)));
  const background = cut(contrast(linkBackground, blockBackground));
  if (text >= 3 || background >= 3 || (text === 1 && background === 1)) return { pass: true };
  return {
    pass: false,
    reason: `measured ${text.toFixed(2)}:1 between its text and its block's text, and ${background.toFixed(2)}:1 between their backgrounds; needs 3:1 for either, or a style that does not rely on color, such as an underline`,
  };
}

/** What hides an element from assistive technology. */
const hiddenFromAt = '[aria-hidden="true"], [inert]';

// Measures each element's text against one screenshot of `root` as it is scrolled now.
async function shoot(root: Element, items: { element: Element; required: number }[], last: boolean): Promise<Verdict[]> {
  if (!root.isConnected || items.some(({ element }) => !element.isConnected)) {
    if (!last) throw new PageChanged();
    return items.map(() => ({ pass: false, reason: keptChanging }));
  }
  // The boxes within the root, not on the screen: taking the screenshot can scroll the page.
  const start = root.getBoundingClientRect();
  const texts = items.map(({ element, required }) => {
    // Within the root: each line's box, or each letter's cell for SVG text.
    const cells = (letterCells(element) ?? textBoxes(element).map((box) => ({ box, corners: null }))).map(({ box, corners }) => ({
      box: new DOMRect(box.left - start.left, box.top - start.top, box.width, box.height),
      corners: corners?.map((corner) => ({ x: corner.x - start.left, y: corner.y - start.top })) ?? null,
    }));
    // SVG text, such as a chart's axis labels, is painted with its fill.
    const style = getComputedStyle(element);
    const color = toRgba(element instanceof SVGElement ? style.fill : style.color);
    const fillOpacity = element instanceof SVGElement ? Number.parseFloat(style.fillOpacity) : 1;
    return { element, required, cells, text: { ...color, a: color.a * fillOpacity * paintedOpacity(element) } };
  });
  // The open popups' layers (Base UI portals) the text is not in: whatever they paint over the text,
  // shadows included, is theirs. A second screenshot without them shows which pixels those are.
  // Only a layer that paints near the root (its shadow too) needs the second screenshot.
  const near = (element: Element) => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && box.right > start.left - 64 && box.left < start.right + 64 && box.bottom > start.top - 64 && box.top < start.bottom + 64;
  };
  const layers = [...document.querySelectorAll("[data-base-ui-portal]")].filter(
    (layer) => !layer.contains(root) && !layer.closest(hiddenFromAt) && [layer, ...layer.querySelectorAll("*")].some(near),
  );
  const kept = overlappingText(items.map(({ element }) => element));
  const hide = document.createElement("style");
  hide.textContent = hideGlyphs;
  for (const { element } of items) element.setAttribute("data-ouro-measure", "");
  for (const element of kept) element.setAttribute("data-ouro-measure-keep", "");
  document.head.append(hide);
  let context: CanvasRenderingContext2D;
  let bare: CanvasRenderingContext2D | null = null;
  try {
    context = await screenshot(root);
    if (layers.length > 0) {
      for (const layer of layers) layer.setAttribute("data-ouro-measure-layer", "");
      bare = await screenshot(root);
    }
  } catch (error) {
    // The browser takes a picture only of a box that stays still and shows.
    if (!root.isConnected || items.some(({ element }) => !element.isConnected)) {
      if (!last) throw new PageChanged();
      return items.map(() => ({ pass: false, reason: keptChanging }));
    }
    const reason = `axe could not judge its contrast, and it could not be screenshotted: ${(error as Error).message.split("\n")[0]}`;
    return items.map(() => ({ pass: false, reason }));
  } finally {
    for (const { element } of items) element.removeAttribute("data-ouro-measure");
    for (const element of kept) element.removeAttribute("data-ouro-measure-keep");
    for (const layer of layers) layer.removeAttribute("data-ouro-measure-layer");
    hide.remove();
  }
  // A screenshot taken by selector can find a new element in the place of one that left the page.
  if (!root.isConnected || items.some(({ element }) => !element.isConnected)) {
    if (!last) throw new PageChanged();
    return items.map(() => ({ pass: false, reason: keptChanging }));
  }
  const origin = root.getBoundingClientRect();
  const scale = context.canvas.width / origin.width;
  // The page's elements exposed to assistive technology, with their boxes as the page is scrolled now.
  let exposed: { other: Element; box: DOMRect }[] | undefined;
  const exposedBoxes = () =>
    (exposed ??= [...document.body.querySelectorAll("*")].filter((other) => !other.closest(hiddenFromAt)).map((other) => ({ other, box: other.getBoundingClientRect() })));
  return texts.map(({ element, required, cells, text }) => {
    if (cells.length === 0) return { pass: false, reason: "axe could not judge its contrast, and it has no text of its own to measure" };
    // Where an open popup covers the text, those pixels are the popup's, measured as its own text:
    // what a popup's layer paints, or any exposed layer over text the popup shuts off from assistive
    // technology. What still shows is measured. A layer hidden from assistive technology (an
    // overlay's outlines and tags) covers nothing, and neither does what holds the text. Only a
    // pixel inside an exposed element's box is hit-tested.
    const layered = element.closest(hiddenFromAt) === null ? [] : exposedBoxes().filter(({ other }) => !other.contains(element));
    const coveredAt = (x: number, y: number) => {
      if (!layered.some(({ box }) => x >= box.left && x < box.right && y >= box.top && y < box.bottom)) return false;
      const top = document.elementFromPoint(x, y);
      return top !== null && !element.contains(top) && !top.contains(element) && !top.closest(hiddenFromAt);
    };
    let worst = Number.POSITIVE_INFINITY;
    let measured = 0;
    let covered = 0;
    for (const { box, corners } of cells) {
      const left = Math.max(0, Math.floor(box.left * scale));
      const top = Math.max(0, Math.floor(box.top * scale));
      const right = Math.min(context.canvas.width, Math.ceil(box.right * scale));
      const bottom = Math.min(context.canvas.height, Math.ceil(box.bottom * scale));
      if (right <= left || bottom <= top) continue;
      const width = right - left;
      const pixels = context.getImageData(left, top, width, bottom - top).data;
      const under = bare?.getImageData(left, top, width, bottom - top).data;
      for (let index = 0; index < pixels.length; index += 4) {
        const pixel = index / 4;
        if (corners && !insideCell(corners, (left + (pixel % width) + 0.5) / scale, (top + Math.floor(pixel / width) + 0.5) / scale)) continue;
        const painted = under !== undefined && [0, 1, 2].some((channel) => Math.abs(pixels[index + channel]! - under[index + channel]!) > 2);
        if (painted || coveredAt(origin.left + (left + (pixel % width) + 0.5) / scale, origin.top + (top + Math.floor(pixel / width) + 0.5) / scale)) {
          covered++;
          continue;
        }
        measured++;
        const behind = { r: pixels[index]!, g: pixels[index + 1]!, b: pixels[index + 2]!, a: 1 };
        worst = Math.min(worst, contrast(over(text, behind), behind));
      }
    }
    if (measured === 0 && covered > 0) return { pass: true };
    if (worst === Number.POSITIVE_INFINITY) return { pass: false, reason: "axe could not judge its contrast, and its text is off the screen" };
    if (worst >= required) return { pass: true };
    return { pass: false, reason: `measured ${worst.toFixed(2)}:1 against the worst pixel behind its text, needs ${required}:1` };
  });
}
