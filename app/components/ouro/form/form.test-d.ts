import { createElement } from "react";
import { expectTypeOf } from "vitest";
import { Form, type FormErrors, type FormProps, type ReadonlyFormErrors } from "~/components/ouro/form/form";
import { formErrors, formErrorIdentity, type FormErrorValue } from "~/lib/ouro/form-answer";
import { errorMessages, type ErrorMessage, type ErrorMessages } from "~/lib/ouro/use-field";

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
const rawMessages: ErrorMessages = ["Taken."];
rawMessages.push("Try again.");
const rawErrors: FormErrors = { email: rawMessages };
rawErrors.email = ["Replacement."];
const readonlyErrors = { email: ["Taken."] as const };
const snapshot = formErrors({}, readonlyErrors);
expectTypeOf<FormErrors>().toExtend<ReadonlyFormErrors>();
expectTypeOf<FormErrorValue>().toExtend<ReadonlyFormErrors>();
expectTypeOf<ReadonlyFormErrors>().toExtend<NonNullable<FormProps["errors"]>>();
formErrors("cached", readonlyErrors, { key: "accepted-2" });
formErrorIdentity(readonlyErrors);
formErrorIdentity(snapshot);
createElement(Form, { errors: readonlyErrors, children: "Fields" });
const normalized = errorMessages(snapshot.email);
normalized.push("Fresh mutable copy.");
errorMessages(readonlyErrors.email);
type SnapshotMessages = Extract<NonNullable<FormErrorValue["email"]>, readonly ErrorMessage[]>;
declare const snapshotMessages: SnapshotMessages;
// @ts-expect-error Snapshot arrays cannot be appended to.
snapshotMessages.push("Changed.");
// @ts-expect-error Snapshot arrays cannot be spliced.
snapshotMessages.splice(0, 1);
// @ts-expect-error Snapshot array entries cannot be assigned.
snapshotMessages[0] = "Changed.";
// @ts-expect-error Snapshot arrays cannot be truncated.
snapshotMessages.length = 0;
// @ts-expect-error A snapshot is not a mutable raw-error builder.
const mutableSnapshot: FormErrors = snapshot;
void mutableSnapshot;
// Array.isArray narrows to any[] in TypeScript; runtime freezing still rejects this bypass.
if (Array.isArray(snapshot.email)) snapshot.email.push("Rejected at runtime.");
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
