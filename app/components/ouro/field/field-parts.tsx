"use client";

import { Field as BaseField } from "@base-ui/react/field";
import { useMemo, type JSX, type Ref } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { devThrow } from "~/lib/ouro/dev";
import { FieldContext, useField, useFieldOwner, type FieldContextValue } from "~/lib/ouro/use-field";
import {
  controlClass,
  descriptionClass,
  errorClass,
  fieldHint,
  inlineLabelClass,
  labelClass,
  rootClass,
} from "~/components/ouro/field/field-styles";

/** The JSX a part belongs in, for the dev message when it is not there. */
const SHAPE =
  '<FieldRoot name="email"><FieldLabel>Email</FieldLabel><FieldDescription>…</FieldDescription><FieldControl /><FieldError /></FieldRoot>';

/** The enclosing field's state; throws in development, with the JSX the part belongs in, outside one. */
function useFieldPart(part: string): FieldContextValue {
  const field = useField();
  if (!field) {
    devThrow(
      part,
      "must be rendered inside <FieldRoot> or <Field>",
      process.env.NODE_ENV !== "production" ? SHAPE : /* istanbul ignore next @preserve -- production only */ "",
    );
  }
  return field;
}

/** The className check every part runs, with the field's hint. */
function useLayoutClassName(part: string, className: string | undefined): void {
  useAppearanceClassNameCheck(
    part,
    className,
    process.env.NODE_ENV !== "production" ? fieldHint : /* istanbul ignore next @preserve -- production only */ "",
  );
}

/** Props for {@link FieldRoot}. `className` is for layout only (margins, width, grid placement). */
export type FieldRootProps = Omit<BaseField.Root.Props, "className"> & {
  className?: string | undefined;
  /** The control is required: it gets `required` and `aria-required`, and the label a marker. */
  required?: boolean | undefined;
};

/**
 * Part: the state owner of a field built from parts. It connects the label, description
 * and error to the control, and passes `name`, `disabled` and `required` down. Use the
 * `Field` component instead unless its props cannot express your layout; every Ouro form
 * control is built on these parts. Parts link the description and error after hydration;
 * use `Field` when the server HTML must carry them, or pass `id`s and `aria-describedby`
 * yourself.
 *
 * @example
 * <FieldRoot name="email" required>
 *   <FieldLabel>Email</FieldLabel>
 *   <FieldDescription>We never share it.</FieldDescription>
 *   <FieldControl type="email" />
 *   <FieldError />
 * </FieldRoot>
 */
export function FieldRoot({ className, required, ...props }: FieldRootProps): JSX.Element {
  useLayoutClassName("FieldRoot", className);
  const invalid = Boolean(props.invalid);
  const value = useMemo(() => ({ required: Boolean(required), describedBy: undefined, invalid, labelId: undefined }), [required, invalid]);
  return (
    <FieldContext.Provider value={value}>
      <BaseField.Root {...props} data-ouro="field" className={cn(rootClass, className)} />
    </FieldContext.Provider>
  );
}

/** Props for {@link FieldLabel}. `className` is for layout only; `sr-only` hides the label visually. */
export type FieldLabelProps = Omit<BaseField.Label.Props, "className"> & { className?: string | undefined };

/**
 * Part: the control's label. It points at the control by id, and a required field adds a
 * marker that screen readers skip (they hear "required" from the control). Hide it
 * visually with `className="sr-only"`.
 */
export function FieldLabel({ className, children, ...props }: FieldLabelProps): JSX.Element {
  const field = useFieldPart("FieldLabel");
  useLayoutClassName("FieldLabel", className);
  // The label beside a checkbox or switch is its tap target, so it keeps phone-sized text on touch.
  const inline = useFieldOwner().layout === "inline";
  return (
    <BaseField.Label {...props} className={cn(labelClass, inline && inlineLabelClass, className)}>
      {children}
      {field.required && (
        <span aria-hidden="true" data-ouro-required="" className="ms-0.5 text-destructive">
          *
        </span>
      )}
    </BaseField.Label>
  );
}

/** Props for {@link FieldDescription}. `className` is for layout only. */
export type FieldDescriptionProps = Omit<BaseField.Description.Props, "className"> & { className?: string | undefined };

/** Part: supporting text for the control, read after its label through `aria-describedby`. */
export function FieldDescription({ className, ...props }: FieldDescriptionProps): JSX.Element {
  useFieldPart("FieldDescription");
  useLayoutClassName("FieldDescription", className);
  return <BaseField.Description {...props} className={cn(descriptionClass, className)} />;
}

/** Props for {@link FieldError}. `className` is for layout only. */
export type FieldErrorProps = Omit<BaseField.Error.Props, "className"> & { className?: string | undefined };

/**
 * Part: the error message, linked to the control through `aria-describedby`. Without
 * children it shows the browser's validation message, or a Base UI `Form` error for the
 * field's `name`; with `match` and children it always shows them. It fades and slides in.
 */
export function FieldError({ className, ...props }: FieldErrorProps): JSX.Element {
  useFieldPart("FieldError");
  useLayoutClassName("FieldError", className);
  return <BaseField.Error {...props} className={cn(errorClass, className)} />;
}

/** Props for {@link FieldControl}. `className` is for layout only. */
export type FieldControlProps = Omit<BaseField.Control.Props, "className"> & {
  className?: string | undefined;
  ref?: Ref<HTMLInputElement> | undefined;
};

/**
 * Part: the control, a text `<input>` by default. It takes the field's id, `name`,
 * `disabled` and `required`, `aria-invalid` from its error, and `aria-describedby` from its
 * description and error. Render another element with
 * `render={<textarea />}`.
 */
export function FieldControl({ className, required, ...props }: FieldControlProps): JSX.Element {
  const field = useFieldPart("FieldControl");
  useLayoutClassName("FieldControl", className);
  const isRequired = Boolean(field.required || required);
  const describedBy = [field.describedBy, props["aria-describedby"]].filter(Boolean).join(" ") || undefined;
  return (
    <BaseField.Control
      {...props}
      required={isRequired}
      aria-required={isRequired || undefined}
      aria-describedby={describedBy}
      {...(field.invalid ? { "aria-invalid": true } : {})}
      className={cn(controlClass, className)}
    />
  );
}
