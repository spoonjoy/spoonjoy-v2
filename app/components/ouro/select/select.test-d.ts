import { createElement } from "react";
import { expectTypeOf } from "vitest";
import { Select, type SelectProps } from "~/components/ouro/select/select";
import { SelectGroup, SelectItem } from "~/components/ouro/select/select-parts";

// Type tests: `pnpm typecheck` compiles this file, and every `@ts-expect-error`
// fails the check if the line below it stops being an error.

const courses = [
  { value: "starter", label: "Starter" },
  { label: "Mains", options: [{ value: "pasta", label: "Pasta", disabled: true }] },
];

// Valid shapes: the Field contract, options with groups, and a placeholder.
expectTypeOf<{ label: "Course" }>().toExtend<SelectProps>();
createElement(Select, {
  label: "Course",
  hideLabel: true,
  description: "Shown on the menu.",
  error: ["Required."],
  required: true,
  disabled: false,
  readOnly: false,
  name: "course",
  placeholder: "Choose a course",
  options: courses,
  className: "mt-4",
});
createElement(Select, { label: "Course", children: createElement(SelectGroup, { label: "Mains", children: createElement(SelectItem, { value: "pasta", children: "Pasta" }) }) });

// A single select's value is a string or null.
expectTypeOf<{ label: "Course"; value: "pasta"; onValueChange: (value: string | null) => void }>().toExtend<SelectProps>();
expectTypeOf<{ label: "Course"; defaultValue: null }>().toExtend<SelectProps>();
expectTypeOf<{ label: "Course"; value: ["pasta"] }>().not.toExtend<SelectProps>();

// multiple makes the value a string array.
expectTypeOf<{ label: "Tags"; multiple: true; value: ["quick", "vegan"]; onValueChange: (value: string[]) => void }>().toExtend<SelectProps>();
expectTypeOf<{ label: "Tags"; multiple: true; value: "quick" }>().not.toExtend<SelectProps>();
expectTypeOf<{ label: "Tags"; multiple: true; onValueChange: (value: string | null) => void }>().not.toExtend<SelectProps>();

// The label is required, and is a string.
expectTypeOf<{ options: typeof courses }>().not.toExtend<SelectProps>();
expectTypeOf<{ label: 1 }>().not.toExtend<SelectProps>();

// The guessed names are hint types that name the real prop.
expectTypeOf<{ label: "Course"; onChange: () => void }>().not.toExtend<SelectProps>();
expectTypeOf<{ label: "Course"; isMulti: true }>().not.toExtend<SelectProps>();
expectTypeOf<{ label: "Course"; items: typeof courses }>().not.toExtend<SelectProps>();
expectTypeOf<{ label: "Course"; errorMessage: "Required." }>().not.toExtend<SelectProps>();
expectTypeOf<{ label: "Course"; helperText: "Hint" }>().not.toExtend<SelectProps>();
expectTypeOf<{ label: "Course"; isInvalid: true }>().not.toExtend<SelectProps>();
expectTypeOf<{ label: "Course"; invalid: true }>().not.toExtend<SelectProps>();
expectTypeOf<{ label: "Course"; isRequired: true }>().not.toExtend<SelectProps>();
expectTypeOf<{ label: "Course"; isDisabled: true }>().not.toExtend<SelectProps>();

// The same checks through JSX.
// @ts-expect-error label is required.
createElement(Select, { options: courses });
// @ts-expect-error isMulti is not a prop; use multiple.
createElement(Select, { label: "Tags", isMulti: true });
