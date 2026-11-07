"use client";

import { Toggle as BaseToggle } from "@base-ui/react/toggle";
import { ToggleGroup as BaseToggleGroup } from "@base-ui/react/toggle-group";
import { useId, type JSX, type Ref } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { devThrow } from "~/lib/ouro/dev";
import { TouchTarget } from "~/lib/ouro/touch-target";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import {
  iconClass,
  looks,
  sizes,
  squareClass,
  toggleBase,
  toggleHint,
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
   * Every toggle's size, as Button's. shadcn's `default` is `md`.
   * @default "md"
   * @claim "Every toggle's size, as Button's. shadcn's" registry/ouro/components/ouro/toggle/toggle-group.test.tsx verify:testExists(registry/ouro/components/ouro/toggle/toggle-group.test.tsx::ToggleGroup > passes variant and size to every item)
   */
  size?: "sm" | "md" | "lg" | (string & { 'From shadcn? default is "md"': never }) | undefined;
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
 * @see https://ui.ouro.bot/docs/toggle-group
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

  return (
    <div data-ouro="toggle-group" className={cn("box-border grid min-w-0 content-start justify-items-start gap-2", className)}>
      <span id={labelId} className={cn("m-0 text-sm leading-5 font-medium text-foreground select-none", hideLabel && "sr-only")}>
        {label}
      </span>
      <BaseToggleGroup
        ref={ref}
        aria-labelledby={labelId}
        multiple={Boolean(multiple)}
        value={asList(value)}
        defaultValue={asList(defaultValue)}
        onValueChange={(next) => {
          if (multiple) (onValueChange as ToggleGroupMultipleProps["onValueChange"])?.(next);
          else (onValueChange as ToggleGroupSingleProps["onValueChange"])?.(next[0] ?? null);
        }}
        disabled={disabled}
        className="m-0 box-border inline-flex max-w-full flex-wrap items-center gap-1"
      >
        {items.map(({ value: itemValue, label: itemLabel, icon: Icon, hideLabel: iconOnlyItem, disabled: itemDisabled }) => {
          const iconOnly = Boolean(iconOnlyItem && Icon);
          return (
            <BaseToggle
              key={itemValue}
              value={itemValue}
              disabled={itemDisabled}
              aria-label={iconOnlyItem ? itemLabel : undefined}
              data-ouro-toggle=""
              data-ouro-control="toggle-group"
              data-ouro-part="item"
              data-variant={variant}
              className={cn(toggleBase, sizes[size], looks[variant], iconOnly && squareClass)}
            >
              <TouchTarget />
              {Icon && <Icon aria-hidden="true" className={cn(iconClass, "relative", !iconOnlyItem && "-ms-0.5")} />}
              {!iconOnly && <span className={cn("relative", iconOnlyItem && "sr-only")}>{itemLabel}</span>}
            </BaseToggle>
          );
        })}
      </BaseToggleGroup>
    </div>
  );
}
