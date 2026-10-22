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
  labelFrameClass,
  requiredMarkClass,
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

/**
 * The className check every part runs, with the field's hint.
 *
 * @claim "The className check every part runs" registry/ouro/components/ouro/field/field-parts.tsx verify:fileLine(registry/ouro/components/ouro/field/field-parts.tsx, /function\suseLayoutClassName\(part:\sstring,/)
 */
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

/**
 * Props for {@link FieldLabel}. `className` goes on the element around the label and is for
 * layout only (`sr-only` hides the label visually); every other prop (`style`, `id`, `data-*`,
 * event handlers) goes on the `<label>` itself.
 * @claim "`className` goes on the element around" registry/ouro/components/ouro/field/field.test.tsx verify:testExists(registry/ouro/components/ouro/field/field.test.tsx::Field wiring > hides the label visually with hideLabel and keeps it as the name)
 * @claim "`className` goes on the element around" registry/ouro/components/ouro/field/field-parts.tsx verify:fileLine(registry/ouro/components/ouro/field/field-parts.tsx, /export\stype\sFieldLabelProps\s=\sOmit<BaseField\.Label\.Props,\s"className">/)
 */
export type FieldLabelProps = Omit<BaseField.Label.Props, "className"> & { className?: string | undefined };

/**
 * Part: the control's label. It points at the control by id. A required field shows a marker
 * after it, drawn by CSS on the element around the label, so the label's text and the
 * control's name stay exactly what you wrote (screen readers hear "required" from the
 * control). `className` goes on that element, where `[data-ouro-required]` is too; hide the
 * label visually with `className="sr-only"`. `style`, `id`, `data-*` attributes and event
 * handlers go on the `<label>`.
 */
export function FieldLabel({ className, children, ...props }: FieldLabelProps): JSX.Element {
  const field = useFieldPart("FieldLabel");
  useLayoutClassName("FieldLabel", className);
  // The label beside a checkbox or switch is its tap target, so it keeps phone-sized text on touch.
  const inline = useFieldOwner().layout === "inline";
  return (
    <div
      data-ouro-label=""
      {...(field.required ? { "data-ouro-required": "" } : {})}
      className={cn(labelFrameClass, inline && inlineLabelClass, field.required && requiredMarkClass, className)}
    >
      <BaseField.Label {...props} className={labelClass}>
        {children}
      </BaseField.Label>
    </div>
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
 * @claim "Without children it shows the browser's" registry/ouro/components/ouro/field/field.test.tsx verify:testExists(registry/ouro/components/ouro/field/field.test.tsx::Field wiring > shows a Base UI Form error for its name without an error prop)
 * @claim "Without children it shows the browser's" registry/ouro/components/ouro/field/field.test.tsx verify:fileLine(registry/ouro/components/ouro/field/field.test.tsx, /<FieldError\smatch>Enter\san\semail\saddress\.</FieldError>/)
 */
export function FieldError({ className, ...props }: FieldErrorProps): JSX.Element {
  useFieldPart("FieldError");
  useLayoutClassName("FieldError", className);
  return <BaseField.Error data-ouro-text="" {...props} className={cn(errorClass, className)} />;
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
      data-ouro-control="field"
      data-ouro-part="control"
      {...props}
      required={isRequired}
      // A passed `aria-required` says "required" without the browser's blocking check.
      aria-required={isRequired || props["aria-required"]}
      aria-describedby={describedBy}
      {...(field.invalid ? { "aria-invalid": true } : {})}
      className={cn(controlClass, className)}
    />
  );
}
