import type { ElementHandle, Page } from "@playwright/test";
import { auditShownScheme, settle, type AuditOptions, type SchemeAudit } from "../journeys/support/accessibility";

// A popup open on the page, as Ouro UI's story check finds one (its test/stories.tsx, openPopup):
// a dialog, a menu, a list's popup (Select, Combobox) or a navigation panel.
const OPEN_POPUP =
  '[role="dialog"][data-open], [role="alertdialog"][data-open], [role="menu"][data-open], [data-ouro="select-popup"][data-open], [data-open]:has([role="listbox"]), [data-ouro="navigation-menu-popup"][data-open]';

// What opens one: a Base UI trigger, which names its popup in aria-haspopup, unless it is open already.
const TRIGGER = '[aria-haspopup]:not([aria-haspopup="false"]):not([aria-expanded="true"])';

export interface PopupAudit {
  /** The trigger's accessible name. */
  trigger: string;
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

/**
 * Opens each popup in `scope` in turn, as Ouro UI's story check does, and audits the page with it
 * open: each visible, enabled Base UI trigger is clicked (focused and given Enter when it is clipped
 * for screen readers), then each plain opener is clicked. The popup must open, and Escape must close
 * it again. A popup's content exists only while it is open, so the audit of a story at rest never
 * sees it. Tooltips and hover cards are not opened.
 */
export async function auditEachPopupOpen(page: Page, scope: string, { plainOpeners = [], ...options }: PopupOptions = {}): Promise<PopupAudit[]> {
  // Taken once, before any popup opens: a popup renders at the end of the page, so it adds triggers
  // of its own that this loop leaves to Ouro UI's checks, as Ouro's story check does.
  const triggers = await page.locator(`${scope} ${TRIGGER}`).elementHandles();
  const plain: ElementHandle[] = [];
  for (const name of plainOpeners) {
    const button = await page.locator(scope).getByRole("button", { name, exact: true }).first().elementHandle({ timeout: 1_000 }).catch(() => null);
    if (!button) throw new Error(`No button named "${name}" (parameters.plainOpeners).`);
    if (!(await button.evaluate((element, trigger) => element.matches(trigger), TRIGGER))) plain.push(button);
  }
  const audits: PopupAudit[] = [];
  for (const trigger of [...triggers, ...plain]) {
    const state = await trigger.evaluate((element) => {
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
    if (await page.locator(OPEN_POPUP).count()) throw new Error(`A popup was already open before opening "${state.name}".`);
    if (state.clipped) {
      await trigger.focus();
      await page.keyboard.press("Enter");
    } else {
      await trigger.click();
    }
    // Attached, not visible: a popup can open with nothing in it to give it a size.
    const popup = page.locator(OPEN_POPUP).first();
    try {
      await popup.waitFor({ ...WAIT, state: "attached" });
    } catch {
      throw new Error(`Opening "${state.name}" opened no popup.`);
    }
    const opened = await popup.elementHandle();
    try {
      // Base UI drops a popup's starting style in a later render; until then its fade-in has not
      // begun, so nothing would be running for the audit's settle to wait for.
      await page.waitForFunction(() => document.querySelector("[data-open][data-starting-style]") === null, undefined, WAIT);
      audits.push({ trigger: state.name, audit: await auditShownScheme(page, options) });
      if (await page.locator(OPEN_POPUP).count()) await page.keyboard.press("Escape");
      // Gone, or hidden when it stays mounted, so its closing animation cannot cover the next popup's page.
      try {
        await page.waitForFunction(
          ([selector, element]) => document.querySelector(selector) === null && (!element?.isConnected || !element.checkVisibility()),
          [OPEN_POPUP, opened] as const,
          WAIT,
        );
      } catch {
        throw new Error(`Escape did not close the popup "${state.name}" opened.`);
      }
    } finally {
      await opened?.dispose();
    }
    await settle(page);
  }
  return audits;
}
