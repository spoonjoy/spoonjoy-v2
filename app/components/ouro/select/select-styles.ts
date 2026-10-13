import type { ReactElement, ReactNode } from "react";

export { flattenOptions, groupLabelClass, itemClass, itemIndicatorClass, popupClass, positionerClass, sheetQuery, triggerClass, backdropClass, sheetTitleClass, isGroup };
export type { SelectOption, SelectOptionGroup, SelectOptions };

// Class strings, option helpers and the sheet query for Select and its parts, apart from
// the components so each component file exports only components (React Fast Refresh).
// Class strings are literal so the app's Tailwind finds them when it compiles.

/** One choice: the `value` it submits and the `label` it shows. */
interface SelectOption {
  /** What the form submits and `onValueChange` receives. */
  value: string;
  /** What the list and the trigger show. */
  label: string;
  /** The option shows but cannot be chosen. */
  disabled?: boolean | undefined;
}

/** A labeled group of options, shown under a heading in the list. */
interface SelectOptionGroup {
  /** The group's heading. */
  label: string;
  /** The options in the group. */
  options: SelectOption[];
}

/** Select's `options`: options, groups of options, or both. */
type SelectOptions = ReadonlyArray<SelectOption | SelectOptionGroup>;

/**
 * Whether an entry in `options` is a group.
 *
 * @internal
 */
function isGroup(entry: SelectOption | SelectOptionGroup): entry is SelectOptionGroup {
  return "options" in entry;
}

/**
 * Every option, groups flattened, as `{ value, label }` for the trigger's text. Children
 * count too: each `SelectItem` element, inside fragments and `SelectGroup`s.
 *
 * @internal
 */
function flattenOptions(options: SelectOptions | undefined, children: ReactNode, itemType: unknown): Array<{ value: string; label: ReactNode }> {
  const found: Array<{ value: string; label: ReactNode }> = [];
  for (const entry of options ?? []) {
    for (const option of isGroup(entry) ? entry.options : [entry]) found.push({ value: option.value, label: option.label });
  }
  const walk = (node: ReactNode): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object" || !("props" in node)) return;
    const element = node as ReactElement<{ value?: string; children?: ReactNode }>;
    if (element.type === itemType) found.push({ value: element.props.value!, label: element.props.children });
    else walk(element.props.children);
  };
  walk(children);
  return found;
}

/**
 * Phones present the list as a bottom sheet: below the `sm` breakpoint with a coarse pointer.
 *
 * @internal
 */
const sheetQuery = "(max-width: 639.98px) and (pointer: coarse)";

/**
 * The trigger: Field's control look (44px tall with a 16px font on phones, stepping down
 * from `sm` with a fine pointer), with the value at the start and a chevron at the end. Its
 * height is one unprefixed class that reads a variable, so an app's `h-*` replaces it.
 *
 * @internal
 */
const triggerClass =
  "relative m-0 box-border flex w-full min-w-0 items-center justify-between gap-2 h-(--ouro-control-h) px-3 py-0 " +
  "[--ouro-control-h:calc(var(--spacing)*11)] sm:pointer-fine:[--ouro-control-h:calc(var(--spacing)*9)] " +
  "rounded-md border border-solid border-input bg-transparent text-start text-base text-foreground sm:pointer-fine:text-sm " +
  "font-[inherit] cursor-pointer select-none [-webkit-tap-highlight-color:transparent] " +
  "outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid " +
  "transition-[border-color] duration-(--ouro-duration-fast) ease-out " +
  "hover:not-data-disabled:border-ring/60 aria-invalid:border-destructive " +
  "data-disabled:cursor-not-allowed data-disabled:opacity-50 dark:bg-input/30 " +
  "[&_[data-placeholder]]:text-muted-foreground [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground";

/**
 * The positioner. As a sheet it is pinned to the bottom edge at full width, over the place
 * Base UI computed next to the trigger.
 *
 * @internal
 */
const positionerClass =
  "outline-none " +
  "data-[ouro-presentation=sheet]:fixed! data-[ouro-presentation=sheet]:inset-x-0! data-[ouro-presentation=sheet]:top-auto! " +
  "data-[ouro-presentation=sheet]:bottom-0! data-[ouro-presentation=sheet]:w-auto! data-[ouro-presentation=sheet]:transform-none!";

/**
 * The list's panel: the trigger's width at least, scrolling within the space Base UI
 * measured. It scales and fades from its origin, and with reduced motion only fades. As a
 * sheet it rises from the bottom edge with rounded top corners and clears the home indicator.
 *
 * @internal
 */
const popupClass =
  "box-border flex max-h-(--available-height) min-w-(--anchor-width) flex-col overflow-hidden outline-none " +
  "rounded-md border border-solid border-border bg-popover p-1 text-popover-foreground " +
  "[box-shadow:0_8px_24px_rgb(0_0_0/0.12)] origin-(--transform-origin) " +
  "[transition:opacity_var(--ouro-duration-fast)_ease-out,scale_var(--ouro-duration-fast)_ease-out] " +
  "data-starting-style:opacity-0 data-starting-style:scale-95 data-ending-style:opacity-0 data-ending-style:scale-95 " +
  "data-[side=none]:data-starting-style:scale-100 data-[side=none]:data-starting-style:opacity-100 " +
  "motion-reduce:data-starting-style:scale-100 motion-reduce:data-ending-style:scale-100 " +
  "data-[ouro-presentation=sheet]:max-h-[min(70dvh,calc(100dvh-4rem))] data-[ouro-presentation=sheet]:min-w-0 " +
  "data-[ouro-presentation=sheet]:rounded-none data-[ouro-presentation=sheet]:rounded-t-xl data-[ouro-presentation=sheet]:border-x-0 " +
  "data-[ouro-presentation=sheet]:border-b-0 data-[ouro-presentation=sheet]:px-2 data-[ouro-presentation=sheet]:pt-2 " +
  "data-[ouro-presentation=sheet]:pb-[calc(env(safe-area-inset-bottom,0px)+0.5rem)] " +
  "data-[ouro-presentation=sheet]:[transition:transform_var(--ouro-spring-duration)_var(--ouro-ease-spring),opacity_var(--ouro-duration-fast)_ease-out] " +
  "data-[ouro-presentation=sheet]:data-starting-style:scale-100 data-[ouro-presentation=sheet]:data-ending-style:scale-100 " +
  "data-[ouro-presentation=sheet]:data-starting-style:opacity-100 data-[ouro-presentation=sheet]:data-ending-style:opacity-100 " +
  "data-[ouro-presentation=sheet]:data-starting-style:translate-y-full data-[ouro-presentation=sheet]:data-ending-style:translate-y-full " +
  "motion-reduce:data-[ouro-presentation=sheet]:[transition:opacity_var(--ouro-duration-base)_ease-out] " +
  "motion-reduce:data-[ouro-presentation=sheet]:data-starting-style:translate-y-0 motion-reduce:data-[ouro-presentation=sheet]:data-ending-style:translate-y-0 " +
  "motion-reduce:data-[ouro-presentation=sheet]:data-starting-style:opacity-0 motion-reduce:data-[ouro-presentation=sheet]:data-ending-style:opacity-0";

/**
 * The sheet's dimmed backdrop, which a tap outside the list closes. Only the sheet has one.
 *
 * @internal
 */
const backdropClass =
  "fixed inset-0 bg-(--ouro-backdrop-color) opacity-(--ouro-backdrop-max) " +
  "[transition:opacity_var(--ouro-duration-base)_ease-out] data-starting-style:opacity-0 data-ending-style:opacity-0";

/**
 * The sheet's heading: the field's label, so the user sees what they are choosing.
 *
 * @internal
 */
const sheetTitleClass = "m-0 shrink-0 px-3 pt-1 pb-2 text-base leading-6 font-semibold text-foreground";

/**
 * An option: 44px tall on coarse pointers, 32px with a fine one, with the check mark in
 * front. The highlighted option (pointer or arrow keys) takes the accent color.
 *
 * @internal
 */
const itemClass =
  "relative box-border grid min-h-11 cursor-default grid-cols-[1rem_1fr] items-center gap-2 rounded-sm px-2 py-1.5 " +
  "text-base leading-6 outline-none select-none pointer-fine:min-h-8 sm:pointer-fine:text-sm sm:pointer-fine:leading-5 " +
  "scroll-my-1 [-webkit-tap-highlight-color:transparent] data-highlighted:bg-accent data-highlighted:text-accent-foreground " +
  "data-disabled:opacity-50 [&_svg]:size-4";

/**
 * The check mark in front of a chosen option.
 *
 * @internal
 */
const itemIndicatorClass = "col-start-1 flex items-center justify-center";

/**
 * A group's heading.
 *
 * @internal
 */
const groupLabelClass = "px-2 pt-2 pb-1 ps-8 text-xs leading-4 font-medium text-muted-foreground select-none";
