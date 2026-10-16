import { type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { ItemGroup, type ItemGroupProps } from "~/components/ouro/item/item-group";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<ComponentProps<typeof ItemGroup>>().toEqualTypeOf<ItemGroupProps>();
expectTypeOf<{ label: "Tokens"; empty: "None"; variant: "outline"; ordered: true }>().toExtend<ItemGroupProps>();
expectTypeOf<{ "aria-label": "Tokens"; variant: "plain" }>().toExtend<ItemGroupProps>();

expectTypeOf<{ title: "Tokens" }>().not.toExtend<ItemGroupProps>();
expectTypeOf<{ items: [] }>().not.toExtend<ItemGroupProps>();
expectTypeOf<{ divided: true }>().not.toExtend<ItemGroupProps>();
expectTypeOf<{ variant: "separated" }>().not.toExtend<ItemGroupProps>();
