// Stronger measurements for the few checks axe leaves undecided that the page itself can settle.
// Each one measures the exact thing axe asks a person to review, and passes only when that
// measurement does; anything else stays a failure. Contrast has its own measurement
// (support/rendered-contrast.ts).
//
//   - aria-toggle-field-name ("Check that the <label> does not need be part of the ARIA checkbox
//     field's name"): a checkbox inside a <label> that holds more than its name, such as a
//     checklist row with a description and a quantity. Settled when every piece of visible text in
//     the label reaches assistive technology through the control: inside the elements its
//     aria-labelledby names (its name) or its aria-describedby names (its description), and the
//     name is not empty.
//   - aria-hidden-focus ("Check that focusable elements are not tabbable in the current state"):
//     axe finds focusable elements inside an aria-hidden region while a modal is open and cannot
//     tell whether a keyboard can reach them. Settled by walking the page's tab order from the
//     focused element, forwards and backwards, round to where it started, the way Tab and Shift+Tab
//     move focus: each step focuses the next element in tab order and follows wherever focus goes
//     (a focus guard sends it on). Passes when focus never lands inside the hidden region while it
//     is still hidden from assistive technology. Focus is put back afterwards.
//   - form-field-multiple-labels ("Multiple label elements is not widely supported in assistive
//     technologies"): a field with more than one <label>, such as a file field whose drop zone is
//     a label around the input. Settled when the field's name comes from aria-labelledby, which
//     assistive technology uses instead of any <label>, and it names one of the field's own visible
//     labels, so which <label> a screen reader would pick never matters.
//   - aria-valid-attr-value with aria-haspopup ("Unable to determine if aria-controls referenced ID
//     exists"): a popup trigger whose aria-controls may name a popup that is not on the page.
//     Settled when every element it names is on the page, or when the trigger says the popup is
//     closed (aria-expanded="false"), the state in which axe accepts a missing aria-controls target
//     on any other control.
import type { Page } from "@playwright/test";
import type { CheckResult, NodeResult, Result } from "axe-core";

export type VerificationKind = "toggle-label-text" | "labelledby-name" | "hidden-focus" | "closed-popup-controls";

export interface Verification {
  kind: VerificationKind;
  /** The checked element. */
  selector: string;
  /** For hidden-focus: the focusable elements axe found inside the hidden region. */
  related: string[];
}

export interface VerificationOutcome {
  passed: boolean;
  /** What was measured, for the record either way. */
  detail: string;
}

function checksOf(node: NodeResult): CheckResult[] {
  return [...node.any, ...node.all, ...node.none];
}

function singleSelector(target: NodeResult["target"]): string | null {
  return target.length === 1 && typeof target[0] === "string" ? target[0] : null;
}

/** The stronger measurement that can settle this undecided result, or null when none can. */
export function planVerification(rule: Result["id"], node: NodeResult): Verification | null {
  const selector = singleSelector(node.target);
  if (selector === null) return null;
  const checks = checksOf(node);
  if (rule === "aria-toggle-field-name" && checks.some((check) => check.id === "no-implicit-explicit-label")) {
    return { kind: "toggle-label-text", selector, related: [] };
  }
  if (rule === "form-field-multiple-labels") return { kind: "labelledby-name", selector, related: [] };
  if (rule === "aria-valid-attr-value") {
    const data = checks.find((check) => check.id === "aria-valid-attr-value")?.data as { messageKey?: string } | null | undefined;
    if (data?.messageKey === "controlsWithinPopup") return { kind: "closed-popup-controls", selector, related: [] };
    return null;
  }
  if (rule === "aria-hidden-focus") {
    const related = checks.flatMap((check) => check.relatedNodes ?? []).map((each) => singleSelector(each.target));
    if (related.length === 0 || related.some((each) => each === null)) return null;
    return { kind: "hidden-focus", selector, related: [...new Set(related as string[])] };
  }
  return null;
}

async function verifyToggleLabelText(page: Page, selector: string): Promise<VerificationOutcome> {
  return page.locator(selector).evaluate((control) => {
    const ids = (attribute: string) => (control.getAttribute(attribute) ?? "").split(/\s+/).filter(Boolean);
    const named = ids("aria-labelledby").map((id) => document.getElementById(id));
    const described = ids("aria-describedby").map((id) => document.getElementById(id));
    if (named.length === 0 || named.some((each) => each === null)) {
      return { passed: false, detail: "its name does not come from aria-labelledby elements that are all on the page" };
    }
    const name = named.map((each) => (each as HTMLElement).textContent ?? "").join(" ").replace(/\s+/g, " ").trim();
    if (!name) return { passed: false, detail: "the elements its aria-labelledby names hold no text" };
    const labels = new Set<HTMLLabelElement>();
    const wrapping = control.closest("label");
    if (wrapping) labels.add(wrapping);
    if (control.id) for (const label of Array.from(document.querySelectorAll<HTMLLabelElement>(`label[for="${CSS.escape(control.id)}"]`))) labels.add(label);
    const reached = [...named, ...described].filter((each): each is HTMLElement => each !== null);
    const missing: string[] = [];
    for (const label of labels) {
      const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent?.trim();
        const parent = node.parentElement;
        if (!text || !parent || !parent.checkVisibility({ visibilityProperty: true })) continue;
        // The control's own text too: a name from aria-labelledby replaces it.
        if (reached.some((each) => each.contains(node))) continue;
        missing.push(text);
      }
    }
    if (missing.length > 0) return { passed: false, detail: `visible label text outside its name and description: ${missing.map((each) => `"${each}"`).join(", ")}` };
    return { passed: true, detail: `all visible label text is in its name ("${name}") or its description` };
  });
}

async function verifyLabelledbyName(page: Page, selector: string): Promise<VerificationOutcome> {
  return page.locator(selector).evaluate((field) => {
    const ids = (field.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean);
    if (ids.length === 0) return { passed: false, detail: "its name does not come from aria-labelledby, so a screen reader picks one of its labels" };
    const named = ids.map((id) => document.getElementById(id));
    if (named.some((each) => each === null)) return { passed: false, detail: `aria-labelledby names ${ids.join(" ")}, not all on the page` };
    const name = named.map((each) => (each as HTMLElement).textContent ?? "").join(" ").replace(/\s+/g, " ").trim();
    const labels = Array.from((field as HTMLInputElement).labels ?? []);
    const own = labels.find((label) => named.includes(label) && label.checkVisibility({ visibilityProperty: true }) && label.textContent?.trim());
    if (!name || !own) return { passed: false, detail: `aria-labelledby does not name one of its ${labels.length} visible labels` };
    return { passed: true, detail: `its name, "${name}", comes from aria-labelledby, which assistive technology uses instead of its ${labels.length} <label> elements, and is its visible label` };
  });
}

async function verifyClosedPopupControls(page: Page, selector: string): Promise<VerificationOutcome> {
  return page.locator(selector).evaluate((trigger) => {
    const expanded = trigger.getAttribute("aria-expanded");
    const controls = (trigger.getAttribute("aria-controls") ?? "").split(/\s+/).filter(Boolean);
    if (controls.length === 0) return { passed: false, detail: "aria-controls names nothing" };
    const missing = controls.filter((id) => !document.getElementById(id));
    if (missing.length === 0) return { passed: true, detail: `every element aria-controls names is on the page: ${controls.join(", ")}` };
    if (expanded === "false") return { passed: true, detail: `its popup is closed (aria-expanded="false"), so ${missing.join(", ")} is not on the page yet` };
    return { passed: false, detail: `aria-controls names ${missing.join(", ")}, not on the page, and aria-expanded is ${expanded === null ? "unset" : `"${expanded}"`}` };
  });
}

/**
 * Walks the page's tab order from the focused element, forwards and then backwards, round to where
 * it started, and records which of the hidden regions focus landed in. Each step focuses the next
 * element in tab order (positive tabindex first, then document order; the element focused before
 * is the event's relatedTarget, as with Tab) and follows wherever focus goes, so a focus guard
 * sends it on as it would. One walk settles every hidden region on the page; focus goes back where
 * it was. Run it after everything that only looks: moving focus can open a tooltip.
 */
export async function verifyHiddenFocus(page: Page, verifications: readonly Verification[]): Promise<VerificationOutcome[]> {
  const selectors = verifications.map((each) => ({ region: each.selector, related: each.related }));
  return page.evaluate(async (selectors) => {
    const FOCUSABLE = 'a[href], area[href], button, input:not([type="hidden"]), select, textarea, summary, iframe, audio[controls], video[controls], [contenteditable]:not([contenteditable="false"]), [tabindex]';
    const regions = selectors.map(({ region }) => document.querySelectorAll(region));
    // The focusable elements axe found inside each region.
    const related = selectors.map(({ related }) => related.flatMap((selector) => Array.from(document.querySelectorAll(selector))));
    const describe = (node: Element) => `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ""}${node.getAttribute("aria-label") ? `[aria-label="${node.getAttribute("aria-label")}"]` : ""}`;
    const tabOrder = () => {
      const candidates = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (node) => node.tabIndex >= 0 && !(node as HTMLButtonElement).disabled && !node.closest("[inert]") && node.checkVisibility({ visibilityProperty: true }),
      );
      const positive = candidates.filter((node) => node.tabIndex > 0).sort((a, b) => a.tabIndex - b.tabIndex);
      return [...positive, ...candidates.filter((node) => node.tabIndex === 0)];
    };
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const before = document.activeElement as HTMLElement | null;
    const landed = selectors.map(() => [] as string[]);
    let steps = 0;
    const walk = async (direction: 1 | -1) => {
      const seen = new Set<Element>();
      const start = document.activeElement;
      if (start && start !== document.body) seen.add(start);
      const limit = tabOrder().length * 2 + 4;
      for (let step = 0; step < limit; step += 1) {
        const order = tabOrder();
        if (order.length === 0) return true;
        const current = document.activeElement as HTMLElement | null;
        const at = current ? order.indexOf(current) : -1;
        // Focus on an element outside the tab order (a dialog's popup, tabindex -1) moves on to
        // the next element after it in the document, as Tab does; from <body>, to the first.
        const follows = (node: Element) =>
          !!current && current !== document.body && (current.compareDocumentPosition(node) & (direction === 1 ? Node.DOCUMENT_POSITION_FOLLOWING : Node.DOCUMENT_POSITION_PRECEDING)) !== 0;
        const fromOutside = direction === 1 ? order.find(follows) : [...order].reverse().find(follows);
        const next =
          at === -1 ? (fromOutside ?? order[direction === 1 ? 0 : order.length - 1]) : order[(at + direction + order.length) % order.length];
        next.focus({ preventScroll: true });
        await frame();
        steps += 1;
        const active = document.activeElement;
        if (!active || active === document.body) continue;
        reached.add(active);
        // Landing counts when focus is still hidden from assistive technology once it has moved:
        // a control that drops its aria-hidden when it takes focus (a collapsed toast's Dismiss
        // button) is announced like any other.
        const stillHidden = active.closest('[aria-hidden="true"]') !== null;
        regions.forEach((matches, index) => {
          const region = matches.length === 1 ? matches[0] : null;
          if (stillHidden && region && (region === active || region.contains(active)) && !landed[index].includes(describe(active))) landed[index].push(describe(active));
        });
        if (seen.has(active)) return true;
        seen.add(active);
      }
      return false;
    };
    const reached = new Set<Element>();
    let complete = false;
    try {
      const forwards = await walk(1);
      before?.focus({ preventScroll: true });
      complete = forwards && (await walk(-1));
    } finally {
      if (before && before !== document.body && typeof before.focus === "function") before.focus({ preventScroll: true });
      else (document.activeElement as HTMLElement | null)?.blur?.();
    }
    await frame();
    // The walk must leave the page as axe saw it: focus back where it was and each region still
    // hidden. Moving focus can close a popup, and then the walk measured another page.
    const restored = document.activeElement === (before ?? document.body) || (before === null && document.activeElement === document.body);
    return regions.map((matches, index) => {
      if (matches.length !== 1) return { passed: false, detail: `the hidden region matches ${matches.length} elements` };
      if (landed[index].length > 0) return { passed: false, detail: `the tab order lands inside the hidden region on ${landed[index].join(", ")}` };
      if (!complete) return { passed: false, detail: "the tab order never came back to a stop it had already seen, so not every stop was seen" };
      if (!restored) return { passed: false, detail: "focus did not go back where it was after the walk, so the page changed while it was measured" };
      if (!matches[0].isConnected || matches[0].closest('[aria-hidden="true"]') === null) {
        return { passed: false, detail: "the region was no longer hidden after the walk, so the page changed while it was measured" };
      }
      const skipped = related[index].filter((node) => !reached.has(node)).length;
      return {
        passed: true,
        detail: `the tab order went both ways (${steps} steps) until it came back to a stop it had seen, without landing inside it; of the ${related[index].length} focusable elements axe found there, ${skipped} were never reached`,
      };
    });
  }, selectors);
}

/** Runs one stronger measurement that only looks. Hidden-focus checks go to verifyHiddenFocus(). */
export async function verify(page: Page, verification: Verification): Promise<VerificationOutcome> {
  const count = await page.locator(verification.selector).count();
  if (count !== 1) return { passed: false, detail: `the selector matches ${count} elements` };
  if (verification.kind === "toggle-label-text") return verifyToggleLabelText(page, verification.selector);
  if (verification.kind === "labelledby-name") return verifyLabelledbyName(page, verification.selector);
  if (verification.kind === "closed-popup-controls") return verifyClosedPopupControls(page, verification.selector);
  return (await verifyHiddenFocus(page, [verification]))[0];
}
