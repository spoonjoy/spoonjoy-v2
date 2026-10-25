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
//     tell whether a keyboard can reach them. Settled when focusing each of them leaves focus
//     outside the hidden region: it is inert and takes no focus, or it is a focus guard that sends
//     focus on. Focus is put back afterwards.
//   - aria-valid-attr-value with aria-haspopup ("Unable to determine if aria-controls referenced ID
//     exists"): a popup trigger whose aria-controls names a popup that is not on the page. Settled
//     when the trigger says the popup is closed (aria-expanded="false"), the state in which axe
//     accepts a missing aria-controls target on any other control. Open popups are checked by axe
//     directly: with aria-expanded="true", a missing target is a violation.
import type { Page } from "@playwright/test";
import type { CheckResult, NodeResult, Result } from "axe-core";

export type VerificationKind = "toggle-label-text" | "hidden-focus" | "closed-popup-controls";

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
        if (control.contains(node) || reached.some((each) => each.contains(node))) continue;
        missing.push(text);
      }
    }
    if (missing.length > 0) return { passed: false, detail: `visible label text outside its name and description: ${missing.map((each) => `"${each}"`).join(", ")}` };
    return { passed: true, detail: `all visible label text is in its name ("${name}") or its description` };
  });
}

async function verifyClosedPopupControls(page: Page, selector: string): Promise<VerificationOutcome> {
  return page.locator(selector).evaluate((trigger) => {
    const expanded = trigger.getAttribute("aria-expanded");
    const controls = (trigger.getAttribute("aria-controls") ?? "").split(/\s+/).filter(Boolean);
    const missing = controls.filter((id) => !document.getElementById(id));
    if (expanded !== "false") return { passed: false, detail: `aria-controls names ${missing.join(", ")}, not on the page, and aria-expanded is ${expanded === null ? "unset" : `"${expanded}"`}` };
    return { passed: true, detail: `its popup is closed (aria-expanded="false"), so ${missing.join(", ")} is not on the page yet` };
  });
}

// Focuses each focusable element axe found in the hidden region and records where focus ends up.
// Runs with the scroll saved by the caller; focus goes back where it was.
async function verifyHiddenFocus(page: Page, selector: string, related: string[]): Promise<VerificationOutcome> {
  return page.evaluate(
    async ({ selector, related }) => {
      const describe = (node: Element | null) => (node ? `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ""}` : "nothing");
      const region = document.querySelector(selector);
      if (!region) return { passed: false, detail: "the hidden region is no longer on the page" };
      const before = document.activeElement as HTMLElement | null;
      const reached: string[] = [];
      const outcomes: string[] = [];
      try {
        for (const target of related) {
          const node = document.querySelector<HTMLElement>(target);
          if (!node) return { passed: false, detail: `${target} is no longer on the page` };
          node.focus({ preventScroll: true });
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const active = document.activeElement;
          if (active && region.contains(active)) reached.push(`${target} (focus stayed on ${describe(active)})`);
          else outcomes.push(active === node ? `${target} kept focus` : `${target} sent focus to ${describe(active)}`);
        }
      } finally {
        if (before && typeof before.focus === "function") before.focus({ preventScroll: true });
        else (document.activeElement as HTMLElement | null)?.blur?.();
      }
      if (reached.length > 0) return { passed: false, detail: `keyboard focus can land inside the hidden region: ${reached.join(", ")}` };
      return { passed: true, detail: `focus never stays inside it: ${outcomes.join("; ")}` };
    },
    { selector, related },
  );
}

/** Runs one stronger measurement. Anything that stops it is a failure, never a pass. */
export async function verify(page: Page, verification: Verification): Promise<VerificationOutcome> {
  const count = await page.locator(verification.selector).count();
  if (count !== 1) return { passed: false, detail: `the selector matches ${count} elements` };
  if (verification.kind === "toggle-label-text") return verifyToggleLabelText(page, verification.selector);
  if (verification.kind === "closed-popup-controls") return verifyClosedPopupControls(page, verification.selector);
  return verifyHiddenFocus(page, verification.selector, verification.related);
}
