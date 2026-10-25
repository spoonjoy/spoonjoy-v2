// The accessibility gate shared by the journeys' expectAccessible(), the HX census, the explore
// survey and the Storybook check. It fails closed:
//
//   - Every axe violation fails, whatever its impact.
//   - Every check axe could not decide (an "incomplete" result) fails, unless a stronger
//     measurement of the exact question axe left open settles it. Contrast: axe gives up on text
//     over a photo, a gradient, a pseudo-element or anything it cannot read a colour from, so the
//     gate measures the pixels the browser paints behind that text (support/rendered-contrast.ts)
//     and fails unless the worst pixel meets WCAG 1.4.3 (4.5:1, or 3:1 for large text). Three
//     other checks have a measurement of their own (support/undecided-checks.ts). A measurement
//     that cannot be taken is a failure, never a pass.
//   - Both themes. The app follows the system's colour scheme, so the gate checks the page in the
//     theme it is showing, switches the system scheme to the other one and checks again, then puts
//     it back. A page that does not follow the switch fails: its other theme went unchecked.
import type { Page } from "@playwright/test";
import type { AxeResults, CheckResult, NodeResult, Result } from "axe-core";
import { runAxe, type AxeTarget } from "./axe";
import { formatRatio } from "./contrast";
import { measureTextContrast, restoreScroll, saveScroll, type ContrastMeasurement } from "./rendered-contrast";
import { planVerification, verify, verifyHiddenFocus, type Verification } from "./undecided-checks";

export type { ContrastMeasurement } from "./rendered-contrast";

export type ColorScheme = "light" | "dark";
export const COLOR_SCHEMES: readonly ColorScheme[] = ["light", "dark"];

export interface AxeFinding {
  rule: string;
  impact: string | null;
  help: string;
  target: string;
  message: string;
}

export interface SchemeAudit {
  scheme: ColorScheme;
  violations: AxeFinding[];
  /** Checks axe could not decide and nothing stronger settled. */
  unresolved: AxeFinding[];
  /** Text axe could not judge for contrast, measured from the painted pixels. */
  contrast: ContrastMeasurement[];
  /** Other checks axe could not decide that a stronger measurement settled, and how. */
  verified: VerifiedFinding[];
}

export interface VerifiedFinding extends AxeFinding {
  /** What the stronger measurement found. */
  measured: string;
}

export interface AuditOptions {
  target?: AxeTarget;
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

export interface PendingVerification {
  finding: AxeFinding;
  verification: Verification;
}

/**
 * Turns axe's results into an audit, with what is still to be measured: the contrast axe could not
 * judge, and the other undecided checks a stronger measurement can settle.
 */
export function classifyAxeResults(scheme: ColorScheme, results: Pick<AxeResults, "violations" | "incomplete">): {
  audit: SchemeAudit;
  contrastToMeasure: Array<{ node: NodeResult; axeReason: string }>;
  toVerify: PendingVerification[];
} {
  const audit: SchemeAudit = { scheme, violations: results.violations.flatMap(findingsOf), unresolved: [], contrast: [], verified: [] };
  const contrastToMeasure: Array<{ node: NodeResult; axeReason: string }> = [];
  const toVerify: PendingVerification[] = [];
  for (const result of results.incomplete) {
    const findings = findingsOf(result);
    result.nodes.forEach((node, index) => {
      if (result.id === "color-contrast") {
        contrastToMeasure.push({ node, axeReason: checkMessages(node) });
        return;
      }
      const verification = planVerification(result.id, node);
      if (verification) toVerify.push({ finding: findings[index], verification });
      else audit.unresolved.push(findings[index]);
    });
  }
  return { audit, contrastToMeasure, toVerify };
}

/**
 * Waits until the page has stopped changing what it paints: web fonts loaded, the images in view
 * loaded and every finite animation or transition finished (a theme switch starts colour
 * transitions), including ones those start. Endless animations, such as a spinner, are left
 * running, and so are animations on elements the browser does not render. If the page has not
 * settled in time, the error names what it was still waiting for.
 */
export async function settle(page: Page): Promise<void> {
  const pending = await page.evaluate(async (timeout) => {
    const describe = (node: Element | null | undefined) => {
      if (!node) return "a detached element";
      const className = typeof node.className === "string" && node.className.trim() ? `.${node.className.trim().split(/\s+/).slice(0, 3).join(".")}` : "";
      return `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ""}${className}`;
    };
    const waiting = new Map<unknown, string>();
    const track = (key: unknown, label: string, promise: Promise<unknown>) => {
      waiting.set(key, label);
      return promise.catch(() => undefined).finally(() => waiting.delete(key));
    };
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const work = (async () => {
      await track("fonts", "web fonts", document.fonts.ready);
      const inView = Array.from(document.images).filter((image) => {
        const rect = image.getBoundingClientRect();
        return !image.complete && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
      });
      await Promise.all(
        inView.map((image) =>
          track(
            image,
            `image ${new URL(image.currentSrc || image.src, location.href).pathname}`,
            new Promise((resolve) => {
              image.addEventListener("load", resolve, { once: true });
              image.addEventListener("error", resolve, { once: true });
            }),
          ),
        ),
      );
      for (;;) {
        // Only what paints: an animation in a subtree the browser skips (a closed disclosure's
        // hidden="until-found" panel, which is content-visibility: hidden) never advances.
        const finite = document.getAnimations().filter((animation) => {
          const end = animation.effect?.getComputedTiming().endTime;
          const target = (animation.effect as KeyframeEffect | null)?.target;
          const painted = !target || target.checkVisibility();
          return animation.playState === "running" && typeof end === "number" && Number.isFinite(end) && painted;
        });
        if (finite.length === 0) break;
        await Promise.all(
          finite.map((animation) => {
            const target = (animation.effect as KeyframeEffect | null)?.target;
            const name =
              animation instanceof CSSTransition ? `transition of ${animation.transitionProperty}` : animation instanceof CSSAnimation ? `animation ${animation.animationName}` : "script animation";
            const timing = animation.effect?.getComputedTiming();
            const label = `${name} on ${describe(target)} (${Math.round(Number(timing?.localTime ?? 0))} of ${Math.round(Number(timing?.endTime ?? 0))} ms)`;
            return track(animation, label, animation.finished);
          }),
        );
        await frame();
      }
      await frame();
      return [] as string[];
    })();
    const deadline = new Promise<string[]>((resolve) => setTimeout(() => resolve(waiting.size > 0 ? [...waiting.values()] : ["nothing it could name"]), timeout));
    return Promise.race([work, deadline]);
  }, SETTLE_TIMEOUT_MS);
  if (pending.length > 0) {
    throw new Error(`The page had not settled after ${SETTLE_TIMEOUT_MS / 1000} s, so it could not be checked. Still waiting for: ${pending.slice(0, 10).join("; ")}`);
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

/** Audits the page in the theme it is showing now. */
export async function auditShownScheme(page: Page, options: AuditOptions = {}): Promise<SchemeAudit> {
  await settle(page);
  const scheme = await shownScheme(page);
  const results = await runAxe(page, options.target);
  const { audit, contrastToMeasure, toVerify } = classifyAxeResults(scheme, results);
  if (contrastToMeasure.length === 0 && toVerify.length === 0) return audit;
  const record = (finding: AxeFinding, outcome: { passed: boolean; detail: string }) => {
    if (outcome.passed) audit.verified.push({ ...finding, measured: outcome.detail });
    else audit.unresolved.push({ ...finding, message: `${finding.message} (measured: ${outcome.detail})` });
  };
  await saveScroll(page);
  try {
    // The other checks first, while the page is as axe saw it (a toast can leave in seconds). The
    // tab-order walk moves focus and puts it back; the page settles again before measuring, since
    // focus can open a tooltip.
    for (const { finding, verification } of toVerify.filter((each) => each.verification.kind !== "hidden-focus")) {
      record(finding, await verify(page, verification));
    }
    const focus = toVerify.filter((each) => each.verification.kind === "hidden-focus");
    if (focus.length > 0) {
      const outcomes = await verifyHiddenFocus(page, focus.map((each) => each.verification));
      focus.forEach(({ finding }, index) => record(finding, outcomes[index]));
      await settle(page);
    }
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
 * Holds the page's notifications while it is checked. A notification leaves by itself after a few
 * seconds, sooner than checking both themes takes, so it could leave halfway through and the check
 * would judge a page that is gone. F6 moves focus to the notifications, as a keyboard user would,
 * and Ouro UI's toasts stay while they have focus. They are checked as that user sees them. Returns
 * the element to give focus back to, or null when there was nothing to hold.
 */
async function holdNotifications(page: Page) {
  const showing = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-ouro="toaster"] [role="dialog"]')).some((toast) => toast.checkVisibility({ visibilityProperty: true })),
  );
  if (!showing) return null;
  const before = await page.evaluateHandle(() => document.activeElement);
  await page.keyboard.press("F6");
  try {
    await page.waitForFunction(() => document.activeElement?.matches('[data-ouro="toaster"]') === true, undefined, { timeout: 5_000 });
  } catch {
    throw new Error("F6 did not move focus to the notifications, so they could not be held while the page was checked.");
  }
  return before;
}

/**
 * Audits the page in both themes: the one it shows first, then the other, switched through the
 * system colour scheme, which is then put back. Notifications are held while it does.
 */
export async function auditAccessibility(page: Page, options: AuditOptions = {}): Promise<SchemeAudit[]> {
  const held = await holdNotifications(page);
  try {
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
  } finally {
    // Focus goes back where it was, which lets the notifications go on.
    if (held) {
      await held.evaluate((element) => {
        if (element instanceof HTMLElement && element !== document.body) element.focus({ preventScroll: true });
        else (document.activeElement as HTMLElement | null)?.blur();
      });
      await held.dispose();
    }
  }
}
