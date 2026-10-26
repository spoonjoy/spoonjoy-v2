export { frameClass, isPartOf, itemFor, layerClass, linkClass, listClass, outlineClass, pillClass, tagClass };

// Class strings and names for Inspector, apart from the component so its file exports only
// components (React Fast Refresh). Class strings are literal so the app's Tailwind finds them.

/**
 * The root names (`data-ouro`) that are not their registry item's name, by the item they belong
 * to. Roots that only position or hold an overlay (`-portal`, `-positioner`, `-backdrop`,
 * `-viewport`) are no component of their own and get no outline.
 * @claim "Roots that only position or hold" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector > does not outline itself, an overlay's wrappers, a hidden component or a part apart from its component)
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
 * to the same item (a Radio in its RadioGroup). A part outside its component's root, like a popup in
 * a portal, counts as a component.
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
 * @claim "The layer over the page: it" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector > lets a click through an outline reach the control underneath, and only the tags take a pointer)
 * @claim "The layer over the page: it" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector > fades in when it opens, and appears at once with reduced motion)
 * @claim "The layer over the page: it" registry/ouro/components/ouro/inspector/inspector-styles.ts verify:fileLine(registry/ouro/components/ouro/inspector/inspector-styles.ts, /"pointer-events-none\sfixed\sinset-0\sz-\[calc\(var\(--ouro-layer\)\+1\)\]/)
 */
const layerClass =
  "pointer-events-none fixed inset-0 z-[calc(var(--ouro-layer)+1)] opacity-100 " +
  "motion-safe:[transition:opacity_var(--ouro-duration-base)_var(--ouro-ease-out)] starting:data-starting-style:opacity-0 " +
  "[body:has([data-ouro-inspector-list])_&]:invisible";

/**
 * One outline: placed by `transform` from its component's box, and hidden, tag and all, while nothing of it shows. @internal
 *
 * @claim "One outline: placed by `transform` from" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector > hides the outline and tag of a component scrolled out of view inside a box, and clips one partly out)
 * @claim "One outline: placed by `transform` from" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector > does not outline itself, an overlay's wrappers, a hidden component or a part apart from its component)
 */
const outlineClass = "absolute top-0 left-0 will-change-transform data-clipped:invisible";

/**
 * An outline's frame: its edges, drawn in the primary color, with no fill and a gap wherever a line
 * of text crosses them, cut (`clip-path`) to the part of its component that shows.
 *
 * @internal
 * @claim "An outline's frame: its edges, drawn" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector > leaves every line of the page's text as readable as it was, in light and dark: outlines step around text, and tags sit clear of text and of each other)
 * @claim "An outline's frame: its edges, drawn" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector > hides the outline and tag of a component scrolled out of view inside a box, and clips one partly out)
 */
const frameClass = "absolute inset-0 fill-none stroke-[color-mix(in_oklab,var(--primary)_75%,transparent)] [shape-rendering:crispEdges]";

/**
 * An outline's name tag, a link to its docs, by the part of its component that shows, where it
 * covers no text and no other tag (above its start corner when that is clear). It hides, and
 * takes no pointer, where nowhere is clear, and while something else (a menu, a select list) lies
 * over it or its corner.
 *
 * @internal
 * @claim "It hides, and takes no pointer" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector > hides the tag of a component an open select list covers, and leaves its options within reach)
 * @claim "It hides, and takes no pointer" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector > hides a tag an overlay lies over though its component shows)
 * @claim "where it covers no text and" registry/ouro/components/ouro/inspector/inspector.test.tsx verify:testExists(registry/ouro/components/ouro/inspector/inspector.test.tsx::Inspector > leaves every line of the page's text as readable as it was, in light and dark: outlines step around text, and tags sit clear of text and of each other)
 */
const tagClass =
  "pointer-events-auto absolute top-0 left-0 z-1 inline-flex max-w-48 items-center truncate rounded-sm px-1.5 " +
  "font-mono text-[11px] leading-4 font-medium text-primary-foreground no-underline bg-primary " +
  "data-covered:invisible data-crowded:invisible " +
  "outline-ring outline-offset-1 focus-visible:outline-2 focus-visible:outline-solid pointer-fine:hover:underline";

/** The bar at the bottom of the screen, a landmark named by X-ray's label: what X-ray shows, the list and the way out. It steps aside while a dialog is open. @internal */
const pillClass =
  "pointer-events-auto in-data-modal:invisible fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-1 " +
  "rounded-full bg-popover p-1 ps-4 text-sm leading-5 text-popover-foreground shadow-(--shadow-lg) ring-1 ring-border/60";

/** The list of components in the sheet. @internal */
const listClass = "m-0 grid list-none gap-1 p-0";

/** A Docs or Source link in the list. @internal */
const linkClass =
  "rounded-sm px-1 text-sm leading-5 font-medium text-foreground underline underline-offset-4 " +
  "outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid";
