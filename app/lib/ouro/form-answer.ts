import { isValidElement } from "react";
import { devThrow } from "~/lib/ouro/dev";
import type { ErrorMessages, ReadonlyErrorMessages } from "~/lib/ouro/use-field";

/** Display messages by field name; `form` holds messages about the whole form. */
export type FormErrors = Record<string, ErrorMessages | null | undefined>;

/** A read-only display projection for Form and EditSheet; mutable raw `FormErrors` remain valid inputs. */
export type ReadonlyFormErrors = Readonly<Record<string, ReadonlyErrorMessages | null | undefined>>;

/**
 * An accepted-answer key, compared with `Object.is`. Advance it on acceptance, never submit start.
 *
 * @claim "Advance it on acceptance, never submit" registry/ouro/components/ouro/form/form.test.tsx verify:testExists(registry/ouro/components/ouro/form/form.test.tsx::Form > answer-bearing errors > keeps a cached answer cleared for key zero, including rebuilt sources, and restores once for its next acceptance key)
 */
export type FormErrorKey = string | number | bigint | boolean | symbol | object;

declare const errorValueBrand: unique symbol;

/**
 * A read-only message snapshot with private, in-memory answer identity. Create it with
 * `formErrors`; JSON, spread, structured cloning and server-component transport retain
 * only the messages, not its identity. Reconstruct it beside Form on the server and in the browser.
 * Array containers are snapshotted and frozen; React elements are retained, not cloned.
 * React nodes are render inputs, not a promise that arbitrary node graphs JSON-serialize.
 * Snapshot arrays are readonly, so use this type or `ReadonlyFormErrors`, not a mutable
 * `FormErrors` annotation. This is not deep immutability of React nodes. TypeScript's
 * `Array.isArray` narrows to `any[]` and can bypass readonly; runtime freezing still rejects mutation.
 */
export type FormErrorValue = ReadonlyFormErrors & { readonly [errorValueBrand]: true };

/**
 * The private identity decoded by Form; tokens never retain source objects. @internal
 *
 * @claim "The private identity decoded by Form" registry/ouro/lib/ouro/form-answer.test.ts verify:testExists(registry/ouro/lib/ouro/form-answer.test.ts::formErrors answer value > interns object keys without retaining the key payload and lets the key override source identity)
 */
export type FormErrorIdentity = { readonly kind: "answer" | "key" | "none"; readonly value: FormErrorKey | undefined };

const values = new WeakMap<object, FormErrorIdentity>();
const tokens = new WeakMap<object, object>();

function token(source: object): object {
  let identity = tokens.get(source);
  if (!identity) {
    identity = Object.freeze({});
    tokens.set(source, identity);
  }
  return identity;
}

const isObject = (value: unknown): value is object => (typeof value === "object" && value !== null) || typeof value === "function";

/**
 * Binds a message projection to the accepted answer that owns it, inside Form's single
 * `errors` prop: `errors={formErrors(actionData, actionData?.errors)}`. Fresh values and
 * mapped messages for the same answer are presentation updates, not new answers; edited
 * fields stay cleared. A different accepted answer resets those clears and focuses once.
 *
 * Without a key, use an object answer; `null`/`undefined` mean no accepted answer yet.
 * Cached/reused or primitive answers need `{ key }`, advanced only when that answer is
 * accepted. Keys use `Object.is`, including `0`, `""`, `false`, `NaN` and signed zero;
 * an explicitly null/undefined key is invalid. A key overrides source identity.
 *
 * No source properties are read or retained in the returned value or its metadata.
 * Only selected messages are enumerable/serializable; do not select private payload
 * fields as messages. Construct beside Form, including on the undefined-answer baseline.
 * After serialization, reconstruct from the locally accepted answer or a safe acceptance
 * key transported separately; JSON/spread of this value alone loses answer identity.
 * The caller selects an accepted, form-local source; this does not certify cancellation,
 * partition route-global data between forms, or observe a framework's requests.
 *
 * @example
 * import { formErrors } from "@/lib/ouro/form-answer";
 * <Form errors={formErrors(actionData, { email: actionData?.email, form: actionData?.general })} />
 *
 * @example
 * // Reused payload: acceptance.key changes on completed acceptance, not while pending.
 * <Form errors={formErrors(acceptance.data, acceptance.data.errors, { key: acceptance.key })} />
 * @claim "`, `false`, `NaN` and signed zero; an explicitly" registry/ouro/lib/ouro/form-answer.test.ts verify:testExists(registry/ouro/lib/ouro/form-answer.test.ts::formErrors answer value > uses Object.is for keys, including negative zero, without a global scalar intern table)
 * @claim "`, `false`, `NaN` and signed zero; an explicitly" registry/ouro/lib/ouro/form-answer.test.ts verify:testExists(registry/ouro/lib/ouro/form-answer.test.ts::formErrors answer value > decodes null, undefined and ordinary records as raw absence, not answer-bearing values)
 * @claim "No source properties are read or" registry/ouro/lib/ouro/form-answer.test.ts verify:testExists(registry/ouro/lib/ouro/form-answer.test.ts::formErrors answer value > retains empty selected values without treating them as answers or accessing source properties)
 * @claim "No source properties are read or" registry/ouro/lib/ouro/form-answer.test.ts verify:testExists(registry/ouro/lib/ouro/form-answer.test.ts::formErrors answer value > interns object keys without retaining the key payload and lets the key override source identity)
 */
export function formErrors(answer: object | null | undefined, messages?: ReadonlyFormErrors | null): FormErrorValue;
export function formErrors(answer: unknown, messages: ReadonlyFormErrors | null | undefined, options: { key: FormErrorKey }): FormErrorValue;
export function formErrors(answer: unknown, messages?: ReadonlyFormErrors | null, options?: { key: FormErrorKey }): FormErrorValue {
  let identity: FormErrorIdentity;
  if (options !== undefined) {
    const key = Object.hasOwn(options, "key") ? options.key : undefined;
    if (key === null || key === undefined) {
      devThrow("Form", "formErrors key must not be null or undefined",
        process.env.NODE_ENV !== "production" ? "pass { key: acceptedAnswerKey }, advanced only when the answer is accepted" : /* istanbul ignore next @preserve -- production only */ "");
    }
    identity = { kind: "key", value: isObject(key) ? token(key) : key };
  } else if (answer === null || answer === undefined) {
    identity = { kind: "none", value: undefined };
  } else if (isObject(answer)) {
    identity = { kind: "answer", value: token(answer) };
  } else {
    devThrow("Form", "formErrors needs an object answer or an accepted key",
      process.env.NODE_ENV !== "production" ? "formErrors(answer, messages, { key: acceptedAnswerKey })" : /* istanbul ignore next @preserve -- production only */ "");
  }
  if (messages !== null && messages !== undefined && (typeof messages !== "object" || Array.isArray(messages))) {
    devThrow("Form", "formErrors messages must be a record",
      process.env.NODE_ENV !== "production" ? 'formErrors(answer, { email: "Taken.", form: "Try again." })' : /* istanbul ignore next @preserve -- production only */ "");
  }
  const snapshot: ReadonlyFormErrors = Object.fromEntries(Object.entries(messages ?? {}).map(([name, message]) => {
    const valid = (value: unknown) => value === null || value === undefined || typeof value === "string" || isValidElement(value);
    if (!(Array.isArray(message) ? message.every(valid) : valid(message))) {
      devThrow("Form", `formErrors messages for "${name}" must be text, React elements or arrays of them`,
        process.env.NODE_ENV !== "production" ? "select only this form's display messages, not the answer payload" : /* istanbul ignore next @preserve -- production only */ "");
    }
    return [name, Array.isArray(message) ? Object.freeze([...message]) : message];
  }));
  values.set(snapshot, Object.freeze(identity));
  return Object.freeze(snapshot) as FormErrorValue;
}

/**
 * Reads metadata without accessing any payload property; a copied record has none. @internal
 *
 * @claim "Reads metadata without accessing any payload" registry/ouro/lib/ouro/form-answer.test.ts verify:testExists(registry/ouro/lib/ouro/form-answer.test.ts::formErrors answer value > snapshots records and array containers without cloning React nodes or freezing caller data)
 */
export function formErrorIdentity(value: ReadonlyFormErrors | null | undefined): FormErrorIdentity | undefined {
  return value === null || value === undefined ? undefined : values.get(value);
}
