import { createElement } from "react";
import { expectTypeOf } from "vitest";
import { Checkbox, type CheckboxProps } from "~/components/ouro/checkbox/checkbox";
expectTypeOf<readonly ["Taken."]>().toExtend<NonNullable<CheckboxProps["error"]>>();

// Type tests: `pnpm typecheck` compiles this file, and every `@ts-expect-error`
// fails the check if the line below it stops being an error.

// Valid shapes: the Field contract, the checked state and the submitted value.
expectTypeOf<{ label: "Basil" }>().toExtend<CheckboxProps>();
expectTypeOf<{
  label: "I accept the terms";
  hideLabel: true;
  description: "Read them first.";
  error: "Accept the terms.";
  required: true;
  disabled: true;
  name: "terms";
  value: "yes";
  checked: true;
  onCheckedChange: (checked: boolean) => void;
  indeterminate: true;
  readOnly: true;
  className: "mt-4";
}>().toExtend<CheckboxProps>();
expectTypeOf<{ label: "Basil"; defaultChecked: true }>().toExtend<CheckboxProps>();

// The label is required, and is a string.
expectTypeOf<{ checked: true }>().not.toExtend<CheckboxProps>();
expectTypeOf<{ label: 1 }>().not.toExtend<CheckboxProps>();
// onCheckedChange gets a boolean, not an event.
expectTypeOf<{ label: "Basil"; onCheckedChange: (event: Event) => void }>().not.toExtend<CheckboxProps>();

// The guessed names are hint types that name the real prop.
expectTypeOf<{ label: "Basil"; onChange: () => void }>().not.toExtend<CheckboxProps>();
expectTypeOf<{ label: "Basil"; isChecked: true }>().not.toExtend<CheckboxProps>();
expectTypeOf<{ label: "Basil"; isIndeterminate: true }>().not.toExtend<CheckboxProps>();
expectTypeOf<{ label: "Basil"; defaultValue: true }>().not.toExtend<CheckboxProps>();
expectTypeOf<{ label: "Basil"; errorMessage: "Required." }>().not.toExtend<CheckboxProps>();
expectTypeOf<{ label: "Basil"; helperText: "Hint" }>().not.toExtend<CheckboxProps>();
expectTypeOf<{ label: "Basil"; isInvalid: true }>().not.toExtend<CheckboxProps>();
expectTypeOf<{ label: "Basil"; invalid: true }>().not.toExtend<CheckboxProps>();
expectTypeOf<{ label: "Basil"; isRequired: true }>().not.toExtend<CheckboxProps>();
expectTypeOf<{ label: "Basil"; isDisabled: true }>().not.toExtend<CheckboxProps>();

// The same checks through JSX.
// @ts-expect-error onChange is not a prop; onCheckedChange gets the new state.
createElement(Checkbox, { label: "Basil", onChange: () => {} });
// @ts-expect-error label is required.
createElement(Checkbox, { checked: true });
