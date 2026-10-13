import { createElement } from "react";
import { expectTypeOf } from "vitest";
import { Field, type FieldProps } from "~/components/ouro/field/field";

// Type tests: `pnpm typecheck` compiles this file, and every `@ts-expect-error`
// fails the check if the line below it stops being an error.

// Valid shapes: the Field contract every form control takes.
expectTypeOf<{ label: "Email"; children: null }>().toExtend<FieldProps>();
expectTypeOf<{
  label: "Email";
  hideLabel: true;
  description: "We never share it.";
  error: "Required.";
  required: true;
  disabled: true;
  name: "email";
  className: "mt-4";
  children: null;
}>().toExtend<FieldProps>();
expectTypeOf<{ label: "Password"; error: ["Too short.", "Add a number."]; children: null }>().toExtend<FieldProps>();
expectTypeOf<{ label: "Email"; error: undefined; children: null }>().toExtend<FieldProps>();

// The label is required, and is a string.
expectTypeOf<{ children: null }>().not.toExtend<FieldProps>();
expectTypeOf<{ label: 1; children: null }>().not.toExtend<FieldProps>();
// A boolean is not an error: pass the message.
expectTypeOf<{ label: "Email"; error: true; children: null }>().not.toExtend<FieldProps>();

// The guessed names are hint types that name the real prop.
expectTypeOf<{ label: "Email"; htmlFor: "email"; children: null }>().not.toExtend<FieldProps>();
expectTypeOf<{ label: "Email"; errorMessage: "Required."; children: null }>().not.toExtend<FieldProps>();
expectTypeOf<{ label: "Email"; helperText: "Hint"; children: null }>().not.toExtend<FieldProps>();
expectTypeOf<{ label: "Email"; isInvalid: true; children: null }>().not.toExtend<FieldProps>();
expectTypeOf<{ label: "Email"; invalid: true; children: null }>().not.toExtend<FieldProps>();
expectTypeOf<{ label: "Email"; isRequired: true; children: null }>().not.toExtend<FieldProps>();
expectTypeOf<{ label: "Email"; isDisabled: true; children: null }>().not.toExtend<FieldProps>();
expectTypeOf<{ label: "Email"; placeholder: "Email"; children: null }>().not.toExtend<FieldProps>();

// The same checks through JSX.
// @ts-expect-error errorMessage is not a prop; use error.
createElement(Field, { label: "Email", errorMessage: "Required.", children: null });
// @ts-expect-error label is required.
createElement(Field, { children: null });
