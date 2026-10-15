import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { DescriptionList, type DescriptionListProps } from "~/components/ouro/description-list/description-list";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<ComponentProps<typeof DescriptionList>>().toEqualTypeOf<DescriptionListProps>();
expectTypeOf<{ items: [{ term: "Prep time"; details: "20 minutes" }]; stackBelow: "md" }>().toExtend<DescriptionListProps>();

// Items are { term, details }; the names other libraries use are hint types.
expectTypeOf<{ items: [{ label: "Prep time"; details: "20 minutes" }] }>().not.toExtend<DescriptionListProps>();
expectTypeOf<{ items: [{ term: "Prep time"; value: "20 minutes" }] }>().not.toExtend<DescriptionListProps>();
expectTypeOf<{ items: []; stackBelow: "lg" }>().not.toExtend<DescriptionListProps>();
expectTypeOf<{ items: []; data: [] }>().not.toExtend<DescriptionListProps>();
expectTypeOf<{ items: []; children: "x" }>().not.toExtend<DescriptionListProps>();

// @ts-expect-error items are required.
createElement(DescriptionList, {});
