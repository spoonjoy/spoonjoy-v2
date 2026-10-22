import { createElement } from "react";
import { expectTypeOf } from "vitest";
import { NumberField, type NumberFieldProps } from "~/components/ouro/number-field/number-field";
expectTypeOf<readonly ["Taken."]>().toExtend<NonNullable<NumberFieldProps["error"]>>();

// Type tests: `pnpm typecheck` compiles this file, and every `@ts-expect-error`
// fails the check if the line below it stops being an error.

// Valid shapes: the Field contract, bounds, steps, formatting and translated labels.
expectTypeOf<{ label: "Servings" }>().toExtend<NumberFieldProps>();
expectTypeOf<{
  label: "Price";
  hideLabel: true;
  description: "Per jar.";
  error: "Required.";
  required: true;
  disabled: true;
  readOnly: true;
  name: "price";
  value: null;
  onValueChange: (value: number | null) => void;
  onValueCommitted: (value: number | null) => void;
  min: 0;
  max: 100;
  step: 0.5;
  largeStep: 10;
  format: { style: "currency"; currency: "EUR" };
  locale: "de-DE";
  placeholder: "0";
  decrementLabel: "Weniger";
  incrementLabel: "Mehr";
  className: "mt-4";
}>().toExtend<NumberFieldProps>();
expectTypeOf<{ label: "Servings"; defaultValue: "4" }>().not.toExtend<NumberFieldProps>();

// The label is required, and is a string.
expectTypeOf<{ defaultValue: 4 }>().not.toExtend<NumberFieldProps>();
expectTypeOf<{ label: 1 }>().not.toExtend<NumberFieldProps>();

// The guessed names are hint types that name the real prop.
type Guess =
  | "errorMessage"
  | "helperText"
  | "isInvalid"
  | "invalid"
  | "isRequired"
  | "isDisabled"
  | "isReadOnly"
  | "minValue"
  | "maxValue"
  | "onChange"
  | "formatOptions"
  | "precision"
  | "currency"
  | "type";
// Each name on its own: none of them is accepted.
type Accepted = { [K in Guess]: { label: "Servings" } & Record<K, true> extends NumberFieldProps ? K : never }[Guess];
expectTypeOf<Accepted>().toEqualTypeOf<never>();

// The same checks through JSX.
// @ts-expect-error minValue is not a prop; use min.
createElement(NumberField, { label: "Servings", minValue: 1 });
// @ts-expect-error label is required.
createElement(NumberField, { defaultValue: 4 });
