"use client";

import { Field as BaseField } from "@base-ui/react/field";
import { useCallback, useEffect, useId, useMemo, useRef, type FormEvent, type JSX, type ReactElement, type ReactNode } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { FieldContext, FieldOwnerContext, useField, useFieldOwner, useFormErrors } from "~/lib/ouro/use-field";
import { useDevWarnings } from "~/lib/ouro/use-dev-warnings";
import { FieldDescription, FieldError, FieldLabel } from "~/components/ouro/field/field-parts";
import { fieldHint, inlineRootClass, labelClass, rootClass } from "~/components/ouro/field/field-styles";

/**
 * The props every Ouro form control takes, with these exact names: a required `label`,
 * `description`, `error`, `required`, `disabled` and `name`.
 */
export interface FieldProps {
  /**
   * What the control is for, shown above it and read as its name. Required: every control
   * needs a name. To hide it visually, keep it and add `hideLabel`.
   */
  label: string;
  /** Hides the label visually; screen readers still read it as the control's name. */
  hideLabel?: boolean | undefined;
  /** Supporting text under the label, read after the label through `aria-describedby`. */
  description?: ReactNode | undefined;
  /**
   * What is wrong, from your server action or client check. A message (or several, as a
   * list, each shown once) shows under the control, which gets `aria-invalid` and points at the message
   * with `aria-describedby`. An empty string or array means valid. It only shows: it never
   * blocks the next submit of the form around it.
   */
  error?: string | string[] | undefined;
  /** The control must be filled: it gets `required` and `aria-required`, and the label a marker. */
  required?: boolean | undefined;
  /** Disables the control and fades the field. */
  disabled?: boolean | undefined;
  /**
   * The form field name the control submits under. A `Form`'s `errors` for this name show
   * here when there is no `error` prop, and go away once the user changes the control.
   */
  name?: string | undefined;
  /** The control: `<FieldControl />`, or `<FieldControl render={<textarea />} />` for another element. */
  children: ReactNode;
  /**
   * Layout only: margins, width, grid placement (`mt-4`, `col-span-2`). Appearance
   * classes warn in development; style fields in your theme.
   */
  className?: string | undefined;

  /** Not a prop. Field connects the label to its control itself: `<Field label="Email"><FieldControl /></Field>`. */
  htmlFor?: { 'Field connects the label itself: <Field label="Email"><FieldControl /></Field>': never };
  /** Not a prop. Ouro UI uses `error`: `<Field error="Required.">`. */
  errorMessage?: { 'Use <Field error="Required.">': never };
  /** Not a prop. Ouro UI uses `description`: `<Field description="We never share it.">`. */
  helperText?: { 'Use <Field description="...">': never };
  /** Not a prop. `error` marks the field invalid: `<Field error="What is wrong">`. */
  isInvalid?: { 'Use <Field error="What is wrong">': never };
  /** Not a prop. `error` marks the field invalid: `<Field error="What is wrong">`. */
  invalid?: { 'Use <Field error="What is wrong">': never };
  /** Not a prop. Ouro UI uses `required`: `<Field required>`. */
  isRequired?: { 'Use <Field required>': never };
  /** Not a prop. Ouro UI uses `disabled`: `<Field disabled>`. */
  isDisabled?: { 'Use <Field disabled>': never };
  /** Not a prop, and not a label. Pass `label`, and a placeholder example on the control: `<FieldControl placeholder="you@example.com" />`. */
  placeholder?: { 'Use label="Email"; a placeholder example goes on the control': never };
}

/** Field's own arrangement: the label, then the rest. */
const defaultFrame = (label: ReactElement, rest: ReactNode): ReactNode => (
  <>
    {label}
    {rest}
  </>
);

/** The owner a plain Field has, restored for the Field's own children. */
const fieldOwner = { name: "Field", data: "field" };

/** The messages in an `error` prop, without empty ones or repeats (merged validators can repeat one). */
function messagesOf(error: string | string[] | undefined): string[] {
  if (error === undefined) return [];
  return [...new Set(Array.isArray(error) ? error : [error])].filter((message) => message !== "");
}

/**
 * The label is connected when its `for` names an element inside the field, or when an element
 * inside the field names it in `aria-labelledby`: a range Slider's group names the label
 * element's own id, and a label that is not a `<label>` (Select's) is named by `labelId`.
 * Development only.
 */
function labelConnected(root: HTMLElement, data: string, labelId: string, nativeLabel: boolean): boolean {
  const label = root.querySelector("label");
  const inside = (element: Element | null) => element?.closest(`[data-ouro="${data}"]`) === root;
  if (nativeLabel && label?.htmlFor && inside(root.ownerDocument.getElementById(label.htmlFor))) return true;
  return [label?.id ?? labelId, labelId].some((id) =>
    [...root.querySelectorAll(`[aria-labelledby~="${CSS.escape(id)}"]`)].some(inside),
  );
}

/**
 * A labeled form control: the label, an optional description, the control and its error,
 * wired together with ids that match between the server and the browser. Every Ouro form
 * control takes these props and is built on the same parts.
 *
 * Pass `error` straight from a server action or a client check: it shows the message and
 * sets `aria-invalid`. The error only shows: it never blocks the form's next submit, so the
 * user can always send the form again (only the browser's own checks, such as `required`,
 * block). Inside a `Form`, a field with a `name` shows the form's error for that name when
 * it has no `error` of its own. The control is `FieldControl`, from `field-parts`. Use `Fieldset` instead to group several controls under one legend,
 * and the `FieldRoot` parts when the label, control and error need another layout.
 *
 * @group Forms
 * @see https://ourostack.github.io/ouro-ui/docs/field
 *
 * @example
 * <Field label="Email" name="email" required description="We never share it." error={errors?.email}>
 *   <FieldControl type="email" autoComplete="email" />
 * </Field>
 */
export function Field(props: FieldProps): JSX.Element {
  const {
    label,
    hideLabel,
    description,
    error,
    required,
    disabled,
    name,
    children,
    className,
    // Guard props (hint types), dropped here so they never reach the DOM.
    htmlFor,
    errorMessage,
    helperText,
    isInvalid,
    invalid: invalidGuess,
    isRequired,
    isDisabled,
    placeholder,
  } = props;
  const id = useId();
  // A control built on Field (TextField) names itself in the messages and the root.
  const owner = useFieldOwner();
  const layout = owner.layout ?? "stack";
  const nativeLabel = owner.nativeLabel !== false;
  // A checkbox or radio inside a CheckboxGroup or RadioGroup is one of the group's items: it
  // takes the group's name, validity and error, and has none of its own.
  const parent = useField();
  const group = parent?.group;
  const item = layout === "inline" && group !== undefined;
  // A Form's error for this name shows when the field has no `error` of its own. Reading it
  // here, while rendering, puts the message id in the server HTML's aria-describedby.
  const form = useFormErrors();
  const formError = error === undefined && name !== undefined ? form?.errors[name] : undefined;
  const messages = item ? [] : messagesOf(error ?? formError);
  const invalid = messages.length > 0;
  const hasDescription = description !== undefined && description !== null && description !== false && description !== "";
  const labelId = `${id}-label`;
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  // An item is also described by its group's description and error, as Base UI links them
  // after hydration, so the server HTML matches.
  const describedBy =
    [hasDescription && descriptionId, invalid && errorId, item && parent!.describedBy].filter(Boolean).join(" ") || undefined;
  const invalidHere = item ? parent!.invalid : invalid;
  const requiredHere = Boolean(required) && !item;
  const ownGroup = layout === "group" ? owner.name : undefined;
  const value = useMemo(
    () => ({ required: requiredHere, describedBy, invalid: invalidHere, labelId, group: ownGroup }),
    [requiredHere, describedBy, invalidHere, labelId, ownGroup],
  );
  // Changing the control drops its Form error, as Base UI's Form drops its own copy. Every
  // control's change event bubbles here; a control without one (Select) clears it itself.
  const clearFormError = (event: FormEvent<HTMLDivElement>) => {
    if (formError === undefined || (event.target as HTMLElement).closest(`[data-ouro="${owner.data}"]`) !== event.currentTarget) return;
    form!.clear(name!);
  };

  // The field claims its name in the Form, so the Form shows its errors here, not at the top.
  const register = form?.register;
  useEffect(() => (register && name !== undefined ? register(name) : undefined), [register, name]);

  // The dev checks run after render, when the root is in the page and the control has
  // registered its id with the label.
  const rootRef = useRef<HTMLDivElement>(null);

  const hint = useCallback((token: string) => fieldHint(token, owner.name), [owner.name]);
  useAppearanceClassNameCheck(
    owner.name,
    className,
    process.env.NODE_ENV !== "production" ? hint : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    owner.name,
    process.env.NODE_ENV !== "production"
      ? () => [
          !label &&
            (layout === "group"
              ? [`legend is ${label === "" ? "empty" : "missing"}, so the group has no name`, `<${owner.name} legend="Toppings" hideLegend> to hide a legend you still need`]
              : [`label is ${label === "" ? "empty" : "missing"}, so the control has no name`, `<${owner.name} label="Email" hideLabel> to hide a label you still need`]),
          layout !== "group" &&
            !labelConnected(rootRef.current!, owner.data, labelId, nativeLabel) && [
            "the label is not connected to a control",
            `<Field label="${label}"><FieldControl /></Field>, or <FieldControl render={<textarea />} /> for another element`,
          ],
          htmlFor !== undefined && ["htmlFor is not a prop; Field connects the label itself", '<Field label="Email"><FieldControl /></Field>'],
          errorMessage !== undefined && ["errorMessage is not a prop", `<Field error="${String(errorMessage)}">`],
          helperText !== undefined && ["helperText is not a prop", `<Field description="${String(helperText)}">`],
          isInvalid !== undefined && ["isInvalid is not a prop", '<Field error="What is wrong">'],
          invalidGuess !== undefined && ["invalid is not a prop", '<Field error="What is wrong">'],
          isRequired !== undefined && ["isRequired is not a prop", "<Field required>"],
          isDisabled !== undefined && ["isDisabled is not a prop", "<Field disabled>"],
          placeholder !== undefined && [
            "placeholder is not a label",
            '<Field label="Email"><FieldControl placeholder="you@example.com" /></Field>',
          ],
          item && name !== undefined && [`name belongs on the ${group}`, `<${group} name="${name}">`],
          item && error !== undefined && [`error belongs on the ${group}, which shows it once for every choice`, `<${group} error="What is wrong">`],
          item && required !== undefined && [`required belongs on the ${group}`, `<${group} required>`],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );

  const legend =
    layout === "group" ? (
      // A group's name: not a <label>, because a group has no one element to focus. It names a
      // section rather than a control, so it keeps full contrast when the group is disabled.
      <div id={labelId} data-ouro-legend="" className={cn(labelClass, hideLabel && "sr-only")}>
        {label}
        {required && (
          <span aria-hidden="true" data-ouro-required="" className="ms-0.5 text-destructive">
            *
          </span>
        )}
        {/* The asterisk is hidden; a group with no aria-required says "required" in words. */}
        {required && owner.requiredLabel && <span className="sr-only"> {owner.requiredLabel}</span>}
      </div>
    ) : (
      <FieldLabel
        id={labelId}
        className={cn(layout === "inline" && "col-start-2", hideLabel && "sr-only")}
        {...(nativeLabel ? {} : { nativeLabel: false, render: <div /> })}
      >
        {label}
      </FieldLabel>
    );
  // The owner names this Field only: a plain Field inside (in an adornment's popover) is a Field.
  const control = <FieldOwnerContext.Provider value={fieldOwner}>{children}</FieldOwnerContext.Provider>;
  const descriptionPart = hasDescription && (
    <FieldDescription id={descriptionId} className={layout === "inline" ? "col-start-2" : undefined}>
      {description}
    </FieldDescription>
  );
  const errorPart = invalid ? (
    <FieldError id={errorId} match className={layout === "inline" ? "col-start-2" : undefined}>
      {messages.length > 1 ? (
        <ul>
          {messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : (
        messages[0]
      )}
    </FieldError>
  ) : (
    <FieldError id={errorId} className={layout === "inline" ? "col-start-2" : undefined} />
  );
  // An inline control comes first, so it reads before its label, and sits to its left. A
  // stacked field lets its owner arrange the label and the rest (NumberField, a range Slider).
  const content =
    layout === "inline" ? (
      <>
        {control}
        {legend}
        {descriptionPart}
        {/* A group shows its error once. A choice in it shares the group's validity, so its own
            error element would repeat the browser's message under every choice. */}
        {!item && errorPart}
      </>
    ) : layout === "group" ? (
      <>
        {legend}
        {descriptionPart}
        {control}
        {errorPart}
      </>
    ) : (
      (owner.frame ?? defaultFrame)(
        legend,
        <>
          {descriptionPart}
          {control}
          {errorPart}
        </>,
      )
    );
  const rootClassName = cn(layout === "inline" ? inlineRootClass : rootClass, className);

  return (
    <FieldContext.Provider value={value}>
      {item ? (
        <BaseField.Item ref={rootRef} disabled={disabled} data-ouro={owner.data} className={rootClassName}>
          {content}
        </BaseField.Item>
      ) : (
        // `invalid` stays Ouro's: Base UI would count it as a failed check and block the
        // form's next submit. Its own checks (`required`, `type`) still mark and block.
        <BaseField.Root
          ref={rootRef}
          name={name}
          disabled={disabled}
          {...(invalid ? { "data-invalid": "" } : {})}
          data-ouro={owner.data}
          className={rootClassName}
          onChange={clearFormError}
        >
          {content}
        </BaseField.Root>
      )}
    </FieldContext.Provider>
  );
}
