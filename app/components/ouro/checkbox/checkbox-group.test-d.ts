import { createElement } from "react";
import { expectTypeOf } from "vitest";
import { CheckboxGroup, type CheckboxGroupProps } from "~/components/ouro/checkbox/checkbox-group";

// Type tests: `pnpm typecheck` compiles this file, and every `@ts-expect-error`
// fails the check if the line below it stops being an error.

const options = [{ value: "basil", label: "Basil", description: "Sweet.", disabled: true }];

// Valid shapes: the group contract, with options or with children.
expectTypeOf<{ legend: "Herbs"; options: typeof options }>().toExtend<CheckboxGroupProps>();
expectTypeOf<{ legend: "Herbs"; children: null }>().toExtend<CheckboxGroupProps>();
expectTypeOf<{
  legend: "Herbs";
  hideLegend: true;
  description: "Pick any.";
  error: "Pick one.";
  required: true;
  requiredMessage: "Wähle eins.";
  disabled: true;
  name: "herbs";
  value: string[];
  onValueChange: (value: string[]) => void;
  options: typeof options;
  className: "mt-4";
}>().toExtend<CheckboxGroupProps>();
expectTypeOf<{ legend: "Herbs"; defaultValue: ["basil"]; options: typeof options }>().toExtend<CheckboxGroupProps>();

// The legend is required; a group has no label. Its value is a list.
expectTypeOf<{ options: typeof options }>().not.toExtend<CheckboxGroupProps>();
expectTypeOf<{ label: "Herbs"; legend: "Herbs"; options: typeof options }>().not.toExtend<CheckboxGroupProps>();
expectTypeOf<{ legend: "Herbs"; value: "basil"; options: typeof options }>().not.toExtend<CheckboxGroupProps>();
// Options need a value and a label.
expectTypeOf<{ legend: "Herbs"; options: [{ value: "basil" }] }>().not.toExtend<CheckboxGroupProps>();
// Options or children, not both, and not neither.
expectTypeOf<{ legend: "Herbs"; options: typeof options; children: null }>().not.toExtend<CheckboxGroupProps>();
expectTypeOf<{ legend: "Herbs" }>().not.toExtend<CheckboxGroupProps>();

// The guessed names are hint types that name the real prop.
expectTypeOf<{ legend: "Herbs"; onChange: () => void; options: typeof options }>().not.toExtend<CheckboxGroupProps>();
expectTypeOf<{ legend: "Herbs"; items: typeof options }>().not.toExtend<CheckboxGroupProps>();
expectTypeOf<{ legend: "Herbs"; errorMessage: "Required."; options: typeof options }>().not.toExtend<CheckboxGroupProps>();
expectTypeOf<{ legend: "Herbs"; isRequired: true; options: typeof options }>().not.toExtend<CheckboxGroupProps>();

// The same checks through JSX.
// @ts-expect-error options and children, not both.
createElement(CheckboxGroup, { legend: "Herbs", options, children: null });
// @ts-expect-error legend is required.
createElement(CheckboxGroup, { options });
