"use client";

import { Form as BaseForm } from "@base-ui/react/form";
import { isValidElement, useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode, type Ref } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { formErrorIdentity, type FormErrorIdentity, type FormErrorValue, type ReadonlyFormErrors } from "~/lib/ouro/form-answer";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { useMergedRef } from "~/lib/ouro/refs";
import { errorMessageKey, errorMessages, FormErrorsContext } from "~/lib/ouro/use-field";

/**
 * Errors by field name: one message, or several as an array. A React Router action returns
 * this shape. A message is text or a React node, so it can carry a link. The `form` key holds
 * messages about the whole form. A key may hold nothing (`undefined`, `null`, an empty string
 * or list), so an object mapped from an action's answer needs no cleanup.
 */
export type { FormErrors } from "~/lib/ouro/form-answer";

/** A read-only error projection, including the frozen arrays returned by `formErrors`. */
export type { ReadonlyFormErrors } from "~/lib/ouro/form-answer";

/** Props for {@link Form}: a `<form>`'s attributes, one complete `errors` value, and Base UI Form's `render`. */
export type FormProps = Omit<BaseForm.Props, "className" | "errors" | "children"> & {
  /**
   * Errors by field name. Bind an accepted server answer inside this single prop:
   * `errors={formErrors(actionData, actionData?.errors)}` (import `formErrors` from
   * `@/lib/ouro/form-answer`). Each changed answer, including an equal refusal, restores
   * cleared messages, replaces its alert and moves focus once. Rebuilding the value or its
   * mapped messages with the same answer never counts as arrival.
   * Each one shows on the field with that `name`, which gets `aria-invalid` and links the
   * message, in the server HTML too. A field's own `error` prop wins over it, and a message
   * goes away once the user changes that field. When new errors arrive, focus moves to the
   * first field with one, in page order. The `form` key shows in an alert at the top of
   * the form, in the server HTML too; a key no rendered field is named joins it once the
   * page hydrates, and warns in development. A message is text or a React node (a message
   * with a link), and an array is several messages.
   *
   * With `formErrors`, a field stays cleared for that answer even if its key disappears
   * and is re-added. Uncleared messages use the latest projection, including new React
   * nodes/handlers, without resetting the mask, forcing an alert remount or moving focus.
   * No answer (`null`/`undefined`) is not arrival and preserves the established mask.
   * Cached/reused or primitive answers need `{ key: acceptedAnswerKey }`, advanced on
   * actual acceptance, never submit start. Select this form's accepted source yourself;
   * Form does not infer ownership or cancellation from a router's global data.
   *
   * Plain records still work for display/local errors and are compared by content. Fresh
   * equal records cannot identify equal new answers; use `formErrors` for action answers,
   * including the initial undefined-answer render. Changing between raw and answer-bearing
   * values establishes a baseline with the existing mask, not an arrival.
   * Construct the value beside Form on server and client. JSON/spread/structured cloning
   * or server-component transport loses opaque identity and leaves a plain message record;
   * reconstruct using the locally accepted source or a safely transported acceptance key.
   *
   * These errors only show: they never block the next submit, so the user can always send
   * the form again (a server error may be fixed by changing another field, or by trying
   * again). The browser's own checks (`required`, `type="email"`) still block a submit.
   */
  errors?: ReadonlyFormErrors | FormErrorValue | null | undefined;
  /** Not a prop. Bind the accepted answer inside `errors`: `errors={formErrors(answer, messages)}`. */
  result?: { 'Use errors={formErrors(answer, messages)}': never };
  /** The fields and the submit button. */
  children: ReactNode;
  /**
   * Layout only: margins, width, grid placement. Fields stack with a gap by default;
   * appearance classes warn in development.
   */
  className?: string | undefined;

  /** Not a prop. Ouro UI uses `errors`: `<Form errors={actionData?.errors}>`. */
  validationErrors?: { 'Use <Form errors={actionData?.errors}>': never };
};

const EMPTY: ReadonlyFormErrors = {};

function maskErrors(projection: ReadonlyFormErrors | null | undefined, cleared: Set<string>): ReadonlyFormErrors {
  return Object.fromEntries(Object.entries(projection ?? EMPTY).filter(([name]) => !cleared.has(name)));
}

/**
 * The message at the top of the form, for the `form` key and keys no field claims: the
 * destructive color, with an outline only while focused.
 */
const formMessageClass =
  "grid gap-1 text-sm leading-5 text-destructive outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid";

/** The key for a message about the whole form, shown at its top. */
const FORM_KEY = "form";

/** How deep `sameContent` looks before it calls two values different: past any real message, short of a loop. */
const MAX_DEPTH = 40;

/**
 * Whether two error values hold the same content: equal text, arrays and plain objects with
 * equal entries, and React elements of the same type and key with equal props. An app that
 * builds its errors object while rendering passes a new, equal one on every render.
 */
function sameContent(a: unknown, b: unknown, depth = 0): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null || depth === MAX_DEPTH) return false;
  if (isValidElement(a) || isValidElement(b)) {
    return isValidElement(a) && isValidElement(b) && a.type === b.type && a.key === b.key && sameContent(a.props, b.props, depth + 1);
  }
  const keys = Object.keys(a);
  return (
    Array.isArray(a) === Array.isArray(b) &&
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && sameContent((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], depth + 1))
  );
}

/**
 * Whether an element takes focus: hidden inputs and hidden copies of a control do not, and
 * neither does a disabled control, which the user cannot change (a disabled checkbox or
 * radio is a `<span aria-disabled>` that would otherwise accept focus).
 */
const focusable = (element: HTMLElement) =>
  !element.matches('input[type="hidden"], [aria-hidden="true"], [hidden], :disabled, [aria-disabled="true"]');

/** In a radio group, the picked radio is the way in, when it can take focus; otherwise the element itself. */
function entryPoint(element: HTMLElement): HTMLElement {
  if (element.getAttribute("role") !== "radio") return element;
  const picked = element.closest('[role="radiogroup"]')!.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]');
  return picked && focusable(picked) ? picked : element;
}

/**
 * A form that validates with the browser's own constraints (`required`, `type="email"`,
 * `pattern`) and shows server errors on the matching fields. Pass `errors` straight from
 * your action; each message lands on the field with that `name`, and focus moves to the
 * first field with an error. Bind an accepted action answer with the framework-free
 * `formErrors` constructor in `@/lib/ouro/form-answer`; it adds no server protocol or router
 * dependency. Server errors only show: unlike the browser's checks they
 * never block the next submit, so the user can always send the form again. A Form submits
 * only itself: its submit event stops there, so a Form in a sheet inside another Form
 * never submits the outer one. It renders a `<form>`, so `action` and `method` pass
 * through; to submit through React Router, render its `Form`: `render={<RouterForm />}`.
 *
 * A submit is checked in this order. First the browser's own checks (`required`,
 * `type="email"`, `pattern`): a failure stops the submit, marks each failing field with the
 * browser's message and moves focus to the first. Then your `onSubmit`, which runs only when
 * those pass and can still call `event.preventDefault()`. Then the server, whose answer
 * comes back as `errors`.
 *
 * The keys of `errors` are your fields' `name`s, and `form` is the message about the whole
 * form. An action that answers with other keys is mapped where you pass them:
 * `errors={formErrors(data, { form: data?.errors?.general, email: data?.errors?.email })}`. A key that no field
 * in this form is named shows at the top of the form and warns in development with the key,
 * this form's field names and the fix; with two forms on one route, pass each only its own
 * keys.
 *
 * `formErrors(answer, messages)` separates arrival from presentation. Same accepted answer:
 * the clear mask persists, even through empty/omitted maps or a temporarily absent answer,
 * and the latest uncleared messages render without new focus or a forced alert replacement.
 * New accepted answer: reset the mask and create one arrival, even when messages are equal.
 * Cached/reused answers require `{ key: acceptedAnswerKey }`, advanced only on actual
 * acceptance. Form never guesses arrival from submit start, waits or framework navigation.
 * The caller chooses accepted, form-local data; passing the same changing route-global
 * source to two Forms does not automatically partition answers between them.
 *
 * Plain `errors={{ email: "Taken." }}` remains compatible and content-only: equal raw maps
 * cannot prove a new answer. Use the constructor from the initial render for action answers;
 * switching representations seeds a baseline and preserves clears rather than inventing
 * arrival. Opaque identity does not survive JSON, spread, structured cloning or server
 * component transport. Reconstruct beside Form in each environment with the locally
 * accepted object or a safe explicit acceptance key; the returned value never retains or
 * serializes the unselected source payload. Changed text in an existing alert may still
 * produce ordinary live-region speech, but presentation is not a new answer generation.
 *
 * The message about the whole form is an alert (`role="alert"`). It is in the page only
 * while there is a message, and each answer adds a new one with its text already in it,
 * which is what screen readers announce; `getByRole("alert")` finds nothing on a form
 * without one. A field's message is not an alert: it is that control's description, so
 * assert it with `toHaveAccessibleDescription`.
 *
 * Focus moves to the first field with an error when errors arrive after a submit. A page
 * that loads with `errors` already set (a post without JavaScript, or a reload) shows them
 * in the server HTML and moves no focus: nothing was submitted from this page, and taking
 * focus on load would drop a keyboard or screen-reader user into the middle of a page they
 * have not read. To send them to the errors on load, put an in-page link to the form in
 * your page's own error summary.
 *
 * Use `EditSheet` instead for a form in a dialog that saves and closes, and a plain
 * `<form>` when nothing needs validating.
 *
 * @group Forms
 * @see https://ourostack.github.io/ouro-ui/docs/form
 *
 * @example
 * import { formErrors } from "@/lib/ouro/form-answer";
 * const actionData = useActionData<typeof action>();
 * <Form method="post" errors={formErrors(actionData, actionData?.errors)} render={<RouterForm />}>
 *   <TextField label="Email" name="email" type="email" required />
 *   <Button type="submit">Save</Button>
 * </Form>
 *
 * @example
 * // The action answers { errors: { general, email } }: map its keys to this form's field names.
 * const errors = actionData?.errors;
 * <Form method="post" errors={formErrors(actionData, { form: errors?.general, email: errors?.email })} render={<RouterForm />}>
 *   <TextField label="Email" name="email" type="email" required />
 *   <Button type="submit">Subscribe</Button>
 * </Form>
 */
export function Form(props: FormProps): JSX.Element {
  const {
    errors: errorsProp,
    result,
    onSubmit,
    children,
    className,
    // Guard props (hint types), dropped here so they never reach the DOM.
    validationErrors,
    ...rest
  } = props;

  useAppearanceClassNameCheck(
    "Form",
    className,
    process.env.NODE_ENV !== "production"
      ? "style fields in your theme (--input, --ring, --radius)"
      : /* istanbul ignore next @preserve -- production only */ "",
  );
  const identity = formErrorIdentity(errorsProp);
  const mode = identity ? "answer" : "raw";
  const accepted = identity?.kind === "none" ? undefined : identity;
  const [shown, setShown] = useState({
    mode,
    source: errorsProp,
    identity: accepted as FormErrorIdentity | undefined,
    rawErrors: errorsProp,
    cleared: new Set<string>(),
    arrivals: 0,
  });
  if (mode !== shown.mode) {
    // A representation switch establishes a baseline, not an accepted answer.
    setShown({ ...shown, mode, source: errorsProp, identity: accepted, rawErrors: maskErrors(errorsProp, shown.cleared) });
  } else if (accepted && (!shown.identity || accepted.kind !== shown.identity.kind || !Object.is(accepted.value, shown.identity.value))) {
    // Answer identity is the sole arrival authority; projection changes never reset a mask.
    setShown({ ...shown, source: errorsProp, identity: accepted, cleared: new Set(), arrivals: shown.arrivals + 1 });
  } else if (mode === "raw" && errorsProp !== shown.source && !sameContent(errorsProp ?? EMPTY, shown.source ?? EMPTY)) {
    setShown({ ...shown, source: errorsProp, rawErrors: errorsProp, cleared: new Set(), arrivals: shown.arrivals + 1 });
  }
  const errors = useMemo(
    () => mode === "answer" ? maskErrors(errorsProp, shown.cleared) : shown.rawErrors,
    [mode, errorsProp, shown.cleared, shown.rawErrors],
  );
  const clear = useCallback((name: string) => {
    if (!errors || !Object.hasOwn(errors, name)) return;
    setShown((current) => {
      if (current.cleared.has(name)) return current;
      const next: Record<string, ReadonlyFormErrors[string]> = { ...current.rawErrors };
      delete next[name];
      return { ...current, rawErrors: next, cleared: new Set([...current.cleared, name]) };
    });
  }, [errors, setShown]);

  // The names of the fields in the form, which claim their errors. Fields register once
  // mounted, so the server and the first client render show only the `form` key at the
  // top; keys no field claims (a typo, a field that is not rendered) join it after
  // hydration. A message never shows twice.
  const names = useRef(new Map<string, number>());
  const [claims, setClaims] = useState<{ ready: boolean; names: string[] }>({ ready: false, names: [] });
  const sync = useCallback(() => setClaims({ ready: true, names: [...names.current.keys()] }), []);
  const register = useCallback(
    (name: string) => {
      names.current.set(name, (names.current.get(name) ?? 0) + 1);
      sync();
      return () => {
        const count = names.current.get(name)! - 1;
        if (count === 0) names.current.delete(name);
        else names.current.set(name, count);
        sync();
      };
    },
    [sync],
  );
  useEffect(sync, [sync]);
  const value = useMemo(() => ({ errors: errors ?? EMPTY, clear, register }), [errors, clear, register]);
  const showsAtTop = (key: string) => key === FORM_KEY || (claims.ready && !claims.names.includes(key));

  useDevWarnings(
    "Form",
    process.env.NODE_ENV !== "production"
      ? () => [
          validationErrors !== undefined && ["validationErrors is not a prop", "<Form errors={actionData?.errors}>"],
          (result !== undefined || Object.hasOwn(props, "result")) && ["result is not a prop", "errors={formErrors(answer, messages)}"],
          ...Object.keys(errorsProp ?? EMPTY)
            .filter((key) => key !== FORM_KEY && !names.current.has(key) && errorMessages(errorsProp![key]).length > 0)
            .map((key) => unclaimedWarning(key, [...names.current.keys()])),
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );

  // When new errors arrive, focus the first field showing one, in page order, or the
  // message at the top when no field has one. Not on the first render: a page that loads
  // with errors leaves focus where the browser puts it.
  const formRef = useRef<HTMLFormElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  const focusedFor = useRef(shown.arrivals);
  useEffect(() => {
    if (focusedFor.current === shown.arrivals) return;
    focusedFor.current = shown.arrivals;
    if (!Object.values(errors ?? EMPTY).some((message) => errorMessages(message).length > 0)) return;
    const invalid = [...formRef.current!.querySelectorAll<HTMLElement>('[aria-invalid="true"]')].find(focusable);
    (invalid ? entryPoint(invalid) : messageRef.current)?.focus();
  }, [shown.arrivals, errors]);

  // A submit stops at its own Form: React bubbles events through portals, so a Form in a
  // sheet would otherwise reach the Form the sheet sits in.
  const submit: NonNullable<BaseForm.Props["onSubmit"]> = (event) => {
    event.stopPropagation();
    onSubmit?.(event);
  };
  const setFormRef = useMergedRef(rest.ref, formRef);

  return (
    <FormErrorsContext.Provider value={value}>
      {/* Base UI's Form runs the browser's checks: it blocks a submit while a constraint
          fails and focuses the first such control. Ouro's errors never reach it, so they
          never block a submit. */}
      <BaseForm {...rest} ref={setFormRef} onSubmit={submit} data-ouro="form" className={cn("grid min-w-0 gap-5", className)}>
        {/* A new element for each answer, so its alert is announced again. */}
        <FormMessage key={shown.arrivals} ref={messageRef} errors={errors ?? EMPTY} showsAtTop={showsAtTop} />
        {children}
      </BaseForm>
    </FormErrorsContext.Provider>
  );
}

/**
 * The development message for an `errors` key no field in the form is named: the key, the
 * fields there are, and both fixes. Development only.
 */
function unclaimedWarning(key: string, fields: string[]): readonly [string, string] {
  const property = (name: string) => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name));
  const read = (name: string) => (property(name) === name ? `errors.${name}` : `errors[${property(name)}]`);
  const own = fields.map((name) => `${property(name)}: ${read(name)}`).join(", ");
  return fields.length === 0
    ? [
        `errors has the key "${key}", but the form has no named field, so the message shows at the top of the form`,
        `a message about the whole form goes under the "${FORM_KEY}" key: errors={{ ${FORM_KEY}: ${read(key)} }}`,
      ]
    : [
        `errors has the key "${key}", but the form's fields are named ${fields.join(", ")}, so the message shows at the top of the form`,
        `a message about the whole form goes under the "${FORM_KEY}" key: errors={{ ${FORM_KEY}: ${read(key)}, ${own} }}; ` +
          `one that belongs to another form is left out: errors={{ ${own} }}`,
      ];
}

/**
 * The message at the top of the form. It is in the page only while it has a message, and it
 * arrives with the message already in it: an element added with `role="alert"` and its text
 * is what screen readers announce, and a test's `getByRole("alert")` finds a message or nothing.
 */
function FormMessage({
  ref,
  errors,
  showsAtTop,
}: {
  ref: Ref<HTMLDivElement>;
  errors: ReadonlyFormErrors;
  showsAtTop: (key: string) => boolean;
}): JSX.Element | null {
  // The message about the whole form comes first, then the keys no field claims.
  const keys = Object.keys(errors).filter(showsAtTop);
  const messages = [...keys.filter((key) => key === FORM_KEY), ...keys.filter((key) => key !== FORM_KEY)].flatMap((key) =>
    errorMessages(errors[key]),
  );
  if (messages.length === 0) return null;
  return (
    <div ref={ref} role="alert" tabIndex={-1} data-ouro="form-message" className={formMessageClass}>
      {messages.map((message, index) => (
        <p key={errorMessageKey(message, index)} className="m-0">
          {message}
        </p>
      ))}
    </div>
  );
}
