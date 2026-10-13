import { createElement } from "react";
import { expectTypeOf } from "vitest";
import { TextField, type TextFieldProps } from "~/components/ouro/text-field/text-field";

// Type tests: `pnpm typecheck` compiles this file, and every `@ts-expect-error`
// fails the check if the line below it stops being an error.

// Valid shapes: the Field contract, every supported type, adornments and input attributes.
expectTypeOf<{ label: "Email" }>().toExtend<TextFieldProps>();
expectTypeOf<{
  label: "Email";
  hideLabel: true;
  description: "We never share it.";
  error: ["Required.", "Use a full address."];
  required: true;
  disabled: true;
  name: "email";
  type: "email";
  placeholder: "you@example.com";
  autoComplete: "username";
  clearable: true;
  startAdornment: "@";
  endAdornment: null;
  className: "mt-4";
}>().toExtend<TextFieldProps>();
for (const type of ["text", "email", "password", "tel", "url", "search", "date", "time"] as const) {
  createElement(TextField, { label: "Value", type });
}
expectTypeOf<{ label: "Search"; value: "pasta"; onValueChange: (value: string) => void }>().toExtend<TextFieldProps>();
// The button labels translate.
expectTypeOf<{ label: "Passwort"; type: "password"; showPasswordLabel: "Passwort anzeigen"; clearable: true; clearLabel: "Leeren" }>().toExtend<TextFieldProps>();
expectTypeOf<{ label: "Passwort"; showPasswordLabel: 1 }>().not.toExtend<TextFieldProps>();
// There is one toggle label: the pressed state says whether the password shows.
// @ts-expect-error hidePasswordLabel is not a prop.
createElement(TextField, { label: "Passwort", type: "password", hidePasswordLabel: "Passwort verbergen" });

// The label is required, and is a string.
expectTypeOf<{ type: "email" }>().not.toExtend<TextFieldProps>();
expectTypeOf<{ label: 1 }>().not.toExtend<TextFieldProps>();

// number is not a TextField type: the hint names NumberField.
expectTypeOf<{ label: "Servings"; type: "number" }>().not.toExtend<TextFieldProps>();
expectTypeOf<{ label: "Color"; type: "color" }>().not.toExtend<TextFieldProps>();

// The guessed names are hint types that name the real prop.
expectTypeOf<{ label: "Email"; errorMessage: "Required." }>().not.toExtend<TextFieldProps>();
expectTypeOf<{ label: "Email"; helperText: "Hint" }>().not.toExtend<TextFieldProps>();
expectTypeOf<{ label: "Email"; isInvalid: true }>().not.toExtend<TextFieldProps>();
expectTypeOf<{ label: "Email"; invalid: true }>().not.toExtend<TextFieldProps>();
expectTypeOf<{ label: "Email"; isRequired: true }>().not.toExtend<TextFieldProps>();
expectTypeOf<{ label: "Email"; isDisabled: true }>().not.toExtend<TextFieldProps>();
expectTypeOf<{ label: "Search"; startIcon: () => null }>().not.toExtend<TextFieldProps>();
expectTypeOf<{ label: "Search"; leftIcon: () => null }>().not.toExtend<TextFieldProps>();
expectTypeOf<{ label: "Search"; endIcon: () => null }>().not.toExtend<TextFieldProps>();
expectTypeOf<{ label: "Search"; rightIcon: () => null }>().not.toExtend<TextFieldProps>();
expectTypeOf<{ label: "Price"; prefix: "$" }>().not.toExtend<TextFieldProps>();
expectTypeOf<{ label: "Weight"; suffix: "kg" }>().not.toExtend<TextFieldProps>();
expectTypeOf<{ label: "Search"; isClearable: true }>().not.toExtend<TextFieldProps>();
expectTypeOf<{ label: "Notes"; multiline: true }>().not.toExtend<TextFieldProps>();

// The same checks through JSX.
// @ts-expect-error number is not a TextField type; use NumberField.
createElement(TextField, { label: "Servings", type: "number" });
// @ts-expect-error label is required.
createElement(TextField, { type: "email" });
