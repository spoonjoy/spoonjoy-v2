import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { ShowMore, type ShowMoreProps } from "~/components/ouro/collapsible/show-more";

// Type tests: `pnpm typecheck` compiles this file.

type Items = string[];

// Three modes: lines, items, and items that load more.
expectTypeOf<{ lines: 3; children: "Long text" }>().toExtend<ShowMoreProps>();
expectTypeOf<{ items: Items; initialCount: 3; ordered: true; showLessLabel: "Less" }>().toExtend<ShowMoreProps>();
expectTypeOf<{ items: Items; hasMore: true; loading: false; onShowMore: () => void; href: "?after=2" }>().toExtend<ShowMoreProps>();
expectTypeOf<ComponentProps<typeof ShowMore>>().toEqualTypeOf<ShowMoreProps>();

// Mixing modes is a type error.
expectTypeOf<{ lines: 3; children: "Long text"; items: Items }>().not.toExtend<ShowMoreProps>();
expectTypeOf<{ items: Items; initialCount: 3; onShowMore: () => void; hasMore: true }>().not.toExtend<ShowMoreProps>();
expectTypeOf<{ items: Items; onShowMore: () => void }>().not.toExtend<ShowMoreProps>();
expectTypeOf<{ items: Items; hasMore: true; onShowMore: () => void; showLessLabel: "Less" }>().not.toExtend<ShowMoreProps>();

// The guessed props name the fix.
expectTypeOf<{ lines: 3; children: "Long text"; maxLines: 3 }>().not.toExtend<ShowMoreProps>();
expectTypeOf<{ items: Items; limit: 3 }>().not.toExtend<ShowMoreProps>();

// @ts-expect-error lines, items or onShowMore is required.
createElement(ShowMore, {});
