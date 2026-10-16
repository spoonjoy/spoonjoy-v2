import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { Alert, type AlertProps } from "~/components/ouro/alert/alert";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<{ title: "Saved" }>().toExtend<AlertProps>();
expectTypeOf<{ title: "Couldn't save"; description: "Try again."; tone: "destructive"; onDismiss: () => void; dismissLabel: "Close"; icon: null }>().toExtend<AlertProps>();
expectTypeOf<ComponentProps<typeof Alert>>().toEqualTypeOf<AlertProps>();

// title is required; other libraries' props name the fix.
expectTypeOf<{ description: "Saved" }>().not.toExtend<AlertProps>();
expectTypeOf<{ title: "x"; variant: "destructive" }>().not.toExtend<AlertProps>();
expectTypeOf<{ title: "x"; severity: "error" }>().not.toExtend<AlertProps>();
expectTypeOf<{ title: "x"; status: "info" }>().not.toExtend<AlertProps>();
expectTypeOf<{ title: "x"; onClose: () => void }>().not.toExtend<AlertProps>();
expectTypeOf<{ title: "x"; children: "Body" }>().not.toExtend<AlertProps>();
expectTypeOf<{ title: "x"; tone: "info" }>().not.toExtend<AlertProps>();

// @ts-expect-error title is required.
createElement(Alert, { description: "Saved" });
