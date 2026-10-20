"use client";

import { useId, useState, type JSX, type ReactNode, type Ref } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { devThrow } from "~/lib/ouro/dev";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { useMediaQuery } from "~/lib/ouro/use-media-query";
import {
  TabsIndicator,
  TabsList,
  TabsPanel,
  TabsRootUnchecked,
  TabsTab,
} from "~/components/ouro/tabs/tabs-parts";
import {
  activations,
  orientations,
  ownLook,
  type TabsActivation,
  type TabsOrientation,
} from "~/components/ouro/tabs/tabs-styles";

export type { TabsActivation, TabsOrientation } from "~/components/ouro/tabs/tabs-styles";

/** One tab and its panel. */
export interface TabsItem {
  /** Identifies the tab: `value`, `defaultValue` and `onValueChange` use it. Unique within the tabs. */
  value: string;
  /** The tab's text. Keep it short: one or two words. */
  label: ReactNode;
  /** What the panel shows while this tab is selected. */
  content: ReactNode;
  /** Shows the tab but keeps it from being selected. */
  disabled?: boolean | undefined;
}

/** Props for {@link Tabs}. */
export interface TabsProps {
  /**
   * Names the tab list for screen readers ("Recipe sections"). It is not shown: the tabs'
   * own labels are the visible text.
   */
  label: string;
  /** The tabs, in order, each with the panel it shows. */
  items: readonly TabsItem[];
  /** The selected tab's value, when you control it. Pair it with `onValueChange`. */
  value?: string | undefined;
  /** The tab selected first, when the component keeps its own state. @default the first enabled item */
  defaultValue?: string | undefined;
  /** Called with the new tab's value when the person selects a tab. */
  onValueChange?: ((value: string) => void) | undefined;
  /**
   * `horizontal` puts the tabs in a row above the panel; `vertical` in a column beside it,
   * from the `sm` breakpoint (640px) up, and in a row on a phone. The arrow keys follow:
   * left and right in a row, up and down in a column.
   * @default "horizontal"
   */
  orientation?: TabsOrientation | (string & { 'Use "horizontal" or "vertical"': never }) | undefined;
  /**
   * How the keyboard selects a tab. `automatic` selects it as soon as the arrow keys focus it,
   * which suits panels that show at once. `manual` moves focus only and waits for Enter or
   * Space, for panels that load slowly.
   * @default "automatic"
   */
  activation?: TabsActivation | (string & { 'Use "automatic" or "manual"': never }) | undefined;
  /** Layout only: margins, width, grid placement (`mt-6`). Appearance classes warn in development. */
  className?: string | undefined;
  ref?: Ref<HTMLDivElement> | undefined;

  /** Not a prop. Ouro UI uses `onValueChange`, which gets the tab's value: `<Tabs onValueChange={(value) => …}>`. */
  onChange?: { 'Use <Tabs onValueChange={(value) => ...}>': never };
  /** Not a prop. Ouro UI uses `activation`: `<Tabs activation="manual">`. */
  activateOnFocus?: { 'Use <Tabs activation="automatic"> or activation="manual"': never };
  /** Not a prop. Ouro UI uses `items`: `<Tabs items={[{ value, label, content }]}>`. */
  tabs?: { 'Use <Tabs items={[{ value, label, content }]}>': never };
}

/** The first value that appears twice, or undefined. Development only. */
function duplicateValue(items: readonly TabsItem[]): string | undefined {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.value)) return item.value;
    seen.add(item.value);
  }
  return undefined;
}

/**
 * Tabs that switch between panels in place: an accessible tab list with roving focus,
 * arrow-key navigation, a line that slides to the selected tab, and
 * 44px tabs on touch screens. Pass the tabs and their panels as `items`.
 *
 * Use `SegmentedControl` instead when the choice changes how one view looks (list or grid)
 * rather than which content shows. Use links in a nav instead when each tab is its own
 * page with its own URL. Use the parts in `tabs-parts` when `items` cannot express your
 * layout.
 *
 * @group Navigation
 * @see https://ourostack.github.io/ouro-ui/docs/tabs
 *
 * @example
 * <Tabs
 *   label="Recipe"
 *   items={[
 *     { value: "ingredients", label: "Ingredients", content: <IngredientList /> },
 *     { value: "method", label: "Method", content: <Steps /> },
 *   ]}
 * />
 */
export function Tabs(props: TabsProps): JSX.Element {
  const {
    label,
    items,
    value,
    defaultValue,
    onValueChange,
    orientation: orientationProp = "horizontal",
    activation: activationProp = "automatic",
    className,
    ref,
    // Guard props (hint types), dropped here so they never reach the DOM.
    onChange,
    activateOnFocus,
    tabs,
  } = props;
  // An orientation or activation that is not one of Ouro UI's (a type error) warns and renders the default.
  const orientation = orientations.includes(orientationProp as TabsOrientation) ? (orientationProp as TabsOrientation) : "horizontal";
  const activation = activations.includes(activationProp as TabsActivation) ? (activationProp as TabsActivation) : "automatic";
  useAppearanceClassNameCheck(
    "Tabs",
    className,
    process.env.NODE_ENV !== "production" ? ownLook("Tabs") : /* istanbul ignore next @preserve -- production only */ "",
  );
  const duplicate = duplicateValue(items);
  if (duplicate !== undefined) {
    // Two tabs with one value would select together and loop Base UI's bookkeeping.
    devThrow(
      "Tabs",
      `two items have the value "${duplicate}"`,
      process.env.NODE_ENV !== "production" ? "give each item its own value" : /* istanbul ignore next @preserve -- production only */ "",
    );
  }
  useDevWarnings(
    "Tabs",
    process.env.NODE_ENV !== "production"
      ? () => {
          const known = (candidate: string | undefined) => candidate === undefined || items.some((item) => item.value === candidate);
          const first = items[0]?.value ?? "…";
          return [
            orientation !== orientationProp && [
              `orientation="${String(orientationProp)}" is not an orientation; use ${orientations.map((name) => `"${name}"`).join(", ")}`,
              '<Tabs orientation="horizontal">',
            ],
            activation !== activationProp && [
              `activation="${String(activationProp)}" is not an activation; use ${activations.map((name) => `"${name}"`).join(", ")}`,
              '<Tabs activation="automatic">',
            ],
            onChange !== undefined && ["onChange is not a prop", "<Tabs onValueChange={(value) => …}>"],
            activateOnFocus !== undefined && [
              "activateOnFocus is not a prop",
              `<Tabs activation="${activateOnFocus === (false as unknown) ? "manual" : "automatic"}">`,
            ],
            tabs !== undefined && ["tabs is not a prop", "<Tabs items={[{ value, label, content }]}>"],
            !known(defaultValue) && [`defaultValue="${defaultValue}" matches no item`, `<Tabs defaultValue="${first}">`],
            !known(value) && [`value="${value}" matches no item`, `<Tabs value="${first}">`],
          ];
        }
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  // A column of tabs squeezes the panel on a phone: below the sm breakpoint it becomes a row.
  // Wide in server HTML, so a desktop page does not shift.
  const wide = useMediaQuery("(min-width: 640px)", true);
  const shown = orientation === "vertical" && !wide ? "horizontal" : orientation;
  // Start on the first enabled tab, also in server HTML, where Base UI cannot see which tabs are disabled.
  const [own, setOwn] = useState(() => defaultValue ?? items.find((item) => !item.disabled)?.value ?? null);
  const selected = value !== undefined ? value : own;
  // Ids from useId, so the tab and its panel name each other in server HTML too (Base UI
  // links them only after it mounts). Only the selected panel is mounted, so only the
  // selected tab points at one.
  const id = useId();
  return (
    <TabsRootUnchecked
      ref={ref}
      orientation={shown}
      value={selected}
      onValueChange={(next: string) => {
        setOwn(next);
        onValueChange?.(next);
      }}
      className={className}
    >
      <TabsList aria-label={label} activateOnFocus={activation === "automatic"}>
        {items.map((item, index) => (
          <TabsTab
            key={item.value}
            value={item.value}
            disabled={item.disabled}
            id={`${id}tab${index}`}
            aria-controls={item.value === selected ? `${id}panel${index}` : undefined}
          >
            {item.label}
          </TabsTab>
        ))}
        <TabsIndicator />
      </TabsList>
      {items.map((item, index) => (
        <TabsPanel key={item.value} value={item.value} id={`${id}panel${index}`} aria-labelledby={`${id}tab${index}`}>
          {item.content}
        </TabsPanel>
      ))}
    </TabsRootUnchecked>
  );
}
