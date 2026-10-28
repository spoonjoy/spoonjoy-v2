import type { ElementHandle, Page } from "@playwright/test";
import { openPopupSelector, otherPopups, popupTriggerSelector, type OtherPopup } from "../../app/lib/ouro/testing/popups";
import { auditShownScheme, settle, type AuditOptions, type SchemeAudit } from "../journeys/support/accessibility";

// What opens a popup and what a popup is come from Ouro UI's test kit (app/lib/ouro/testing/popups.ts),
// the lists its own story check uses, so the two checks open the same popups.

export interface PopupAudit {
  /** The trigger's accessible name. */
  trigger: string;
  /** What opened: "popup" for a trigger that names its popup in aria-haspopup, else the kind of popup ("tooltip", "hover card"). */
  kind: string;
  audit: SchemeAudit;
}

export interface PopupOptions extends AuditOptions {
  /**
   * The names of plain buttons that open a popup without saying so (no aria-haspopup), as a story
   * lists them in `parameters.plainOpeners` for Ouro UI's story check.
   */
  plainOpeners?: string[];
}

const WAIT = { timeout: 10_000 };

/** How a failure names an audited popup: the trigger's name, and the kind when it is not a plain popup. */
export const describePopup = ({ trigger, kind }: Pick<PopupAudit, "trigger" | "kind">) => (kind === "popup" ? `"${trigger}"` : `the ${kind} of "${trigger}"`);

interface Opener {
  handle: ElementHandle<Element>;
  kind: string;
  /** The open popup it shows. */
  popup: string;
  opensOn: OtherPopup["opensOn"] | "trigger";
}

/**
 * Opens each popup in `scope` in turn, as Ouro UI's story check does, and audits the page with it
 * open: each visible, enabled Base UI trigger is clicked (focused and given Enter when it is clipped
 * for screen readers), then each plain opener is clicked, then each tooltip trigger is hovered, each
 * navigation panel trigger pressed and each hover card trigger focused from the keyboard. The popup
 * must open, and Escape must close it again. A popup's content exists only while it is open, so the
 * audit of a story at rest never sees it.
 */
export async function auditEachPopupOpen(
  page: Page,
  scope: string,
  { plainOpeners = [], ...options }: PopupOptions = {},
  // Filled as each popup is audited, so the caller keeps them if a later one throws.
  audits: PopupAudit[] = [],
): Promise<PopupAudit[]> {
  // Taken once, before any popup opens: a popup renders at the end of the page, so it adds triggers
  // of its own that this loop leaves to Ouro UI's checks, as Ouro's story check does.
  // Every match is an element; Playwright types a list of handles as nodes.
  const handles = async (selector: string) => (await page.locator(`${scope} ${selector}`).elementHandles()) as ElementHandle<Element>[];
  const openers: Opener[] = (await handles(popupTriggerSelector)).map((handle) => ({ handle, kind: "popup", popup: openPopupSelector, opensOn: "trigger" }));
  for (const name of plainOpeners) {
    const button = await page.locator(scope).getByRole("button", { name, exact: true }).first().elementHandle({ timeout: 1_000 }).catch(() => null);
    if (!button) throw new Error(`No button named "${name}" (parameters.plainOpeners).`);
    if (!(await button.evaluate((element, trigger) => element.matches(trigger), popupTriggerSelector))) openers.push({ handle: button, kind: "popup", popup: openPopupSelector, opensOn: "trigger" });
  }
  for (const { kind, trigger, popup, opensOn } of otherPopups) {
    for (const handle of await handles(trigger)) openers.push({ handle, kind, popup, opensOn });
  }
  for (const { handle, kind, popup: popupSelector, opensOn } of openers) {
    const state = await handle.evaluate((element) => {
      const tiny = (node: Element) => {
        const box = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return box.width <= 1 && box.height <= 1 && (style.clip !== "auto" || style.clipPath !== "none");
      };
      const disabled = element.matches(':disabled, [aria-disabled="true"], [data-disabled]');
      const clipped = tiny(element) || (element.parentElement !== null && tiny(element.parentElement));
      const shown = element.checkVisibility({ visibilityProperty: true });
      // Enough of the accessible name to tell the triggers apart: a combobox's input is named by its label.
      const text = (node: Element | null) => node?.textContent?.replace(/\s+/g, " ").trim() ?? "";
      const labelledBy = (element.getAttribute("aria-labelledby") ?? "").split(/\s+/).map((id) => text(document.getElementById(id))).join(" ").trim();
      const labels = element instanceof HTMLInputElement ? [...(element.labels ?? [])].map(text).join(" ") : "";
      const name = element.getAttribute("aria-label")?.trim() || labelledBy || labels || text(element) || element.getAttribute("title") || element.tagName.toLowerCase();
      return { usable: element.isConnected && shown && !disabled, clipped, name };
    });
    if (!state.usable) continue;
    const label = describePopup({ trigger: state.name, kind });
    // The last popup's trigger keeps the pointer and gets focus back as it closes, which can show its
    // tooltip: move both away, and let what they showed close.
    await page.mouse.move(0, 0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    try {
      await page.waitForFunction((selector) => document.querySelector(selector) === null, `${openPopupSelector}, ${popupSelector}`, WAIT);
    } catch {
      throw new Error(`A popup was already open before opening ${label}.`);
    }
    if (opensOn === "hover") {
      await handle.hover();
    } else if (opensOn === "keyboard focus") {
      // A hover card opens on focus only from the keyboard.
      await page.keyboard.press("Shift");
      await handle.focus();
    } else if (opensOn === "trigger" && state.clipped) {
      await handle.focus();
      await page.keyboard.press("Enter");
    } else {
      await handle.click();
    }
    // Attached, not visible: a popup can open with nothing in it to give it a size.
    const popup = page.locator(popupSelector).first();
    try {
      await popup.waitFor({ ...WAIT, state: "attached" });
    } catch {
      throw new Error(`Opening ${label} opened no popup.`);
    }
    const opened = await popup.elementHandle();
    try {
      // Base UI drops a popup's starting style in a later render; until then its fade-in has not
      // begun, so nothing would be running for the audit's settle to wait for.
      await page.waitForFunction(() => document.querySelector("[data-open][data-starting-style]") === null, undefined, WAIT);
      audits.push({ trigger: state.name, kind, audit: await auditShownScheme(page, options) });
      // A tooltip stays while the pointer is over its trigger, and a hover card while its trigger has focus.
      if (opensOn === "hover") await page.mouse.move(0, 0);
      if (opensOn === "keyboard focus") await handle.evaluate((element) => (element as HTMLElement).blur());
      if (await page.locator(popupSelector).count()) await page.keyboard.press("Escape");
      // Gone, or hidden when it stays mounted, so its closing animation cannot cover the next popup's page.
      try {
        await page.waitForFunction(
          ([selector, element]) => document.querySelector(selector) === null && (!element?.isConnected || !element.checkVisibility()),
          [popupSelector, opened] as const,
          WAIT,
        );
      } catch {
        throw new Error(`Escape did not close the popup ${label} opened.`);
      }
    } finally {
      await opened?.dispose();
    }
    await settle(page);
  }
  return audits;
}
