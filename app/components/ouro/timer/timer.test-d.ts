import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { Timer, type TimerProps } from "~/components/ouro/timer/timer";
import type { TimerOptions } from "~/lib/ouro/use-timer";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<{ label: "Pasta"; duration: 600 }>().toExtend<TimerProps>();
expectTypeOf<{ label: "Pasta"; duration: 600; timerId: "pasta"; id: "pasta-timer"; silent: true; size: "lg"; labels: { start: "Go" }; onDone: () => void; className: "mt-6" }>().toExtend<TimerProps>();
expectTypeOf<ComponentProps<typeof Timer>>().toEqualTypeOf<TimerProps>();

// label and duration are required.
expectTypeOf<{ duration: 600 }>().not.toExtend<TimerProps>();
expectTypeOf<{ label: "Pasta" }>().not.toExtend<TimerProps>();

// Guessed props and values name the fix.
expectTypeOf<{ label: "P"; duration: 1; seconds: 600 }>().not.toExtend<TimerProps>();
expectTypeOf<{ label: "P"; duration: 1; minutes: 10 }>().not.toExtend<TimerProps>();
expectTypeOf<{ label: "P"; duration: 1; onComplete: () => void }>().not.toExtend<TimerProps>();
expectTypeOf<{ label: "P"; duration: 1; size: "xl" }>().not.toExtend<TimerProps>();
expectTypeOf<{ label: "P"; duration: 1; autoSaveId: "pasta" }>().not.toExtend<TimerProps>();
expectTypeOf<{ label: "P"; duration: 1; storageKey: "pasta" }>().not.toExtend<TimerProps>();

// useTimer keeps and shares a timer by timerId, not id.
expectTypeOf<{ duration: 600; timerId: "pasta"; fallback: true; onDone: () => void }>().toExtend<TimerOptions>();
expectTypeOf<{ duration: 600; id: "pasta" }>().not.toExtend<TimerOptions>();

// @ts-expect-error minutes is not a prop.
createElement(Timer, { label: "P", duration: 1, minutes: 10 });
