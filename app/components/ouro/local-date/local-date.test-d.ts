import { createElement, type ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { LocalDate, type DateFormat, type LocalDateProps } from "~/components/ouro/local-date/local-date";

// Type tests: `pnpm typecheck` compiles this file.

expectTypeOf<{ value: Date }>().toExtend<LocalDateProps>();
expectTypeOf<{ value: string; format: "datetime"; locale: "fr-FR"; className: "ms-1"; id: "due" }>().toExtend<LocalDateProps>();
expectTypeOf<{ value: number; format: DateFormat }>().toExtend<LocalDateProps>();
expectTypeOf<ComponentProps<typeof LocalDate>>().toEqualTypeOf<LocalDateProps>();
expectTypeOf<DateFormat>().toEqualTypeOf<"date" | "month" | "datetime" | "time">();

// value is required.
expectTypeOf<{ format: "date" }>().not.toExtend<LocalDateProps>();

// Guessed props and values name the fix.
expectTypeOf<{ value: Date; format: "long" }>().not.toExtend<LocalDateProps>();
expectTypeOf<{ date: Date }>().not.toExtend<LocalDateProps>();
expectTypeOf<{ value: Date; dateTime: string }>().not.toExtend<LocalDateProps>();
expectTypeOf<{ value: Date; children: "June 1" }>().not.toExtend<LocalDateProps>();

// @ts-expect-error date is not a prop.
createElement(LocalDate, { date: new Date() });
