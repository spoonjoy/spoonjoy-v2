import { createElement } from "react";
import { expectTypeOf } from "vitest";
import { Switch, type SwitchProps } from "~/components/ouro/switch/switch";

// Type tests: `pnpm typecheck` compiles this file, and every `@ts-expect-error`
// fails the check if the line below it stops being an error.

// Valid shapes: the Field contract, the on state and the submitted value.
expectTypeOf<{ label: "Wi-Fi" }>().toExtend<SwitchProps>();
expectTypeOf<{
  label: "Wi-Fi";
  hideLabel: true;
  description: "Faster at home.";
  error: "Turn it on.";
  required: true;
  disabled: true;
  name: "wifi";
  value: "yes";
  checked: true;
  onCheckedChange: (checked: boolean) => void;
  readOnly: true;
  className: "mt-4";
}>().toExtend<SwitchProps>();
expectTypeOf<{ label: "Wi-Fi"; defaultChecked: true }>().toExtend<SwitchProps>();

// The label is required.
expectTypeOf<{ checked: true }>().not.toExtend<SwitchProps>();

// The guessed names are hint types that name the real prop.
expectTypeOf<{ label: "Wi-Fi"; onChange: () => void }>().not.toExtend<SwitchProps>();
expectTypeOf<{ label: "Wi-Fi"; isChecked: true }>().not.toExtend<SwitchProps>();
expectTypeOf<{ label: "Wi-Fi"; defaultValue: true }>().not.toExtend<SwitchProps>();
expectTypeOf<{ label: "Wi-Fi"; errorMessage: "Required." }>().not.toExtend<SwitchProps>();
expectTypeOf<{ label: "Wi-Fi"; isDisabled: true }>().not.toExtend<SwitchProps>();

// The same checks through JSX.
// @ts-expect-error onChange is not a prop; onCheckedChange gets the new state.
createElement(Switch, { label: "Wi-Fi", onChange: () => {} });
// @ts-expect-error label is required.
createElement(Switch, { checked: true });
