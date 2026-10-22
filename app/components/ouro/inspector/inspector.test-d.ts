import { expectTypeOf } from "vitest";
import { type InspectorProps } from "~/components/ouro/inspector/inspector";

// Type tests: `pnpm typecheck` compiles this file, and every `@ts-expect-error`
// fails the check if the line below it stops being an error.

type Docs = (item: string) => string;
type OnOpenChange = (open: boolean) => void;

// Valid shapes: the least X-ray needs, and every prop.
expectTypeOf<{ open: true; onOpenChange: OnOpenChange }>().toExtend<InspectorProps>();
expectTypeOf<{ open: false; onOpenChange: OnOpenChange; docsHref: Docs; sourceHref: (item: string, element: Element) => string | undefined; label: "Components" }>().toExtend<InspectorProps>();

// open and onOpenChange are required; docsHref defaults to Ouro's public docs.
expectTypeOf<{ onOpenChange: OnOpenChange; docsHref: Docs }>().not.toExtend<InspectorProps>();
expectTypeOf<{ open: true; docsHref: Docs }>().not.toExtend<InspectorProps>();
expectTypeOf<{ open: true; onOpenChange: OnOpenChange; docsHref: "/docs" }>().not.toExtend<InspectorProps>();

// The props agents guess are hint types that name the real one.
expectTypeOf<{ open: true; onOpenChange: OnOpenChange; docsHref: Docs; isOpen: true }>().not.toExtend<InspectorProps>();
expectTypeOf<{ open: true; onOpenChange: OnOpenChange; docsHref: Docs; onClose: () => void }>().not.toExtend<InspectorProps>();
