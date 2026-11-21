import { type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { Fieldset, type FieldsetProps } from "~/components/ouro/field/fieldset";

// A call site's props, typed as the component takes them. A case below keeps children in the props object because it
// checks the props a call passes, children among them, and a .ts file has no JSX to put children in; an app's lint
// (react(no-children-prop)) flags children passed in createElement's props, so the check doesn't call createElement.
const propsOf = <P>(value: P): P => value;

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
propsOf<ComponentProps<typeof Fieldset>>({ children: null });
