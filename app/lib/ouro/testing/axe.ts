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
  /** axe's one-line help for the rule, or the kit's for a placeholder, which axe does not check. */
  help: string;
  /** The node's selector. */
  target: string;
  /** Why it fails: axe's own summary, or what the measurement found. */
  summary: string;
  /** True when a measurement failed it: one axe left undecided (`incomplete`), or a placeholder, which axe does not check. */
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
 * It also measures the placeholder of each field that shows one, which axe leaves out, as it
 * measures text, and fails one below WCAG 1.4.3 as `color-contrast`. Like axe's contrast rule, it
 * leaves out a disabled or inert field and one that does not show.
 *
 * Anything else axe could not decide fails with axe's own message. A node that leaves the page
 * while it is measured means the page changed under the scan, so it scans the page again, and on
 * the third scan such a node fails. It throws on an axe-core older than the kit's minimum
 * (axe-version.ts), naming the version it found.
 *
 * It leaves the page as it found it: focus where it was, with a focus ring only if it had one, the
 * selection, and every scroll position, in an open shadow root too. It throws, naming the change,
 * when its Tab walk changes what is open on the page (an `aria-expanded`, a <dialog>, <details> or
 * popover) and it does not change back within a second, as it cannot change it back itself.
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
 * @claim "Like axe's contrast rule, it" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > leaves out a placeholder axe leaves out: aria-disabled, inert under a modal dialog, off the page or clipped away)
 * @claim "It also measures the placeholder of" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > fails a faint placeholder, as Tailwind's base styles draw one at half the text color, and passes one that meets 4.5:1)
 * @claim "Anything else axe could not decide" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > fails what axe could not decide and the kit does not measure, with axe's own message)
 * @claim "It throws on an axe-core older than the kit's minimum" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > refuses an axe-core older than the kit's minimum, naming the version it needs and the version it found)
 * @claim "A node that leaves the page" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > scans the page again when a node it found leaves the page while it is measured, as a Searching… line does)
 * @claim "A node that leaves the page" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > fails a node that leaves the page each time it is measured, three scans running)
 * @claim "a field with two labels, only when" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > passes a field with two labels when aria-labelledby names it, and fails it when nothing settles which label names it)
 * @claim "It leaves the page as it found it: focus" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > leaves focus where its Tab walk found it: nothing focused stays so, and a focus ring shows after only if it showed before)
 * @claim "It leaves the page as it found it: focus" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > puts back a field's caret and selected text, which Tab into a field selects whole, and the page's selection)
 * @claim "It throws, naming the change, when its Tab walk" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > passes a page whose content arrives during its Tab walk, as that is no change the walk made)
 * @claim "and every scroll position" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > puts back every scroll position it moves to measure text, the page's and a scrolled box's)
 * @claim "in an open shadow root too" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > puts back the scroll position of a scrolled box inside a shadow root)
 * @claim "It throws, naming the change, when its Tab walk" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > fails, naming what changed, when its Tab walk closes a popup that focus leaving closes, which it cannot open again)
 */
async function audit(context: axe.ElementContext): Promise<GateFinding[]> {
  // The registry names axe-core without a version, so an app keeps the one it has; an older one
  // decides some checks differently (link-in-text-block among them), so it must not pass quietly.
  requireAxe(axe.version, "audit");
  return keepingScroll(async () => {
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
  });
}

// Every element in `root` and in the open shadow roots within it. A closed shadow root cannot be
// reached from the page.
function elementsWithin(root: Document | ShadowRoot): Element[] {
  return [...root.querySelectorAll("*")].flatMap((element) => (element.shadowRoot ? [element, ...elementsWithin(element.shadowRoot)] : [element]));
}

// Runs `work`, which scrolls the page to measure it, and puts every scroll position back after:
// the page's and each scrolled box's, in an open shadow root too.
async function keepingScroll<T>(work: () => Promise<T>): Promise<T> {
  const scrolled = elementsWithin(document).filter((element) => element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth);
  const positions = scrolled.map((element) => ({ element, top: element.scrollTop, left: element.scrollLeft }));
  try {
    return await work();
  } finally {
    for (const { element, top, left } of positions) {
      // "instant", or a page that scrolls smoothly would still be on its way back.
      if (element.isConnected && (element.scrollTop !== top || element.scrollLeft !== left)) element.scrollTo({ top, left, behavior: "instant" });
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
  const byRoot = new Map<Element, Measured[]>();
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
  // axe does not measure a placeholder, so the kit measures each one that shows.
  for (const field of placeholderFields(context)) {
    const root = screenRoot(field);
    byRoot.set(root, [...(byRoot.get(root) ?? []), { node: null, element: field, required: requiredRatio(field, undefined, "::placeholder"), placeholder: true }]);
  }
  const placeholderFindings: GateFinding[] = [];
  for (const [root, items] of byRoot) {
    const verdicts = await measureTexts(root, items, last);
    for (const [index, item] of items.entries()) {
      // Scrolled for the group, a sticky part of the page can sit over the text: measured alone,
      // centered on the screen, it shows as a reader scrolls to it.
      const verdict = verdicts[index]!.pass || root === item.element ? verdicts[index]! : (await measureTexts(item.element, [item], last))[0]!;
      if (item.node) measured.set(item.node, verdict);
      else if (!verdict.pass) placeholderFindings.push({ rule: "color-contrast", impact: "serious", help: placeholderHelp, target: selectorOf(item.element), summary: verdict.reason, undecided: true });
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
  return [...findings, ...placeholderFindings];
}

/** Text {@link measureTexts} measures: a node axe could not decide, or the placeholder of a field, which axe leaves out. */
interface Measured {
  node?: axe.NodeResult | null;
  element: Element;
  required: number;
  placeholder?: boolean;
}

const placeholderHelp = "Placeholder text must have sufficient color contrast with the field behind it";

// Where a field's placeholder is drawn: its lines, as wide as the text, in the field's content box
// (centered in an input, from the top in a textarea). Not the whole content box, whose edge can
// touch the field's border.
function placeholderBoxes(field: HTMLInputElement | HTMLTextAreaElement): DOMRect[] {
  const [content] = textBoxes(field);
  const style = getComputedStyle(field, "::placeholder");
  const size = Number.parseFloat(style.fontSize);
  const line = Number.parseFloat(style.lineHeight) || size * 1.2;
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const cased = style.textTransform === "uppercase" ? field.placeholder.toUpperCase() : style.textTransform === "lowercase" ? field.placeholder.toLowerCase() : field.placeholder;
  const spacing = Number.parseFloat(style.letterSpacing) || 0;
  // A textarea shows each line of its placeholder, wrapped to its width; an input shows one line.
  const widths = (field instanceof HTMLTextAreaElement ? cased.split("\n") : [cased.replace(/\n/g, "")]).map((text) => measure.measureText(text).width + spacing * text.length);
  const wide = Math.max(...widths);
  const lines = field instanceof HTMLTextAreaElement ? widths.reduce((sum, width) => sum + Math.max(1, Math.ceil(width / content!.width)), 0) : 1;
  const height = Math.min(content!.height, line * lines);
  const width = Math.min(content!.width, wide);
  const top = field instanceof HTMLTextAreaElement ? content!.top : content!.top + (content!.height - height) / 2;
  const align = style.textAlign;
  const end = align === "right" || align === "-webkit-right" || (align === "end" && style.direction !== "rtl") || (align === "start" && style.direction === "rtl");
  const left = align === "center" || align === "-webkit-center" ? content!.left + (content!.width - width) / 2 : end ? content!.right - width : content!.left;
  return [new DOMRect(left, top, width, height)];
}

// The text fields within `context` that show a placeholder, leaving out those axe's color-contrast
// rule leaves out: a disabled field (`disabled` or `aria-disabled`), whose text need not meet
// WCAG 1.4.3, an inert one (under `inert`, or outside an open modal <dialog>), and one that does
// not show (hidden, off the page, or clipped away).
function placeholderFields(context: axe.ElementContext): HTMLElement[] {
  const spec = context as { include?: unknown; exclude?: unknown };
  const object = typeof spec === "object" && spec !== null && !(spec instanceof Node) && !isList(spec) && ("include" in spec || "exclude" in spec);
  // axe scans the whole page for a missing or empty include.
  const empty = (part: unknown) => isList(part) && Array.from(part).length === 0;
  const whole = object ? spec.include === undefined || empty(spec.include) : empty(context);
  const include = whole ? [document.documentElement] : contextElements(object ? spec.include : context);
  const exclude = object && spec.exclude !== undefined ? contextElements(spec.exclude) : [];
  const modal = topModal();
  return elementsWithin(document).filter(
    (element): element is HTMLElement =>
      (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) &&
      element.matches(":placeholder-shown:enabled") &&
      element.placeholder.trim() !== "" &&
      !closestAcross(element, '[aria-disabled="true"], [inert]') &&
      (!modal || holds(modal, element)) &&
      shows(element) &&
      include.some((root) => holds(root, element)) &&
      !exclude.some((root) => holds(root, element)),
  );
}

/** Whether a value is a list of nodes or selectors: an array, a NodeList, an HTMLCollection. */
const isList = (value: unknown): value is ArrayLike<unknown> =>
  Array.isArray(value) || value instanceof NodeList || value instanceof HTMLCollection;

// The element or its nearest ancestor matching `selector`, across the shadow roots between them.
function closestAcross(element: Element, selector: string): Element | null {
  for (let node: Element | null = element; node; node = node.parentElement ?? (node.getRootNode() instanceof ShadowRoot ? (node.getRootNode() as ShadowRoot).host : null)) {
    if (node.matches(selector)) return node;
  }
  return null;
}

// The open modal <dialog> on top, which leaves the rest of the page inert, or null. The top layer
// keeps the order dialogs opened in, which the page cannot read, so the one at its own center is it.
function topModal(): Element | null {
  const modals = [...document.querySelectorAll("dialog:modal")];
  const onTop = modals.find((dialog) => {
    const box = dialog.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return hit !== null && dialog.contains(hit);
  });
  return onTop ?? modals.at(-1) ?? null;
}

// Whether an element shows: visible, with a size, on the page and not clipped away by a box around
// it that hides what overflows it. A box that scrolls does not count: the field is scrolled to before
// it is measured. Nor does a box that the element is positioned outside of.
function shows(element: Element): boolean {
  if (!element.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return false;
  const box = element.getBoundingClientRect();
  if (box.width <= 1 || box.height <= 1 || box.right + window.scrollX <= 0 || box.bottom + window.scrollY <= 0) return false;
  const { position } = getComputedStyle(element);
  if (position === "fixed") return true;
  // An absolutely positioned element escapes the boxes between it and the one it is positioned in.
  const container = position === "absolute" ? (element as HTMLElement).offsetParent : null;
  let escaped = container !== null;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (parent === container) escaped = false;
    if (escaped) continue;
    const style = getComputedStyle(parent);
    const clips = (value: string) => value === "hidden" || value === "clip";
    if (!clips(style.overflowX) && !clips(style.overflowY)) continue;
    const clip = parent.getBoundingClientRect();
    if (Math.min(box.right, clip.right) - Math.max(box.left, clip.left) <= 1 || Math.min(box.bottom, clip.bottom) - Math.max(box.top, clip.top) <= 1) return false;
  }
  return true;
}

// The elements an axe context names: nodes, selectors, and paths into open shadow roots. A
// selector into a frame names nothing here, as the kit measures only the page itself.
function contextElements(part: unknown): Element[] {
  if (part instanceof Document) return [part.documentElement];
  if (part instanceof ShadowRoot) return [...part.children];
  if (part instanceof Element) return [part];
  if (typeof part === "string") return [...document.querySelectorAll(part)];
  if (part instanceof NodeList || part instanceof HTMLCollection) return [...part].flatMap((node) => contextElements(node));
  if (typeof part === "object" && part !== null && "fromShadowDom" in part) return throughShadow((part as { fromShadowDom: string[] }).fromShadowDom);
  // A path through frames of one step stays on the page.
  if (typeof part === "object" && part !== null && "fromFrames" in part) {
    const steps = (part as { fromFrames: unknown[] }).fromFrames;
    return steps.length === 1 ? (Array.isArray(steps[0]) ? throughShadow(steps[0] as string[]) : contextElements(steps[0])) : [];
  }
  if (!Array.isArray(part)) return [];
  // In a list, an entry that is an array is a path through frames: one step stays on the page.
  return part.flatMap((entry) => (!Array.isArray(entry) ? contextElements(entry) : entry.length !== 1 ? [] : Array.isArray(entry[0]) ? throughShadow(entry[0]) : contextElements(entry[0])));
}

// The elements a path of selectors names, each step inside the open shadow roots of the last.
function throughShadow(path: string[]): Element[] {
  let found: Element[] = [document.documentElement];
  for (const [index, selector] of path.entries()) {
    found = found.flatMap((host) => {
      const scope = index === 0 ? document : host.shadowRoot;
      return scope ? [...scope.querySelectorAll(selector)] : [];
    });
  }
  return found;
}

// Whether `root` holds `element`, across the shadow roots between them.
function holds(root: Element, element: Element): boolean {
  for (let node: Node | null = element; node; node = node instanceof ShadowRoot ? node.host : node.parentNode) if (node === root) return true;
  return false;
}

// A selector for an element, for a finding: its id, or its place under the nearest ancestor with one.
// Inside a shadow root, the host's selector comes first, then the path within the root, as
// Playwright's CSS selectors reach into open shadow roots.
function selectorOf(element: Element): string {
  const root = element.getRootNode() as Document | ShadowRoot;
  const steps: string[] = [];
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.id && root.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1) {
      steps.unshift(`#${CSS.escape(node.id)}`);
      break;
    }
    const siblings = node.parentElement ? [...node.parentElement.children] : [...root.children];
    const kin = siblings.filter((sibling) => sibling.localName === node!.localName);
    steps.unshift(kin.length > 1 ? `${node.localName}:nth-of-type(${kin.indexOf(node) + 1})` : node.localName);
  }
  const path = steps.join(" > ");
  return root instanceof ShadowRoot ? `${selectorOf(root.host)} ${path}` : path;
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
// goes back where it was, with a focus ring only if it had one, and nothing focused if nothing was,
// and so does the selection or a field's caret. It throws when the walk changed what is open on
// the page, which it cannot change back.
async function tabReaches(targets: HTMLElement[]): Promise<HTMLElement[]> {
  const start = document.activeElement;
  const ring = start?.matches(":focus-visible") ?? false;
  const selection = selectionOf(start);
  const opened = openState();
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
  const active = document.activeElement;
  const back = start !== document.body && (start instanceof HTMLElement || start instanceof SVGElement) && start.isConnected ? start : null;
  // Focused by the last press, the element keeps the ring the key gave it unless it is focused afresh.
  if (active instanceof HTMLElement || active instanceof SVGElement) {
    if (active !== back || active.matches(":focus-visible") !== ring) active.blur();
  }
  // A typed variable, not a literal: TypeScript 5.9's DOM types, which apps still build with, lack focusVisible.
  const again: FocusOptions & { focusVisible?: boolean } = { preventScroll: true, focusVisible: ring };
  if (back && document.activeElement !== back) back.focus(again);
  selection();
  // What the walk's focus showed (a tooltip, a fanned stack) eases back before the page is compared,
  // and what closes or opens on a timer once focus moves gets a second to settle.
  await settleTransitions();
  let changed = changedState(opened, openState());
  for (const deadline = performance.now() + 1000; changed && performance.now() < deadline; changed = changedState(opened, openState())) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  if (changed) {
    throw new Error(
      `audit: its Tab walk changed what is open on the page and cannot change it back: ${changed}. ` +
        "The walk runs when a modal hides the page from assistive technology without making it inert, to learn whether Tab still reaches what it hides. " +
        "Audit the page before that opens, or make what the modal hides inert, so axe decides without the walk.",
    );
  }
  return [...reached];
}

// What is open on the page, as triggers and popups state it: each `aria-expanded`, and each
// <dialog>, <details> and popover.
function openState(): Map<Element, string> {
  const state = new Map<Element, string>();
  for (const element of document.querySelectorAll("[aria-expanded]")) state.set(element, element.getAttribute("aria-expanded") === "true" ? "expanded" : "collapsed");
  for (const element of document.querySelectorAll("dialog, details, [popover]")) state.set(element, element.matches("[open], :popover-open") ? "open" : "closed");
  return state;
}

// The first difference between two `openState`s, in words, or null when there is none. Only what
// was on the page both times counts: content that arrived or left on its own is no change the walk made.
function changedState(before: Map<Element, string>, after: Map<Element, string>): string | null {
  for (const [element, was] of before) {
    const now = after.get(element);
    if (now !== undefined && now !== was) return `${describe(element)} went from ${was} to ${now}`;
  }
  return null;
}

// Puts back, when called, the selection as it is now: a text field's caret or selected text when
// one has focus (Tab into a field selects all of it), else the page's selection.
function selectionOf(focused: Element | null): () => void {
  if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) {
    const { selectionStart, selectionEnd, selectionDirection } = focused;
    // A field that has no caret (a checkbox, a number field) reports null.
    if (selectionStart === null || selectionEnd === null) return () => undefined;
    return () => focused.setSelectionRange(selectionStart, selectionEnd, selectionDirection ?? undefined);
  }
  const page = document.getSelection();
  /* istanbul ignore if @preserve -- a document in a page always has a selection */
  if (!page) return () => undefined;
  const ranges = Array.from({ length: page.rangeCount }, (_, index) => page.getRangeAt(index).cloneRange());
  return () => {
    page.removeAllRanges();
    for (const range of ranges) page.addRange(range);
  };
}

// The contrast WCAG 1.4.3 asks of the element's text: axe's own figure when it gave one, else 3:1
// for large text (24px, or 18.66px bold) and 4.5:1 for the rest.
function requiredRatio(element: Element, expected: string | undefined, pseudo: string | null = null): number {
  const stated = expected ? Number.parseFloat(expected) : Number.NaN;
  if (Number.isFinite(stated)) return stated;
  const style = getComputedStyle(element, pseudo);
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

// Whether an element shows, with an area, and its box stays where it is over a frame. As Playwright
// does, a box hidden with `visibility` does not show.
async function showsAndHoldsStill(element: Element): Promise<boolean> {
  const before = element.getBoundingClientRect();
  if (!element.isConnected || !element.checkVisibility({ visibilityProperty: true }) || before.width === 0 || before.height === 0) return false;
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const after = element.getBoundingClientRect();
  return element.isConnected && after.x === before.x && after.y === before.y && after.width === before.width && after.height === before.height;
}

// The element's box as a canvas, two frames after a change to what it shows. Only the element is
// taken: the browser paints a whole long page's screenshot wrongly away from where it is scrolled.
async function screenshot(element: Element): Promise<CanvasRenderingContext2D> {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const image = new Image();
  // `caret: "initial"`: hiding the caret, Playwright leaves an empty style attribute on the focused
  // field. The measuring rules hide the caret themselves.
  const take = () => page.screenshot({ save: false, element, animations: "disabled", caret: "initial", timeout: 5000 });
  let data: string;
  try {
    data = await take();
  } catch (error) {
    // Vitest's Node process, which runs Playwright, can stall for seconds on other work while the
    // page holds still, and the stall counts against the limit. A box that shows and holds still
    // did not hold the screenshot up, so it gets one more try; a box with no area never shows.
    if (!/Timeout/.test((error as Error).message) || !(await showsAndHoldsStill(element))) throw error;
    data = await take();
  }
  image.src = `data:image/png;base64,${data}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(image, 0, 0);
  return context;
}

/**
 * What keeps the page still while a measuring rule goes on and comes off: no color it changes
 * eases there or back, as a link's underline does over its transition. A document's style sheet
 * does not reach into shadow roots, so an element there can still ease.
 *
 * @claim "no color it changes eases there or back" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > leaves no transition running when it is done, its own text's or a link's elsewhere on the page)
 */
const still = "body *, body *::before, body *::after { transition: none !important; } ";

/**
 * The rule that hides glyphs while the page behind them is screenshotted: the element's, and all
 * other text on the page too, as a tall heading's descenders reach into the line below, except
 * other text drawn over the element's, which is what it is seen against.
 *
 * @claim "and all other text on the page too" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > measures a heading's second line against the page, not the descenders of the line above)
 * @claim "except other text drawn over the" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > fails text that other text is drawn over, as a tag without a background over a line)
 */
const hideGlyphs =
  still +
  "body * { -webkit-text-fill-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; caret-color: transparent !important; } " +
  "[data-ouro-measure-keep] { -webkit-text-fill-color: currentcolor !important; } " +
  "svg text, svg tspan { fill: transparent !important; stroke: transparent !important; } " +
  "[data-ouro-measure], [data-ouro-measure] * { color: transparent !important; -webkit-text-fill-color: transparent !important; " +
  "fill: transparent !important; stroke: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; caret-color: transparent !important; transition: none !important; } " +
  "[data-ouro-measure-layer] { opacity: 0 !important; transition: none !important; } " +
  "::placeholder { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; }";

// Takes a measuring rule off the page without easing back what it changed: the page takes its own
// colors again while nothing eases, so nothing is left in motion for the next measurement to wait for.
function lift(rule: HTMLStyleElement): void {
  rule.textContent = still;
  document.documentElement.getBoundingClientRect();
  rule.remove();
}

/**
 * Measures text contrast that axe could not judge: waits for running transitions, hides the
 * element's glyphs, screenshots the page and finds the worst pixel behind each line of its
 * text. Anything drawn over the text (an outline, a tag, a veil) counts as behind it, since it
 * is what the text is seen against.
 * Passes when the text color, as painted over that pixel, meets `required` (4.5 or 3). Where an open
 * popup covers the text (its shadow too), the covered part is hidden while it is open, and only what
 * still shows is measured. It puts back every scroll position it moves, leaves nothing on the
 * focused field, and leaves no color easing outside shadow roots.
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
 * @claim "It puts back every scroll position it moves" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > puts back every scroll position it moves to measure text, the page's and a scrolled box's)
 * @claim "It puts back every scroll position it moves" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > puts back the scroll position of a scrolled box inside a shadow root)
 * @claim "leaves nothing on the focused field" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > leaves no trace on the focused field when it screenshots the page)
 * @claim "and leaves no color easing" registry/ouro/lib/ouro/testing/axe.test.ts verify:testExists(registry/ouro/lib/ouro/testing/axe.test.ts::audit > leaves no transition running when it is done, its own text's or a link's elsewhere on the page)
 */
async function measureTextContrast(element: Element, required: number): Promise<Verdict> {
  return keepingScroll(async () => (await measureTexts(element, [{ element, required }], true))[0]!);
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
    // A box with no size, such as a popup's container around its fixed popup, cannot be screenshotted.
    if (box.width > window.innerWidth || box.height > window.innerHeight || box.width === 0 || box.height === 0) break;
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
async function measureTexts(root: Element, items: Measured[], last: boolean): Promise<Verdict[]> {
  // Centered, so a sticky header does not sit over text that scrolled to the top edge.
  root.scrollIntoView({ block: "center", inline: "nearest" });
  await settleTransitions();
  const verdicts = new Map<Measured, Verdict>();
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
    lift(hide);
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
async function shoot(root: Element, items: Measured[], last: boolean): Promise<Verdict[]> {
  if (!root.isConnected || items.some(({ element }) => !element.isConnected)) {
    if (!last) throw new PageChanged();
    return items.map(() => ({ pass: false, reason: keptChanging }));
  }
  // The boxes within the root, not on the screen: taking the screenshot can scroll the page.
  const start = root.getBoundingClientRect();
  const texts = items.map(({ element, required, placeholder }) => {
    // Within the root: each line's box, or each letter's cell for SVG text.
    const boxes = placeholder ? placeholderBoxes(element as HTMLInputElement | HTMLTextAreaElement) : textBoxes(element);
    const cells = (letterCells(element) ?? boxes.map((box) => ({ box, corners: null }))).map(({ box, corners }) => ({
      box: new DOMRect(box.left - start.left, box.top - start.top, box.width, box.height),
      corners: corners?.map((corner) => ({ x: corner.x - start.left, y: corner.y - start.top })) ?? null,
    }));
    // SVG text, such as a chart's axis labels, is painted with its fill; a placeholder with its own
    // color and opacity.
    const style = getComputedStyle(element, placeholder ? "::placeholder" : null);
    const color = toRgba(element instanceof SVGElement ? style.fill : style.color);
    const ownOpacity = element instanceof SVGElement ? Number.parseFloat(style.fillOpacity) : placeholder ? Number.parseFloat(style.opacity) : 1;
    return { element, required, placeholder, cells, text: { ...color, a: color.a * ownOpacity * paintedOpacity(element) } };
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
    lift(hide);
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
  return texts.map(({ element, required, placeholder, cells, text }) => {
    if (cells.length === 0) return { pass: false, reason: placeholder ? "its placeholder has no box on the screen to measure" : "axe could not judge its contrast, and it has no text of its own to measure" };
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
    if (placeholder) return { pass: false, reason: `its placeholder measured ${worst.toFixed(2)}:1 against the worst pixel behind it, needs ${required}:1` };
    return { pass: false, reason: `measured ${worst.toFixed(2)}:1 against the worst pixel behind its text, needs ${required}:1` };
  });
}
