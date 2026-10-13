import { createElement } from "react";
import { expectTypeOf } from "vitest";
import { NativeSelect, type NativeSelectProps } from "~/components/ouro/select/native-select";

// Type tests: `pnpm typecheck` compiles this file, and every `@ts-expect-error`
// fails the check if the line below it stops being an error.

// Valid shapes: the Field contract, options with groups, children, and select attributes.
expectTypeOf<{ label: "Country" }>().toExtend<NativeSelectProps>();
createElement(NativeSelect, {
  label: "Country",
  hideLabel: true,
  description: "Where you live.",
  error: "Required.",
  required: true,
  disabled: false,
  name: "country",
  placeholder: "Choose a country",
  options: [{ value: "nz", label: "New Zealand" }, { label: "Europe", options: [{ value: "fr", label: "France", disabled: true }] }],
  autoComplete: "country",
  className: "mt-4",
});
createElement(NativeSelect, { label: "Country" }, createElement("option", { value: "nz" }, "New Zealand"));
expectTypeOf<{ label: "Country"; value: "nz"; onValueChange: (value: string) => void; onChange: () => void }>().toExtend<NativeSelectProps>();

// The label is required, and is a string.
expectTypeOf<{ name: "country" }>().not.toExtend<NativeSelectProps>();
expectTypeOf<{ label: 1 }>().not.toExtend<NativeSelectProps>();

// multiple is not supported: the hint names Select.
expectTypeOf<{ label: "Tags"; multiple: true }>().not.toExtend<NativeSelectProps>();
expectTypeOf<{ label: "Tags"; isMulti: true }>().not.toExtend<NativeSelectProps>();

// The guessed names are hint types that name the real prop.
expectTypeOf<{ label: "Country"; errorMessage: "Required." }>().not.toExtend<NativeSelectProps>();
expectTypeOf<{ label: "Country"; helperText: "Hint" }>().not.toExtend<NativeSelectProps>();
expectTypeOf<{ label: "Country"; isInvalid: true }>().not.toExtend<NativeSelectProps>();
expectTypeOf<{ label: "Country"; invalid: true }>().not.toExtend<NativeSelectProps>();
expectTypeOf<{ label: "Country"; isRequired: true }>().not.toExtend<NativeSelectProps>();
expectTypeOf<{ label: "Country"; isDisabled: true }>().not.toExtend<NativeSelectProps>();

// The same checks through JSX.
// @ts-expect-error multiple is not a NativeSelect prop; use Select.
createElement(NativeSelect, { label: "Tags", multiple: true });
// @ts-expect-error label is required.
createElement(NativeSelect, { name: "country" });
