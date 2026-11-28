"use client";

import { Toggle } from "@base-ui/react/toggle";
import { useEffect, useId, useRef, useState, type CSSProperties, type JSX, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { Tooltip } from "~/components/ouro/tooltip/tooltip";
import { useDisabledReason } from "~/lib/ouro/disabled-reason";
import { TouchTarget } from "~/lib/ouro/touch-target";
import { devThrow, devWarn } from "~/lib/ouro/dev";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import {
  countClass,
  glassGroupClass,
  groupClass,
  iconClass,
  labelClass,
  ownLook,
  revealClass,
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
  /** An icon before the label. With `glass`, an unchecked segment shows only this, and the label stays for screen readers. */
  icon?: ReactNode | undefined;
  /** A count shown in a small pill inside the segment, after the label (unread messages, matches). Shown with the label. */
  count?: number | undefined;
  /** Shows the segment but keeps it from being pressed. */
  disabled?: boolean | undefined;
  /**
   * Why this segment can't be checked now. Turns it off with `aria-disabled`: it stays
   * focusable and the arrow keys land on it without checking it, pressing it does nothing,
   * and the reason shows as its tooltip on hover and keyboard focus and is read as its
   * description. It wins over `disabled`. Pass `undefined` while the segment is available.
   * @example
   * { value: "map", label: "Map", disabledReason: offline ? "Reconnect to see the map" : undefined }
   */
  disabledReason?: string | undefined;
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
  /**
   * Draws the control as a Liquid Glass capsule for a window toolbar, in the theme's glass behind blur, with a glass
   * thumb. The checked segment shows its label and count while the others show their `icon`, so give the segments an
   * `icon`. It turns solid under reduced transparency or more contrast.
   */
  glass?: boolean | undefined;
  /**
   * For a secondary control laid over content, such as a switch on a slide: on a screen with a
   * mouse the control stays transparent, keeping its room, until the pointer rests on it or focus
   * is in it, then fades in. On a touch screen it shows from the start. Screen readers reach it
   * while it is transparent too, and keyboard focus shows it. Pass `false` to show it again, as
   * when the page's controls are turned on.
   * @claim "on a screen with a mouse the" registry/ouro/components/ouro/segmented-control/segmented-control.test.tsx verify:testExists(registry/ouro/components/ouro/segmented-control/segmented-control.test.tsx::SegmentedControl revealOnHover > stays transparent, keeping its room, until the pointer rests on it or focus is in it)
   * @claim "On a touch screen it shows" registry/ouro/components/ouro/segmented-control/segmented-control.touch.test.tsx verify:testExists(registry/ouro/components/ouro/segmented-control/segmented-control.touch.test.tsx::shows a revealOnHover control from the start on a touch screen)
   */
  revealOnHover?: boolean | undefined;
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

/** One segment: a radio-like toggle, soft-disabled with a Tooltip when the item has a `disabledReason`. */
function Segment(props: {
  item: SegmentedControlItem;
  selected: boolean;
  tabStop: boolean;
  disabled: boolean | undefined;
  arrowedRef: { current: boolean };
  choose: (value: string) => void;
  glass: boolean | undefined;
}): JSX.Element {
  const { item, selected, tabStop, disabled, arrowedRef, choose, glass } = props;
  const reason = useDisabledReason(item);
  const segment = (
    <Toggle
      pressed={selected}
      // Pressing the checked segment would leave none checked. Keep it.
      onPressedChange={(next) => {
        // Stryker disable next-line ConditionalExpression,LogicalOperator: only the checked segment reports false, and choose ignores the checked value
        if (next && !reason.off) choose(item.value);
      }}
      disabled={disabled || (item.disabled && !reason.off)}
      {...(reason.off ? { "data-disabled": "" } : {})}
      data-ouro-segment=""
      data-ouro-control="segmented-control"
      data-ouro-part="segment"
      className={segmentClass}
      aria-describedby={reason.describedBy}
      aria-disabled={reason.off || undefined}
      // A radio, not a toggle button: pressing the checked one does not uncheck it.
      render={(segmentProps, state) => <button {...segmentProps} role="radio" aria-checked={state.pressed} aria-pressed={undefined} />}
      // The checked segment is the one Tab lands on, as in a radio group.
      tabIndex={tabStop ? 0 : -1}
      onFocus={() => {
        if (!arrowedRef.current) return;
        arrowedRef.current = false;
        if (!reason.off) choose(item.value);
      }}
    >
      <TouchTarget />
      {item.icon !== undefined && (
        <span aria-hidden="true" data-slot="segmented-control-icon" className={cn(iconClass, glass && !selected && "me-0")}>
          {item.icon}
        </span>
      )}
      {/* sr-only alone: beside relative, which sets position too, the hidden label could stay in the row and push the icon aside. */}
      <span data-slot="segmented-control-label" className={glass && !selected && item.icon !== undefined ? "sr-only" : "relative min-w-0 truncate"}>{item.label}</span>
      {item.count !== undefined && (glass ? selected : true) && (
        <span data-slot="segmented-control-count" className={countClass}>
          {item.count}
        </span>
      )}
      {reason.note}
    </Toggle>
  );
  return reason.wrapped ? <Tooltip content={reason.reason}>{segment}</Tooltip> : segment;
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
 * screens, and `name` submits the value with a form. Keyboard focus stays on the checked
 * segment: when the app checks another one while a segment has focus, focus moves to it, so
 * the ring and the thumb never mark two segments.
 *
 * A switch laid over content can keep out of the way with `revealOnHover`: with a mouse it shows
 * only while the pointer rests on it or focus is in it.
 *
 * Use `Tabs` instead when each choice shows different content with its own panel. Use links
 * in a `<nav>` instead when each choice is its own page. Use a `RadioGroup` instead for a
 * form value that is submitted.
 *
 * @group Navigation
 * @see https://ui.ouroboros.bot/docs/segmented-control
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
 * @claim "Keyboard focus stays on the checked" registry/ouro/components/ouro/segmented-control/segmented-control.test.tsx verify:testExists(registry/ouro/components/ouro/segmented-control/segmented-control.test.tsx::SegmentedControl > moves focus to the segment the app checks, so the ring and the thumb mark one segment)
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
    glass,
    revealOnHover,
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
  // The values this control asked for since focus came in, so one the app checks late, after a
  // quicker key, still counts as the person's own and does not pull focus back.
  const asked = useRef(new Set<string | undefined>());
  const choose = (pressed: string) => {
    // Never report the value that is already checked.
    if (pressed === selected) return;
    asked.current.add(pressed);
    setOwn(pressed);
    onValueChange?.(pressed);
  };
  useEffect(() => {
    // The app checked another segment (a setting changed elsewhere) while a segment has focus:
    // focus follows the check, so the ring is never on a segment beside the thumb's.
    const group = document.activeElement!.closest(`[aria-labelledby="${labelId}"]`);
    if (!group || asked.current.has(selected)) return;
    const checked = group.querySelector<HTMLElement>('[data-ouro-segment][aria-checked="true"]');
    if (checked) checked.focus();
  }, [selected, labelId]);
  // Each label shows whole; when the control has less room than its labels need, they spill out of it, and development says so.
  const spillKey = useRef({});
  useEffect(() => {
    /* istanbul ignore else @preserve -- the else path exists only in production bundles; scripts/dev-strip.test.mjs covers it */
    if (process.env.NODE_ENV !== "production") {
      const group = document.querySelector<HTMLElement>(`[aria-labelledby="${labelId}"]`)!;
      const observer = new ResizeObserver(() => {
        // The group grows to its labels' width; the component's root is the room it has.
        const [need, room] = [group.offsetWidth, group.parentElement!.clientWidth];
        if (need <= room) return;
        // Stryker disable next-line EqualityOperator: of two labels as long as each other, either makes the example
        const longest = items.reduce((a, b) => (b.label.length > a.label.length ? b : a));
        devWarn(
          "SegmentedControl",
          `its labels need ${need}px and it has ${room}px, so they spill out of it`,
          `{ value: "${longest.value}", label: "${longest.label.split(" ")[0]}" }`,
          spillKey.current,
        );
      });
      // The room is the root's width; new labels run this effect again.
      observer.observe(group.parentElement!);
      // Stryker disable next-line ArrowFunction: an observer left on a root that is gone reports nothing more
      return () => observer.disconnect();
    }
  }, [labelId, items]);
  // Roving focus is the control's own, not Base UI's composite, whose mount reads computed style.
  // The arrow keys wrap and follow the way the text runs; Home and End go to the ends.
  const move = (event: KeyboardEvent<HTMLDivElement>): void => {
    const segments = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-ouro-segment]:not(:disabled)"));
    const at = segments.indexOf(event.target as HTMLElement);
    // A key from a segment disabled while it had focus moves nothing.
    if (at === -1) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const rtl = (event.currentTarget.closest("[dir]")?.getAttribute("dir") ?? document.documentElement.dir) === "rtl";
    const step = event.key === "ArrowRight" ? (rtl ? -1 : 1) : event.key === "ArrowLeft" ? (rtl ? 1 : -1) : 0;
    const target =
      event.key === "Home" ? 0 : event.key === "End" ? segments.length - 1 : step ? (at + step + segments.length) % segments.length : -1;
    if (target === -1) return;
    event.preventDefault();
    // Stryker disable next-line OptionalChaining: target is always inside segments
    segments[target]?.focus();
  };
  const thumbStyle = {
    opacity: index === -1 ? 0 : undefined,
  } as CSSProperties;
  return (
    <div data-ouro="segmented-control" className={cn(rootClass, fullWidth && "justify-items-stretch", revealOnHover && revealClass, className)}>
      <span id={labelId} className={cn(labelClass, hideLabel && "sr-only")}>
        {label}
      </span>
      <div
        ref={ref}
        role="radiogroup"
        aria-labelledby={labelId}
        data-orientation="horizontal"
        data-disabled={disabled ? "" : undefined}
        onKeyDown={move}
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
          // It also ends what the person asked for here: a check the app makes after this is its own.
          if (!event.currentTarget.contains(event.relatedTarget)) asked.current.clear();
        }}
        data-glass={glass ? "" : undefined}
        // Stryker disable next-line ConditionalExpression,LogicalOperator: fullWidth is tested on the plain group; the glass class sets its own look
        className={cn(groupClass, glass && glassGroupClass, fullWidth && "grid w-full")}
      >
        <span aria-hidden="true" data-ouro-segment-thumb="" className={thumbClass} style={thumbStyle} />
        {items.map((item) => (
          <Segment
            key={item.value}
            item={item}
            selected={item.value === selected}
            tabStop={item.value === tabStop}
            disabled={disabled}
            arrowedRef={arrowed}
            choose={choose}
            glass={glass}
          />
        ))}
      </div>
      {name !== undefined && <input type="hidden" name={name} value={selected ?? ""} disabled={disabled} />}
    </div>
  );
}
