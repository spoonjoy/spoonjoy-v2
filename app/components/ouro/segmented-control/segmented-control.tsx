"use client";

import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { useId, useRef, useState, type CSSProperties, type JSX, type Ref } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { TouchTarget } from "~/lib/ouro/touch-target";
import { devThrow } from "~/lib/ouro/dev";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import {
  groupClass,
  labelClass,
  ownLook,
  rootClass,
  segmentClass,
  thumbClass,
} from "~/components/ouro/segmented-control/segmented-control-styles";

/** One segment. */
export interface SegmentedControlItem {
  /** Identifies the segment: `value`, `defaultValue` and `onValueChange` use it. Unique within the control. */
  value: string;
  /** The segment's text. Keep it to one short word; every segment gets the width of the longest. */
  label: string;
  /** Shows the segment but keeps it from being pressed. */
  disabled?: boolean | undefined;
  /** Not a prop. A segment switches a view in place; to go to another page, use `Tabs` or links in a `<nav>`. */
  href?: { 'A segment switches a view in place. To navigate, use links in a <nav>': never };
}

/** Props for {@link SegmentedControl}. */
export interface SegmentedControlProps {
  /**
   * Names the choice ("View"). Shown above the control unless `hideLabel` is set; screen readers always hear it.
   *
   * @claim "Shown above the control unless `hideLabel`" registry/ouro/components/ouro/segmented-control/segmented-control.test.tsx verify:testExists(registry/ouro/components/ouro/segmented-control/segmented-control.test.tsx::SegmentedControl > hides the label visually with hideLabel, and still names the group)
   */
  label: string;
  /** Hides the label visually; it still names the control for screen readers. Set it on a view switcher whose segments say what it is. */
  hideLabel?: boolean | undefined;
  /** The segments, in order. Keep to two to five. */
  items: readonly SegmentedControlItem[];
  /** The pressed segment's value, when you control it. Pair it with `onValueChange`. */
  value?: string | undefined;
  /** The segment pressed first, when the component keeps its own state. @default the first enabled item */
  defaultValue?: string | undefined;
  /** Called with the new segment's value when the person presses a segment. Pressing the pressed one does nothing. */
  onValueChange?: ((value: string) => void) | undefined;
  /**
   * Disables every segment.
   *
   * @claim "Disables every segment" registry/ouro/components/ouro/segmented-control/segmented-control.test.tsx verify:testExists(registry/ouro/components/ouro/segmented-control/segmented-control.test.tsx::SegmentedControl > disables one segment, or the whole control)
   */
  disabled?: boolean | undefined;
  /** Stretches the control to the width of its container, with the segments sharing it equally. */
  fullWidth?: boolean | undefined;
  /** Submits the checked segment's value under this name with the form it sits in, unless the control is `disabled`. */
  name?: string | undefined;
  /** Layout only: margins, grid placement (`mt-4`). Appearance classes warn in development. */
  className?: string | undefined;
  /** Reaches the group element (`role="radiogroup"`). */
  ref?: Ref<HTMLDivElement> | undefined;

  /** Not a prop. Ouro UI uses `items`: `<SegmentedControl items={[{ value, label }]}>`. */
  options?: { 'Use <SegmentedControl items={[{ value, label }]}>': never };
  /** Not a prop. Ouro UI uses `onValueChange`, which gets the value: `<SegmentedControl onValueChange={(value) => …}>`. */
  onChange?: { 'Use <SegmentedControl onValueChange={(value) => ...}>': never };
}

/** The first value that appears twice, or undefined. */
function duplicateValue(items: readonly SegmentedControlItem[]): string | undefined {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.value)) return item.value;
    seen.add(item.value);
  }
  return undefined;
}

/**
 * An iOS-style segmented control: a row of equal segments with a raised thumb that slides
 * to the checked one, for switching how one view shows its content in place, such as list
 * or grid. Exactly one segment is checked. Screen readers hear a radio group, and the arrow
 * keys check the next segment as they do for radio buttons. Segments are 44px tall on touch
 * screens, and `name` submits the value with a form.
 *
 * Use `Tabs` instead when each choice shows different content with its own panel. Use links
 * in a `<nav>` instead when each choice is its own page. Use a `RadioGroup` instead for a
 * form value that is submitted.
 *
 * @group Navigation
 * @see https://ui.ouro.bot/docs/segmented-control
 *
 * @example
 * <SegmentedControl
 *   label="View"
 *   hideLabel
 *   items={[
 *     { value: "list", label: "List" },
 *     { value: "grid", label: "Grid" },
 *   ]}
 *   value={view}
 *   onValueChange={setView}
 * />
 * @claim "Segments are 44px tall on touch" registry/ouro/components/ouro/segmented-control/segmented-control.test.tsx verify:testExists(registry/ouro/components/ouro/segmented-control/segmented-control.test.tsx::SegmentedControl > submits the checked value with a form when given a name)
 * @claim "Segments are 44px tall on touch" registry/ouro/components/ouro/segmented-control/segmented-control.touch.test.tsx verify:testExists(registry/ouro/components/ouro/segmented-control/segmented-control.touch.test.tsx::keeps 44px segments with 16px text on a phone, also in landscape)
 */
export function SegmentedControl(props: SegmentedControlProps): JSX.Element {
  const {
    label,
    hideLabel,
    items,
    value,
    defaultValue,
    onValueChange,
    disabled,
    fullWidth,
    name,
    className,
    ref,
    // Guard props (hint types), dropped here so they never reach the DOM.
    options,
    onChange,
  } = props;
  useAppearanceClassNameCheck(
    "SegmentedControl",
    className,
    process.env.NODE_ENV !== "production" ? ownLook("SegmentedControl") : /* istanbul ignore next @preserve -- production only */ "",
  );
  const duplicate = duplicateValue(items);
  if (duplicate !== undefined) {
    devThrow(
      "SegmentedControl",
      `two items have the value "${duplicate}"`,
      process.env.NODE_ENV !== "production" ? "give each item its own value" : /* istanbul ignore next @preserve -- production only */ "",
    );
  }
  useDevWarnings(
    "SegmentedControl",
    process.env.NODE_ENV !== "production"
      ? () => {
          const known = (candidate: string | undefined) => candidate === undefined || items.some((item) => item.value === candidate);
          const first = items[0]?.value ?? "…";
          return [
            options !== undefined && ["options is not a prop", "<SegmentedControl items={[{ value, label }]}>"],
            onChange !== undefined && ["onChange is not a prop", "<SegmentedControl onValueChange={(value) => …}>"],
            !known(value) && [`value="${value}" matches no item`, `<SegmentedControl value="${first}">`],
            !known(defaultValue) && [
              `defaultValue="${defaultValue}" matches no item`,
              `<SegmentedControl defaultValue="${first}">`,
            ],
            items.some((item) => item.href !== undefined) && [
              "a segment switches a view in place, so it has no href",
              "<Tabs> or links in a <nav>",
            ],
          ];
        }
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  const [own, setOwn] = useState(() => defaultValue ?? items.find((item) => !item.disabled)?.value);
  const selected = value !== undefined ? value : own;
  const index = items.findIndex((item) => item.value === selected);
  const tabStop = index === -1 ? items.find((item) => !item.disabled)?.value : selected;
  const labelId = useId();
  // Set while an arrow, Home or End key moves focus, so the segment it lands on gets checked,
  // as a radio button does. Tab and pointer focus leave the value alone.
  const arrowed = useRef(false);
  const choose = (pressed: string) => {
    // Never report the value that is already checked.
    if (pressed === selected) return;
    setOwn(pressed);
    onValueChange?.(pressed);
  };
  const thumbStyle = {
    "--ouro-segment-count": items.length,
    "--ouro-segment-index": Math.max(index, 0),
    opacity: index === -1 ? 0 : undefined,
  } as CSSProperties;
  return (
    <div data-ouro="segmented-control" className={cn(rootClass, fullWidth && "justify-items-stretch", className)}>
      <span id={labelId} className={cn(labelClass, hideLabel && "sr-only")}>
        {label}
      </span>
      <ToggleGroup
        ref={ref}
        role="radiogroup"
        aria-labelledby={labelId}
        value={selected === undefined ? [] : [selected]}
        onValueChange={(next) => {
          // Pressing the checked segment would leave none checked. Keep it.
          const [pressed] = next;
          if (pressed !== undefined) choose(pressed);
        }}
        onKeyDownCapture={(event) => {
          arrowed.current = /^(Arrow|Home$|End$)/.test(event.key);
          // A key moves the thumb at once; only a pointer slides it.
          event.currentTarget.toggleAttribute("data-ouro-keyboard", true);
        }}
        onPointerDownCapture={(event) => {
          // A pointer press focuses the segment it lands on; that focus is not an arrow key's.
          arrowed.current = false;
          event.currentTarget.toggleAttribute("data-ouro-keyboard", false);
        }}
        onBlurCapture={(event) => {
          // Focus leaving the group (by pointer, say) ends the arrow key's move.
          if (!event.currentTarget.contains(event.relatedTarget)) arrowed.current = false;
        }}
        disabled={disabled}
        className={cn(groupClass, fullWidth && "grid w-full")}
      >
        <span aria-hidden="true" data-ouro-segment-thumb="" className={thumbClass} style={thumbStyle} />
        {items.map((item) => (
          <Toggle
            key={item.value}
            value={item.value}
            disabled={item.disabled}
            data-ouro-segment=""
            data-ouro-control="segmented-control"
            data-ouro-part="segment"
            className={segmentClass}
            // A radio, not a toggle button: pressing the checked one does not uncheck it.
            render={(segmentProps, state) => <button {...segmentProps} role="radio" aria-checked={state.pressed} aria-pressed={undefined} />}
            // The checked segment is the one Tab lands on, as in a radio group.
            tabIndex={item.value === tabStop ? 0 : -1}
            onFocus={() => {
              if (!arrowed.current) return;
              arrowed.current = false;
              choose(item.value);
            }}
          >
            <TouchTarget />
            <span className="relative min-w-0 truncate">{item.label}</span>
          </Toggle>
        ))}
      </ToggleGroup>
      {name !== undefined && <input type="hidden" name={name} value={selected ?? ""} disabled={disabled} />}
    </div>
  );
}
