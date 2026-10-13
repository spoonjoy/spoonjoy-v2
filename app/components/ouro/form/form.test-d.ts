import { createElement } from "react";
import { expectTypeOf } from "vitest";
import { Form, type FormErrors, type FormProps } from "~/components/ouro/form/form";

// Type tests: `pnpm typecheck` compiles this file, and every `@ts-expect-error`
// fails the check if the line below it stops being an error.

// Valid shapes: errors by field name (one message or several), form attributes.
expectTypeOf<{ name: "Required."; tags: ["Too many.", "Pick one."] }>().toExtend<FormErrors>();
expectTypeOf<{ children: "Fields" }>().toExtend<FormProps>();
expectTypeOf<{ children: "Fields"; errors: { name: "Required." }; method: "post"; action: "/recipes"; className: "mt-4" }>().toExtend<FormProps>();
expectTypeOf<{ children: "Fields"; errors: null }>().toExtend<FormProps>();
createElement(Form, { onSubmit: (event) => event.preventDefault(), children: "Fields" });

// Error values are strings.
expectTypeOf<{ children: "Fields"; errors: { name: 1 } }>().not.toExtend<FormProps>();

// The guessed name is a hint type that names the real prop.
expectTypeOf<{ children: "Fields"; validationErrors: { name: "Required." } }>().not.toExtend<FormProps>();

// The same check through JSX.
// @ts-expect-error validationErrors is not a prop; use errors.
createElement(Form, { validationErrors: { name: "Required." }, children: "Fields" });
