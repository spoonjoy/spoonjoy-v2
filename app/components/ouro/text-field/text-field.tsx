"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { JSX, MouseEvent, ReactNode, Ref } from "react";
import { Button } from "~/components/ouro/button/button";
import { Field } from "~/components/ouro/field/field";
import { FieldControl, type FieldControlProps } from "~/components/ouro/field/field-parts";
import { contractWarnings } from "~/components/ouro/field/field-styles";
import { cn } from "~/lib/ouro/cn";
import { useMergedRef } from "~/lib/ouro/refs";
import { FieldOwnerContext } from "~/lib/ouro/use-field";
import { useDevWarnings } from "~/lib/ouro/use-dev-warnings";
import {
  adornmentClass,
  endSlotClass,
  groupClass,
  inputClass,
  nativeClearClass,
  numberWarning,
  textFieldTypes,
  typeDefaults,
  typeWarning,
  type TextFieldType,
} from "~/components/ouro/text-field/text-field-styles";

/** The props TextField adds to the input attributes it passes through. */
export interface TextFieldOwnProps {
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
  /** Disables the field, its buttons included, and fades it. */
  disabled?: boolean | undefined;
  /** The form field name the value submits under. */
  name?: string | undefined;
  /**
   * What kind of text it holds. Each type sets the phone keyboard (`inputMode`) and autofill
   * (`autoComplete`) for you; pass either to override. `password` adds a show/hide button;
   * `date` and `time` open the OS picker. For numbers use `NumberField`, which parses and
   * steps them; for digit codes, `inputMode="numeric"`.
   * @default "text"
   */
  type?:
    | "text"
    | "email"
    | "password"
    | "tel"
    | "url"
    | "search"
    | "date"
    | "time"
    | (string & { 'number is <NumberField>; digit codes: inputMode="numeric"': never })
    | undefined;
  /**
   * Text or an icon inside the box, before the input: `"$"`, `<SearchIcon />`. Text is also
   * read as part of the field's description. Replaces shadcn's InputGroup.
   */
  startAdornment?: ReactNode | undefined;
  /** Text or an icon inside the box, after the input: `"kg"`, `<CheckIcon />`. Text is also read as part of the description. */
  endAdornment?: ReactNode | undefined;
  /**
   * An example of what to type, shown while the field is empty: `"you@example.com"`. It is
   * not a label; pass `label`, which stays visible.
   */
  placeholder?: string | undefined;
  /** Adds a button that empties the field and puts focus back in it. It shows while there is text. */
  clearable?: boolean | undefined;
  /**
   * The label of the clear button that `clearable` adds. Translate it with your app.
   * @default "Clear"
   */
  clearLabel?: string | undefined;
  /**
   * The label of a password field's show/hide button. It stays the same while the password
   * shows; the button's pressed state (`aria-pressed`) says whether it does. Translate it with your app.
   * @default "Show password"
   */
  showPasswordLabel?: string | undefined;
  /**
   * Layout only: margins, width, grid placement (`mt-4`, `col-span-2`). Appearance classes
   * warn in development; style fields in your theme.
   */
  className?: string | undefined;
  /** The input element. */
  ref?: Ref<HTMLInputElement> | undefined;

  /** Not a prop. Ouro UI uses `error`: `<TextField error="Required.">`. */
  errorMessage?: { 'Use <TextField error="Required.">': never };
  /** Not a prop. Ouro UI uses `description`: `<TextField description="We never share it.">`. */
  helperText?: { 'Use <TextField description="...">': never };
  /** Not a prop. `error` marks the field invalid: `<TextField error="What is wrong">`. */
  isInvalid?: { 'Use <TextField error="What is wrong">': never };
  /** Not a prop. `error` marks the field invalid: `<TextField error="What is wrong">`. */
  invalid?: { 'Use <TextField error="What is wrong">': never };
  /** Not a prop. Ouro UI uses `required`: `<TextField required>`. */
  isRequired?: { 'Use <TextField required>': never };
  /** Not a prop. Ouro UI uses `disabled`: `<TextField disabled>`. */
  isDisabled?: { 'Use <TextField disabled>': never };
  /** Not a prop. Ouro UI uses `startAdornment`: `<TextField startAdornment={<SearchIcon />}>`. */
  startIcon?: { 'Use <TextField startAdornment={<SearchIcon />}>': never };
  /** Not a prop. Ouro UI uses `startAdornment`: `<TextField startAdornment={<SearchIcon />}>`. */
  leftIcon?: { 'Use <TextField startAdornment={<SearchIcon />}>': never };
  /** Not a prop. Ouro UI uses `endAdornment`: `<TextField endAdornment={<CheckIcon />}>`. */
  endIcon?: { 'Use <TextField endAdornment={<CheckIcon />}>': never };
  /** Not a prop. Ouro UI uses `endAdornment`: `<TextField endAdornment={<CheckIcon />}>`. */
  rightIcon?: { 'Use <TextField endAdornment={<CheckIcon />}>': never };
  /** Not a prop. Ouro UI uses `startAdornment`: `<TextField startAdornment="$">`. */
  prefix?: { 'Use <TextField startAdornment="$">': never };
  /** Not a prop. Ouro UI uses `endAdornment`: `<TextField endAdornment="kg">`. */
  suffix?: { 'Use <TextField endAdornment="kg">': never };
  /** Not a prop. Ouro UI uses `clearable`: `<TextField clearable>`. */
  isClearable?: { 'Use <TextField clearable>': never };
  /** Not a prop. TextField is one line; use `TextArea` for several: `<TextArea label="Notes" autoGrow />`. */
  multiline?: { 'Use <TextArea label="Notes" autoGrow />': never };
}

/** Props for {@link TextField}: its own props and the input attributes it passes through. */
export type TextFieldProps = Omit<FieldControlProps, keyof TextFieldOwnProps | "render"> & TextFieldOwnProps;

/** Field's messages and root name TextField. */
const owner = { name: "TextField", data: "text-field" };

const preventFocusMove = (event: MouseEvent) => event.preventDefault();

/** An adornment that is text, and so part of the field's description. */
const isText = (node: ReactNode): node is string | number => typeof node === "string" || typeof node === "number";

/** The value prop as text, to know whether there is something to clear. */
const textOf = (value: unknown): string => (value === undefined || value === null ? "" : String(value));

/** Icons drawn in the text color at 16px, like the other Ouro icons. */
function Icon({ children }: { children: ReactNode }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
    >
      {children}
    </svg>
  );
}

/**
 * A labeled one-line text input on the Field contract: pass `label`, and `error` from your
 * server action or client check. The `type` sets the phone keyboard and autofill, `password`
 * gets a show/hide button that keeps focus in the input, `clearable` adds a clear button, and
 * `startAdornment`/`endAdornment` put text or icons inside the box.
 *
 * Use `TextArea` instead for several lines, `NumberField` for numbers, and `Field` with
 * `FieldControl` when the control is not a text input.
 *
 * @group Forms
 * @see https://ourostack.github.io/ouro-ui/docs/text-field
 *
 * @example
 * <TextField label="Email" type="email" name="email" required error={errors?.email} />
 * <TextField label="Password" type="password" name="password" autoComplete="new-password" />
 * <TextField label="Search recipes" hideLabel type="search" clearable startAdornment={<SearchIcon />} />
 * <TextField label="Price" startAdornment="$" endAdornment="per jar" />
 */
export function TextField(props: TextFieldProps): JSX.Element {
  const {
    label,
    hideLabel,
    description,
    error,
    required,
    disabled,
    name,
    type: typeProp = "text",
    startAdornment,
    endAdornment,
    clearable,
    clearLabel = "Clear",
    showPasswordLabel = "Show password",
    className,
    ref,
    value,
    defaultValue,
    onChange,
    readOnly,
    inputMode,
    autoComplete,
    "aria-describedby": describedByProp,
    // Guard props (hint types), dropped here so they never reach the DOM.
    errorMessage,
    helperText,
    isInvalid,
    invalid,
    isRequired,
    isDisabled,
    startIcon,
    leftIcon,
    endIcon,
    rightIcon,
    prefix,
    suffix,
    isClearable,
    multiline,
    ...rest
  } = props;
  // A type that is not one of TextField's (a type error) warns and renders the default.
  const type: TextFieldType = textFieldTypes.includes(typeProp as TextFieldType) ? (typeProp as TextFieldType) : "text";
  // A number that fell back to text still gets a number keyboard.
  const defaults = typeProp === "number" ? { ...typeDefaults.text, inputMode: "decimal" as const } : typeDefaults[type];
  const id = useId();
  const startId = `${id}-start`;
  const endId = `${id}-end`;
  const inputRef = useRef<HTMLInputElement | null>(null);

  useDevWarnings(
    "TextField",
    process.env.NODE_ENV !== "production"
      ? () => [
          type !== typeProp && (typeProp === "number" ? numberWarning(label) : typeWarning(String(typeProp))),
          ...contractWarnings("TextField", { errorMessage, helperText, isInvalid, invalid, isRequired, isDisabled }),
          startIcon !== undefined && ["startIcon is not a prop", "<TextField startAdornment={<SearchIcon />}>"],
          leftIcon !== undefined && ["leftIcon is not a prop", "<TextField startAdornment={<SearchIcon />}>"],
          endIcon !== undefined && ["endIcon is not a prop", "<TextField endAdornment={<CheckIcon />}>"],
          rightIcon !== undefined && ["rightIcon is not a prop", "<TextField endAdornment={<CheckIcon />}>"],
          prefix !== undefined && ["prefix is not a prop", `<TextField startAdornment="${String(prefix)}">`],
          suffix !== undefined && ["suffix is not a prop", `<TextField endAdornment="${String(suffix)}">`],
          isClearable !== undefined && ["isClearable is not a prop", "<TextField clearable>"],
          multiline !== undefined && ["multiline is not a prop; TextField is one line", '<TextArea label="Notes" autoGrow />'],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );

  // Whether there is text to clear: the value when controlled, else what the user typed.
  const [typed, setTyped] = useState(() => textOf(defaultValue) !== "");
  const filled = value === undefined ? typed : textOf(value) !== "";
  const handleChange: NonNullable<FieldControlProps["onChange"]> = (event) => {
    setTyped(event.currentTarget.value !== "");
    onChange?.(event);
  };
  // A form reset puts back the default value after the reset event, so read it a task later.
  useEffect(() => {
    const form = inputRef.current!.form;
    if (!clearable || !form) return;
    const onReset = () => setTimeout(() => setTyped(inputRef.current?.value !== ""));
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [clearable]);

  const clear = () => {
    const input = inputRef.current!;
    // Set the value the way typing does, so React's onChange and Base UI's onValueChange fire
    // for a controlled field and an uncontrolled one alike.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  };

  // Showing the password changes the input's type, which resets the cursor in some browsers:
  // remember the selection while the input has focus, and put it back after the change.
  const [revealed, setRevealed] = useState(false);
  const selection = useRef<[number | null, number | null] | null>(null);
  const toggle = () => {
    const input = inputRef.current!;
    if (input.ownerDocument.activeElement === input) selection.current = [input.selectionStart, input.selectionEnd];
    setRevealed((shown) => !shown);
  };
  // A password submitted while it shows would reach password managers as text, so hide it
  // when the form submits (before the app's own submit handler runs).
  const password = type === "password";
  useEffect(() => {
    const form = inputRef.current!.form;
    if (!password || !form) return;
    const onSubmit = () => flushSync(() => setRevealed(false));
    form.addEventListener("submit", onSubmit);
    return () => form.removeEventListener("submit", onSubmit);
  }, [password]);
  useLayoutEffect(() => {
    const saved = selection.current;
    if (!saved) return;
    selection.current = null;
    const input = inputRef.current!;
    // Chrome rebuilds the input's editor on the next layout after a type change, which moves
    // the cursor to the start: lay out first, then set the selection.
    void input.offsetWidth;
    input.setSelectionRange(saved[0], saved[1]);
  }, [revealed]);

  // Pressing the box outside the input (its padding, a text adornment) focuses the input, as
  // pressing a plain input's padding does. Buttons and links inside keep their own focus.
  const focusInput = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    // Only controls inside the box count: a dialog around the field has a tabindex too.
    const control = target.closest("button, a, input, select, textarea, [tabindex]");
    if (target === inputRef.current || (control && event.currentTarget.contains(control))) return;
    event.preventDefault();
    inputRef.current!.focus();
  };

  const setRef = useMergedRef(ref, inputRef);

  const hasStart = startAdornment !== undefined && startAdornment !== null && startAdornment !== false;
  const hasEnd = endAdornment !== undefined && endAdornment !== null && endAdornment !== false;
  const describedBy =
    [isText(startAdornment) && startId, isText(endAdornment) && endId, describedByProp].filter(Boolean).join(" ") || undefined;
  const showClear = clearable && filled && !disabled && !readOnly;

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
        <div data-ouro-input-group="" className={groupClass} onMouseDown={focusInput}>
          {hasStart && (
            <span id={startId} data-ouro-adornment="start" className={adornmentClass}>
              {startAdornment}
            </span>
          )}
          <FieldControl
            {...rest}
            ref={setRef}
            value={value}
            defaultValue={defaultValue}
            onChange={handleChange}
            readOnly={readOnly}
            type={password && revealed ? "text" : type}
            inputMode={inputMode ?? defaults.inputMode}
            autoComplete={autoComplete ?? defaults.autoComplete}
            autoCapitalize={rest.autoCapitalize ?? defaults.autoCapitalize}
            spellCheck={rest.spellCheck ?? defaults.spellCheck}
            enterKeyHint={rest.enterKeyHint ?? defaults.enterKeyHint}
            aria-describedby={describedBy}
            render={(controlProps) => (
              <input {...controlProps} className={cn(inputClass, clearable && type === "search" && nativeClearClass)} />
            )}
          />
          {(showClear || password) && (
            <span className={endSlotClass}>
              {showClear && (
                <Button
                  variant="plain"
                  tone="secondary"
                  size="sm"
                  aria-label={clearLabel}
                  className="aspect-square px-0"
                  onMouseDown={preventFocusMove}
                  onClick={clear}
                >
                  <Icon>
                    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
                  </Icon>
                </Button>
              )}
              {password && (
                <Button
                  variant="plain"
                  tone="secondary"
                  size="sm"
                  aria-label={showPasswordLabel}
                  aria-pressed={revealed}
                  disabled={disabled}
                  className="aspect-square px-0"
                  onMouseDown={preventFocusMove}
                  onClick={toggle}
                >
                  <Icon>
                    <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z" />
                    <circle cx="8" cy="8" r="2" />
                    {revealed && <path d="M2.5 2.5l11 11" />}
                  </Icon>
                </Button>
              )}
            </span>
          )}
          {hasEnd && (
            <span id={endId} data-ouro-adornment="end" className={adornmentClass}>
              {endAdornment}
            </span>
          )}
        </div>
      </Field>
    </FieldOwnerContext.Provider>
  );
}
