import { createElement } from "react";
import { expectTypeOf } from "vitest";
import { Form, type FormErrors, type FormProps } from "~/components/ouro/form/form";
import { formErrors, type FormErrorValue } from "~/lib/ouro/form-answer";

// Type tests: `pnpm typecheck` compiles this file, and every `@ts-expect-error`
// fails the check if the line below it stops being an error.

// Valid shapes: errors by field name (one message or several), form attributes.
expectTypeOf<{ name: "Required."; tags: ["Too many.", "Pick one."] }>().toExtend<FormErrors>();
expectTypeOf<{ children: "Fields" }>().toExtend<FormProps>();
expectTypeOf<{ children: "Fields"; errors: { name: "Required." }; method: "post"; action: "/recipes"; className: "mt-4" }>().toExtend<FormProps>();
expectTypeOf<{ children: "Fields"; errors: null }>().toExtend<FormProps>();
createElement(Form, { onSubmit: (event) => event.preventDefault(), children: "Fields" });
expectTypeOf<FormErrorValue>().toExtend<NonNullable<FormProps["errors"]>>();
createElement(Form, { errors: formErrors({}, { email: "Taken." }), children: "Fields" });
formErrors(undefined, { email: undefined });
formErrors(null, null, { key: 0 });
formErrors("cached", {}, { key: "accepted-1" });
// @ts-expect-error Primitive sources need an explicit accepted key.
formErrors("cached", {});
// @ts-expect-error An explicitly undefined key is not absence.
formErrors({}, {}, { key: undefined });
// @ts-expect-error Values are read-only snapshots.
formErrors({}, {}).email = "Changed.";
// @ts-expect-error The unreleased second prop was replaced by one complete errors value.
createElement(Form, { result: {}, children: "Fields" });

// A key may hold nothing, so an object mapped from an action's answer needs no cleanup.
expectTypeOf<{ form: string | undefined; email: string | null; name: undefined }>().toExtend<FormErrors>();

// Error values are strings.
expectTypeOf<{ children: "Fields"; errors: { name: 1 } }>().not.toExtend<FormProps>();

// The guessed name is a hint type that names the real prop.
expectTypeOf<{ children: "Fields"; validationErrors: { name: "Required." } }>().not.toExtend<FormProps>();

// The same check through JSX.
// @ts-expect-error validationErrors is not a prop; use errors.
createElement(Form, { validationErrors: { name: "Required." }, children: "Fields" });
