"use client";

import { CheckboxGroup as BaseCheckboxGroup } from "@base-ui/react/checkbox-group";
import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode, type Ref } from "react";
import { Checkbox } from "~/components/ouro/checkbox/checkbox";
import { Field } from "~/components/ouro/field/field";
import { choicesClass, contractWarnings } from "~/components/ouro/field/field-styles";
import { devThrow } from "~/lib/ouro/dev";
import { useMergedRef } from "~/lib/ouro/refs";
import { FieldOwnerContext, useField, type ErrorMessages } from "~/lib/ouro/use-field";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";

/** One choice in a {@link CheckboxGroup}'s `options`. */
export interface CheckboxGroupOption {
  /** What the box submits, and its entry in the group's `value`. */
  value: string;
  /** The choice's name, shown to the right of its box. */
  label: string;
  /** Supporting text under the label, read after it. */
  description?: ReactNode | undefined;
  /** Disables this one box. */
  disabled?: boolean | undefined;
}

/** The props CheckboxGroup takes whichever way its choices are given. */
export interface CheckboxGroupOwnProps {
  /**
   * What the group is, shown above the choices and read as the group's name. Required: a
   * group of controls needs a name. To hide it visually, keep it and add `hideLegend`.
   */
  legend: string;
  /** Hides the legend visually; screen readers still read it as the group's name. */
  hideLegend?: boolean | undefined;
  /** Supporting text under the legend, read after it through `aria-describedby`. */
  description?: ReactNode | undefined;
  /**
   * What is wrong, from your server action or client check, shown under the choices; every
   * box gets `aria-invalid`. A message is text or a React node (one with a link); an empty string or array means valid.
   */
  error?: ErrorMessages | undefined;
  /**
   * At least one box must be checked to submit the form: the legend gets a marker (and
   * `requiredLabel` for screen readers), and the browser shows `requiredMessage` until one is
   * checked. HTML has no native "at least one" rule for checkboxes, so this check runs only
   * once the page has hydrated: your server action must still check it.
   */
  required?: boolean | undefined;
  /** What the browser says when `required` and nothing is checked. Translate it here. @default "Choose at least one." */
  requiredMessage?: string | undefined;
  /**
   * What screen readers hear after the legend when `required`, since no box can carry
   * `aria-required`; the asterisk is what shows. Translate it here. @default "(required)"
   */
  requiredLabel?: string | undefined;
  /** Disables every box and fades the group. */
  disabled?: boolean | undefined;
  /** The form field name every checked box submits under, once per checked value. */
  name?: string | undefined;
  /** The checked values, for a controlled group; pair it with `onValueChange`. */
  value?: string[] | undefined;
  /** The values checked at first, for an uncontrolled group. */
  defaultValue?: string[] | undefined;
  /** Called with every checked value, in the order they were checked, when one is checked or unchecked. */
  onValueChange?: ((value: string[]) => void) | undefined;
  /**
   * Layout only: margins, width, grid placement (`mt-4`, `col-span-2`). Appearance classes
   * warn in development; style checkboxes in your theme.
   */
  className?: string | undefined;
  /** The group element, a `<div role="group">`. */
  ref?: Ref<HTMLDivElement> | undefined;

  /** Not a prop. A group is named by its `legend`: `<CheckboxGroup legend="Herbs">`. */
  label?: { 'Use <CheckboxGroup legend="Herbs">': never };
  /** Not a prop. Ouro UI uses `onValueChange`, which gets the checked values: `onValueChange={setValues}`. */
  onChange?: { 'Use onValueChange={setValues}': never };
  /** Not a prop. Ouro UI uses `options`: `options={[{ value: "basil", label: "Basil" }]}`. */
  items?: { 'Use options={[{ value: "basil", label: "Basil" }]}': never };
  /** Not a prop. Ouro UI uses `error`: `<CheckboxGroup error="Required.">`. */
  errorMessage?: { 'Use <CheckboxGroup error="Required.">': never };
  /** Not a prop. Ouro UI uses `description`: `<CheckboxGroup description="...">`. */
  helperText?: { 'Use <CheckboxGroup description="...">': never };
  /** Not a prop. `error` marks the group invalid: `<CheckboxGroup error="What is wrong">`. */
  isInvalid?: { 'Use <CheckboxGroup error="What is wrong">': never };
  /** Not a prop. `error` marks the group invalid: `<CheckboxGroup error="What is wrong">`. */
  invalid?: { 'Use <CheckboxGroup error="What is wrong">': never };
  /** Not a prop. Ouro UI uses `required`: `<CheckboxGroup required>`. */
  isRequired?: { 'Use <CheckboxGroup required>': never };
  /** Not a prop. Ouro UI uses `disabled`: `<CheckboxGroup disabled>`. */
  isDisabled?: { 'Use <CheckboxGroup disabled>': never };
}

/**
 * Props for {@link CheckboxGroup}: the choices as `options`, or as `Checkbox` children, not
 * both.
 */
export type CheckboxGroupProps = CheckboxGroupOwnProps &
  (
    | {
        /** The choices, one box each, in order. */
        options: CheckboxGroupOption[];
        /** Not with `options`: pass the choices one way. */
        children?: never;
      }
    | {
        /** The choices as `Checkbox` elements, each with a `value`, for a layout `options` cannot express. */
        children: ReactNode;
        /** Not with children: pass the choices one way. */
        options?: never;
      }
  );

/** Field's messages and root name CheckboxGroup, and use the label as the group's legend. */
const owner = { name: "CheckboxGroup", data: "checkbox-group", layout: "group" } as const;

/** The group, inside the Field: it takes its name and description ids from the field. */
function Choices(props: {
  value: string[] | undefined;
  defaultValue: string[] | undefined;
  onValueChange: ((value: string[]) => void) | undefined;
  requiredMessage: string;
  ref: Ref<HTMLDivElement> | undefined;
  children: ReactNode;
}): JSX.Element {
  const { value, defaultValue, onValueChange, requiredMessage, ref, children } = props;
  const field = useField()!;
  const [uncontrolled, setUncontrolled] = useState(defaultValue ?? []);
  const checked = value ?? uncontrolled;
  const groupRef = useRef<HTMLDivElement>(null);
  const setRef = useMergedRef(ref, groupRef);

  // A checkbox group has no native `required`, so the first enabled box carries the message
  // while nothing is checked: the form does not submit, and the browser points at the group.
  const missing = field.required && checked.length === 0;
  useEffect(() => {
    const inputs = [...groupRef.current!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    const first = inputs.find((input) => !input.disabled);
    for (const input of inputs) input.setCustomValidity(missing && input === first ? requiredMessage : "");
  });

  return (
    <BaseCheckboxGroup
      ref={setRef}
      value={value}
      defaultValue={defaultValue}
      onValueChange={(next) => {
        setUncontrolled(next);
        onValueChange?.(next);
      }}
      // Set here, not left to Base UI's effects, so the server HTML names and describes the group.
      aria-labelledby={field.labelId}
      aria-describedby={field.describedBy}
      className={choicesClass.vertical}
    >
      {children}
    </BaseCheckboxGroup>
  );
}

/**
 * A group of checkboxes under one legend, on the Field contract, for picking any number of
 * choices: pass `legend`, and `options` (or `Checkbox` children). `value` is the list of
 * checked values; with `name`, each checked box submits `name=value` with its form.
 * `error` and `required` apply to the whole group.
 *
 * Use `RadioGroup` instead when exactly one choice may be picked, `Checkbox` for a single
 * yes-or-no choice, and `Fieldset` to group different fields.
 *
 * @group Forms
 * @see https://ourostack.github.io/ouro-ui/docs/checkbox-group
 *
 * @example
 * <CheckboxGroup
 *   legend="Herbs"
 *   name="herbs"
 *   defaultValue={["basil"]}
 *   options={[
 *     { value: "basil", label: "Basil", description: "Sweet and peppery." },
 *     { value: "mint", label: "Mint" },
 *   ]}
 * />
 */
export function CheckboxGroup(props: CheckboxGroupProps): JSX.Element {
  const {
    legend,
    hideLegend,
    description,
    error,
    required,
    requiredMessage = "Choose at least one.",
    requiredLabel = "(required)",
    disabled,
    name,
    value,
    defaultValue,
    onValueChange,
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
      "CheckboxGroup",
      "takes options or Checkbox children, not both",
      process.env.NODE_ENV !== "production"
        ? `<CheckboxGroup legend="${legend}" options={options} />, or <CheckboxGroup legend="${legend}"><Checkbox value="basil" label="Basil" /></CheckboxGroup>`
        : /* istanbul ignore next @preserve -- production only */ "",
    );
  }

  const groupOwner = useMemo(() => ({ ...owner, requiredLabel }), [requiredLabel]);

  useDevWarnings(
    "CheckboxGroup",
    process.env.NODE_ENV !== "production"
      ? () => [
          ...contractWarnings("CheckboxGroup", { errorMessage, helperText, isInvalid, invalid, isRequired, isDisabled }),
          label !== undefined && ["label is not a prop; a group is named by its legend", `<CheckboxGroup legend="${String(label)}">`],
          onChange !== undefined && ["onChange is not a prop; onValueChange gets the checked values", "<CheckboxGroup onValueChange={(values) => setValues(values)}>"],
          items !== undefined && ["items is not a prop", '<CheckboxGroup options={[{ value: "basil", label: "Basil" }]}>'],
          value !== undefined && !onValueChange && ["value without onValueChange never changes", "<CheckboxGroup value={values} onValueChange={setValues}>, or defaultValue"],
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
        <Choices value={value} defaultValue={defaultValue} onValueChange={onValueChange} requiredMessage={requiredMessage} ref={ref}>
          {options
            ? options.map((option) => (
                <Checkbox key={option.value} value={option.value} label={option.label} description={option.description} disabled={option.disabled} />
              ))
            : children}
        </Choices>
      </Field>
    </FieldOwnerContext.Provider>
  );
}
