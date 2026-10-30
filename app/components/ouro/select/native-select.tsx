"use client";

import type { JSX, ReactNode, Ref, SelectHTMLAttributes } from "react";
import { Field } from "~/components/ouro/field/field";
import { FieldControl, type FieldControlProps } from "~/components/ouro/field/field-parts";
import { contractWarnings } from "~/components/ouro/field/field-styles";
import { FieldOwnerContext, type ReadonlyErrorMessages } from "~/lib/ouro/use-field";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";

/** One choice: the `value` it submits and the `label` it shows. */
export interface NativeSelectOption {
  /** What the form submits. */
  value: string;
  /** What the picker shows. */
  label: string;
  /** The option shows but cannot be chosen. */
  disabled?: boolean | undefined;
}

/** A labeled group of options, an `<optgroup>`. */
export interface NativeSelectOptionGroup {
  /** The group's heading. */
  label: string;
  /** The options in the group. */
  options: NativeSelectOption[];
}

/** The props NativeSelect adds to the `<select>` attributes it passes through. */
export interface NativeSelectOwnProps {
  /**
   * What the select is for, shown above it and read as its name. Required: every control
   * needs a name. To hide it visually, keep it and add `hideLabel`.
   * @claim "Required: every control needs a name" registry/ouro/components/ouro/select/native-select.test-d.ts verify:fileLine(registry/ouro/components/ouro/select/native-select.test-d.ts, /expectTypeOf<\{\sname:\s"country"\s\}>\(\)\.not\.toExtend<NativeSelectProps>/)
   */
  label: string;
  /** Hides the label visually; screen readers still read it as the select's name. */
  hideLabel?: boolean | undefined;
  /** Supporting text under the label, read after the label through `aria-describedby`. */
  description?: ReactNode | undefined;
  /**
   * What is wrong, from your server action or client check. The message (or several, as a
   * list) shows under the select, which gets `aria-invalid`. A message is text or a React node (one with a link); an empty string or array means valid.
   */
  error?: ReadonlyErrorMessages | undefined;
  /** A choice is required: the form will not submit without one, and the label gets a marker. */
  required?: boolean | undefined;
  /** Disables the select and fades it. */
  disabled?: boolean | undefined;
  /** The form field name the value submits under. */
  name?: string | undefined;
  /**
   * An empty first option shown, muted, while nothing is chosen: `"Choose a country"`. With
   * `required` it cannot be chosen back, so the browser asks for a real choice.
   */
  placeholder?: string | undefined;
  /**
   * The choices: `[{ value: "nz", label: "New Zealand" }]`, and groups as
   * `{ label: "Oceania", options: [...] }`. Or pass `<option>` children.
   */
  options?: ReadonlyArray<NativeSelectOption | NativeSelectOptionGroup> | undefined;
  /** `<option>` and `<optgroup>` elements, when you do not pass `options`. */
  children?: ReactNode;
  /**
   * Layout only: margins, width, grid placement (`mt-4`, `col-span-2`). Appearance classes
   * warn in development; style fields in your theme.
   */
  className?: string | undefined;
  /** The select element. */
  ref?: Ref<HTMLSelectElement> | undefined;

  /**
   * Not supported by NativeSelect. A native multiple select is hard to use; use `<Select multiple>`.
   *
   * @claim "Not supported by NativeSelect" registry/ouro/components/ouro/select/native-select.test-d.ts verify:fileLine(registry/ouro/components/ouro/select/native-select.test-d.ts, /expectTypeOf<\{\slabel:\s"Tags";\smultiple:\strue\s\}>\(\)\.not\.toExtend<NativeSelectProps>/)
   */
  multiple?: { 'Use <Select multiple>': never };
  /** Not a prop. For several values use `<Select multiple>`. */
  isMulti?: { 'Use <Select multiple>': never };
  /** Not a prop. Ouro UI uses `error`: `<NativeSelect error="Required.">`. */
  errorMessage?: { 'Use <NativeSelect error="Required.">': never };
  /** Not a prop. Ouro UI uses `description`: `<NativeSelect description="...">`. */
  helperText?: { 'Use <NativeSelect description="...">': never };
  /** Not a prop. `error` marks the select invalid: `<NativeSelect error="What is wrong">`. */
  isInvalid?: { 'Use <NativeSelect error="What is wrong">': never };
  /** Not a prop. `error` marks the select invalid: `<NativeSelect error="What is wrong">`. */
  invalid?: { 'Use <NativeSelect error="What is wrong">': never };
  /** Not a prop. Ouro UI uses `required`: `<NativeSelect required>`. */
  isRequired?: { 'Use <NativeSelect required>': never };
  /** Not a prop. Ouro UI uses `disabled`: `<NativeSelect disabled>`. */
  isDisabled?: { 'Use <NativeSelect disabled>': never };
}

/**
 * Props for {@link NativeSelect}: its own props and the `<select>` attributes it passes
 * through, including `onChange` (the event) and `onValueChange` (the value).
 */
export type NativeSelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, keyof NativeSelectOwnProps | "onChange"> &
  Pick<FieldControlProps, "onValueChange"> & {
    /** Called with the change event when the user picks an option. `onValueChange` gets the value. */
    onChange?: SelectHTMLAttributes<HTMLSelectElement>["onChange"] | undefined;
  } & NativeSelectOwnProps;

/** Field's messages and root name NativeSelect. */
const owner = { name: "NativeSelect", data: "native-select" };

/**
 * The select: Field's control look (44px tall with a 16px font on phones, so iOS does not
 * zoom; 36px and 14px from `sm` with a fine pointer), with room for the chevron at the end.
 * The placeholder option shows muted while it is chosen.
 * @claim "The select: Field's control look (44px" registry/ouro/components/ouro/select/select.test.tsx verify:testExists(registry/ouro/components/ouro/select/select.test.tsx::Select > is 36px tall with a fine pointer from sm up, with 32px options)
 * @claim "The select: Field's control look (44px" registry/ouro/components/ouro/select/native-select.test.tsx verify:testExists(registry/ouro/components/ouro/select/native-select.test.tsx::NativeSelect > is 36px tall with a fine pointer from sm up)
 * @claim "The select: Field's control look (44px" registry/ouro/components/ouro/select/select.touch.test.tsx verify:testExists(registry/ouro/components/ouro/select/select.touch.test.tsx::keeps 44px controls and 16px text on a landscape phone, where the list opens by the trigger)
 */
const selectClass =
  "m-0 box-border block w-full min-w-0 h-(--ouro-control-h) ps-3 pe-9 py-0 appearance-none " +
  "[--ouro-control-h:calc(var(--spacing)*11)] sm:pointer-fine:[--ouro-control-h:calc(var(--spacing)*9)] " +
  "rounded-md border border-solid border-input bg-transparent text-base text-foreground sm:pointer-fine:text-sm " +
  "font-[inherit] cursor-pointer [-webkit-tap-highlight-color:transparent] " +
  "outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid " +
  "transition-[border-color] duration-(--ouro-duration-fast) ease-[ease] " +
  "pointer-fine:hover:not-disabled:border-ring/60 aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50 " +
  "dark:bg-input/30 [&:has(option[value='']:checked)]:text-muted-foreground [&_option]:bg-popover [&_option]:text-popover-foreground dark:scheme-dark";

/** The chevron at the end of the box, drawn in the muted text color; presses go to the select. */
function ChevronIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
    >
      <path d="M4.5 6.5L8 10l3.5-3.5" />
    </svg>
  );
}

/**
 * A labeled native `<select>` on the Field contract: pass `label`, `options` (or `<option>`
 * children) and `error`. Phones open the operating system's own picker (a wheel on iOS, a
 * list on Android), which is quick for long plain-text lists such as countries, and works
 * before JavaScript loads.
 *
 * Use `Select` instead for a styled list (icons, groups with headings, several values with
 * `multiple`), and `RadioGroup` for two to five choices that should all show.
 *
 * @group Forms
 * @see https://ui.ouro.bot/docs/native-select
 *
 * @example
 * <NativeSelect
 *   label="Country"
 *   name="country"
 *   autoComplete="country"
 *   placeholder="Choose a country"
 *   options={[{ value: "nz", label: "New Zealand" }, { value: "za", label: "South Africa" }]}
 *   error={errors?.country}
 * />
 */
export function NativeSelect(props: NativeSelectProps): JSX.Element {
  const {
    label,
    hideLabel,
    description,
    error,
    required,
    disabled,
    name,
    placeholder,
    options,
    children,
    className,
    ref,
    // Guard props (hint types), dropped here so they never reach the DOM.
    multiple,
    isMulti,
    errorMessage,
    helperText,
    isInvalid,
    invalid,
    isRequired,
    isDisabled,
    ...rest
  } = props;

  const hasChildren = children !== undefined && children !== null && children !== false;
  useDevWarnings(
    "NativeSelect",
    process.env.NODE_ENV !== "production"
      ? () => [
          multiple !== undefined && [
            "multiple is not supported; a native multiple select is hard to use",
            `<Select label="${label}" multiple options={options} />`,
          ],
          isMulti !== undefined && ["isMulti is not a prop", `<Select label="${label}" multiple options={options} />`],
          ...contractWarnings("NativeSelect", { errorMessage, helperText, isInvalid, invalid, isRequired, isDisabled }),
          options !== undefined &&
            hasChildren && ["options and children are both set, so the children are ignored", `<NativeSelect label="${label}" options={options} />`],
          options === undefined &&
            !hasChildren && [
              "there are no options to choose from",
              `<NativeSelect label="${label}" options={[{ value: "nz", label: "New Zealand" }]} />`,
            ],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );

  // A placeholder is chosen at first unless the app chose a value.
  const start = placeholder !== undefined && rest.value === undefined && rest.defaultValue === undefined ? { defaultValue: "" } : {};

  return (
    <FieldOwnerContext.Provider value={owner}>
      <Field
        label={label}
        hideLabel={hideLabel}
        description={description}
        error={error}
        required={required}
        disabled={disabled}
        name={name}
        className={className}
      >
        <div className="relative">
          <FieldControl
            {...(rest as Omit<FieldControlProps, "className">)}
            {...start}
            ref={ref as Ref<HTMLInputElement> | undefined}
            render={(controlProps) => (
              <select {...(controlProps as SelectHTMLAttributes<HTMLSelectElement>)} data-ouro-control="native-select" data-ouro-part="select" className={selectClass}>
                {placeholder !== undefined && (
                  <option value="" disabled={required}>
                    {placeholder}
                  </option>
                )}
                {options
                  ? options.map((entry) =>
                      "options" in entry ? (
                        <optgroup key={`group:${entry.label}`} label={entry.label}>
                          {entry.options.map((option) => (
                            <option key={option.value} value={option.value} disabled={option.disabled}>
                              {option.label}
                            </option>
                          ))}
                        </optgroup>
                      ) : (
                        <option key={entry.value} value={entry.value} disabled={entry.disabled}>
                          {entry.label}
                        </option>
                      ),
                    )
                  : children}
              </select>
            )}
          />
          <ChevronIcon />
        </div>
      </Field>
    </FieldOwnerContext.Provider>
  );
}
