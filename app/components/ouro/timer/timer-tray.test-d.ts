import { createElement, type ComponentProps, type RefObject } from "react";
import { expectTypeOf } from "vitest";
import { TimerTray, type TimerTrayProps } from "~/components/ouro/timer/timer-tray";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<{ timers: [] }>().toExtend<TimerTrayProps>();
expectTypeOf<{ timers: [{ timerId: "pasta"; label: "Pasta"; duration: 600; href: "/steps/2" }]; label: "Timers"; silent: true; labels: { goTo: "Open" }; className: "sticky top-0" }>().toExtend<TimerTrayProps>();
expectTypeOf<{ timers: []; finalFocus: RefObject<HTMLHeadingElement | null> }>().toExtend<TimerTrayProps>();
expectTypeOf<ComponentProps<typeof TimerTray>>().toEqualTypeOf<TimerTrayProps>();

// timers is required, and each needs its timerId, label and duration.
expectTypeOf<{ label: "Timers" }>().not.toExtend<TimerTrayProps>();
expectTypeOf<{ timers: [{ label: "Pasta"; duration: 600 }] }>().not.toExtend<TimerTrayProps>();

// Guessed props name the fix.
expectTypeOf<{ timers: []; items: [] }>().not.toExtend<TimerTrayProps>();
expectTypeOf<{ timers: []; hidden: true }>().not.toExtend<TimerTrayProps>();
expectTypeOf<{ timers: [{ id: "pasta"; label: "Pasta"; duration: 600 }] }>().not.toExtend<TimerTrayProps>();
expectTypeOf<{ timers: [{ timerId: "pasta"; id: "pasta"; label: "Pasta"; duration: 600 }] }>().not.toExtend<TimerTrayProps>();

// @ts-expect-error items is not a prop.
createElement(TimerTray, { timers: [], items: [] });
