"use client";

import { Switch as BaseSwitch } from "@base-ui/react/switch";
import type { JSX, ReactNode, Ref } from "react";
import { cn } from "~/lib/ouro/cn";
import { Field } from "~/components/ouro/field/field";
import { contractWarnings } from "~/components/ouro/field/field-styles";
import { devThrow } from "~/lib/ouro/dev";
import { controlRef } from "~/lib/ouro/control-ref";
import { useDisabledReason } from "~/lib/ouro/disabled-reason";
import { TouchTarget } from "~/lib/ouro/touch-target";
import { FieldOwnerContext, useField, type ReadonlyErrorMessages } from "~/lib/ouro/use-field";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { Tooltip } from "~/components/ouro/tooltip/tooltip";
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
  /**
   * Why the switch can't be changed now. Passing a reason turns it off without taking it out of the
   * tab order: it gets `aria-disabled`, clicks and keys do nothing, focus still reaches it, and
   * the reason shows as its tooltip on hover and focus and is read through `aria-describedby`.
   * Pass `undefined` while it can be changed: it keeps its place and focus as it turns off and on.
   * It wins over `disabled`. Use `disabled` alone when no reason is needed.
   * @example
   * <Switch label="Wi-Fi" disabledReason={locked ? "Ask an admin to unlock this" : undefined} />
   */
  disabledReason?: string | undefined;
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
  /**
   * Ids of other elements that describe the switch, a hint elsewhere on the page. They join the
   * switch's own description and error, each id once, and never replace them.
   * @claim "They join the switch's own description" registry/ouro/components/ouro/switch/switch.test.tsx verify:testExists(registry/ouro/components/ouro/switch/switch.test.tsx::Switch in a row > merges a given aria-describedby with its own description, each id once, and passes an accessibility audit)
   */
  "aria-describedby"?: string | undefined;
  /** Shows the state but ignores clicks and keys, unlike `disabled`, which also fades it. */
  readOnly?: boolean | undefined;
  /**
   * Layout only: margins, width, grid placement (`mt-4`, `col-span-2`). Appearance classes
   * warn in development; style switches in your theme.
   */
  className?: string | undefined;
  /** The track element, a `<button role="switch">`, which the label names with `for`. */
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

/** Joins the ids of the given lists into one space-separated value, leaving out repeats and blanks. */
function mergeIds(...lists: (string | undefined)[]): string | undefined {
  // Stryker disable next-line Regex: the empty strings a looser split leaves are deleted on the next line
  const ids = new Set(lists.join(" ").split(/\s+/));
  ids.delete("");
  return [...ids].join(" ") || undefined;
}

function SwitchTrack(props: {
  value: string | undefined;
  checked: boolean | undefined;
  defaultChecked: boolean | undefined;
  onCheckedChange: ((checked: boolean) => void) | undefined;
  readOnly: boolean | undefined;
  describedBy: string | undefined;
  disabledProps: { disabledReason?: string | undefined } | { [key: string]: never };
  ref: Ref<HTMLElement> | undefined;
}): JSX.Element {
  const { onCheckedChange, describedBy, disabledProps, readOnly, ...rest } = props;
  const field = useField()!;
  const reason = useDisabledReason(disabledProps, mergeIds(field.describedBy, describedBy));
  const track = (
    <BaseSwitch.Root
      {...rest}
      readOnly={readOnly || reason.off}
      // A real button, so the label's `for` names it and not the hidden input: its label finds one control.
      nativeButton
      render={<button />}
      inputRef={markInput}
      data-ouro-control="switch"
      data-ouro-part="track"
      onCheckedChange={onCheckedChange && ((checked) => onCheckedChange(checked))}
      required={field.required}
      // Set here, not left to Base UI's effects, so the server HTML names and describes the switch.
      aria-labelledby={field.labelId}
      aria-describedby={reason.describedBy}
      {...(reason.off ? { "aria-readonly": undefined, "aria-disabled": true, "data-disabled": "" } : {})}
      aria-invalid={field.invalid || undefined}
      className={trackClass}
    >
      <TouchTarget />
      <BaseSwitch.Thumb data-ouro-switch-thumb="" className={thumbClass} />
      {reason.note}
    </BaseSwitch.Root>
  );
  return reason.wrapped ? <Tooltip content={reason.reason}>{track}</Tooltip> : track;
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
 * @see https://ui.ouroboros.bot/docs/switch
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
    "aria-describedby": describedBy,
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
        disabled={disabled && !props.disabledReason}
        name={name}
        // A hidden label takes no room beside the track, so the gap that separated them goes too.
        className={cn(hideLabel && "gap-x-0", className)}
      >
        <SwitchTrack disabledProps={"disabledReason" in props ? { disabledReason: props.disabledReason } : {}} value={value} checked={checked} defaultChecked={defaultChecked} onCheckedChange={onCheckedChange} readOnly={readOnly} describedBy={describedBy} ref={ref} />
      </Field>
    </FieldOwnerContext.Provider>
  );
}
