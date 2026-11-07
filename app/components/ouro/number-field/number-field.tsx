"use client";

import { NumberField as BaseNumberField } from "@base-ui/react/number-field";
import type { ComponentPropsWithRef, JSX, ReactElement, ReactNode, Ref } from "react";
import { Field } from "~/components/ouro/field/field";
import { contractWarnings } from "~/components/ouro/field/field-styles";
import { FieldOwnerContext, useField, useFormErrors, type ReadonlyErrorMessages } from "~/lib/ouro/use-field";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { useMediaQuery } from "~/lib/ouro/use-media-query";
import { controlRef } from "~/lib/ouro/control-ref";
import { TouchTarget } from "~/lib/ouro/touch-target";
import { groupClass, inputClass, scrubClass, stepperClass } from "~/components/ouro/number-field/number-field-styles";

/** Props for {@link NumberField}. */
export interface NumberFieldProps {
  /**
   * What the number is, shown above the field and read as its name. Required: every control
   * needs a name. To hide it visually, keep it and add `hideLabel`. Drag it sideways with a
   * mouse to change the value.
   * @claim "Required: every control needs a name" registry/ouro/components/ouro/number-field/number-field.test-d.ts verify:fileLine(registry/ouro/components/ouro/number-field/number-field.test-d.ts, /expectTypeOf<\{\sdefaultValue:\s4\s\}>\(\)\.not\.toExtend<NumberFieldProps>/)
   */
  label: string;
  /** Hides the label visually; screen readers still read it as the field's name. */
  hideLabel?: boolean | undefined;
  /** Supporting text under the label, read after the label through `aria-describedby`. */
  description?: ReactNode | undefined;
  /**
   * What is wrong, from your server action or client check. The message (or several, as a
   * list) shows under the field, which gets `aria-invalid`. A message is text or a React node (one with a link); an empty string or array means valid.
   */
  error?: ReadonlyErrorMessages | undefined;
  /** The field must be filled: it gets `aria-required`, and the label a marker. */
  required?: boolean | undefined;
  /** Disables the field and its steppers, and fades it. */
  disabled?: boolean | undefined;
  /** People can read and copy the value but not change it. */
  readOnly?: boolean | undefined;
  /** The form field name the number submits under, as a plain number (`4.5`, not `$4.50`). */
  name?: string | undefined;
  /** The value, when you control it; `null` is empty. */
  value?: number | null | undefined;
  /** The starting value, when the field keeps its own; `null` is empty. */
  defaultValue?: number | null | undefined;
  /** Called with the new number as it changes, or `null` when the field is emptied. */
  onValueChange?: ((value: number | null) => void) | undefined;
  /**
   * Called when the value settles: on blur after typing, when a stepper or scrub is released, and with each key press. Use it to save.
   *
   * @claim "Called when the value settles: on" registry/ouro/components/ouro/number-field/number-field.test.tsx verify:testExists(registry/ouro/components/ouro/number-field/number-field.test.tsx::NumberField > steps by step with the arrow keys and parses typed text on blur)
   * @claim "Called when the value settles: on" https://base-ui.com/react/components/number-field verify:urlOk(https://base-ui.com/react/components/number-field)
   */
  onValueCommitted?: ((value: number | null) => void) | undefined;
  /**
   * The lowest value; the steppers stop there. A minimum of 0 or more also gives phones a
   * number keypad: iOS's keypads have no minus key, so a field that takes negatives (no
   * `min`, or a negative one) gets the full keyboard.
   * @claim "A minimum of 0 or more" registry/ouro/components/ouro/number-field/number-field.test.tsx verify:testExists(registry/ouro/components/ouro/number-field/number-field.test.tsx::NumberField > steps with its buttons, within min and max)
   * @claim "A minimum of 0 or more" registry/ouro/components/ouro/number-field/number-field.test.tsx verify:fileLine(registry/ouro/components/ouro/number-field/number-field.test.tsx, /\["integers\sfrom\s1",\s\{\smin:\s1\s\},\s"numeric"\]/)
   * @claim "The lowest value; the steppers stop" registry/ouro/components/ouro/number-field/number-field.test.tsx verify:testExists(registry/ouro/components/ouro/number-field/number-field.test.tsx::NumberField > steps with its buttons, within min and max)
   */
  min?: number | undefined;
  /**
   * The highest value; the steppers stop there.
   *
   * @claim "The highest value; the steppers stop" registry/ouro/components/ouro/number-field/number-field.test.tsx verify:testExists(registry/ouro/components/ouro/number-field/number-field.test.tsx::NumberField > steps with its buttons, within min and max)
   */
  max?: number | undefined;
  /** The amount the steppers, the arrow keys and a scrub change the value by. @default 1 */
  step?: number | undefined;
  /** The step for Page Up, Page Down and Shift with an arrow key. @default 10 */
  largeStep?: number | undefined;
  /**
   * How the number shows, as `Intl.NumberFormat` options: `{ style: "currency", currency: "USD" }`
   * shows `$4.50`, `{ style: "percent" }` shows `15%`, `{ maximumFractionDigits: 2 }` rounds.
   * The form still submits the plain number.
   */
  format?: Intl.NumberFormatOptions | undefined;
  /** The locale for `format` and for parsing what people type. @default the browser's */
  locale?: Intl.LocalesArgument | undefined;
  /** An example shown while the field is empty. It is not a label; pass `label`. */
  placeholder?: string | undefined;
  /**
   * The name of the button that lowers the value, as visually hidden text and not an
   * `aria-label`, so a test's label lookup for the field finds the field alone. Translate it with your app.
   * @default "Decrease"
   */
  decrementLabel?: string | undefined;
  /**
   * The name of the button that raises the value, as visually hidden text and not an
   * `aria-label`. Translate it with your app.
   * @default "Increase"
   */
  incrementLabel?: string | undefined;
  /**
   * Layout only: margins, width, grid placement (`mt-4`, `col-span-2`). Appearance classes
   * warn in development; style fields in your theme.
   */
  className?: string | undefined;
  /** The input element. */
  ref?: Ref<HTMLInputElement> | undefined;

  /** Not a prop. Ouro UI uses `error`: `<NumberField error="Required.">`. */
  errorMessage?: { 'Use <NumberField error="Required.">': never };
  /** Not a prop. Ouro UI uses `description`: `<NumberField description="...">`. */
  helperText?: { 'Use <NumberField description="...">': never };
  /** Not a prop. `error` marks the field invalid: `<NumberField error="What is wrong">`. */
  isInvalid?: { 'Use <NumberField error="What is wrong">': never };
  /** Not a prop. `error` marks the field invalid: `<NumberField error="What is wrong">`. */
  invalid?: { 'Use <NumberField error="What is wrong">': never };
  /** Not a prop. Ouro UI uses `required`: `<NumberField required>`. */
  isRequired?: { 'Use <NumberField required>': never };
  /** Not a prop. Ouro UI uses `disabled`: `<NumberField disabled>`. */
  isDisabled?: { 'Use <NumberField disabled>': never };
  /** Not a prop. Ouro UI uses `readOnly`: `<NumberField readOnly>`. */
  isReadOnly?: { 'Use <NumberField readOnly>': never };
  /** Not a prop. Ouro UI uses `min`: `<NumberField min={1}>`. */
  minValue?: { 'Use <NumberField min={1}>': never };
  /** Not a prop. Ouro UI uses `max`: `<NumberField max={10}>`. */
  maxValue?: { 'Use <NumberField max={10}>': never };
  /** Not a prop. NumberField reports the number itself: `<NumberField onValueChange={(value) => …}>`. */
  onChange?: { 'Use <NumberField onValueChange={(value) => ...}>': never };
  /** Not a prop. Ouro UI uses `format`: `<NumberField format={{ style: "percent" }}>`. */
  formatOptions?: { 'Use <NumberField format={{ style: "percent" }}>': never };
  /** Not a prop. Rounding is a format option: `<NumberField format={{ maximumFractionDigits: 2 }}>`. */
  precision?: { 'Use <NumberField format={{ maximumFractionDigits: 2 }}>': never };
  /** Not a prop. Currency is a format option: `<NumberField format={{ style: "currency", currency: "USD" }}>`. */
  currency?: { 'Use <NumberField format={{ style: "currency", currency: "USD" }}>': never };
  /**
   * Not a prop. NumberField is always a number field; for text use `TextField`.
   *
   * @claim "NumberField is always a number field" registry/ouro/components/ouro/number-field/number-field.test-d.ts verify:fileLine(registry/ouro/components/ouro/number-field/number-field.test-d.ts, /^type\sGuess\s=/)
   * @claim "NumberField is always a number field" registry/ouro/components/ouro/number-field/number-field.tsx verify:fileLine(registry/ouro/components/ouro/number-field/number-field.tsx, /type\?:\s\{\s'NumberField\sis\salways\sa\snumber;\sfor\stext\suse\s<TextField>':\snever\s\};/)
   */
  type?: { 'NumberField is always a number; for text use <TextField>': never };
}

/**
 * Icons drawn in the text color at 16px, like the other Ouro icons.
 *
 * @claim "Icons drawn in the text color" registry/ouro/components/ouro/number-field/number-field.tsx verify:fileLine(registry/ouro/components/ouro/number-field/number-field.tsx, /viewBox="0\s0\s16\s16"/)
 * @claim "Icons drawn in the text color" registry/ouro/components/ouro/number-field/number-field.tsx verify:fileLine(registry/ouro/components/ouro/number-field/number-field.tsx, /stroke="currentColor"/)
 */
/** Marks the hidden input Base UI submits the number with. */
const markInput = controlRef("number-field", "hidden-input");

function Icon({ children }: { children: ReactNode }): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      {children}
    </svg>
  );
}

/**
 * A labeled number input on the Field contract: pass `label`, and `error` from your server
 * action or client check. It parses what people type in their locale, shows the value with
 * `format` (currency, percent, units), steps with its buttons and the arrow keys, and changes
 * the value when the label is dragged sideways with a mouse.
 * The steppers take taps over 44px on touch screens. The form submits the plain number.
 *
 * It picks the phone keyboard itself: the keypad with a decimal separator when `min` is 0 or
 * more and the field takes fractions (a fractional `step`, or a `format` with fraction digits,
 * such as a currency), the digits-only keypad when `min` is 0 or more and it takes whole
 * numbers, and the full keyboard when it takes negatives, since iOS's keypads have no minus key.
 *
 * Use `TextField` with `inputMode="numeric"` instead for digit codes such as a PIN or a ZIP
 * code, and `Slider` when an approximate value in a range is enough.
 *
 * @group Forms
 * @see https://ui.ouro.bot/docs/number-field
 *
 * @example
 * <NumberField label="Servings" name="servings" defaultValue={4} min={1} max={24} />
 * <NumberField label="Price" name="price" min={0} format={{ style: "currency", currency: "USD" }} step={0.5} />
 * @claim "The steppers take taps over 44px" registry/ouro/components/ouro/number-field/number-field.touch.test.tsx verify:testExists(registry/ouro/components/ouro/number-field/number-field.touch.test.tsx::is 44px tall with 16px text, and its steppers have a 44px hit area, also on a landscape phone)
 * @claim "It picks the phone keyboard itself" registry/ouro/components/ouro/number-field/number-field.test.tsx verify:fileLine(registry/ouro/components/ouro/number-field/number-field.test.tsx, /\["half\ssteps\sfrom\s0",\s\{\smin:\s0,\sstep:\s0\.5\s\},\s"decimal"\]/)
 */
export function NumberField(props: NumberFieldProps): JSX.Element {
  const {
    label,
    hideLabel,
    description,
    error,
    required,
    disabled,
    readOnly,
    name,
    value,
    defaultValue,
    onValueChange,
    onValueCommitted,
    min,
    max,
    step,
    largeStep,
    format,
    locale,
    placeholder,
    decrementLabel = "Decrease",
    incrementLabel = "Increase",
    className,
    ref,
    // Guard props (hint types), dropped here so they never reach the DOM.
    errorMessage,
    helperText,
    isInvalid,
    invalid,
    isRequired,
    isDisabled,
    isReadOnly,
    minValue,
    maxValue,
    onChange,
    formatOptions,
    precision,
    currency,
    type,
  } = props;
  const form = useFormErrors();
  // A change drops a Form error for this name, as typing does in a text field.
  const handleValueChange = (next: number | null) => {
    if (name !== undefined) form?.clear(name);
    onValueChange?.(next);
  };

  useDevWarnings(
    "NumberField",
    process.env.NODE_ENV !== "production"
      ? () => [
          ...contractWarnings("NumberField", { errorMessage, helperText, isInvalid, invalid, isRequired, isDisabled }),
          isReadOnly !== undefined && ["isReadOnly is not a prop", "<NumberField readOnly>"],
          minValue !== undefined && ["minValue is not a prop", `<NumberField min={${String(minValue)}}>`],
          maxValue !== undefined && ["maxValue is not a prop", `<NumberField max={${String(maxValue)}}>`],
          onChange !== undefined && ["onChange is not a prop", "<NumberField onValueChange={(value) => …}>"],
          formatOptions !== undefined && [
            "formatOptions is not a prop",
            `<NumberField format={{ ${Object.entries(formatOptions as object)
              .map(([key, option]) => `${key}: ${JSON.stringify(option)}`)
              .join(", ")} }}>`,
          ],
          precision !== undefined && ["precision is not a prop", `<NumberField format={{ maximumFractionDigits: ${String(precision)} }}>`],
          currency !== undefined && ["currency is not a prop", `<NumberField format={{ style: "currency", currency: "${String(currency)}" }}>`],
          type !== undefined && ["type is not a prop; NumberField is always a number", `<NumberField label="${label}">`],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );

  // Scrubbing is a mouse gesture (it locks the pointer); on a touch screen the label stays a
  // plain label, so a finger that lands on it still scrolls the page. The server renders the
  // scrub area and the client drops it on hydration.
  const scrubbable = useMediaQuery("(pointer: fine)", true);

  const owner = {
    name: "NumberField",
    data: "number-field",
    frame: (labelNode: ReactElement, rest: ReactNode) => (
      <BaseNumberField.Root
        value={value}
        defaultValue={defaultValue ?? undefined}
        onValueChange={(next) => handleValueChange(next)}
        onValueCommitted={onValueCommitted && ((next) => onValueCommitted(next))}
        min={min}
        max={max}
        step={step}
        largeStep={largeStep}
        format={format}
        locale={locale}
        required={required}
        readOnly={readOnly}
        inputRef={markInput}
        className="contents"
      >
        {scrubbable ? (
          <BaseNumberField.ScrubArea data-ouro-number-field-scrub="" className={scrubClass}>
            {labelNode}
          </BaseNumberField.ScrubArea>
        ) : (
          labelNode
        )}
        {rest}
      </BaseNumberField.Root>
    ),
  };

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
        <NumberFieldGroup
          inputRef={ref}
          inputMode={phoneKeyboard(min, step, format, locale)}
          required={required}
          placeholder={placeholder}
          decrementLabel={decrementLabel}
          incrementLabel={incrementLabel}
        />
      </Field>
    </FieldOwnerContext.Provider>
  );
}

/**
 * The phone keyboard for the field: `decimal` for fractions and `numeric` for whole numbers
 * when nothing below 0 is allowed, and `text` otherwise, since iOS's number keypads have no
 * minus key. Base UI's own choice depends on the platform, so the field sets it.
 * @claim "The phone keyboard for the field" registry/ouro/components/ouro/number-field/number-field.test.tsx verify:fileLine(registry/ouro/components/ouro/number-field/number-field.test.tsx, /\["half\ssteps\sfrom\s0",\s\{\smin:\s0,\sstep:\s0\.5\s\},\s"decimal"\]/)
 * @claim "The phone keyboard for the field" registry/ouro/components/ouro/number-field/number-field.test.tsx verify:fileLine(registry/ouro/components/ouro/number-field/number-field.test.tsx, /\["integers\sfrom\s1",\s\{\smin:\s1\s\},\s"numeric"\]/)
 */
function phoneKeyboard(
  min: number | undefined,
  step: number | undefined,
  format: Intl.NumberFormatOptions | undefined,
  locale: Intl.LocalesArgument | undefined,
): "decimal" | "numeric" | "text" {
  if (min === undefined || min < 0) return "text";
  const fractionalStep = step !== undefined && !Number.isInteger(step);
  const fractionalFormat = format !== undefined && new Intl.NumberFormat(locale, format).resolvedOptions().maximumFractionDigits! > 0;
  return fractionalStep || fractionalFormat ? "decimal" : "numeric";
}

/**
 * A stepper without the `aria-label` Base UI gives it: its hidden text names it, and an
 * `aria-label` is label text, which a loose label lookup for the field would also match.
 */
const unlabelled = (props: ComponentPropsWithRef<"button">) => <button {...props} aria-label={undefined} />;

/** The steppers and the input, inside the Field, where they read its server-known description ids. */
function NumberFieldGroup({
  inputRef,
  inputMode,
  required,
  placeholder,
  decrementLabel,
  incrementLabel,
}: {
  inputRef: Ref<HTMLInputElement> | undefined;
  inputMode: "decimal" | "numeric" | "text";
  required: boolean | undefined;
  placeholder: string | undefined;
  decrementLabel: string;
  incrementLabel: string;
}): JSX.Element {
  const field = useField()!;
  // Ouro's own invalid state (the error prop or the Form's error for this name), not Base UI's,
  // which would count it as a failed check and block the next submit.
  const invalid = field.invalid;
  return (
    <BaseNumberField.Group data-ouro-number-field-group="" className={groupClass}>
      <BaseNumberField.Decrement data-ouro-decrement="" data-ouro-control="number-field" data-ouro-part="decrement" render={unlabelled} className={stepperClass}>
        <TouchTarget />
        <Icon>
          <path d="M3.5 8h9" />
        </Icon>
        <span className="sr-only">{decrementLabel}</span>
      </BaseNumberField.Decrement>
      <BaseNumberField.Input
        ref={inputRef}
        data-ouro-control="number-field"
        data-ouro-part="input"
        inputMode={inputMode}
        placeholder={placeholder}
        aria-required={required || undefined}
        aria-describedby={field.describedBy}
        {...(invalid ? { "aria-invalid": true } : {})}
        className={inputClass}
      />
      <BaseNumberField.Increment data-ouro-increment="" data-ouro-control="number-field" data-ouro-part="increment" render={unlabelled} className={stepperClass}>
        <TouchTarget />
        <Icon>
          <path d="M3.5 8h9M8 3.5v9" />
        </Icon>
        <span className="sr-only">{incrementLabel}</span>
      </BaseNumberField.Increment>
    </BaseNumberField.Group>
  );
}
