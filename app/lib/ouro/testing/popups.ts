export { openPopupSelector, otherPopups, popupTriggerSelector };
export type { OtherPopup };

// The export list comes first because the shadcn CLI drops comments before a file's
// first statement, which would take the JSDoc below with it.

// This file imports nothing, so an app's Playwright specs can import it as well as its Vitest tests.

/**
 * A popup open on the page, as Ouro UI's story check finds one: a dialog, a menu, a list's popup
 * (Select, Combobox) or a NavigationMenu panel.
 *
 * @example
 * await page.locator(openPopupSelector).first().waitFor({ state: "attached" });
 */
const openPopupSelector =
  '[role="dialog"][data-open], [role="alertdialog"][data-open], [role="menu"][data-open], [data-ouro="select-popup"][data-open], [data-open]:has([role="listbox"]), [data-ouro="navigation-menu-popup"][data-open]';

/**
 * What opens a popup, as Ouro UI's story check finds one: a Base UI trigger, which names its popup
 * in `aria-haspopup`, unless it is open already. The check also leaves out a disabled or hidden
 * trigger, which opens nothing.
 *
 * @example
 * const triggers = await page.locator(`main ${popupTriggerSelector}`).elementHandles();
 */
const popupTriggerSelector = '[aria-haspopup]:not([aria-haspopup="false"]):not([aria-expanded="true"])';

/** A popup its trigger does not name in `aria-haspopup`: what opens it, how, and the popup once open. */
interface OtherPopup {
  /** What it is, for a failure: "tooltip", "navigation panel" or "hover card". */
  kind: string;
  /** Its triggers. */
  trigger: string;
  /** How a trigger opens it: hovered, pressed, or focused from the keyboard. */
  opensOn: "hover" | "press" | "keyboard focus";
  /**
   * The popup, while it is open. To close it, move the pointer off a tooltip's trigger and focus off a
   * hover card's, then press Escape, and wait for it to close before opening the next.
   */
  popup: string;
}

/**
 * The popups Ouro UI's story check opens besides those of {@link popupTriggerSelector}: each
 * Tooltip (its trigger hovered), each NavigationMenu panel (its trigger pressed) and each HoverCard
 * (its trigger focused after a key press, as a hover card opens on focus only from the keyboard).
 *
 * @claim "The popups Ouro UI's story check opens" test/stories.test.tsx verify:testExists(test/stories.test.tsx::opens the popups of $id that no aria-haspopup names, and scans the page with one open)
 * @example
 * for (const { trigger, opensOn, popup } of otherPopups) {
 *   // open each trigger as opensOn says, wait for popup, check the page, then close it as `popup` says
 * }
 */
const otherPopups: readonly OtherPopup[] = [
  { kind: "tooltip", trigger: "[data-base-ui-tooltip-trigger]", opensOn: "hover", popup: '[data-ouro="tooltip"][data-open]' },
  { kind: "navigation panel", trigger: '[data-ouro-control="navigation-menu"][data-ouro-part="trigger"]', opensOn: "press", popup: '[data-ouro="navigation-menu-popup"][data-open]' },
  { kind: "hover card", trigger: "[data-ouro-hover-card-trigger]", opensOn: "keyboard focus", popup: '[data-ouro="hover-card"][data-open]' },
];
