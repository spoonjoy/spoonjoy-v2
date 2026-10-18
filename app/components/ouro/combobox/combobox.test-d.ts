import { createElement } from "react";
import { expectTypeOf } from "vitest";
import { Combobox, type ComboboxProps } from "~/components/ouro/combobox/combobox";
expectTypeOf<readonly ["Taken."]>().toExtend<NonNullable<ComboboxProps["error"]>>();

// Type tests: `pnpm typecheck` compiles this file, and every `@ts-expect-error`
// fails the check if the line below it stops being an error.

// Valid shapes: the Field contract, items as strings or objects, and each mode.
expectTypeOf<{ label: "Herb"; items: ["Basil", "Dill"] }>().toExtend<ComboboxProps>();
expectTypeOf<{
  label: "Cheese";
  hideLabel: true;
  description: "From the market.";
  error: ["Required."];
  required: true;
  disabled: true;
  name: "cheese";
  items: [{ value: "brie"; label: "Brie"; disabled: true }, "Gouda"];
  placeholder: "Pick a cheese";
  value: "brie";
  onValueChange: (value: string | null) => void;
  onInputChange: (text: string) => void;
  loading: true;
  loadingLabel: "Lädt…";
  emptyLabel: "Nichts";
  clearLabel: "Leeren";
  doneLabel: "Fertig";
  className: "mt-4";
}>().toExtend<ComboboxProps>();
expectTypeOf<{ label: "Herbs"; items: string[]; multiple: true; defaultValue: ["Basil"]; onValueChange: (value: string[]) => void; removeLabel: (label: string) => string }>().toExtend<ComboboxProps>();
expectTypeOf<{
  label: "Cuisine";
  items: string[];
  allowCustomValue: true;
  value: "Thai";
  onValueChange: (value: string) => void;
  customValueLabel: (text: string) => string;
}>().toExtend<ComboboxProps>();
// customValueLabel names the sheet's row for typed text, which only allowCustomValue has.
expectTypeOf<{ label: "Herb"; items: string[]; customValueLabel: (text: string) => string }>().not.toExtend<ComboboxProps>();

// The value's type follows the mode.
expectTypeOf<{ label: "Herbs"; items: string[]; multiple: true; value: "Basil" }>().not.toExtend<ComboboxProps>();
expectTypeOf<{ label: "Herb"; items: string[]; value: ["Basil"] }>().not.toExtend<ComboboxProps>();
expectTypeOf<{ label: "Cuisine"; items: string[]; allowCustomValue: true; value: null }>().not.toExtend<ComboboxProps>();
// One typed value only: multiple and allowCustomValue do not combine.
expectTypeOf<{ label: "Tags"; items: string[]; multiple: true; allowCustomValue: true }>().not.toExtend<ComboboxProps>();
// removeLabel names chips, which only multiple has.
expectTypeOf<{ label: "Herb"; items: string[]; removeLabel: (label: string) => string }>().not.toExtend<ComboboxProps>();

// The label and items are required.
expectTypeOf<{ items: string[] }>().not.toExtend<ComboboxProps>();
expectTypeOf<{ label: "Herb" }>().not.toExtend<ComboboxProps>();

// The guessed names are hint types that name the real prop.
type Guess =
  | "errorMessage"
  | "helperText"
  | "isInvalid"
  | "invalid"
  | "isRequired"
  | "isDisabled"
  | "options"
  | "isLoading"
  | "isMulti"
  | "freeSolo"
  | "creatable"
  | "onSearch"
  | "onInputValueChange"
  | "onChange"
  | "noOptionsMessage"
  | "isClearable";
// Each name on its own: none of them is accepted.
type Accepted = { [K in Guess]: { label: "Herb"; items: string[] } & Record<K, true> extends ComboboxProps ? K : never }[Guess];
expectTypeOf<Accepted>().toEqualTypeOf<never>();

// The same checks through JSX.
// @ts-expect-error options is not a prop; use items.
createElement(Combobox, { label: "Herb", options: ["Basil"] });
// @ts-expect-error label is required.
createElement(Combobox, { items: ["Basil"] });
