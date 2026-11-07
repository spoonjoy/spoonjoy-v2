import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { ChoiceCard, type ChoiceCardProps } from "~/components/ouro/choice-card/choice-card";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<{ legend: "Cover"; items: [{ value: "a"; label: "A" }] }>().toExtend<ChoiceCardProps>();
expectTypeOf<{ legend: "Cover"; items: []; value: "a"; onValueChange: (value: string) => void; name: "cover"; error: "Pick one."; required: true; disabled: false; columns: 4; hideLegend: true; className: "mt-6" }>().toExtend<ChoiceCardProps>();
expectTypeOf<ComponentProps<typeof ChoiceCard>>().toEqualTypeOf<ChoiceCardProps>();

// legend and items are required.
expectTypeOf<{ items: [] }>().not.toExtend<ChoiceCardProps>();
expectTypeOf<{ legend: "Cover" }>().not.toExtend<ChoiceCardProps>();

// Guessed props and values name the fix.
expectTypeOf<{ legend: "C"; items: []; options: [] }>().not.toExtend<ChoiceCardProps>();
expectTypeOf<{ legend: "C"; items: []; label: "C" }>().not.toExtend<ChoiceCardProps>();
expectTypeOf<{ legend: "C"; items: []; onChange: () => void }>().not.toExtend<ChoiceCardProps>();
expectTypeOf<{ legend: "C"; items: []; columns: 6 }>().not.toExtend<ChoiceCardProps>();

// @ts-expect-error options is not a prop.
createElement(ChoiceCard, { legend: "C", items: [], options: [] });
