"use client";

import { Toggle as BaseToggle } from "@base-ui/react/toggle";
import { useId, useLayoutEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { devThrow } from "~/lib/ouro/dev";
import { useDisabledReason } from "~/lib/ouro/disabled-reason";
import { useMergedRef } from "~/lib/ouro/refs";
import { useScrollFade } from "~/lib/ouro/scroll-fade";
import { TouchTarget } from "~/lib/ouro/touch-target";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { Tooltip } from "~/components/ouro/tooltip/tooltip";
import {
  iconClass,
  looks,
  overflowScrollerClass,
  shapes,
  sizes,
  squareClass,
  toggleBase,
  toggleHint,
  toggleOverflowWarning,
  toggleShapeWarning,
  toggleSizeWarning,
  toggleVariantWarning,
  type ToggleIcon,
} from "~/components/ouro/toggle/toggle-styles";

/** One toggle in a {@link ToggleGroup}. */
export interface ToggleGroupItem {
  /** Identifies the toggle: `value`, `defaultValue` and `onValueChange` use it. Unique within the group. */
  value: string;
  /** The toggle's name, shown unless `hideLabel` is set. It stays the same while pressed. */
  label: string;
  /** Icon before the label, or alone with `hideLabel`. Pass the component: `icon: BoldIcon`. */
  icon?: ToggleIcon | undefined;
  /** Shows only the icon; the label stays the toggle's name for screen readers. */
  hideLabel?: boolean | undefined;
  /** Shows the toggle but keeps it from being pressed. */
  disabled?: boolean | undefined;
  /**
   * Why this toggle can't be pressed now. It stays in the tab order with `aria-disabled`, pressing
   * does nothing, and the reason shows as its tooltip on hover and focus. Pass `undefined` while
   * it can be pressed so it keeps its place and focus. It wins over `disabled` and the group's.
   * @example
   * { value: "bold", label: "Bold", disabledReason: locked ? "Unlock the layer first" : undefined }
   */
  disabledReason?: string | undefined;
  /**
   * `data-*` attributes for the item's button (`"data-testid": "bold"`), for an app's own hooks. The
   * markers Ouro UI sets itself (`data-ouro-control`, `data-ouro-part`) keep their values.
   * @claim "The markers Ouro UI sets itself" registry/ouro/components/ouro/toggle/toggle-group.test.tsx verify:testExists(registry/ouro/components/ouro/toggle/toggle-group.test.tsx::ToggleGroup > passes an item's data attributes to its button and keeps Ouro's own markers)
   */
  [attribute: `data-${string}`]: string | number | boolean | undefined;
}

/** One toggle of the group: a Base UI toggle with its `disabledReason` wiring. */
function GroupItem(props: {
  item: ToggleGroupItem;
  pressed: boolean;
  onPress: (next: boolean) => void;
  groupDisabled: boolean | undefined;
  tabIndex: number;
  onFocus: () => void;
  variant: keyof typeof looks;
  shape: keyof typeof shapes;
  size: keyof typeof sizes;
}): JSX.Element {
  const { item, pressed, onPress, groupDisabled, tabIndex, onFocus, variant, shape, size } = props;
  const { label, icon: Icon, hideLabel: iconOnlyItem, disabled: itemDisabled } = item;
  const reason = useDisabledReason(item);
  const dataAttributes = useMemo(() => Object.fromEntries(Object.entries(item).filter(([name]) => name.startsWith("data-"))), [item]);
  const iconOnly = Boolean(iconOnlyItem && Icon);
  const toggle = (
    <BaseToggle
      {...dataAttributes}
      pressed={pressed}
      onPressedChange={(next) => {
        if (!reason.off) onPress(next);
      }}
      disabled={Boolean((groupDisabled || itemDisabled) && !reason.off)}
      aria-disabled={reason.off ? true : undefined}
      data-disabled={reason.off ? "" : undefined}
      aria-describedby={reason.describedBy}
      tabIndex={tabIndex}
      onFocus={onFocus}
      aria-label={iconOnlyItem ? label : undefined}
      data-ouro-toggle=""
      data-ouro-control="toggle-group"
      data-ouro-part="item"
      data-variant={variant}
      data-shape={shape}
      data-ouro-squircle={shape === "rect" ? "" : undefined}
      className={cn(toggleBase, shapes[shape], sizes[size], looks[variant], iconOnly && squareClass)}
    >
      <TouchTarget />
      {shape === "rect" && <span data-ouro-surface="" aria-hidden="true" style={{ zIndex: -1 }} />}
      {Icon && <Icon aria-hidden="true" className={cn(iconClass, "relative", !iconOnlyItem && "-ms-0.5")} />}
      {!iconOnly && <span className={cn("relative", iconOnlyItem && "sr-only")}>{label}</span>}
      {reason.note}
    </BaseToggle>
  );
  return reason.wrapped ? <Tooltip content={reason.reason}>{toggle}</Tooltip> : toggle;
}

/** Props both modes of {@link ToggleGroup} take. */
export interface ToggleGroupBaseProps {
  /**
   * Names the group ("Text style"). Shown above it unless `hideLabel` is set; screen readers always hear it.
   *
   * @claim "Shown above it unless `hideLabel` is" registry/ouro/components/ouro/toggle/toggle-group.test.tsx verify:testExists(registry/ouro/components/ouro/toggle/toggle-group.test.tsx::ToggleGroup > hides the group label visually with hideLabel and keeps it as the name)
   */
  label: string;
  /** Hides the group's label visually; it still names the group. Set it on a toolbar whose toggles say what it is. */
  hideLabel?: boolean | undefined;
  /** The toggles, in order. */
  items: readonly ToggleGroupItem[];
  /**
   * Disables every toggle.
   *
   * @claim "Disables every toggle" registry/ouro/components/ouro/toggle/toggle-group.test.tsx verify:testExists(registry/ouro/components/ouro/toggle/toggle-group.test.tsx::ToggleGroup > disables one item, or the whole group)
   */
  disabled?: boolean | undefined;
  /**
   * `plain` toggles have no border until pressed; `outline` ones always have one. shadcn's `default` is `plain`.
   * @default "plain"
   * @claim "`plain` toggles have no border until" registry/ouro/components/ouro/toggle/toggle.test.tsx verify:testExists(registry/ouro/components/ouro/toggle/toggle.test.tsx::Toggle looks > draws a border with variant outline)
   * @claim "`plain` toggles have no border until" https://ui.shadcn.com/docs/components/toggle-group verify:urlOk(https://ui.shadcn.com/docs/components/toggle-group)
   */
  variant?: "plain" | "outline" | (string & { 'From shadcn? default is "plain"; use "plain" or "outline"': never }) | undefined;
  /**
   * Every toggle's size, as Button's, plus `xs` for a row of filter chips: 24px with a fine
   * pointer, with a 44px touch target on phones. shadcn's `default` is `md`.
   * @default "md"
   * @claim "Every toggle's size, as Button's, plus" registry/ouro/components/ouro/toggle/toggle-group.test.tsx verify:testExists(registry/ouro/components/ouro/toggle/toggle-group.test.tsx::ToggleGroup > passes variant and size to every item)
   */
  size?: "xs" | "sm" | "md" | "lg" | (string & { 'From shadcn? default is "md"': never }) | undefined;
  /**
   * Every toggle's shape: `rect` has the theme's corners and medium text; `pill` is fully rounded
   * with regular-weight text, for filter chips such as All, Unread and Mentions.
   * @default "rect"
   * @claim "`pill` is fully rounded with regular-weight" registry/ouro/components/ouro/toggle/toggle-group.test.tsx verify:testExists(registry/ouro/components/ouro/toggle/toggle-group.test.tsx::ToggleGroup > passes shape pill and size xs to every item)
   */
  shape?: "rect" | "pill" | (string & { 'Use "rect" or "pill"; rounded-full is "pill"': never }) | undefined;
  /**
   * `wrap`, the default, lets the row of toggles move onto more lines at the width they need.
   * `scroll` keeps the row one line tall and scrolls it sideways instead, with a soft fade at
   * whichever edge cuts a toggle off and none once every toggle fits, and its scrollbar hidden.
   * The roving tab stop still moves with the arrow keys, Home and End, and brings the toggle it
   * focuses fully into view; the pressed toggle scrolls into view too when the value changes. A
   * touch pans the row, and a fine pointer's wheel scrolls it too.
   * Use it for a row of filter chips in a place too narrow for them all.
   * @default "wrap"
   * @example
   * <ToggleGroup
   *   label="Show"
   *   hideLabel
   *   variant="outline"
   *   shape="pill"
   *   size="xs"
   *   overflow="scroll"
   *   items={[
   *     { value: "all", label: "All" },
   *     { value: "unread", label: "Unread" },
   *   ]}
   *   value={filter}
   *   onValueChange={(next) => setFilter(next ?? "all")}
   * />
   * @claim "keeps the row one line tall and scrolls it sideways instead" registry/ouro/components/ouro/toggle/toggle-group.overflow.test.tsx verify:testExists(registry/ouro/components/ouro/toggle/toggle-group.overflow.test.tsx::ToggleGroup overflow scroll > stays one line tall, narrower than the toggles, instead of wrapping)
   * @claim "with a soft fade at whichever edge cuts a toggle off and none once every toggle fits" registry/ouro/components/ouro/toggle/toggle-group.overflow.test.tsx verify:testExists(registry/ouro/components/ouro/toggle/toggle-group.overflow.test.tsx::ToggleGroup overflow scroll > fades no side once every toggle fits, and the side that hides one once it doesn't)
   * @claim "brings the toggle it focuses fully into view" registry/ouro/components/ouro/toggle/toggle-group.overflow.test.tsx verify:testExists(registry/ouro/components/ouro/toggle/toggle-group.overflow.test.tsx::ToggleGroup overflow scroll > brings the last toggle fully into view when End moves focus to it)
   * @claim "the pressed toggle scrolls into view too when the value changes" registry/ouro/components/ouro/toggle/toggle-group.overflow.test.tsx verify:testExists(registry/ouro/components/ouro/toggle/toggle-group.overflow.test.tsx::ToggleGroup overflow scroll > scrolls the pressed toggle into view when the value changes)
   */
  overflow?: "wrap" | "scroll" | (string & { 'Use "wrap" or "scroll"': never }) | undefined;
  /** Layout only: margins, grid placement (`mt-4`). Appearance classes warn in development. */
  className?: string | undefined;
  /** Reaches the group element (`role="group"`). */
  ref?: Ref<HTMLDivElement> | undefined;

  /** Not a prop. Ouro UI uses `items`: `<ToggleGroup items={[{ value, label }]}>`. */
  options?: { 'Use <ToggleGroup items={[{ value, label }]}>': never };
  /** Not a prop. One toggle at a time is the default; `multiple` allows several: `<ToggleGroup multiple>`. */
  type?: { 'Use <ToggleGroup multiple> for several; one at a time is the default': never };
  /** Not a prop. Ouro UI uses `onValueChange`, which gets the value: `<ToggleGroup onValueChange={(value) => ...}>`. */
  onChange?: { 'Use <ToggleGroup onValueChange={(value) => ...}>': never };
  /** Not a prop. The toggles come from `items`: `<ToggleGroup items={[{ value: "bold", label: "Bold" }]}>`. */
  children?: { 'Use <ToggleGroup items={[{ value: "bold", label: "Bold" }]}>': never };
}

/**
 * One toggle pressed at a time, the default: the value is one item's value, or `null` for none.
 *
 * @claim "One toggle pressed at a time" registry/ouro/components/ouro/toggle/toggle-group.test.tsx verify:testExists(registry/ouro/components/ouro/toggle/toggle-group.test.tsx::ToggleGroup > presses one item at a time and reports the value, or null when none is pressed)
 */
export type ToggleGroupSingleProps = ToggleGroupBaseProps & {
  /** Allows several toggles pressed at once, and makes the value a list. */
  multiple?: false | undefined;
  /**
   * The pressed toggle's value, or `null` for none, when you control it. Pair it with `onValueChange`.
   *
   * @claim "The pressed toggle's value, or `null`" registry/ouro/components/ouro/toggle/toggle-group.test.tsx verify:testExists(registry/ouro/components/ouro/toggle/toggle-group.test.tsx::ToggleGroup > presses one item at a time and reports the value, or null when none is pressed)
   */
  value?: string | null | undefined;
  /** The toggle pressed first, when the group keeps its own state. @default null */
  defaultValue?: string | null | undefined;
  /** Called with the pressed toggle's value, or `null` when the pressed one is pressed again. */
  onValueChange?: ((value: string | null) => void) | undefined;
};

/** With `multiple`, any number of toggles pressed: the value is a list of item values. */
export type ToggleGroupMultipleProps = ToggleGroupBaseProps & {
  /** Allows several toggles pressed at once, and makes the value a list. */
  multiple: true;
  /** The pressed toggles' values, when you control them. Pair it with `onValueChange`. */
  value?: readonly string[] | undefined;
  /** The toggles pressed first, when the group keeps its own state. @default [] */
  defaultValue?: readonly string[] | undefined;
  /** Called with the pressed toggles' values, in item order. */
  onValueChange?: ((value: string[]) => void) | undefined;
};

/** Props for {@link ToggleGroup}: `multiple` makes the value a list. */
export type ToggleGroupProps = ToggleGroupSingleProps | ToggleGroupMultipleProps;

/** The first value that appears twice, or undefined. */
function duplicateValue(items: readonly ToggleGroupItem[]): string | undefined {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.value)) return item.value;
    seen.add(item.value);
  }
  return undefined;
}

/** A value prop as Base UI's list. */
function asList(value: string | null | readonly string[] | undefined): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (value === null) return [];
  return typeof value === "string" ? [value] : value;
}

/**
 * A row of related toggles that share one value, such as text alignment or bold, italic and
 * underline in a toolbar. One toggle is pressed at a time unless `multiple` is set, which
 * makes the value a list. The arrow keys move between toggles, and each keeps its name with
 * `aria-pressed` for its state.
 *
 * Use `SegmentedControl` instead when exactly one choice is always selected and switches a
 * view. Use `RadioGroup` or `CheckboxGroup` instead for a form value that is submitted, and
 * one `Toggle` for a single on/off button.
 *
 * @group Actions
 * @see https://ui.ouroboros.bot/docs/toggle-group
 *
 * @example
 * <ToggleGroup
 *   label="Text style"
 *   hideLabel
 *   multiple
 *   items={[
 *     { value: "bold", label: "Bold", icon: BoldIcon, hideLabel: true },
 *     { value: "italic", label: "Italic", icon: ItalicIcon, hideLabel: true },
 *   ]}
 *   value={styles}
 *   onValueChange={setStyles}
 * />
 * <ToggleGroup
 *   label="Show"
 *   hideLabel
 *   variant="outline"
 *   shape="pill"
 *   size="xs"
 *   items={[
 *     { value: "all", label: "All" },
 *     { value: "unread", label: "Unread" },
 *   ]}
 *   value={filter}
 *   onValueChange={(next) => setFilter(next ?? "all")}
 * />
 * @claim "The arrow keys move between toggles" registry/ouro/components/ouro/toggle/toggle-group.test.tsx verify:testExists(registry/ouro/components/ouro/toggle/toggle-group.test.tsx::ToggleGroup > moves focus with the arrow keys and presses with Space)
 * @claim "The arrow keys move between toggles" registry/ouro/components/ouro/toggle/toggle-group.test.tsx verify:testExists(registry/ouro/components/ouro/toggle/toggle-group.test.tsx::ToggleGroup > is a labeled group of toggle buttons)
 */
export function ToggleGroup(props: ToggleGroupProps): JSX.Element {
  const {
    label,
    hideLabel,
    items,
    disabled,
    variant: variantProp = "plain",
    size: sizeProp = "md",
    shape: shapeProp = "rect",
    overflow: overflowProp = "wrap",
    className,
    ref,
    multiple,
    value,
    defaultValue,
    onValueChange,
    // Guard props (hint types), dropped here so they never reach the DOM.
    options,
    type,
    onChange,
    children,
  } = props;
  const variant = Object.hasOwn(looks, variantProp) ? (variantProp as keyof typeof looks) : "plain";
  const size = Object.hasOwn(sizes, sizeProp) ? (sizeProp as keyof typeof sizes) : "md";
  const shape = Object.hasOwn(shapes, shapeProp) ? (shapeProp as keyof typeof shapes) : "rect";
  const overflow = overflowProp === "scroll" ? "scroll" : "wrap";
  const duplicate = duplicateValue(items);
  if (duplicate !== undefined) {
    devThrow(
      "ToggleGroup",
      `two items have the value "${duplicate}"`,
      process.env.NODE_ENV !== "production" ? "give each item its own value" : /* istanbul ignore next @preserve -- production only */ "",
    );
  }
  useAppearanceClassNameCheck(
    "ToggleGroup",
    className,
    process.env.NODE_ENV !== "production" ? toggleHint("ToggleGroup") : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "ToggleGroup",
    process.env.NODE_ENV !== "production"
      ? () => {
          const lists = Array.isArray(value) || Array.isArray(defaultValue);
          const strings = typeof value === "string" || typeof defaultValue === "string";
          const first = items[0]?.value ?? "bold";
          const unknown = [...(asList(value) ?? []), ...(asList(defaultValue) ?? [])].find(
            (candidate) => !items.some((item) => item.value === candidate),
          );
          const bare = items.find((item) => item.hideLabel && !item.icon);
          const kind = String(type);
          return [
            variant !== variantProp && toggleVariantWarning("ToggleGroup", String(variantProp)),
            size !== sizeProp && toggleSizeWarning("ToggleGroup", String(sizeProp)),
            shape !== shapeProp && toggleShapeWarning("ToggleGroup", String(shapeProp)),
            overflow !== overflowProp && toggleOverflowWarning(String(overflowProp)),
            !label && ["label is empty, so the group has no name", '<ToggleGroup label="Text style" hideLabel>'],
            !multiple && lists && ["a list of values needs multiple", "<ToggleGroup multiple defaultValue={[…]}>"],
            multiple && strings && ["multiple takes a list of values", `<ToggleGroup multiple value={["${first}"]}>`],
            unknown !== undefined && [`value "${unknown}" matches no item`, `<ToggleGroup value="${first}">`],
            bare && [
              `item "${bare.value}" hides its label without an icon`,
              `{ value: "${bare.value}", label: "${bare.label}", icon: ${bare.label.replace(/\W/g, "")}Icon, hideLabel: true }`,
            ],
            options !== undefined && ["options is not a prop", "<ToggleGroup items={[{ value, label }]}>"],
            type !== undefined && [
              `type="${kind}" is not a prop`,
              kind === "multiple" ? "<ToggleGroup multiple>" : "<ToggleGroup> (one at a time is the default)",
            ],
            onChange !== undefined && ["onChange is not a prop", "<ToggleGroup onValueChange={(value) => …}>"],
            children !== undefined && [
              "children is not a prop; the toggles come from items",
              '<ToggleGroup items={[{ value: "bold", label: "Bold" }]}>',
            ],
          ];
        }
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  const labelId = useId();
  // Stryker disable next-line ArrayDeclaration: an empty list and a stray entry press no item
  const [inner, setInner] = useState<readonly string[]>(() => asList(defaultValue) ?? []);
  const pressed = asList(value) ?? inner;
  const [focused, setFocused] = useState<string | null>(null);
  const enabled = items.filter((item) => item.disabledReason || (!disabled && !item.disabled));
  const stop = enabled.find((item) => item.value === focused) ?? enabled.find((item) => pressed.includes(item.value)) ?? enabled[0];

  const press = (itemValue: string, next: boolean): void => {
    const list = multiple
      ? items.filter((item) => (item.value === itemValue ? next : pressed.includes(item.value))).map((item) => item.value)
      : next
        ? [itemValue]
        : [];
    // Stryker disable next-line ConditionalExpression: a controlled group reads value, so the extra state is never shown
    if (value === undefined) setInner(list);
    if (multiple) (onValueChange as ToggleGroupMultipleProps["onValueChange"])?.(list);
    else (onValueChange as ToggleGroupSingleProps["onValueChange"])?.(list[0] ?? null);
  };

  // Roving focus is the group's own, not Base UI's composite, whose mount reads computed style once per group.
  const move = (event: KeyboardEvent<HTMLDivElement>): void => {
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-ouro-toggle]:not(:disabled)"));
    const at = buttons.indexOf(event.target as HTMLElement);
    if (at === -1 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const rtl = (event.currentTarget.closest("[dir]")?.getAttribute("dir") ?? document.documentElement.dir) === "rtl";
    const step =
      event.key === "ArrowRight" ? (rtl ? -1 : 1) : event.key === "ArrowLeft" ? (rtl ? 1 : -1) : event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    const target =
      event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : step ? (at + step + buttons.length) % buttons.length : -1;
    if (target === -1) return;
    event.preventDefault();
    const next = buttons[target];
    // Stryker disable next-line OptionalChaining: next is always inside buttons
    next?.focus();
    if (overflow === "scroll") {
      // Stryker disable next-line OptionalChaining: next is always inside buttons
      next?.scrollIntoView({ inline: "nearest", block: "nearest" });
    }
  };

  const groupItems = items.map((item) => (
    <GroupItem
      key={item.value}
      item={item}
      pressed={pressed.includes(item.value)}
      onPress={(next) => press(item.value, next)}
      groupDisabled={disabled}
      tabIndex={stop?.value === item.value ? 0 : -1}
      onFocus={() => setFocused(item.value)}
      variant={variant}
      shape={shape}
      size={size}
    />
  ));

  return (
    <div data-ouro="toggle-group" className={cn("box-border grid min-w-0 content-start justify-items-start gap-2", className)}>
      {/* aria-hidden drops hideLabel's sr-only text from reading order; aria-labelledby still reads a hidden element, so the group keeps its name. */}
      <span id={labelId} aria-hidden={hideLabel || undefined} className={cn("m-0 text-sm leading-5 font-medium text-foreground select-none", hideLabel && "sr-only")}>
        {label}
      </span>
      {overflow === "scroll" ? (
        <ScrollRow labelId={labelId} outerRef={ref} onKeyDown={move} pressedKey={pressed.join("\u0000")}>
          {groupItems}
        </ScrollRow>
      ) : (
        <div
          ref={ref}
          role="group"
          aria-labelledby={labelId}
          onKeyDown={move}
          className="m-0 box-border inline-flex max-w-full flex-wrap items-center gap-1"
        >
          {groupItems}
        </div>
      )}
    </div>
  );
}

/**
 * {@link ToggleGroupBaseProps.overflow} `"scroll"`: the one-line row itself, isolated from
 * {@link ToggleGroup} so the default `"wrap"` row calls {@link useScrollFade} only when it is
 * mounted, keeping the default row's computed-style reads at the same count as before this
 * prop. A layout effect keeps the pressed toggle in view, on mount and whenever the value
 * changes.
 * @claim "keeping the default row's computed-style reads at the same count as before this prop" registry/ouro/components/ouro/toggle/toggle-group.layout.test.tsx verify:testExists(registry/ouro/components/ouro/toggle/toggle-group.layout.test.tsx::ToggleGroup layout reads > reads no computed style while its items mount or its value changes)
 *
 * @internal
 */
function ScrollRow(props: {
  labelId: string;
  outerRef: Ref<HTMLDivElement> | undefined;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  pressedKey: string;
  children: ReactNode;
}): JSX.Element {
  const { labelId, outerRef, onKeyDown, pressedKey, children } = props;
  const fadeRef = useRef<HTMLDivElement>(null);
  useScrollFade(fadeRef);
  const rowRef = useMergedRef(outerRef, fadeRef);
  useLayoutEffect(() => {
    // Stryker disable next-line OptionalChaining: the ref is attached by the time this effect runs
    const pressedButton = fadeRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    pressedButton?.scrollIntoView({ inline: "nearest", block: "nearest" });
    // Stryker disable next-line ArrayDeclaration: the ref is stable; only a value change need run this again
  }, [pressedKey]);
  return (
    <div
      ref={rowRef}
      data-slot="toggle-group-scroller"
      role="group"
      aria-labelledby={labelId}
      onKeyDown={onKeyDown}
      className={cn("m-0 box-border flex max-w-full items-center gap-1", overflowScrollerClass)}
    >
      {children}
    </div>
  );
}
