import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { Toaster, type ToasterProps } from "~/components/ouro/toast/toaster";
import { toast, type ToastOptions } from "~/lib/ouro/toast";

// Type tests: `pnpm typecheck` compiles this file, and every `@ts-expect-error`
// fails the check if the line below it stops being an error.

// Toaster takes its labels and a viewport layout class; Sonner's props are hint types.
createElement(Toaster, { className: "bottom-20 w-80" });
expectTypeOf<{ className: string | undefined }>().toExtend<ToasterProps>();
expectTypeOf<{ style: { bottom: number } }>().not.toExtend<ToasterProps>();
expectTypeOf<{ offset: number }>().not.toExtend<ToasterProps>();
expectTypeOf<Record<string, never>>().toExtend<ToasterProps>();
expectTypeOf<{ label: "Benachrichtigungen"; closeLabel: "Schließen" }>().toExtend<ToasterProps>();
expectTypeOf<ComponentProps<typeof Toaster>>().toEqualTypeOf<ToasterProps>();
expectTypeOf<{ position: "top-center" }>().not.toExtend<ToasterProps>();
expectTypeOf<{ richColors: true }>().not.toExtend<ToasterProps>();
expectTypeOf<{ theme: "dark" }>().not.toExtend<ToasterProps>();
expectTypeOf<{ duration: 3000 }>().not.toExtend<ToasterProps>();
// @ts-expect-error Sonner's position is not a prop.
createElement(Toaster, { position: "top-center" });

// toast(message, options) returns the id.
expectTypeOf(toast).returns.toEqualTypeOf<string>();
expectTypeOf(toast("Saved")).toEqualTypeOf<string>();
expectTypeOf<{
  tone: "success";
  description: "In your cookbook.";
  action: { label: "Undo"; onClick: () => void };
  duration: 8000;
  id: "save";
}>().toExtend<ToastOptions>();
expectTypeOf(toast.dismiss).toEqualTypeOf<(id?: string) => void>();

// The message is required and is a string; a tone is one of the five.
// @ts-expect-error The message is required.
toast();
// @ts-expect-error The message is the first argument, not an option.
toast({ title: "Saved" });
expectTypeOf<{ tone: "error" }>().not.toExtend<ToastOptions>();
expectTypeOf<{ tone: "info" }>().not.toExtend<ToastOptions>();
expectTypeOf<{ type: "success" }>().not.toExtend<ToastOptions>();
expectTypeOf<{ variant: "destructive" }>().not.toExtend<ToastOptions>();
expectTypeOf<{ timeout: 8000 }>().not.toExtend<ToastOptions>();
expectTypeOf<{ title: "Saved" }>().not.toExtend<ToastOptions>();
expectTypeOf<{ action: { label: "Undo" } }>().not.toExtend<ToastOptions>();

// Sonner's shortcuts are not callable; their types name the call to use.
// @ts-expect-error Use toast("Saved", { tone: "success" }).
toast.success("Saved");
// @ts-expect-error Use toast("Failed", { tone: "destructive" }).
toast.error("Failed");
// @ts-expect-error Use toast("Careful", { tone: "warning" }).
toast.warning("Careful");
// @ts-expect-error Use toast("Heads up", { tone: "primary" }).
toast.info("Heads up");
