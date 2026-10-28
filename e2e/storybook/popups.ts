import type { Page } from "@playwright/test";
import { auditShownScheme, type AuditOptions, type SchemeAudit } from "../journeys/support/accessibility";

// A popup open on the page, as Ouro UI's story check finds one (its test/stories.tsx, openPopup):
// a dialog, a menu, a list's popup (Select, Combobox) or a navigation panel.
const OPEN_POPUP =
  '[role="dialog"][data-open], [role="alertdialog"][data-open], [role="menu"][data-open], [data-ouro="select-popup"][data-open], [data-open]:has([role="listbox"]), [data-ouro="navigation-menu-popup"][data-open]';

// What opens one: a Base UI trigger, which names its popup in aria-haspopup, unless it is open already.
const TRIGGER = '[aria-haspopup]:not([aria-haspopup="false"]):not([aria-expanded="true"])';

/** What a trigger is, read in the page: whether it can be used, how, and its name. */
interface TriggerState {
  usable: boolean;
  /** Clipped to a pixel for screen readers, so no click can land on it: opened from the keyboard. */
  clipped: boolean;
  name: string;
}

export interface PopupAudit {
  /** The trigger's accessible name. */
  trigger: string;
  audit: SchemeAudit;
}

const WAIT = { timeout: 10_000 };

/**
 * Opens each popup in `scope` in turn, as Ouro UI's story check does, and audits the page with it
 * open: each visible, enabled Base UI trigger is clicked (focused and given Enter when it is clipped
 * for screen readers), the popup must open, and Escape must close it again. A popup's content
 * exists only while it is open, so the audit of a story at rest never sees it.
 */
export async function auditEachPopupOpen(page: Page, scope: string, options: AuditOptions = {}): Promise<PopupAudit[]> {
  const triggers = page.locator(`${scope} ${TRIGGER}`);
  const audits: PopupAudit[] = [];
  const count = await triggers.count();
  for (let index = 0; index < count; index++) {
    const trigger = triggers.nth(index);
    const state: TriggerState = await trigger.evaluate((element) => {
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
      return { usable: shown && !disabled, clipped, name };
    });
    if (!state.usable) continue;
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
    await settle(page);
  }
  return audits;
}

/** Waits until no finite animation or transition runs, as Ouro UI's story check does (`settle`). */
async function settle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect?.getComputedTiming().iterations === Infinity),
    undefined,
    WAIT,
  );
}
