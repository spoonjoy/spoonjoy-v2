"use client";

import { Form as BaseForm } from "@base-ui/react/form";
import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode, type Ref } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { useDevWarnings } from "~/lib/ouro/use-dev-warnings";
import { FormErrorsContext } from "~/lib/ouro/use-field";

/** Errors by field name: one message, or several. A React Router action returns this shape. */
export type FormErrors = Record<string, string | string[]>;

/** Props for {@link Form}: a `<form>`'s attributes, `errors`, and Base UI Form's `render`. */
export type FormProps = Omit<BaseForm.Props, "className" | "errors" | "children"> & {
  /**
   * Errors by field name, usually from your server action: `errors={actionData?.errors}`.
   * Each one shows on the field with that `name`, which gets `aria-invalid` and links the
   * message, in the server HTML too. A field's own `error` prop wins over it, and a message
   * goes away once the user changes that field. When new errors arrive, focus moves to the
   * first field with one, in page order. The `form` key shows in an alert at the top of
   * the form, in the server HTML too; a key no rendered field is named joins it once the
   * page hydrates.
   *
   * These errors only show: they never block the next submit, so the user can always send
   * the form again (a server error may be fixed by changing another field, or by trying
   * again). The browser's own checks (`required`, `type="email"`) still block a submit.
   */
  errors?: FormErrors | null | undefined;
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

const EMPTY: FormErrors = {};

/**
 * The message at the top of the form, for the `form` key and keys no field claims: the
 * destructive color, with an outline only while focused. Empty, it takes no space.
 */
const formMessageClass =
  "grid gap-1 text-sm leading-5 text-destructive outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid empty:absolute";

/** The key for a message about the whole form, shown at its top. */
const FORM_KEY = "form";

/** The messages an error holds: one, several, or none for an empty string or array. */
const messagesOf = (error: string | string[] | undefined) => (Array.isArray(error) ? error : error ? [error] : []);

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
 * first field with an error. Server errors only show: unlike the browser's checks they
 * never block the next submit, so the user can always send the form again. A Form submits
 * only itself: its submit event stops there, so a Form in a sheet inside another Form
 * never submits the outer one. It renders a `<form>`, so `action` and `method` pass
 * through; to submit through React Router, render its `Form`: `render={<RouterForm />}`.
 *
 * Use `EditSheet` instead for a form in a dialog that saves and closes, and a plain
 * `<form>` when nothing needs validating.
 *
 * @group Forms
 * @see https://ourostack.github.io/ouro-ui/docs/form
 *
 * @example
 * const actionData = useActionData<typeof action>();
 * <Form method="post" errors={actionData?.errors} render={<RouterForm />}>
 *   <TextField label="Email" name="email" type="email" required />
 *   <Button type="submit">Save</Button>
 * </Form>
 */
export function Form(props: FormProps): JSX.Element {
  const {
    errors: errorsProp,
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
  // The errors the fields show: the prop, less the fields the user has changed since. A new
  // errors object (the next action's result) replaces them all, during render, so the
  // server HTML and the first client render agree.
  const [errors, setErrors] = useState(errorsProp);
  const [source, setSource] = useState(errorsProp);
  if (errorsProp !== source) {
    setSource(errorsProp);
    setErrors(errorsProp);
  }
  const clear = useCallback((name: string) => {
    setErrors((current) => {
      if (!current || !Object.hasOwn(current, name)) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  }, []);

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
          ...Object.keys(errorsProp ?? EMPTY)
            .filter((key) => key !== FORM_KEY && !names.current.has(key))
            .map(
              (key) =>
                [
                  `errors has "${key}", which no field in the form is named, so it shows at the top of the form`,
                  `use a field's name (${[...names.current.keys()].join(", ")}), or "${FORM_KEY}" for a message about the whole form`,
                ] as const,
            ),
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );

  // When new errors arrive, focus the first field showing one, in page order, or the
  // message at the top when no field has one. Not on the first render: a page that loads
  // with errors leaves focus where the browser puts it.
  const messageRef = useRef<HTMLDivElement>(null);
  const focusedFor = useRef(errorsProp);
  useEffect(() => {
    if (focusedFor.current === errorsProp) return;
    focusedFor.current = errorsProp;
    if (Object.keys(errorsProp ?? EMPTY).length === 0) return;
    const message = messageRef.current!;
    const invalid = [...message.parentElement!.querySelectorAll<HTMLElement>('[aria-invalid="true"]')].find(focusable);
    (invalid ? entryPoint(invalid) : message.textContent ? message : undefined)?.focus();
  }, [errorsProp]);

  // A submit stops at its own Form: React bubbles events through portals, so a Form in a
  // sheet would otherwise reach the Form the sheet sits in.
  const submit: NonNullable<BaseForm.Props["onSubmit"]> = (event) => {
    event.stopPropagation();
    onSubmit?.(event);
  };

  return (
    <FormErrorsContext.Provider value={value}>
      {/* Base UI's Form runs the browser's checks: it blocks a submit while a constraint
          fails and focuses the first such control. Ouro's errors never reach it, so they
          never block a submit. */}
      <BaseForm {...rest} onSubmit={submit} data-ouro="form" className={cn("m-0 grid min-w-0 gap-5", className)}>
        <FormMessage ref={messageRef} errors={errors ?? EMPTY} showsAtTop={showsAtTop} />
        {children}
      </BaseForm>
    </FormErrorsContext.Provider>
  );
}

/** The message region at the top of the form. */
function FormMessage({
  ref,
  errors,
  showsAtTop,
}: {
  ref: Ref<HTMLDivElement>;
  errors: FormErrors;
  showsAtTop: (key: string) => boolean;
}): JSX.Element {
  // The message about the whole form comes first, then the keys no field claims.
  const keys = Object.keys(errors).filter(showsAtTop);
  const messages = [...keys.filter((key) => key === FORM_KEY), ...keys.filter((key) => key !== FORM_KEY)].flatMap((key) =>
    messagesOf(errors[key]),
  );
  return (
    <div ref={ref} role="alert" tabIndex={-1} data-ouro="form-message" className={formMessageClass}>
      {messages.map((message) => (
        <p key={message} className="m-0">
          {message}
        </p>
      ))}
    </div>
  );
}
