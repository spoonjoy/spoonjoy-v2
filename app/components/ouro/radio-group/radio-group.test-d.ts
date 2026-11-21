import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { Radio, RadioGroup, type RadioGroupProps, type RadioProps } from "~/components/ouro/radio-group/radio-group";

// A call site's props, typed as the component takes them. A case below keeps children in the props object because it
// checks the props a call passes, children among them, and a .ts file has no JSX to put children in; an app's lint
// (react(no-children-prop)) flags children passed in createElement's props, so the check doesn't call createElement.
const propsOf = <P>(value: P): P => value;

expectTypeOf<readonly ["Taken."]>().toExtend<NonNullable<RadioGroupProps["error"]>>();

// Type tests: `pnpm typecheck` compiles this file, and every `@ts-expect-error`
// fails the check if the line below it stops being an error.

const options = [{ value: "small", label: "Small", description: "Serves 2.", disabled: true }];

// Valid shapes: the group contract, with options or with Radio children.
expectTypeOf<{ legend: "Size"; options: typeof options }>().toExtend<RadioGroupProps>();
expectTypeOf<{ legend: "Size"; children: null }>().toExtend<RadioGroupProps>();
expectTypeOf<{
  legend: "Size";
  hideLegend: true;
  description: "Pick one.";
  error: "Choose a size.";
  required: true;
  disabled: true;
  name: "size";
  value: string;
  onValueChange: (value: string) => void;
  orientation: "horizontal";
  options: typeof options;
  className: "mt-4";
}>().toExtend<RadioGroupProps>();
expectTypeOf<{ value: "small"; label: "Small"; description: "Serves 2."; disabled: true; hideLabel: true }>().toExtend<RadioProps>();

// A choice, or a Radio, takes a reason it is off, a string or undefined.
expectTypeOf<{ legend: "Size"; options: [{ value: "a"; label: "A"; disabledReason: string | undefined }] }>().toExtend<RadioGroupProps>();
expectTypeOf<{ value: "small"; label: "Small"; disabledReason: "Sold out" }>().toExtend<RadioProps>();
// @ts-expect-error disabledReason is a string, not a boolean
createElement(Radio, { value: "small", label: "Small", disabledReason: true });

// The legend is required; a group has no label. Its value is one string.
expectTypeOf<{ options: typeof options }>().not.toExtend<RadioGroupProps>();
expectTypeOf<{ label: "Size"; legend: "Size"; options: typeof options }>().not.toExtend<RadioGroupProps>();
expectTypeOf<{ legend: "Size"; value: ["small"]; options: typeof options }>().not.toExtend<RadioGroupProps>();
expectTypeOf<{ legend: "Size"; orientation: "row"; options: typeof options }>().not.toExtend<RadioGroupProps>();
// Options or children, not both.
expectTypeOf<{ legend: "Size"; options: typeof options; children: null }>().not.toExtend<RadioGroupProps>();

// A Radio needs a value and a label, and its state and name belong to the group.
expectTypeOf<{ label: "Small" }>().not.toExtend<RadioProps>();
expectTypeOf<{ value: "small" }>().not.toExtend<RadioProps>();
expectTypeOf<{ value: "small"; label: "Small"; checked: true }>().not.toExtend<RadioProps>();
expectTypeOf<{ value: "small"; label: "Small"; name: "size" }>().not.toExtend<RadioProps>();

// The guessed names are hint types that name the real prop.
expectTypeOf<{ legend: "Size"; onChange: () => void; options: typeof options }>().not.toExtend<RadioGroupProps>();
expectTypeOf<{ legend: "Size"; items: typeof options }>().not.toExtend<RadioGroupProps>();
expectTypeOf<{ legend: "Size"; helperText: "Hint"; options: typeof options }>().not.toExtend<RadioGroupProps>();

// The same checks through JSX.
// @ts-expect-error options and children, not both.
propsOf<ComponentProps<typeof RadioGroup>>({ legend: "Size", options, children: null });
// @ts-expect-error a Radio's checked state is the group's value.
createElement(Radio, { value: "small", label: "Small", checked: true });
