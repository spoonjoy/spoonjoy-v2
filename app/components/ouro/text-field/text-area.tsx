"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { ChangeEvent, JSX, ReactNode, Ref, TextareaHTMLAttributes } from "react";
import { Field } from "~/components/ouro/field/field";
import { FieldControl, type FieldControlProps } from "~/components/ouro/field/field-parts";
import { contractWarnings } from "~/components/ouro/field/field-styles";
import { cn } from "~/lib/ouro/cn";
import { useMergedRef } from "~/lib/ouro/refs";
import { FieldOwnerContext } from "~/lib/ouro/use-field";
import { useDevWarnings } from "~/lib/ouro/use-dev-warnings";
import { fitHeight, textAreaClass } from "~/components/ouro/text-field/text-area-styles";

/** The props TextArea adds to the textarea attributes it passes through. */
export interface TextAreaOwnProps {
  /**
   * What the field is for, shown above it and read as its name. Required: every control
   * needs a name. To hide it visually, keep it and add `hideLabel`. A placeholder is not a label.
   */
  label: string;
  /** Hides the label visually; screen readers still read it as the field's name. */
  hideLabel?: boolean | undefined;
  /** Supporting text under the label, read after the label through `aria-describedby`. */
  description?: ReactNode | undefined;
  /**
   * What is wrong, from your server action or client check. The message (or several, as a
   * list) shows under the field, which gets `aria-invalid`. An empty string or array means valid.
   */
  error?: string | string[] | undefined;
  /** The field must be filled: it gets `required` and `aria-required`, and the label a marker. */
  required?: boolean | undefined;
  /** Disables the field and fades it. */
  disabled?: boolean | undefined;
  /** The form field name the text submits under. */
  name?: string | undefined;
  /**
   * An example of what to write, shown while the field is empty. It is not a label; pass
   * `label`, which stays visible.
   */
  placeholder?: string | undefined;
  /** Lines of text it shows; with `autoGrow`, the fewest it shows. @default 3 */
  rows?: number | undefined;
  /**
   * Grows with the content, from `rows` lines up to `maxRows`, instead of scrolling. Use it
   * for messages and notes, so people see what they wrote.
   */
  autoGrow?: boolean | undefined;
  /** With `autoGrow`, the most lines it grows to before it scrolls. Unset, it keeps growing. */
  maxRows?: number | undefined;
  /** The current text, for a controlled field; pair it with `onValueChange` or `onChange`. */
  value?: string | undefined;
  /** The starting text, for an uncontrolled field. */
  defaultValue?: string | undefined;
  /** Called with the new text on every change. */
  onValueChange?: FieldControlProps["onValueChange"];
  /**
   * Layout only: margins, width, grid placement (`mt-4`, `col-span-2`). Appearance classes
   * warn in development; style fields in your theme.
   */
  className?: string | undefined;
  /** The textarea element. */
  ref?: Ref<HTMLTextAreaElement> | undefined;

  /** Not a prop. Ouro UI uses `error`: `<TextArea error="Required.">`. */
  errorMessage?: { 'Use <TextArea error="Required.">': never };
  /** Not a prop. Ouro UI uses `description`: `<TextArea description="Only you see these.">`. */
  helperText?: { 'Use <TextArea description="...">': never };
  /** Not a prop. `error` marks the field invalid: `<TextArea error="What is wrong">`. */
  isInvalid?: { 'Use <TextArea error="What is wrong">': never };
  /** Not a prop. `error` marks the field invalid: `<TextArea error="What is wrong">`. */
  invalid?: { 'Use <TextArea error="What is wrong">': never };
  /** Not a prop. Ouro UI uses `required`: `<TextArea required>`. */
  isRequired?: { 'Use <TextArea required>': never };
  /** Not a prop. Ouro UI uses `disabled`: `<TextArea disabled>`. */
  isDisabled?: { 'Use <TextArea disabled>': never };
  /** Not a prop. `rows` is the minimum: `<TextArea autoGrow rows={2} maxRows={8}>`. */
  minRows?: { 'Use <TextArea autoGrow rows={2} maxRows={8}>': never };
  /** Not a prop. Ouro UI uses `autoGrow`: `<TextArea autoGrow>`. */
  autoResize?: { 'Use <TextArea autoGrow>': never };
  /** Not a prop. Ouro UI uses `autoGrow`: `<TextArea autoGrow>`. */
  autosize?: { 'Use <TextArea autoGrow>': never };
}

/** Props for {@link TextArea}: its own props and the textarea attributes it passes through. */
export type TextAreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, keyof TextAreaOwnProps> & TextAreaOwnProps;

/** Field's messages and root name TextArea. */
const owner = { name: "TextArea", data: "text-area" };

/**
 * A labeled multi-line text field on the Field contract, a native `<textarea>`: pass
 * `label`, and `error` from your server action or client check. `autoGrow` makes it grow
 * with the text from `rows` lines up to `maxRows`.
 *
 * Use `TextField` instead for one line, and `Field` with `FieldControl` for a control that
 * is not text.
 *
 * @group Forms
 * @see https://ourostack.github.io/ouro-ui/docs/text-area
 *
 * @example
 * <TextArea label="Notes" name="notes" description="Only you see these." />
 * <TextArea label="Message" name="message" autoGrow rows={2} maxRows={8} required error={errors?.message} />
 */
export function TextArea(props: TextAreaProps): JSX.Element {
  const {
    label,
    hideLabel,
    description,
    error,
    required,
    disabled,
    name,
    rows = 3,
    autoGrow = false,
    maxRows,
    className,
    ref,
    onChange,
    // Guard props (hint types), dropped here so they never reach the DOM.
    errorMessage,
    helperText,
    isInvalid,
    invalid,
    isRequired,
    isDisabled,
    minRows,
    autoResize,
    autosize,
    ...rest
  } = props;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useDevWarnings(
    "TextArea",
    process.env.NODE_ENV !== "production"
      ? () => [
          ...contractWarnings("TextArea", { errorMessage, helperText, isInvalid, invalid, isRequired, isDisabled }),
          minRows !== undefined && ["minRows is not a prop; rows is the minimum", `<TextArea autoGrow rows={${String(minRows)}} maxRows={8}>`],
          autoResize !== undefined && ["autoResize is not a prop", "<TextArea autoGrow>"],
          autosize !== undefined && ["autosize is not a prop", "<TextArea autoGrow>"],
          maxRows !== undefined && !autoGrow && ["maxRows only applies with autoGrow", `<TextArea autoGrow maxRows={${maxRows}}>`],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );

  // With autoGrow, fit after every render (a controlled value, a prop change) and on every
  // keystroke. Without it, measure nothing: the inline height is the user's resize handle.
  // Turning autoGrow off once clears the height autoGrow set, so `rows` applies again.
  const grew = useRef(autoGrow);
  const fit = () => {
    const textarea = textareaRef.current!;
    if (autoGrow) fitHeight(textarea, rows, maxRows);
    else if (grew.current) {
      textarea.style.height = "";
      textarea.style.overflowY = "";
    }
    grew.current = autoGrow;
  };
  useLayoutEffect(fit);
  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    if (autoGrow) fitHeight(event.currentTarget, rows, maxRows);
    onChange?.(event);
  };
  // The text rewraps when the width changes (a rotated phone, a resized window).
  useEffect(() => {
    if (!autoGrow) return;
    const textarea = textareaRef.current!;
    let width = textarea.offsetWidth;
    const observer = new ResizeObserver(() => {
      if (textarea.offsetWidth === width) return;
      width = textarea.offsetWidth;
      fitHeight(textarea, rows, maxRows);
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [autoGrow, rows, maxRows]);

  const setRef = useMergedRef(ref, textareaRef);

  return (
    <FieldOwnerContext.Provider value={owner}>
      <Field
        label={label}
        hideLabel={hideLabel}
        description={description}
        error={error}
        required={required}
        disabled={disabled}
        name={name}
        className={className}
      >
        <FieldControl
          {...(rest as Omit<FieldControlProps, "className">)}
          ref={setRef as Ref<HTMLInputElement>}
          onChange={handleChange as unknown as FieldControlProps["onChange"]}
          render={(controlProps) => (
            <textarea
              {...(controlProps as TextareaHTMLAttributes<HTMLTextAreaElement>)}
              rows={rows}
              className={cn(textAreaClass, autoGrow ? "resize-none" : "resize-y")}
            />
          )}
        />
      </Field>
    </FieldOwnerContext.Provider>
  );
}
