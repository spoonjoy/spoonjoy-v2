"use client";

import { Radio as BaseRadio } from "@base-ui/react/radio";
import { RadioGroup as BaseRadioGroup } from "@base-ui/react/radio-group";
import type { JSX, ReactNode, Ref } from "react";
import { Field } from "~/components/ouro/field/field";
import { choicesClass, contractWarnings } from "~/components/ouro/field/field-styles";
import { devThrow } from "~/lib/ouro/dev";
import { TouchTarget } from "~/lib/ouro/touch-target";
import { FieldOwnerContext, useField, type ErrorMessages } from "~/lib/ouro/use-field";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { dotClass, radioClass } from "~/components/ouro/radio-group/radio-group-styles";

/** One choice in a {@link RadioGroup}'s `options`. */
export interface RadioGroupOption {
  /** What the group submits when this choice is picked, and the group's `value` then. */
  value: string;
  /** The choice's name, shown to the right of its radio. */
  label: string;
  /** Supporting text under the label, read after it. */
  description?: ReactNode | undefined;
  /** Disables this one radio; the arrow keys skip it. */
  disabled?: boolean | undefined;
}

/** The props RadioGroup takes whichever way its choices are given. */
export interface RadioGroupOwnProps {
  /**
   * What is being chosen, shown above the choices and read as the group's name. Required: a
   * group of controls needs a name. To hide it visually, keep it and add `hideLegend`.
   */
  legend: string;
  /** Hides the legend visually; screen readers still read it as the group's name. */
  hideLegend?: boolean | undefined;
  /** Supporting text under the legend, read after it through `aria-describedby`. */
  description?: ReactNode | undefined;
  /**
   * What is wrong, from your server action or client check, shown under the choices; every
   * radio gets `aria-invalid`. A message is text or a React node (one with a link); an empty string or array means valid.
   */
  error?: ErrorMessages | undefined;
  /** A choice must be picked to submit the form: the group gets `aria-required`, and the legend a marker. */
  required?: boolean | undefined;
  /** Disables every radio and fades the group. */
  disabled?: boolean | undefined;
  /** The form field name the chosen value submits under. */
  name?: string | undefined;
  /** The chosen value, for a controlled group; pair it with `onValueChange`. */
  value?: string | undefined;
  /** The value chosen at first, for an uncontrolled group. Unset, nothing is chosen. */
  defaultValue?: string | undefined;
  /** Called with the chosen value when another radio is picked. */
  onValueChange?: ((value: string) => void) | undefined;
  /** `vertical` stacks the choices; `horizontal` puts short ones in a row that wraps. @default "vertical" */
  orientation?: "vertical" | "horizontal" | undefined;
  /**
   * Layout only: margins, width, grid placement (`mt-4`, `col-span-2`). Appearance classes
   * warn in development; style radios in your theme.
   */
  className?: string | undefined;
  /** The group element, a `<div role="radiogroup">`. */
  ref?: Ref<HTMLDivElement> | undefined;

  /** Not a prop. A group is named by its `legend`: `<RadioGroup legend="Size">`. */
  label?: { 'Use <RadioGroup legend="Size">': never };
  /** Not a prop. Ouro UI uses `onValueChange`, which gets the chosen value: `onValueChange={setSize}`. */
  onChange?: { 'Use onValueChange={setValue}': never };
  /** Not a prop. Ouro UI uses `options`: `options={[{ value: "small", label: "Small" }]}`. */
  items?: { 'Use options={[{ value: "small", label: "Small" }]}': never };
  /** Not a prop. Ouro UI uses `error`: `<RadioGroup error="Required.">`. */
  errorMessage?: { 'Use <RadioGroup error="Required.">': never };
  /** Not a prop. Ouro UI uses `description`: `<RadioGroup description="...">`. */
  helperText?: { 'Use <RadioGroup description="...">': never };
  /** Not a prop. `error` marks the group invalid: `<RadioGroup error="What is wrong">`. */
  isInvalid?: { 'Use <RadioGroup error="What is wrong">': never };
  /** Not a prop. `error` marks the group invalid: `<RadioGroup error="What is wrong">`. */
  invalid?: { 'Use <RadioGroup error="What is wrong">': never };
  /** Not a prop. Ouro UI uses `required`: `<RadioGroup required>`. */
  isRequired?: { 'Use <RadioGroup required>': never };
  /** Not a prop. Ouro UI uses `disabled`: `<RadioGroup disabled>`. */
  isDisabled?: { 'Use <RadioGroup disabled>': never };
}

/** Props for {@link RadioGroup}: the choices as `options`, or as `Radio` children, not both. */
export type RadioGroupProps = RadioGroupOwnProps &
  (
    | {
        /** The choices, one radio each, in order. */
        options: RadioGroupOption[];
        /** Not with `options`: pass the choices one way. */
        children?: never;
      }
    | {
        /** The choices as `Radio` elements, for a layout `options` cannot express. */
        children: ReactNode;
        /** Not with children: pass the choices one way. */
        options?: never;
      }
  );

/** Props for {@link Radio}. */
export interface RadioProps {
  /** What the group submits when this radio is picked, and the group's `value` then. */
  value: string;
  /** The choice's name, shown to the right of the radio. Required: every control needs a name. */
  label: string;
  /** Hides the label visually; screen readers still read it as the radio's name. */
  hideLabel?: boolean | undefined;
  /** Supporting text under the label, read after it through `aria-describedby`. */
  description?: ReactNode | undefined;
  /** Disables this one radio; the arrow keys skip it. */
  disabled?: boolean | undefined;
  /** Layout only: margins, width, grid placement. Appearance classes warn in development. */
  className?: string | undefined;
  /** The radio element, a `<span role="radio">`. */
  ref?: Ref<HTMLElement> | undefined;

  /** Not a prop. The group's `value` picks the radio: `<RadioGroup value="small">`. */
  checked?: { 'Use <RadioGroup value="small">': never };
  /** Not a prop. The group's `name` applies to every radio: `<RadioGroup name="size">`. */
  name?: { 'Use <RadioGroup name="size">': never };
}

/** Field's messages and root name RadioGroup, and use the label as the group's legend. */
const groupOwner = { name: "RadioGroup", data: "radio-group", layout: "group" } as const;
/** Field's messages and root name Radio, and put the radio before its label. */
const radioOwner = { name: "Radio", data: "radio", layout: "inline" } as const;

/** The radio, inside its Field item: it takes its name and description ids from the field. */
function RadioCircle({ value, ref }: { value: string; ref: Ref<HTMLElement> | undefined }): JSX.Element {
  const field = useField()!;
  return (
    <BaseRadio.Root
      value={value}
      ref={ref}
      // Set here, not left to Base UI's effects, so the server HTML names and describes the radio.
      aria-labelledby={field.labelId}
      aria-describedby={field.describedBy}
      aria-invalid={field.invalid || undefined}
      className={radioClass}
    >
      <TouchTarget />
      <BaseRadio.Indicator keepMounted data-ouro-radio-dot="" className={dotClass} />
    </BaseRadio.Root>
  );
}

/**
 * One choice in a `RadioGroup`, with its label to its right. Pass the choices as the group's
 * `options` unless you need a layout they cannot express, such as a choice with a rich
 * description; then render `Radio` children.
 *
 * Use `Checkbox` inside a `CheckboxGroup` instead when several choices may be picked.
 *
 * @group Forms
 * @example
 * <RadioGroup legend="Size" name="size">
 *   <Radio value="small" label="Small" description="Serves 2." />
 *   <Radio value="large" label="Large" description="Serves 6." />
 * </RadioGroup>
 */
export function Radio(props: RadioProps): JSX.Element {
  const { value, label, hideLabel, description, disabled, className, ref, checked, name } = props;
  if (useField()?.group !== "RadioGroup") {
    devThrow(
      "Radio",
      "must be rendered inside <RadioGroup>",
      process.env.NODE_ENV !== "production"
        ? `<RadioGroup legend="Size"><Radio value="${value}" label="${label}" /></RadioGroup>`
        : /* istanbul ignore next @preserve -- production only */ "",
    );
  }
  useDevWarnings(
    "Radio",
    process.env.NODE_ENV !== "production"
      ? () => [checked !== undefined && ["checked is not a prop; the group's value picks the radio", `<RadioGroup value="${value}">`]]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  return (
    <FieldOwnerContext.Provider value={radioOwner}>
      {/* `name` reaches Field only so it can point the misuse to the group. */}
      <Field label={label} hideLabel={hideLabel} description={description} disabled={disabled} name={name as string | undefined} className={className}>
        <RadioCircle value={value} ref={ref} />
      </Field>
    </FieldOwnerContext.Provider>
  );
}

/** The group, inside the Field: it takes its name, description and required state from the field. */
function Choices(props: {
  value: string | undefined;
  defaultValue: string | undefined;
  onValueChange: ((value: string) => void) | undefined;
  orientation: "vertical" | "horizontal";
  ref: Ref<HTMLDivElement> | undefined;
  children: ReactNode;
}): JSX.Element {
  const { value, defaultValue, onValueChange, orientation, ref, children } = props;
  const field = useField()!;
  return (
    <BaseRadioGroup
      ref={ref}
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange && ((next) => onValueChange(next as string))}
      required={field.required}
      // Set here, not left to Base UI's effects, so the server HTML names and describes the group.
      aria-labelledby={field.labelId}
      aria-describedby={field.describedBy}
      className={choicesClass[orientation]}
    >
      {children}
    </BaseRadioGroup>
  );
}

/**
 * A group of radios under one legend, on the Field contract, for picking exactly one
 * choice: pass `legend`, and `options` (or `Radio` children). The group is one tab stop;
 * the arrow keys move between radios and pick as they go. With `name`, the chosen value
 * submits as `name=value` with its form. `error` and `required` apply to the whole group.
 *
 * Use `CheckboxGroup` instead when several choices may be picked, `Select` for a long list,
 * and `Switch` for on or off.
 *
 * @group Forms
 * @see https://ourostack.github.io/ouro-ui/docs/radio-group
 *
 * @example
 * <RadioGroup
 *   legend="Size"
 *   name="size"
 *   defaultValue="medium"
 *   options={[
 *     { value: "small", label: "Small", description: "Serves 2." },
 *     { value: "medium", label: "Medium", description: "Serves 4." },
 *   ]}
 * />
 */
export function RadioGroup(props: RadioGroupProps): JSX.Element {
  const {
    legend,
    hideLegend,
    description,
    error,
    required,
    disabled,
    name,
    value,
    defaultValue,
    onValueChange,
    orientation = "vertical",
    options,
    children,
    className,
    ref,
    // Guard props (hint types), dropped here so they never reach the DOM.
    label,
    onChange,
    items,
    errorMessage,
    helperText,
    isInvalid,
    invalid,
    isRequired,
    isDisabled,
  } = props;
  if (options !== undefined && children !== undefined) {
    devThrow(
      "RadioGroup",
      "takes options or Radio children, not both",
      process.env.NODE_ENV !== "production"
        ? `<RadioGroup legend="${legend}" options={options} />, or <RadioGroup legend="${legend}"><Radio value="small" label="Small" /></RadioGroup>`
        : /* istanbul ignore next @preserve -- production only */ "",
    );
  }

  useDevWarnings(
    "RadioGroup",
    process.env.NODE_ENV !== "production"
      ? () => [
          ...contractWarnings("RadioGroup", { errorMessage, helperText, isInvalid, invalid, isRequired, isDisabled }),
          label !== undefined && ["label is not a prop; a group is named by its legend", `<RadioGroup legend="${String(label)}">`],
          onChange !== undefined && ["onChange is not a prop; onValueChange gets the chosen value", "<RadioGroup onValueChange={(value) => setValue(value)}>"],
          items !== undefined && ["items is not a prop", '<RadioGroup options={[{ value: "small", label: "Small" }]}>'],
          value !== undefined && !onValueChange && ["value without onValueChange never changes", "<RadioGroup value={value} onValueChange={setValue}>, or defaultValue"],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );

  return (
    <FieldOwnerContext.Provider value={groupOwner}>
      <Field
        label={legend}
        hideLabel={hideLegend}
        description={description}
        error={error}
        required={required}
        disabled={disabled}
        name={name}
        className={className}
      >
        <Choices value={value} defaultValue={defaultValue} onValueChange={onValueChange} orientation={orientation} ref={ref}>
          {options
            ? options.map((option) => (
                <Radio key={option.value} value={option.value} label={option.label} description={option.description} disabled={option.disabled} />
              ))
            : children}
        </Choices>
      </Field>
    </FieldOwnerContext.Provider>
  );
}
