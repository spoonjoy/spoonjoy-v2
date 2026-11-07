"use client";

import { useId, useState, type ChangeEvent, type JSX, type ReactNode, type Ref } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { errorMessages, type ReadonlyErrorMessages } from "~/lib/ouro/use-field";

/** One card in a {@link ChoiceCard}'s `items`. */
export interface ChoiceCardItem {
  /** What the group submits when this card is chosen, and its `value` then. */
  value: string;
  /** The choice's name, under its media. */
  label: string;
  /** Supporting text under the label, read after it. */
  description?: ReactNode | undefined;
  /**
   * A picture of the choice above its label, such as `<img src={cover} alt="" />`: give it
   * `alt=""` when the label says what it shows. It fills the card's width.
   */
  media?: ReactNode | undefined;
  /** Disables this one card; the arrow keys skip it. */
  disabled?: boolean | undefined;
}

/** Props for {@link ChoiceCard}. */
export interface ChoiceCardProps {
  /** What is being chosen, above the cards and read as the group's name. */
  legend: string;
  /** Keeps the legend for screen readers only, when a heading above already says it. */
  hideLegend?: boolean | undefined;
  /** Supporting text under the legend, read with the group. */
  description?: ReactNode | undefined;
  /** The choices. */
  items: readonly ChoiceCardItem[];
  /** The chosen value, for a controlled group; pair it with `onValueChange`. */
  value?: string | undefined;
  /** The value chosen at first, for an uncontrolled group. */
  defaultValue?: string | undefined;
  /** Called with the value of the card the person chooses. */
  onValueChange?: ((value: string) => void) | undefined;
  /** The form field name the chosen value submits under. */
  name?: string | undefined;
  /**
   * What is wrong, shown under the cards in the destructive tone and read with each choice.
   *
   * @claim "What is wrong, shown under the" registry/ouro/components/ouro/choice-card/choice-card.test.tsx verify:testExists(registry/ouro/components/ouro/choice-card/choice-card.test.tsx::ChoiceCard > shows an error under the cards, read with each choice, and marks them invalid)
   */
  error?: ReadonlyErrorMessages | undefined;
  /** A choice must be made before the form submits; the legend shows the required mark. */
  required?: boolean | undefined;
  /**
   * Disables every card.
   *
   * @claim "Disables every card" registry/ouro/components/ouro/choice-card/choice-card.test.tsx verify:testExists(registry/ouro/components/ouro/choice-card/choice-card.test.tsx::ChoiceCard > disables every card, or one)
   */
  disabled?: boolean | undefined;
  /**
   * How many cards a row holds on a wide screen; on a phone each row holds one, or two with
   * `columns` of 3 or more. @default 3
   * @claim "How many cards a row holds" registry/ouro/components/ouro/choice-card/choice-card.touch.test.tsx verify:testExists(registry/ouro/components/ouro/choice-card/choice-card.touch.test.tsx::gives each card and each photo button a 44px target, and stacks the cards on a phone)
   * @claim "How many cards a row holds" registry/ouro/components/ouro/choice-card/choice-card.test.tsx verify:fileLine(registry/ouro/components/ouro/choice-card/choice-card.test.tsx, /puts\s%s\scards\sin\sa\srow\son\sa\swide\sscreen\sand\sfewer\son\sa\sphone/)
   */
  columns?: 2 | 3 | 4 | (number & { 'Use 2, 3 or 4': never }) | undefined;
  /** Layout only: margins, width (`mt-6`). Appearance classes warn in development. */
  className?: string | undefined;
  ref?: Ref<HTMLFieldSetElement> | undefined;

  /** Not a prop. The choices are `items`: `<ChoiceCard items={[{ value, label, media }]} />`. */
  options?: { 'Use items={[{ value, label, media }]}': never };
  /** Not a prop. The group's name is `legend`: `<ChoiceCard legend="Cover photo" />`. */
  label?: { 'Use <ChoiceCard legend="Cover photo" />': never };
  /** Not a prop. Ouro UI says `onValueChange`: `<ChoiceCard onValueChange={setCover} />`. */
  onChange?: { 'Use onValueChange={setValue}': never };
}

const columnClasses = {
  2: "sm:grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
} as const;

const cardClass =
  "group/card relative flex min-h-11 min-w-0 cursor-pointer flex-col overflow-hidden rounded-lg border border-solid border-border bg-background text-foreground " +
  "transition-[background-color,border-color] duration-(--ouro-duration-fast) ease-[ease] " +
  "data-checked:border-primary data-checked:bg-primary/5 " +
  "pointer-fine:hover:not-data-checked:not-data-disabled:border-[color-mix(in_oklab,var(--border)_50%,var(--foreground))] " +
  "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-solid has-focus-visible:outline-ring " +
  "data-disabled:cursor-not-allowed data-disabled:opacity-50 data-invalid:not-data-checked:border-destructive " +
  "contrast-more:data-checked:border-2";

/**
 * A set of choices shown as cards, each with a picture, a label and a line of description,
 * for picking exactly one: a cover photo, a plan, a layout. The cards are a native radio group
 * under a legend, so the arrow keys move between them, a plain form submits the chosen value,
 * and screen readers hear "Cover photo, radio group" and each card's label and description.
 * The chosen card takes the primary color and a check.
 *
 * Use `RadioGroup` instead for plain text choices, `SegmentedControl` for two to five short
 * options that switch a view, and `Select` for a long list.
 *
 * @group Forms
 * @see https://ui.ouro.bot/docs/choice-card
 *
 * @example
 * <ChoiceCard
 *   legend="Cover photo"
 *   name="cover"
 *   items={photos.map((photo) => ({ value: photo.id, label: photo.title, media: <img src={photo.url} alt="" /> }))}
 * />
 * @claim "A set of choices shown as" registry/ouro/components/ouro/choice-card/choice-card.test.tsx verify:testExists(registry/ouro/components/ouro/choice-card/choice-card.test.tsx::ChoiceCard > is a group named by its legend, of radios named by their labels and described by their descriptions)
 * @claim "The cards are a native radio" registry/ouro/components/ouro/choice-card/choice-card.test.tsx verify:testExists(registry/ouro/components/ouro/choice-card/choice-card.test.tsx::ChoiceCard > moves between cards with the arrow keys, as a radio group does)
 * @claim "The cards are a native radio" registry/ouro/components/ouro/choice-card/choice-card.test.tsx verify:testExists(registry/ouro/components/ouro/choice-card/choice-card.test.tsx::ChoiceCard > is a group named by its legend, of radios named by their labels and described by their descriptions)
 * @claim "The cards are a native radio" registry/ouro/components/ouro/choice-card/choice-card.test.tsx verify:testExists(registry/ouro/components/ouro/choice-card/choice-card.test.tsx::ChoiceCard > submits the chosen value under its name)
 */
export function ChoiceCard(props: ChoiceCardProps): JSX.Element {
  const {
    legend,
    hideLegend,
    description,
    items,
    value,
    defaultValue,
    onValueChange,
    name,
    error,
    required,
    disabled,
    columns: columnsProp = 3,
    className,
    ref,
    // Guard props (hint types), dropped here so they never reach the DOM.
    options,
    label,
    onChange,
  } = props;
  const columns: 2 | 3 | 4 = columnsProp === 2 ? 2 : columnsProp === 4 ? 4 : 3;
  useAppearanceClassNameCheck(
    "ChoiceCard",
    className,
    process.env.NODE_ENV !== "production"
      ? (token: string) => `remove "${token}"; ChoiceCard sets its own look from the theme`
      : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "ChoiceCard",
    process.env.NODE_ENV !== "production"
      ? () => [
          columns !== columnsProp && [`columns={${String(columnsProp)}} is not a column count; use 2, 3 or 4`, "<ChoiceCard columns={3} />"],
          options !== undefined && ["options is not a prop", "<ChoiceCard items={[{ value, label, media }]} />"],
          label !== undefined && ["label is not a prop; the group's name is legend", `<ChoiceCard legend="${typeof label === "string" ? label : "Cover photo"}" />`],
          onChange !== undefined && ["onChange is not a prop", "<ChoiceCard onValueChange={setValue} />"],
          new Set(items.map((item) => item.value)).size !== items.length && ["two items share a value, so they choose together", "<ChoiceCard items={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} />"],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  const id = useId();
  const group = name ?? id;
  const [own, setOwn] = useState(defaultValue);
  const chosen = value !== undefined ? value : own;
  const messages = errorMessages(error);
  const invalid = messages.length > 0;
  const describedBy = [description != null ? `${id}-description` : null, invalid ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    setOwn(event.target.value);
    onValueChange?.(event.target.value);
  };

  return (
    <fieldset
      ref={ref}
      data-ouro="choice-card"
      disabled={disabled}
      aria-labelledby={`${id}-legend`}
      aria-describedby={describedBy}
      className={cn("[@layer_ouro-reset]:m-0 grid min-w-0 gap-3 border-0 p-0", className)}
    >
      <legend
        data-ouro-legend=""
        data-ouro-required={required ? "" : undefined}
        className={cn(
          "p-0 text-sm leading-5 font-medium text-foreground",
          // The mark sits outside the text the group is named by, so it never joins the name.
          "data-ouro-required:after:ms-0.5 data-ouro-required:after:font-medium data-ouro-required:after:text-destructive data-ouro-required:after:content-['*'] supports-[content:'*'_/_'']:data-ouro-required:after:content-['*'_/_'']",
          hideLegend ? "sr-only" : "mb-1",
        )}
      >
        <span id={`${id}-legend`}>{legend}</span>
      </legend>
      {description != null ? (
        <div id={`${id}-description`} className="text-sm leading-5 text-muted-foreground">
          {description}
        </div>
      ) : null}
      <div className={cn("grid gap-3", columnClasses[columns])}>
        {items.map((item, index) => {
          const checked = chosen === item.value;
          const key = `${id}-${index}`;
          const off = disabled || item.disabled;
          return (
            <label
              key={`${index}:${item.value}`}
              data-ouro-part="card"
              data-checked={checked ? "" : undefined}
              data-disabled={off ? "" : undefined}
              data-invalid={invalid ? "" : undefined}
              className={cardClass}
            >
              <input
                data-ouro-control="choice-card"
                data-ouro-part="input"
                type="radio"
                name={group}
                value={item.value}
                checked={checked}
                onChange={choose}
                disabled={off}
                required={required}
                aria-invalid={invalid || undefined}
                aria-labelledby={`${key}-label`}
                aria-describedby={[item.description != null ? `${key}-description` : "", invalid ? `${id}-error` : ""].join(" ").trim() || undefined}
                className="peer sr-only"
              />
              {item.media != null ? (
                <span className="block aspect-[4/3] w-full overflow-hidden bg-muted [&>img]:block [&>img]:size-full [&>img]:object-cover">{item.media}</span>
              ) : null}
              <span className="grid gap-0.5 p-3 pe-10">
                <span id={`${key}-label`} className="text-sm leading-5 font-medium">
                  {item.label}
                </span>
                {item.description != null ? (
                  // Mixed toward the foreground: the chosen card's tint is a muted surface.
                  <span id={`${key}-description`} className="text-sm leading-5 text-[color-mix(in_oklab,var(--muted-foreground)_80%,var(--foreground))]">
                    {item.description}
                  </span>
                ) : null}
              </span>
              <span
                aria-hidden="true"
                className="absolute end-2 bottom-2.5 flex size-6 items-center justify-center rounded-full border border-solid border-border bg-background text-transparent group-data-checked/card:border-primary group-data-checked/card:bg-primary group-data-checked/card:text-primary-foreground"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </span>
            </label>
          );
        })}
      </div>
      {invalid ? (
        <div id={`${id}-error`} className="grid gap-1 text-sm leading-5 text-destructive">
          {messages.map((message, index) => (
            <p key={index} className="m-0">
              {message}
            </p>
          ))}
        </div>
      ) : null}
    </fieldset>
  );
}
