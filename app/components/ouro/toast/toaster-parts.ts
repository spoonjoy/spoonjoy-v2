"use client";

const tabbable = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const reachable = (element: HTMLElement) => element.getClientRects().length > 0 && element.closest('[inert], [aria-hidden="true"]') === null;
const OPEN_DIALOG = '[role="dialog"][data-open]:not([data-ouro="toast"])';

/**
 * A modal dialog traps Tab, so toasts outside it need their own way in. While a
 * dialog holds focus, Tab past its last control goes to the toasts, and Tab past the last toast control
 * returns to the dialog's first (Shift+Tab goes the other way), so a toast's action stays within reach.
 * Loading this module starts the hand-over, which looks up the toasts' viewport when Tab is pressed.
 */
const tabbables = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>(tabbable)].filter(reachable);
// A modal traps Tab and, where it can, hides the rest of the page; a popover left non-modal does neither.
const hidesPage = (dialog: HTMLElement, viewport: HTMLElement) =>
  dialog.hasAttribute("data-ouro-modal") ||
  [...document.body.children].some((child) => child.getAttribute("aria-hidden") === "true" && !child.contains(dialog) && !child.contains(viewport));

document.addEventListener(
  "keydown",
  (event) => {
    const viewport = document.querySelector<HTMLElement>('[data-ouro="toaster"]');
    if (!viewport || event.key !== "Tab" || event.defaultPrevented) return;
    const active = document.activeElement as HTMLElement | null;
    // Stryker disable next-line ConditionalExpression: contains(null) is false, so forcing the null check true changes nothing.
    const inToasts = active !== null && viewport.contains(active);
    const dialog = inToasts ? [...document.querySelectorAll<HTMLElement>(OPEN_DIALOG)].pop() : active?.closest<HTMLElement>(OPEN_DIALOG);
    if (!dialog || viewport.contains(dialog) || !hidesPage(dialog, viewport)) return;
    const inside = tabbables(dialog);
    const toasts = tabbables(viewport);
    if (inside.length === 0 || toasts.length === 0) return;
    const own = inToasts ? toasts : inside;
    const other = inToasts ? inside : toasts;
    if (active !== (event.shiftKey ? own[0] : own[own.length - 1])) return;
    event.preventDefault();
    // Going forward into the toasts lands on the newest toast's action, and on the toast itself only when it has none.
    const first = !inToasts && !event.shiftKey ? other[0]!.querySelector<HTMLElement>('[data-ouro-part=action]') : null;
    (first ?? (event.shiftKey ? other[other.length - 1] : other[0]))!.focus();
  },
  true,
);

export {};
