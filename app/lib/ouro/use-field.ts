"use client";

import { createContext, isValidElement, useContext, type ReactElement, type ReactNode } from "react";

// The state a Field shares with its control and label, apart from the components so the
// parts file exports only components (React Fast Refresh). Base UI's Field owns ids,
// validity and disabled; this adds what Base UI leaves to the app: `required`, and the
// description and error ids the server already knows, so the server HTML carries
// `aria-describedby` before hydration.

/** What a Field tells the controls and label inside it. */
export interface FieldContextValue {
  /** The field is required: the control gets `required` and `aria-required`, the label a marker. */
  required: boolean;
  /** Ids of the description and error the field renders, for the control's `aria-describedby`. */
  describedBy: string | undefined;
  /**
   * The field shows an error, from its `error` prop or its `Form`'s `errors`; for a group's
   * item, the group's. A control that is not a `FieldControl` (Select's trigger, a checkbox,
   * a switch, a radio) sets `aria-invalid` from it.
   */
  invalid: boolean;
  /**
   * The label's (or a group's legend's) id, for a control that a `<label for>` cannot name
   * (Select's trigger, a checkbox, a switch, a radio group) and that takes `aria-labelledby`.
   * `undefined` in the parts, which leave the id to Base UI.
   */
  labelId: string | undefined;
  /**
   * Set by a `Field` whose control is a group of choices: its owner's `name`, such as
   * `RadioGroup`. A checkbox or radio `Field` inside it renders as one of the group's items.
   */
  group?: string | undefined;
}

/**
 * The context `FieldRoot` and `Field` provide; `null` outside a field.
 *
 * @internal
 */
export const FieldContext = createContext<FieldContextValue | null>(null);

/**
 * Reads the enclosing field's state, or `null` outside a `FieldRoot` or `Field`. Controls
 * built on the Field contract use it to apply `required` and the server-known
 * `aria-describedby`.
 *
 * @internal
 */
export function useField(): FieldContextValue | null {
  return useContext(FieldContext);
}

/** The component a Field belongs to: its name in development messages and its `data-ouro` value. */
export interface FieldOwner {
  /** The component name development messages start with and show in their fixes, such as `TextField`. */
  name: string;
  /** The root's `data-ouro` value, such as `text-field`. */
  data: string;
  /**
   * How the field lays out its parts. `stack` (the default) puts the label above the
   * control. `inline` puts the control first with the label to its right, as a checkbox or
   * switch does. `group` names a group of choices: the label is the group's legend, not a
   * `<label>`, and the control is the group.
   */
  layout?: "stack" | "inline" | "group" | undefined;
  /**
   * For a group whose control cannot carry `aria-required` (a checkbox group): the words a
   * required field adds, visually hidden, after its legend, such as `(required)`, so screen
   * readers announce it.
   */
  requiredLabel?: string | undefined;
  /**
   * Arranges the field's content inside its root: the label element, then the rest
   * (description, control, error). NumberField puts its Base UI root around both and a scrub
   * area around the label; a range Slider drops the label's `for`, because its group is named
   * with `aria-labelledby`. Without it, the label comes first, then the rest.
   */
  frame?: ((label: ReactElement, rest: ReactNode) => ReactNode) | undefined;
  /**
   * `false` when the control is not a form element a `<label for>` can click and name, such
   * as Select's trigger button: the label renders as a `<div>` and the control takes
   * `aria-labelledby` (Base UI's `nativeLabel={false}`).
   */
  nativeLabel?: false | undefined;
}

/**
 * The component a `Field` renders for. A control built on `Field` (TextField, TextArea)
 * provides its own, so Field's messages and root name that control; `Field` alone is `Field`.
 *
 * @internal
 */
export const FieldOwnerContext = createContext<FieldOwner>({ name: "Field", data: "field" });

/**
 * The component the enclosing `Field` renders for.
 *
 * @internal
 */
export function useFieldOwner(): FieldOwner {
  return useContext(FieldOwnerContext);
}

/** One error message: text, or a React element for a message that carries a link or other markup. */
export type ErrorMessage = string | ReactElement;

/** Mutable error-message input for building a raw error record: one message, or several as an array. */
export type ErrorMessages = ErrorMessage | ErrorMessage[];

/** A read-only message view accepted by fields and Form; mutable input arrays remain valid. */
export type ReadonlyErrorMessages = ErrorMessage | readonly ErrorMessage[];

/**
 * The messages an `error` holds, in order: one for a single value, one per item for an array,
 * without repeats (merged validators can repeat one) or empty ones (`""`, and the `null` or
 * `false` a condition leaves behind in untyped code).
 * Accepts readonly inputs and returns a fresh mutable array, never the snapshot container.
 *
 * @internal
 * @claim "Accepts readonly inputs and returns a" registry/ouro/lib/ouro/form-answer.test.ts verify:testExists(registry/ouro/lib/ouro/form-answer.test.ts::formErrors answer value > snapshots records and array containers without cloning React nodes or freezing caller data)
 */
export function errorMessages(error: ReadonlyErrorMessages | null | undefined): ErrorMessage[] {
  const list: readonly unknown[] = Array.isArray(error) ? error : [error];
  return [...new Set(list)].filter((message): message is ErrorMessage => typeof message === "string" ? message !== "" : isValidElement(message));
}

/**
 * A React key for one of `errorMessages`' messages: the text itself, or its place in the list
 * for a node.
 *
 * @internal
 */
export function errorMessageKey(message: ErrorMessage, index: number): string {
  return typeof message === "string" ? `text:${message}` : `node:${index}`;
}

/** A form's server or client errors, by field name, as `Form` shares them with the fields inside it. */
export interface FormErrorsValue {
  /**
   * The messages for each field name; a field shows its own when it has no `error` prop.
   *
   * @claim "The messages for each field name" registry/ouro/components/ouro/field/field.test.tsx verify:testExists(registry/ouro/components/ouro/field/field.test.tsx::Field wiring > shows a Base UI Form error for its name without an error prop)
   */
  errors: Readonly<Record<string, ReadonlyErrorMessages | null | undefined>>;
  /** Drops one field's message, once the user changes that field. */
  clear: (name: string) => void;
  /**
   * Records that a field with this name is in the form, so its errors show on it and not at
   * the top of the form. Returns the function that removes it again.
   */
  register: (name: string) => () => void;
}

/**
 * The errors `Form` provides; `null` outside a `Form`. It is Ouro's own context, so a Field
 * reads its message while rendering, and the server HTML links the message to the control.
 *
 * @internal
 */
export const FormErrorsContext = createContext<FormErrorsValue | null>(null);

/**
 * Reads the enclosing `Form`'s errors, or `null` outside one.
 *
 * @internal
 */
export function useFormErrors(): FormErrorsValue | null {
  return useContext(FormErrorsContext);
}
