export { frameClass, isPartOf, itemFor, layerClass, linkClass, listClass, outlineClass, pillClass, tagClass };

// Class strings and names for Inspector, apart from the component so its file exports only
// components (React Fast Refresh). Class strings are literal so the app's Tailwind finds them.

/**
 * The root names (`data-ouro`) that are not their registry item's name, by the item they belong
 * to. Roots that only position or hold an overlay (`-portal`, `-positioner`, `-backdrop`,
 * `-viewport`) are no component of their own and get no outline.
 */
const aliases: Readonly<Record<string, string>> = {
  "avatar-group": "avatar",
  "combobox-popup": "combobox",
  "edit-sheet-discard": "edit-sheet",
  "form-message": "form",
  "menu-bar": "menu",
  "navigation-menu-popup": "navigation-menu",
  radio: "radio-group",
  "resizable-handle": "resizable",
  "resizable-panel": "resizable",
  "select-popup": "select",
  toast: "toaster",
};

/**
 * The registry item a component root belongs to, from its `data-ouro` name, or `null` for a root
 * that only positions an overlay.
 *
 * @internal
 */
function itemFor(name: string): string | null {
  if (/-(portal|positioner|backdrop|viewport)$/.test(name)) return null;
  return aliases[name] ?? name;
}

/**
 * Whether a root is a part of the component around it rather than a component of its own: its name
 * is a part's (`radio`, `resizable-panel`, `form-message`) and the nearest root around it belongs
 * to the same item (a Radio in its RadioGroup). A part with no such root around it, like a popup in
 * a portal, still counts.
 *
 * @internal
 */
function isPartOf(name: string, around: Element | null | undefined): boolean {
  return name in aliases && !!around && itemFor(around.getAttribute("data-ouro")!) === aliases[name];
}

/**
 * The layer over the page: it never takes a pointer (only the tags and the bar do), sits above
 * every overlay, fades in over `--ouro-duration-base` (at once with reduced motion), and hides
 * while its own list is open, so the list's sheet is never under an outline.
 *
 * @internal
 */
const layerClass =
  "pointer-events-none fixed inset-0 z-[calc(var(--ouro-layer)+1)] opacity-100 " +
  "motion-safe:[transition:opacity_var(--ouro-duration-base)_var(--ouro-ease-out)] starting:data-starting-style:opacity-0 " +
  "[body:has([data-ouro-inspector-list])_&]:invisible";

/** One outline: placed by `transform` from its component's box, and hidden, tag and all, while nothing of it shows. @internal */
const outlineClass = "absolute top-0 left-0 will-change-transform data-clipped:invisible";

/** An outline's frame in the primary color, cut (`clip-path`) to the part of its component that shows. @internal */
const frameClass =
  "absolute inset-0 box-border rounded-[3px] border border-solid border-[color-mix(in_oklab,var(--primary)_75%,transparent)] " +
  "bg-[color-mix(in_oklab,var(--primary)_6%,transparent)]";

/**
 * An outline's name tag, a link to its docs, above the start corner of the part that shows (inside
 * it at the top of the screen, or where its top is cut). It hides, and takes no pointer, while
 * something else (a menu, a select list) lies over it or its corner.
 *
 * @internal
 */
const tagClass =
  "pointer-events-auto absolute start-0 bottom-full z-1 inline-flex max-w-48 items-center truncate rounded-t-sm rounded-e-sm px-1.5 " +
  "font-mono text-[11px] leading-4 font-medium text-primary-foreground no-underline bg-primary " +
  "ltr:translate-x-(--ouro-inspector-left) rtl:translate-x-(--ouro-inspector-right) " +
  "data-covered:invisible data-inside:top-(--ouro-inspector-top) data-inside:bottom-auto data-inside:rounded-none data-inside:rounded-ee-sm " +
  "outline-ring outline-offset-1 focus-visible:outline-2 focus-visible:outline-solid pointer-fine:hover:underline";

/** The bar at the bottom of the screen: what X-ray shows, the list and the way out. It steps aside while a dialog is open. @internal */
const pillClass =
  "pointer-events-auto in-data-modal:invisible fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-1 " +
  "rounded-full bg-popover p-1 ps-4 text-sm leading-5 text-popover-foreground shadow-(--shadow-lg) ring-1 ring-border/60";

/** The list of components in the sheet. @internal */
const listClass = "m-0 grid list-none gap-1 p-0";

/** A Docs or Source link in the list. @internal */
const linkClass =
  "rounded-sm px-1 text-sm leading-5 font-medium text-foreground underline underline-offset-4 " +
  "outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid";
