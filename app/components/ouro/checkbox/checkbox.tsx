"use client";

import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import type { JSX, ReactNode, Ref } from "react";
import { Field } from "~/components/ouro/field/field";
import { contractWarnings } from "~/components/ouro/field/field-styles";
import { devThrow } from "~/lib/ouro/dev";
import { controlRef } from "~/lib/ouro/control-ref";
import { TouchTarget } from "~/lib/ouro/touch-target";
import { FieldOwnerContext, useField, type ReadonlyErrorMessages } from "~/lib/ouro/use-field";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { boxClass, dashClass, indicatorClass, tickClass } from "~/components/ouro/checkbox/checkbox-styles";

/** Props for {@link Checkbox}. */
export interface CheckboxProps {
  /**
   * What checking it means, shown to the right of the box and read as its name. Required:
   * every control needs a name. To hide it visually, keep it and add `hideLabel`.
   */
  label: string;
  /** Hides the label visually; screen readers still read it as the checkbox's name. */
  hideLabel?: boolean | undefined;
  /** Supporting text under the label, read after it through `aria-describedby`. */
  description?: ReactNode | undefined;
  /**
   * What is wrong, from your server action or client check, shown under the label; the box
   * gets `aria-invalid`. A message is text or a React node (one with a link); an empty string or array means valid. In a `CheckboxGroup`, pass it
   * to the group.
   */
  error?: ReadonlyErrorMessages | undefined;
  /**
   * The box must be checked to submit the form (accepting terms): it gets `required` and
   * `aria-required`, and the label a marker. In a `CheckboxGroup`, pass it to the group.
   */
  required?: boolean | undefined;
  /** Disables the checkbox and fades it. */
  disabled?: boolean | undefined;
  /** The form field name it submits under when checked. In a `CheckboxGroup`, the group's `name` applies. */
  name?: string | undefined;
  /**
   * What a checked box submits (`on` without one). In a `CheckboxGroup`, it identifies the
   * box in the group's `value`, so it is required there.
   */
  value?: string | undefined;
  /** Whether it is checked, for a controlled checkbox; pair it with `onCheckedChange`. */
  checked?: boolean | undefined;
  /** Whether it starts checked, for an uncontrolled checkbox. */
  defaultChecked?: boolean | undefined;
  /** Called with the new state when it is checked or unchecked. */
  onCheckedChange?: ((checked: boolean) => void) | undefined;
  /**
   * Shows a dash and announces "mixed": neither checked nor unchecked, as a "select all" box
   * does when some of its items are checked. It is controlled: a click does not clear it, so
   * clear it in `onCheckedChange`, as in
   * `<Checkbox indeterminate={some} checked={all} onCheckedChange={toggleAll}>`. The box
   * submits only while `checked`.
   */
  indeterminate?: boolean | undefined;
  /** Shows the state but ignores clicks and keys, unlike `disabled`, which also fades it. */
  readOnly?: boolean | undefined;
  /**
   * Layout only: margins, width, grid placement (`mt-4`, `col-span-2`). Appearance classes
   * warn in development; style checkboxes in your theme.
   */
  className?: string | undefined;
  /** The box element, a `<span role="checkbox">`. */
  ref?: Ref<HTMLElement> | undefined;

  /** Not a prop. Ouro UI uses `onCheckedChange`, which gets the new state: `onCheckedChange={setChecked}`. */
  onChange?: { 'Use onCheckedChange={setChecked}': never };
  /** Not a prop. Ouro UI uses `checked`: `<Checkbox checked={agreed}>`. */
  isChecked?: { 'Use <Checkbox checked={agreed}>': never };
  /** Not a prop. Ouro UI uses `indeterminate`: `<Checkbox indeterminate>`. */
  isIndeterminate?: { 'Use <Checkbox indeterminate>': never };
  /** Not a prop. A checkbox's starting state is `defaultChecked`: `<Checkbox defaultChecked>`. */
  defaultValue?: { 'Use <Checkbox defaultChecked>': never };
  /** Not a prop. Ouro UI uses `error`: `<Checkbox error="Required.">`. */
  errorMessage?: { 'Use <Checkbox error="Required.">': never };
  /** Not a prop. Ouro UI uses `description`: `<Checkbox description="...">`. */
  helperText?: { 'Use <Checkbox description="...">': never };
  /** Not a prop. `error` marks the checkbox invalid: `<Checkbox error="What is wrong">`. */
  isInvalid?: { 'Use <Checkbox error="What is wrong">': never };
  /** Not a prop. `error` marks the checkbox invalid: `<Checkbox error="What is wrong">`. */
  invalid?: { 'Use <Checkbox error="What is wrong">': never };
  /** Not a prop. Ouro UI uses `required`: `<Checkbox required>`. */
  isRequired?: { 'Use <Checkbox required>': never };
  /** Not a prop. Ouro UI uses `disabled`: `<Checkbox disabled>`. */
  isDisabled?: { 'Use <Checkbox disabled>': never };
}

/** Field's messages and root name Checkbox, and put the box before its label. */
const owner = { name: "Checkbox", data: "checkbox", layout: "inline" } as const;
/** Marks the hidden input Base UI submits the box with. */
const markInput = controlRef("checkbox", "hidden-input");

/** The box, inside the Field: it takes its name, description and error ids from the field. */
function CheckboxBox(props: {
  value: string | undefined;
  checked: boolean | undefined;
  defaultChecked: boolean | undefined;
  onCheckedChange: ((checked: boolean) => void) | undefined;
  indeterminate: boolean | undefined;
  readOnly: boolean | undefined;
  ref: Ref<HTMLElement> | undefined;
}): JSX.Element {
  const { onCheckedChange, ...rest } = props;
  const field = useField()!;
  return (
    <BaseCheckbox.Root
      {...rest}
      inputRef={markInput}
      data-ouro-control="checkbox"
      data-ouro-part="box"
      onCheckedChange={onCheckedChange && ((checked) => onCheckedChange(checked))}
      required={field.required}
      // Set here, not left to Base UI's effects, so the server HTML names and describes the box.
      aria-labelledby={field.labelId}
      aria-describedby={field.describedBy}
      aria-invalid={field.invalid || undefined}
      className={boxClass}
    >
      <TouchTarget />
      <BaseCheckbox.Indicator keepMounted className={indicatorClass}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-full">
          <path d="M3.5 8.5 6.5 11.5 12.5 4.5" pathLength={1} data-ouro-part="tick" className={tickClass} />
          <path d="M4 8h8" className={dashClass} />
        </svg>
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );
}

/**
 * A labeled checkbox on the Field contract, with the label to its right: pass `label`, and
 * `checked` with `onCheckedChange` (or `defaultChecked`). Clicking the label toggles it,
 * Space toggles it from the keyboard, the box fills and the tick draws, and `indeterminate` shows a
 * dash announced as "mixed". With `name`, a checked box submits `name=value` with its form.
 *
 * Use `CheckboxGroup` instead for several choices under one legend that submit together,
 * `Switch` for a setting that applies at once, and `RadioGroup` when only one choice may be picked.
 *
 * @group Forms
 * @see https://ourostack.github.io/ouro-ui/docs/checkbox
 *
 * @example
 * <Checkbox label="Email me new recipes" name="newsletter" defaultChecked />
 * <Checkbox label="I accept the terms" name="terms" required error={errors?.terms} />
 */
export function Checkbox(props: CheckboxProps): JSX.Element {
  const {
    label,
    hideLabel,
    description,
    error,
    required,
    disabled,
    name,
    value,
    checked,
    defaultChecked,
    onCheckedChange,
    indeterminate,
    readOnly,
    className,
    ref,
    // Guard props (hint types), dropped here so they never reach the DOM.
    onChange,
    isChecked,
    isIndeterminate,
    defaultValue,
    errorMessage,
    helperText,
    isInvalid,
    invalid,
    isRequired,
    isDisabled,
  } = props;
  const group = useField()?.group;
  if (group === "RadioGroup") {
    devThrow(
      "Checkbox",
      "a RadioGroup takes Radio choices",
      process.env.NODE_ENV !== "production"
        ? `<RadioGroup legend="Size"><Radio value="small" label="${label}" /></RadioGroup>, or a CheckboxGroup for several choices`
        : /* istanbul ignore next @preserve -- production only */ "",
    );
  }

  useDevWarnings(
    "Checkbox",
    process.env.NODE_ENV !== "production"
      ? () => [
          ...contractWarnings("Checkbox", { errorMessage, helperText, isInvalid, invalid, isRequired, isDisabled }),
          onChange !== undefined && ["onChange is not a prop; onCheckedChange gets the new state", "<Checkbox onCheckedChange={(checked) => setChecked(checked)}>"],
          isChecked !== undefined && ["isChecked is not a prop", `<Checkbox checked={${String(isChecked)}}>`],
          isIndeterminate !== undefined && ["isIndeterminate is not a prop", "<Checkbox indeterminate>"],
          defaultValue !== undefined && ["defaultValue is not a prop; a checkbox starts checked with defaultChecked", "<Checkbox defaultChecked>"],
          group !== undefined && value === undefined && [`a checkbox in a ${group} needs a value`, `<Checkbox value="basil" label="${label}" />`],
          checked !== undefined && !onCheckedChange && !readOnly && ["checked without onCheckedChange never changes", "<Checkbox checked={checked} onCheckedChange={setChecked}>, or defaultChecked"],
          indeterminate &&
            !onCheckedChange &&
            !readOnly &&
            !disabled && [
            "indeterminate without onCheckedChange stays mixed after a click while the box submits as checked",
            "<Checkbox indeterminate={some} checked={all} onCheckedChange={toggleAll}>",
          ],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );

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
        <CheckboxBox
          value={value}
          checked={checked}
          defaultChecked={defaultChecked}
          onCheckedChange={onCheckedChange}
          indeterminate={indeterminate}
          readOnly={readOnly}
          ref={ref}
        />
      </Field>
    </FieldOwnerContext.Provider>
  );
}
