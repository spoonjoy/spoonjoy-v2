"use client";

import { Slider as BaseSlider } from "@base-ui/react/slider";
import { cloneElement, useId, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type JSX, type ReactElement, type ReactNode, type Ref } from "react";
import { Field } from "~/components/ouro/field/field";
import { contractWarnings } from "~/components/ouro/field/field-styles";
import { TouchTarget } from "~/lib/ouro/touch-target";
import { FieldOwnerContext, useField, useFormErrors, type ReadonlyErrorMessages } from "~/lib/ouro/use-field";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import {
  controlClass,
  indicatorClass,
  rootClass,
  sampleClass,
  thumbClass,
  trackClass,
  valueClass,
} from "~/components/ouro/slider/slider-styles";

/** A slider's value: one number, or one per thumb for a range. */
export type SliderValue = number | readonly number[];

/** The value Slider reports: a number for one thumb, an array for a range. */
export type SliderOutput<Value extends SliderValue> = Value extends readonly number[] ? number[] : number;

/** Props for {@link Slider}. A `value` or `defaultValue` array gives a thumb per value. */
export interface SliderProps<Value extends SliderValue = number> {
  /**
   * What the slider sets, shown above it and read as its name. Required: every control
   * needs a name. To hide it visually, keep it and add `hideLabel`.
   * @claim "Required: every control needs a name" registry/ouro/components/ouro/slider/slider.test-d.ts verify:fileLine(registry/ouro/components/ouro/slider/slider.test-d.ts, /expectTypeOf<\{\sdefaultValue:\s40\s\}>\(\)\.not\.toExtend<SliderProps>/)
   */
  label: string;
  /** Hides the label visually; screen readers still read it as the slider's name. */
  hideLabel?: boolean | undefined;
  /** Supporting text under the label, read after the label through `aria-describedby`. */
  description?: ReactNode | undefined;
  /**
   * What is wrong, from your server action or client check. The message (or several, as a
   * list) shows under the slider, which gets `aria-invalid` and the destructive color. A message is text or a React node (one with a link); an empty string or array means valid.
   */
  error?: ReadonlyErrorMessages | undefined;
  /** Disables the slider and fades it. */
  disabled?: boolean | undefined;
  /** The form field name the value submits under; a range submits one entry per thumb. */
  name?: string | undefined;
  /**
   * The value, when you control it. An array gives a thumb per value: `value={[20, 80]}`
   * is a range.
   */
  value?: Value | undefined;
  /** The starting value, when the slider keeps its own. An array gives a range: `defaultValue={[20, 80]}`. */
  defaultValue?: Value | undefined;
  /** Called with the new value as the user drags, presses the track or uses the keyboard: a number, or an array for a range. */
  onValueChange?: ((value: SliderOutput<Value>) => void) | undefined;
  /**
   * Called once the user lets go (or with each key press), with the final value. Use it to save.
   *
   * @claim "Called once the user lets go" registry/ouro/components/ouro/slider/slider.test.tsx verify:testExists(registry/ouro/components/ouro/slider/slider.test.tsx::Slider > steps with the keyboard and reports the value)
   * @claim "Called once the user lets go" https://base-ui.com/react/components/slider verify:urlOk(https://base-ui.com/react/components/slider)
   */
  onValueCommitted?: ((value: SliderOutput<Value>) => void) | undefined;
  /**
   * The lowest value. @default 0
   *
   * @claim "The lowest value" registry/ouro/components/ouro/slider/slider.test.tsx verify:testExists(registry/ouro/components/ouro/slider/slider.test.tsx::Slider > is a labeled range input built on the Field contract)
   * @claim "The lowest value" registry/ouro/components/ouro/slider/slider.test.tsx verify:testExists(registry/ouro/components/ouro/slider/slider.test.tsx::Slider > takes large steps with Page Up, Page Down and Shift with an arrow)
   */
  min?: number | undefined;
  /**
   * The highest value. @default 100
   *
   * @claim "The highest value" registry/ouro/components/ouro/slider/slider.test.tsx verify:testExists(registry/ouro/components/ouro/slider/slider.test.tsx::Slider > is a labeled range input built on the Field contract)
   * @claim "The highest value" registry/ouro/components/ouro/slider/slider.test.tsx verify:testExists(registry/ouro/components/ouro/slider/slider.test.tsx::Slider > takes large steps with Page Up, Page Down and Shift with an arrow)
   */
  max?: number | undefined;
  /** The distance between values. @default 1 */
  step?: number | undefined;
  /** The step for Page Up, Page Down and Shift with an arrow key. @default 10 */
  largeStep?: number | undefined;
  /**
   * How the value reads, as `Intl.NumberFormat` options, for `showValue` and screen readers:
   * `{ style: "percent" }`, `{ style: "currency", currency: "EUR" }`.
   */
  format?: Intl.NumberFormatOptions | undefined;
  /** The locale for `format`. @default the browser's, once hydrated; en-US in the server's HTML */
  locale?: Intl.LocalesArgument | undefined;
  /** Shows the formatted value at the end of the slider; a range shows both ends: `$10 – $40`. */
  showValue?: boolean | undefined;
  /**
   * What each thumb of a range is called, before the label: screen readers hear
   * "Minimum, Price". Translate them with your app.
   * @default ["Minimum", "Maximum"]
   * @claim "What each thumb of a range" registry/ouro/components/ouro/slider/slider.test.tsx verify:testExists(registry/ouro/components/ouro/slider/slider.test.tsx::Slider > gives a value array a thumb per value, each named)
   * @claim "What each thumb of a range" registry/ouro/components/ouro/slider/slider.test.tsx verify:testExists(registry/ouro/components/ouro/slider/slider.test.tsx::Slider > translates the thumb names)
   */
  thumbLabels?: readonly string[] | undefined;
  /**
   * Layout only: margins, width, grid placement (`mt-4`, `col-span-2`). Appearance classes
   * warn in development; style sliders in your theme.
   */
  className?: string | undefined;
  /** The first thumb's `<input type="range">`. */
  ref?: Ref<HTMLInputElement> | undefined;

  /** Not a prop. Ouro UI uses `error`: `<Slider error="Required.">`. */
  errorMessage?: { 'Use <Slider error="Required.">': never };
  /** Not a prop. Ouro UI uses `description`: `<Slider description="...">`. */
  helperText?: { 'Use <Slider description="...">': never };
  /** Not a prop. `error` marks the slider invalid: `<Slider error="What is wrong">`. */
  isInvalid?: { 'Use <Slider error="What is wrong">': never };
  /** Not a prop. `error` marks the slider invalid: `<Slider error="What is wrong">`. */
  invalid?: { 'Use <Slider error="What is wrong">': never };
  /** Not a prop. Ouro UI uses `disabled`: `<Slider disabled>`. */
  isDisabled?: { 'Use <Slider disabled>': never };
  /**
   * Not a prop. A slider always has a value, so it is never missing: `<Slider defaultValue={50}>`.
   *
   * @claim "A slider always has a value" registry/ouro/components/ouro/slider/slider.test-d.ts verify:fileLine(registry/ouro/components/ouro/slider/slider.test-d.ts, /@ts-expect-error\srequired\sis\sa\shint:\sa\sslider\salways\shas\sa\svalue\./)
   */
  required?: { 'A slider always has a value: <Slider defaultValue={50}>': never };
  /**
   * Not a prop. A slider always has a value, so it is never missing: `<Slider defaultValue={50}>`.
   *
   * @claim "A slider always has a value" registry/ouro/components/ouro/slider/slider.test-d.ts verify:fileLine(registry/ouro/components/ouro/slider/slider.test-d.ts, /@ts-expect-error\srequired\sis\sa\shint:\sa\sslider\salways\shas\sa\svalue\./)
   */
  isRequired?: { 'A slider always has a value: <Slider defaultValue={50}>': never };
  /** Not a prop. A value array gives a thumb per value: `<Slider defaultValue={[20, 80]}>`. */
  range?: { 'Pass a value array: <Slider defaultValue={[20, 80]}>': never };
  /** Not a prop. Ouro UI uses `min`: `<Slider min={1}>`. */
  minValue?: { 'Use <Slider min={1}>': never };
  /** Not a prop. Ouro UI uses `max`: `<Slider max={10}>`. */
  maxValue?: { 'Use <Slider max={10}>': never };
  /** Not a prop. Slider reports the value itself: `<Slider onValueChange={(value) => …}>`. */
  onChange?: { 'Use <Slider onValueChange={(value) => ...}>': never };
  /** Not a prop. Ouro UI uses `showValue`: `<Slider showValue>`. */
  valueLabelDisplay?: { 'Use <Slider showValue>': never };
  /** Not a prop. Ouro UI uses `showValue`: `<Slider showValue>`. */
  showTooltip?: { 'Use <Slider showValue>': never };
}

/** Field's messages and root name Slider. */
const owner = { name: "Slider", data: "slider" };

/**
 * A range's label names its group, with an id the server knows, and each thumb has its own
 * name, so the label points at no single input.
 * @claim "A range's label names its group" registry/ouro/components/ouro/slider/slider.test.tsx verify:testExists(registry/ouro/components/ouro/slider/slider.test.tsx::Slider > gives a value array a thumb per value, each named)
 * @claim "A range's label names its group" registry/ouro/components/ouro/slider/slider.test.tsx verify:testExists(registry/ouro/components/ouro/slider/slider.test.tsx::Slider development messages > warns when a range has the wrong number of thumb names)
 */
function rangeOwner(labelId: string) {
  return {
    ...owner,
    frame: (label: ReactElement, rest: ReactNode) => (
      <>
        {cloneElement(label as ReactElement<{ htmlFor?: string | undefined; id?: string }>, { htmlFor: undefined, id: labelId })}
        {rest}
      </>
    ),
  };
}

/** An empty subscription: here `useSyncExternalStore` only tells the server and hydration apart from the browser. */
// Stryker disable next-line ArrowFunction: React takes an unsubscribe of undefined as none, and this store never changes.
const noSubscription = () => () => {};

/**
 * The locale the value reads in on the server and during hydration when no `locale` is given: the
 * reader's is unknown there, so both use this one, and the reader's browser switches to its own
 * once it has hydrated the server's HTML.
 *
 * @claim "The locale the value reads in" registry/ouro/components/ouro/slider/slider.test.tsx verify:testExists(registry/ouro/components/ouro/slider/slider.test.tsx::Slider across locales > renders the same value text on a server in any locale, and shows the reader's once hydrated)
 */
const SERVER_LOCALE = "en-US";

/** The default names for a range's thumbs: Minimum and Maximum, with Middle between. */
function defaultThumbLabels(count: number): string[] {
  return Array.from({ length: count }, (_, index) => (index === 0 ? "Minimum" : index === count - 1 ? "Maximum" : "Middle"));
}

/**
 * A labeled slider on the Field contract: pass `label`, and a `defaultValue` (or `value`
 * with `onValueChange`). A value array, `defaultValue={[20, 80]}`, gives a range with a thumb
 * per value. `showValue` shows the value, formatted with `format`. Each thumb has a 44px
 * touch area on phones.
 *
 * Use `NumberField` instead when people need an exact number, and `RadioGroup` for a few
 * named choices.
 *
 * @group Forms
 * @see https://ourostack.github.io/ouro-ui/docs/slider
 *
 * @example
 * <Slider label="Servings" name="servings" defaultValue={4} min={1} max={12} showValue />
 * <Slider label="Price" name="price" defaultValue={[10, 40]} format={{ style: "currency", currency: "USD" }} showValue />
 * @claim "Each thumb has a 44px touch" registry/ouro/components/ouro/slider/slider.test.tsx verify:testExists(registry/ouro/components/ouro/slider/slider.test.tsx::Slider looks > gives the thumb a 44px hit area only on a coarse pointer)
 * @claim "Each thumb has a 44px touch" registry/ouro/components/ouro/slider/slider.touch.test.tsx verify:testExists(registry/ouro/components/ouro/slider/slider.touch.test.tsx::gives the thumb a 44px hit area and the control a 44px height, also on a landscape phone)
 */
export function Slider<Value extends SliderValue = number>(props: SliderProps<Value>): JSX.Element {
  const {
    label,
    hideLabel,
    description,
    error,
    disabled,
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
    showValue,
    thumbLabels: thumbLabelsProp,
    className,
    ref,
    // Guard props (hint types), dropped here so they never reach the DOM.
    errorMessage,
    helperText,
    isInvalid,
    invalid,
    isDisabled,
    required,
    isRequired,
    range,
    minValue,
    maxValue,
    onChange,
    valueLabelDisplay,
    showTooltip,
  } = props;
  const form = useFormErrors();
  // A change drops a Form error for this name, as typing does in a text field.
  const handleValueChange = (next: number | number[]) => {
    if (name !== undefined) form?.clear(name);
    (onValueChange as ((value: number | number[]) => void) | undefined)?.(next);
  };
  const current = value ?? defaultValue;
  const count = Array.isArray(current) ? current.length : 1;
  const isRange = Array.isArray(current);
  const thumbLabels = thumbLabelsProp ?? defaultThumbLabels(count);
  const labelId = `${useId()}-label`;
  const fieldOwner = useMemo(() => (isRange ? rangeOwner(labelId) : owner), [isRange, labelId]);

  useDevWarnings(
    "Slider",
    process.env.NODE_ENV !== "production"
      ? () => {
          const always = "a slider always has a value";
          return [
            ...contractWarnings("Slider", { errorMessage, helperText, isInvalid, invalid, isDisabled }),
            required !== undefined && [`required is not a prop; ${always}`, "<Slider defaultValue={50}>"],
            isRequired !== undefined && [`isRequired is not a prop; ${always}`, "<Slider defaultValue={50}>"],
            range !== undefined && ["range is not a prop; a value array gives a thumb per value", "<Slider defaultValue={[20, 80]}>"],
            minValue !== undefined && ["minValue is not a prop", `<Slider min={${String(minValue)}}>`],
            maxValue !== undefined && ["maxValue is not a prop", `<Slider max={${String(maxValue)}}>`],
            onChange !== undefined && ["onChange is not a prop", "<Slider onValueChange={(value) => …}>"],
            valueLabelDisplay !== undefined && ["valueLabelDisplay is not a prop", "<Slider showValue>"],
            showTooltip !== undefined && ["showTooltip is not a prop", "<Slider showValue>"],
            isRange &&
              thumbLabels.length !== count && [
                `thumbLabels has ${thumbLabels.length} names for ${count} thumbs`,
                `<Slider thumbLabels={[${defaultThumbLabels(count)
                  .map((name) => `"${name}"`)
                  .join(", ")}]}>`,
              ],
          ];
        }
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );

  return (
    <FieldOwnerContext.Provider value={fieldOwner}>
      <Field label={label} hideLabel={hideLabel} description={description} error={error} disabled={disabled} name={name} className={className}>
        <SliderControl
          label={label}
          labelId={isRange ? labelId : undefined}
          isRange={isRange}
          count={count}
          thumbLabels={thumbLabels}
          showValue={showValue}
          inputRef={ref}
          rootProps={{
            value: value as number | number[] | undefined,
            defaultValue: defaultValue as number | number[] | undefined,
            onValueChange: handleValueChange,
            onValueCommitted: onValueCommitted as ((value: number | number[]) => void) | undefined,
            min,
            max,
            step,
            largeStep,
            format,
            locale,
          }}
        />
      </Field>
    </FieldOwnerContext.Provider>
  );
}

/** The Base UI slider inside the Field, where it reads the field's server-known description ids. */
function SliderControl({
  label,
  labelId,
  isRange,
  count,
  thumbLabels,
  showValue,
  inputRef,
  rootProps,
}: {
  label: string;
  labelId: string | undefined;
  isRange: boolean;
  count: number;
  thumbLabels: readonly string[];
  showValue: boolean | undefined;
  inputRef: Ref<HTMLInputElement> | undefined;
  rootProps: Pick<
    BaseSlider.Root.Props,
    "value" | "defaultValue" | "min" | "max" | "step" | "largeStep" | "format" | "locale"
  > & {
    onValueChange: ((value: number | number[]) => void) | undefined;
    onValueCommitted: ((value: number | number[]) => void) | undefined;
  };
}): JSX.Element {
  const field = useField()!;
  // Ouro's own invalid state (the error prop or the Form's error for this name), not Base UI's,
  // which would count it as a failed check and block the next submit.
  const invalid = field.invalid;
  // Base UI builds each thumb's range input itself and takes aria-invalid only from its own
  // checks, so Ouro's state and the control marker go on the inputs directly.
  const rootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    for (const input of rootRef.current!.querySelectorAll('input[type="range"]')) {
      input.setAttribute("data-ouro-control", "slider");
      input.setAttribute("data-ouro-part", "thumb");
      if (invalid) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    }
  });
  const { onValueChange, onValueCommitted, ...shared } = rootProps;
  // Without a locale, the reader's is unknown on the server and during hydration, so both read
  // en-US (Base UI keeps a formatter per locale, so the page's default never leaks in from a
  // formatter made earlier) and the reader's browser switches to its own once hydrated.
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    // Stryker disable next-line ArrowFunction: undefined, like false, reads as not yet hydrated.
    () => false,
  );
  const locale = shared.locale ?? (hydrated ? undefined : SERVER_LOCALE);
  // Samples of the widest value text, all reserved so the track keeps its length: each end's
  // integer part with the step's decimals (Base UI's defaults are 0, 100 and a step of 1), plus
  // values in each power of ten, since compact notation ("1.1K") can be wider than either end.
  const number = new Intl.NumberFormat(shared.locale, shared.format);
  const min = shared.min ?? 0;
  const max = shared.max ?? 100;
  const step = shared.step ?? 1;
  const decimals = (String(step).split(".")[1] ?? "").length;
  const withDecimals = (end: number) => {
    const whole = Math.trunc(end);
    return decimals === 0 ? end : Math.sign(end || 1) * (Math.abs(whole) + Number(`0.${"8".repeat(decimals)}`));
  };
  const values = [withDecimals(min), withDecimals(max)];
  for (let power = 1; power <= Math.max(Math.abs(min), Math.abs(max)); power *= 10) {
    for (const magnitude of [1.8 * power, 8.8 * power, 10 * power - step]) {
      for (const value of [magnitude, -magnitude]) {
        const snapped = min + Math.round((value - min) / step) * step;
        if (snapped >= min && snapped <= max) values.push(snapped);
      }
    }
  }
  // Without a locale, the samples are in the reader's, which the server cannot know: it and
  // hydration reserve nothing, and the browser fills them in, so the server's HTML hydrates as it is.
  const texts = hydrated || shared.locale !== undefined ? [...new Set(values.map((value) => number.format(value)))] : [];
  const samples = isRange ? texts.map((text) => `${text} – ${text}`) : texts;
  return (
    <BaseSlider.Root
      ref={rootRef}
      {...shared}
      locale={locale}
      {...(invalid ? { "data-ouro-invalid": "" } : {})}
      onValueChange={onValueChange && ((next) => onValueChange(next as number | number[]))}
      onValueCommitted={onValueCommitted && ((next) => onValueCommitted(next as number | number[]))}
      aria-labelledby={labelId}
      aria-describedby={field.describedBy}
      className={`group/slider ${rootClass}`}
    >
      <BaseSlider.Control
        data-ouro-slider-control=""
        className={controlClass}
      >
        <BaseSlider.Track className={trackClass}>
          <BaseSlider.Indicator data-ouro-slider-indicator="" className={indicatorClass} />
          {Array.from({ length: count }, (_, index) => (
            <BaseSlider.Thumb
              key={index}
              index={index}
              data-ouro-slider-thumb=""
              inputRef={index === 0 ? inputRef : undefined}
              aria-label={isRange ? `${thumbLabels[index] ?? index + 1}, ${label}` : undefined}
              aria-describedby={field.describedBy}
              className={thumbClass}
            >
              <TouchTarget />
            </BaseSlider.Thumb>
          ))}
        </BaseSlider.Track>
      </BaseSlider.Control>
      {showValue && (
        <BaseSlider.Value
          data-ouro-slider-value=""
          className={valueClass}
        >
          {(formatted) => (
            <>
              <span className="col-start-1 row-start-1">{formatted.join(" – ")}</span>
              {/* Empty, so they stay out of the text: each shows its sample as a hidden pseudo-element. */}
              {samples.map((sample) => (
                <span key={sample} aria-hidden="true" data-ouro-slider-sample={sample} className={sampleClass} />
              ))}
            </>
          )}
        </BaseSlider.Value>
      )}
    </BaseSlider.Root>
  );
}
