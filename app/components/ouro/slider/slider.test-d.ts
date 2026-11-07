import { createElement } from "react";
import { expectTypeOf } from "vitest";
import { Slider, type SliderProps } from "~/components/ouro/slider/slider";
expectTypeOf<readonly ["Taken."]>().toExtend<NonNullable<SliderProps["error"]>>();

// Type tests: `pnpm typecheck` compiles this file, and every `@ts-expect-error`
// fails the check if the line below it stops being an error.

// Valid shapes: one thumb, a range, formatting and translated thumb labels.
expectTypeOf<{ label: "Volume" }>().toExtend<SliderProps>();
expectTypeOf<{
  label: "Volume";
  hideLabel: true;
  description: "Out of 100.";
  error: "Too loud.";
  disabled: true;
  name: "volume";
  defaultValue: 40;
  onValueChange: (value: number) => void;
  onValueCommitted: (value: number) => void;
  min: 0;
  max: 100;
  step: 5;
  largeStep: 20;
  format: { style: "percent" };
  locale: "de-DE";
  showValue: true;
  className: "mt-4";
}>().toExtend<SliderProps>();
expectTypeOf<{ label: "Price"; defaultValue: [20, 80]; thumbLabels: ["Von", "Bis"] }>().toExtend<SliderProps<[number, number]>>();

// onValueChange hears a number for one thumb and an array for a range.
expectTypeOf<NonNullable<SliderProps<number>["onValueChange"]>>().parameter(0).toEqualTypeOf<number>();
expectTypeOf<NonNullable<SliderProps<readonly number[]>["onValueChange"]>>().parameter(0).toEqualTypeOf<number[]>();

// The label is required, and is a string.
expectTypeOf<{ defaultValue: 40 }>().not.toExtend<SliderProps>();
expectTypeOf<{ label: 1 }>().not.toExtend<SliderProps>();

// A slider always has a value, so required is a hint, like the guessed names.
type Guess =
  | "errorMessage"
  | "helperText"
  | "isInvalid"
  | "invalid"
  | "isDisabled"
  | "required"
  | "isRequired"
  | "range"
  | "minValue"
  | "maxValue"
  | "onChange"
  | "valueLabelDisplay"
  | "showTooltip";
// Each name on its own: none of them is accepted.
type Accepted = { [K in Guess]: { label: "Volume" } & Record<K, true> extends SliderProps ? K : never }[Guess];
expectTypeOf<Accepted>().toEqualTypeOf<never>();

// The same checks through JSX.
// @ts-expect-error required is a hint: a slider always has a value.
createElement(Slider, { label: "Volume", required: true });
// @ts-expect-error label is required.
createElement(Slider, { defaultValue: 40 });
