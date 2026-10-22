"use client";

import { Switch as BaseSwitch } from "@base-ui/react/switch";
import type { JSX, ReactNode, Ref } from "react";
import { Field } from "~/components/ouro/field/field";
import { contractWarnings } from "~/components/ouro/field/field-styles";
import { devThrow } from "~/lib/ouro/dev";
import { controlRef } from "~/lib/ouro/control-ref";
import { TouchTarget } from "~/lib/ouro/touch-target";
import { FieldOwnerContext, useField, type ReadonlyErrorMessages } from "~/lib/ouro/use-field";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { thumbClass, trackClass } from "~/components/ouro/switch/switch-styles";

/** Props for {@link Switch}. */
export interface SwitchProps {
  /**
   * The setting it turns on, shown to the right of the switch and read as its name.
   * Required: every control needs a name. To hide it visually, keep it and add `hideLabel`.
   * @claim "Required: every control needs a name" registry/ouro/components/ouro/switch/switch.test-d.ts verify:fileLine(registry/ouro/components/ouro/switch/switch.test-d.ts, /expectTypeOf<\{\schecked:\strue\s\}>\(\)\.not\.toExtend<SwitchProps>/)
   */
  label: string;
  /** Hides the label visually; screen readers still read it as the switch's name. */
  hideLabel?: boolean | undefined;
  /** Supporting text under the label, read after it through `aria-describedby`. */
  description?: ReactNode | undefined;
  /**
   * What is wrong, from your server action or client check, shown under the label; the
   * switch gets `aria-invalid`. A message is text or a React node (one with a link); an empty string or array means valid.
   */
  error?: ReadonlyErrorMessages | undefined;
  /** The switch must be on to submit the form: it gets `required` and `aria-required`, and the label a marker. */
  required?: boolean | undefined;
  /** Disables the switch and fades it. */
  disabled?: boolean | undefined;
  /** The form field name it submits under when on. */
  name?: string | undefined;
  /** What it submits when on (`on` without one). */
  value?: string | undefined;
  /** Whether it is on, for a controlled switch; pair it with `onCheckedChange`. */
  checked?: boolean | undefined;
  /** Whether it starts on, for an uncontrolled switch. */
  defaultChecked?: boolean | undefined;
  /** Called with the new state when it turns on or off. */
  onCheckedChange?: ((checked: boolean) => void) | undefined;
  /** Shows the state but ignores clicks and keys, unlike `disabled`, which also fades it. */
  readOnly?: boolean | undefined;
  /**
   * Layout only: margins, width, grid placement (`mt-4`, `col-span-2`). Appearance classes
   * warn in development; style switches in your theme.
   */
  className?: string | undefined;
  /** The track element, a `<span role="switch">`. */
  ref?: Ref<HTMLElement> | undefined;

  /** Not a prop. Ouro UI uses `onCheckedChange`, which gets the new state: `onCheckedChange={setOn}`. */
  onChange?: { 'Use onCheckedChange={setChecked}': never };
  /** Not a prop. Ouro UI uses `checked`: `<Switch checked={on}>`. */
  isChecked?: { 'Use <Switch checked={on}>': never };
  /** Not a prop. A switch's starting state is `defaultChecked`: `<Switch defaultChecked>`. */
  defaultValue?: { 'Use <Switch defaultChecked>': never };
  /** Not a prop. Ouro UI uses `error`: `<Switch error="Required.">`. */
  errorMessage?: { 'Use <Switch error="Required.">': never };
  /** Not a prop. Ouro UI uses `description`: `<Switch description="...">`. */
  helperText?: { 'Use <Switch description="...">': never };
  /** Not a prop. `error` marks the switch invalid: `<Switch error="What is wrong">`. */
  isInvalid?: { 'Use <Switch error="What is wrong">': never };
  /** Not a prop. `error` marks the switch invalid: `<Switch error="What is wrong">`. */
  invalid?: { 'Use <Switch error="What is wrong">': never };
  /** Not a prop. Ouro UI uses `required`: `<Switch required>`. */
  isRequired?: { 'Use <Switch required>': never };
  /** Not a prop. Ouro UI uses `disabled`: `<Switch disabled>`. */
  isDisabled?: { 'Use <Switch disabled>': never };
}

/** Field's messages and root name Switch, and put the switch before its label. */
const owner = { name: "Switch", data: "switch", layout: "inline" } as const;
/** Marks the hidden input Base UI submits the switch with. */
const markInput = controlRef("switch", "hidden-input");

/** The track and thumb, inside the Field: they take their name, description and error ids from the field. */
function SwitchTrack(props: {
  value: string | undefined;
  checked: boolean | undefined;
  defaultChecked: boolean | undefined;
  onCheckedChange: ((checked: boolean) => void) | undefined;
  readOnly: boolean | undefined;
  ref: Ref<HTMLElement> | undefined;
}): JSX.Element {
  const { onCheckedChange, ...rest } = props;
  const field = useField()!;
  return (
    <BaseSwitch.Root
      {...rest}
      inputRef={markInput}
      data-ouro-control="switch"
      data-ouro-part="track"
      onCheckedChange={onCheckedChange && ((checked) => onCheckedChange(checked))}
      required={field.required}
      // Set here, not left to Base UI's effects, so the server HTML names and describes the switch.
      aria-labelledby={field.labelId}
      aria-describedby={field.describedBy}
      aria-invalid={field.invalid || undefined}
      className={trackClass}
    >
      <TouchTarget />
      <BaseSwitch.Thumb data-ouro-switch-thumb="" className={thumbClass} />
    </BaseSwitch.Root>
  );
}

/**
 * A labeled on/off switch on the Field contract, with the label to its right: pass `label`,
 * and `checked` with `onCheckedChange` (or `defaultChecked`). Clicking the label or pressing
 * Space flips it; the thumb slides and stretches while pressed. With
 * `name`, a switch that is on submits `name=value` with its form.
 *
 * Use it for a setting that takes effect at once. Use `Checkbox` instead for a choice that
 * applies when a form is submitted, such as accepting terms.
 *
 * @group Forms
 * @see https://ourostack.github.io/ouro-ui/docs/switch
 *
 * @example
 * <Switch label="Wi-Fi" checked={wifi} onCheckedChange={setWifi} />
 * <Switch label="Nightly backups" name="backups" description="At 2 a.m." defaultChecked />
 */
export function Switch(props: SwitchProps): JSX.Element {
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
    readOnly,
    className,
    ref,
    // Guard props (hint types), dropped here so they never reach the DOM.
    onChange,
    isChecked,
    defaultValue,
    errorMessage,
    helperText,
    isInvalid,
    invalid,
    isRequired,
    isDisabled,
  } = props;
  const group = useField()?.group;
  if (group !== undefined) {
    const choice = group === "RadioGroup" ? "Radio" : "Checkbox";
    devThrow(
      "Switch",
      `a ${group} takes ${choice} choices`,
      process.env.NODE_ENV !== "production"
        ? `<${choice} value="${String(label).toLowerCase()}" label="${label}" />, or put the Switch outside the group`
        : /* istanbul ignore next @preserve -- production only */ "",
    );
  }

  useDevWarnings(
    "Switch",
    process.env.NODE_ENV !== "production"
      ? () => [
          ...contractWarnings("Switch", { errorMessage, helperText, isInvalid, invalid, isRequired, isDisabled }),
          onChange !== undefined && ["onChange is not a prop; onCheckedChange gets the new state", "<Switch onCheckedChange={(checked) => setOn(checked)}>"],
          isChecked !== undefined && ["isChecked is not a prop", `<Switch checked={${String(isChecked)}}>`],
          defaultValue !== undefined && ["defaultValue is not a prop; a switch starts on with defaultChecked", "<Switch defaultChecked>"],
          checked !== undefined && !onCheckedChange && !readOnly && ["checked without onCheckedChange never changes", "<Switch checked={on} onCheckedChange={setOn}>, or defaultChecked"],
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
        <SwitchTrack value={value} checked={checked} defaultChecked={defaultChecked} onCheckedChange={onCheckedChange} readOnly={readOnly} ref={ref} />
      </Field>
    </FieldOwnerContext.Provider>
  );
}
