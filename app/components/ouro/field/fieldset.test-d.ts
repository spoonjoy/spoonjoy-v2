import { createElement } from "react";
import { expectTypeOf } from "vitest";
import { Fieldset, type FieldsetProps } from "~/components/ouro/field/fieldset";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<{ legend: "Shipping"; children: null }>().toExtend<FieldsetProps>();
expectTypeOf<{
  legend: "Shipping";
  hideLegend: true;
  description: "Where we send it.";
  disabled: true;
  className: "mt-6";
  children: null;
}>().toExtend<FieldsetProps>();
// Groups take legend, not label.
expectTypeOf<{ children: null }>().not.toExtend<FieldsetProps>();
expectTypeOf<{ label: "Shipping"; legend: "Shipping"; children: null }>().not.toExtend<FieldsetProps>();

// @ts-expect-error legend is required.
createElement(Fieldset, { children: null });
