export {
  iconClass,
  itemClass,
  listClass,
  ownLook,
  panelClass,
  rootClass,
  showMoreHint,
  showMoreRootClass,
  textClass,
  triggerClass,
};

// Class strings and dev-message helpers for Collapsible and ShowMore, apart from the
// components so their files export only components (React Fast Refresh). Class strings are
// literal so the app's Tailwind finds them when it compiles.

/**
 * The `Fix:` for an appearance class: the component draws its own look.
 *
 * @internal
 */
function ownLook(component: string): (token: string) => string {
  return (token) => `remove "${token}"; ${component} sets its own look`;
}

/**
 * The `Fix:` for an appearance class on ShowMore: text styles belong on a parent, so the
 * items inherit them; anything else is ShowMore's own look.
 *
 * @internal
 */
function showMoreHint(token: string): string {
  if (/^(text|font)-/.test(token)) return `<div className="${token}"><ShowMore /></div>`;
  return ownLook("ShowMore")(token);
}

/** @internal */
const rootClass = "box-border grid min-w-0 justify-items-start text-foreground";

/**
 * The title button: 44px tall on a coarse pointer, 36px from `sm` with a fine one.
 *
 * @internal
 */
const triggerClass =
  "group/trigger press relative m-0 box-border inline-flex cursor-pointer items-center gap-2 " +
  "min-h-11 sm:pointer-fine:min-h-9 px-0 py-2 rounded-md border-0 bg-transparent text-start " +
  "font-[inherit] text-base font-medium text-foreground sm:pointer-fine:text-sm " +
  "select-none touch-manipulation [-webkit-tap-highlight-color:transparent] " +
  "underline-offset-4 not-data-disabled:pointer-fine:hover:underline not-data-disabled:active:opacity-70 " +
  "outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid " +
  "data-disabled:cursor-not-allowed data-disabled:opacity-50";

/**
 * The chevron after the title: it turns over while open.
 *
 * @internal
 */
const iconClass =
  "size-4 shrink-0 text-muted-foreground transition-[rotate] duration-(--ouro-duration-base) ease-(--ouro-ease-out) " +
  "group-data-panel-open/trigger:rotate-180 motion-reduce:transition-none";

/**
 * The panel: it grows from 0 to its measured height (Base UI's
 * `--collapsible-panel-height`) and shrinks back; with reduced motion it opens and closes at
 * once. Closed, it stays mounted and hidden; where the browser supports `hidden="until-found"`,
 * its page search finds and opens it.
 *
 * @internal
 */
const panelClass =
  "w-full h-(--collapsible-panel-height) overflow-hidden " +
  "transition-[height] duration-(--ouro-duration-base) ease-(--ouro-ease-out) motion-reduce:transition-none " +
  "data-starting-style:h-0 data-ending-style:h-0 [&[hidden]:not([hidden=until-found])]:hidden";

/** @internal */
const showMoreRootClass = "box-border grid min-w-0 justify-items-start gap-2";

/**
 * The list: no bullets or indent, so the items are the app's own rows.
 *
 * @internal
 */
const listClass = "m-0 box-border grid w-full list-none gap-0 p-0";

/**
 * A row. It takes focus from the script only, when it is the first one revealed and holds
 * nothing focusable, and shows the focus outline then.
 *
 * @internal
 */
const itemClass = "m-0 rounded-sm p-0 outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid";

/**
 * Text clamped to `--ouro-show-more-lines` lines while collapsed.
 *
 * @internal
 */
const textClass = "m-0 w-full";
