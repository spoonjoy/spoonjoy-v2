import { createElement } from "react";
import { expectTypeOf } from "vitest";
import { TextArea, type TextAreaProps } from "~/components/ouro/text-field/text-area";
expectTypeOf<readonly ["Taken."]>().toExtend<NonNullable<TextAreaProps["error"]>>();

// Type tests: `pnpm typecheck` compiles this file, and every `@ts-expect-error`
// fails the check if the line below it stops being an error.

// Valid shapes: the Field contract, autoGrow and textarea attributes.
expectTypeOf<{ label: "Notes" }>().toExtend<TextAreaProps>();
expectTypeOf<{
  label: "Notes";
  hideLabel: true;
  description: "Only you see these.";
  error: "Too long.";
  required: true;
  disabled: true;
  name: "notes";
  rows: 2;
  autoGrow: true;
  maxRows: 8;
  maxLength: 500;
  placeholder: "Anything to remember";
  className: "mt-4";
}>().toExtend<TextAreaProps>();
expectTypeOf<{ label: "Notes"; value: "Salt"; onValueChange: (value: string) => void }>().toExtend<TextAreaProps>();

// The frame and the size are named values.
for (const variant of ["outline", "plain"] as const) createElement(TextArea, { label: "Message", variant });
for (const size of ["md", "lg"] as const) createElement(TextArea, { label: "Message", size });
expectTypeOf<{ label: "Message"; variant: "ghost" }>().not.toExtend<TextAreaProps>();
expectTypeOf<{ label: "Message"; size: "sm" }>().not.toExtend<TextAreaProps>();

// The label is required, and is a string.
expectTypeOf<{ rows: 3 }>().not.toExtend<TextAreaProps>();
expectTypeOf<{ label: 1 }>().not.toExtend<TextAreaProps>();

// The guessed names are hint types that name the real prop.
expectTypeOf<{ label: "Notes"; errorMessage: "Required." }>().not.toExtend<TextAreaProps>();
expectTypeOf<{ label: "Notes"; helperText: "Hint" }>().not.toExtend<TextAreaProps>();
expectTypeOf<{ label: "Notes"; isInvalid: true }>().not.toExtend<TextAreaProps>();
expectTypeOf<{ label: "Notes"; invalid: true }>().not.toExtend<TextAreaProps>();
expectTypeOf<{ label: "Notes"; isRequired: true }>().not.toExtend<TextAreaProps>();
expectTypeOf<{ label: "Notes"; isDisabled: true }>().not.toExtend<TextAreaProps>();
expectTypeOf<{ label: "Notes"; minRows: 2 }>().not.toExtend<TextAreaProps>();
expectTypeOf<{ label: "Notes"; autoResize: true }>().not.toExtend<TextAreaProps>();
expectTypeOf<{ label: "Notes"; autosize: true }>().not.toExtend<TextAreaProps>();

// The same checks through JSX.
// @ts-expect-error minRows is not a prop; rows is the minimum.
createElement(TextArea, { label: "Notes", minRows: 2 });
// @ts-expect-error label is required.
createElement(TextArea, { rows: 3 });
