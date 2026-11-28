"use client";

import "~/lib/ouro/last-input";
import { memo, useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ChangeEvent, JSX, ReactNode, Ref, TextareaHTMLAttributes } from "react";
import { Field } from "~/components/ouro/field/field";
import { FieldControl, type FieldControlProps } from "~/components/ouro/field/field-parts";
import { contractWarnings } from "~/components/ouro/field/field-styles";
import { cn } from "~/lib/ouro/cn";
import { devWarn } from "~/lib/ouro/dev";
import { useMergedRef } from "~/lib/ouro/refs";
import { FieldOwnerContext, type ReadonlyErrorMessages } from "~/lib/ouro/use-field";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import {
  autoGrowBounds,
  autoGrowClass,
  clearFit,
  describeHighlights,
  fitHeight,
  supportsFieldSizing,
  highlightLayerClass,
  highlightRuns,
  highlightTone,
  highlightTones,
  highlightWarnings,
  highlightsKey,
  mirroredStyles,
  moveHighlights,
  normalizeHighlights,
  textAreaClass,
  textAreaSizes,
  textAreaVariants,
  type HighlightEdit,
} from "~/components/ouro/text-field/text-area-styles";
import { controlSizeWarning, controlVariantWarning } from "~/components/ouro/text-field/text-field-styles";

/**
 * A range of a TextArea's text that it marks: words an assistant suggested in the person's
 * draft, a possible spelling mistake. `start` and `end` are JavaScript string indexes, and
 * `end` is exclusive, so a mark covers `text.slice(start, end)`.
 */
export interface TextAreaHighlight {
  /** Where the mark starts: the index of its first character in the text. */
  start: number;
  /** Where it ends: the index just after its last character. */
  end: number;
  /**
   * What the mark means, which screen readers hear with the words it marks: "Suggested by
   * your assistant", "Possible spelling mistake". Required, so no mark is shown only to sighted people.
   * @claim "Required, so no mark is shown" registry/ouro/components/ouro/text-field/text-area.test-d.ts verify:fileLine(registry/ouro/components/ouro/text-field/text-area.test-d.ts, /expectTypeOf<\{\sstart:\s0;\send:\s5\s\}>\(\)\.not\.toExtend<TextAreaHighlight>/)
   */
  label: string;
  /**
   * The mark's colour, a theme tone. `destructive` and `warning` draw a wavy underline, as
   * spelling and grammar checkers do; the others a dotted underline on a faint tint.
   * @default "primary"
   */
  tone?: "primary" | "secondary" | "destructive" | "success" | "warning" | (string & { 'danger is "destructive"; accent is "primary"; neutral is "secondary"': never }) | undefined;
  /** Your own id for the mark. An edit inside a mark splits it, and both pieces keep its id. */
  id?: string | undefined;
}

/** The props TextArea adds to the textarea attributes it passes through. */
export interface TextAreaOwnProps {
  /**
   * What the field is for, shown above it and read as its name. Required: every control
   * needs a name. To hide it visually, keep it and add `hideLabel`. A placeholder is not a label.
   * @claim "Required: every control needs a name" registry/ouro/components/ouro/text-field/text-area.test-d.ts verify:fileLine(registry/ouro/components/ouro/text-field/text-area.test-d.ts, /expectTypeOf<\{\srows:\s3\s\}>\(\)\.not\.toExtend<TextAreaProps>/)
   */
  label: string;
  /** Hides the label visually; screen readers still read it as the field's name. */
  hideLabel?: boolean | undefined;
  /** Supporting text under the label, read after the label through `aria-describedby`. */
  description?: ReactNode | undefined;
  /**
   * What is wrong, from your server action or client check. The message (or several, as a
   * list) shows under the field, which gets `aria-invalid`. A message is text or a React node (one with a link); an empty string or array means valid.
   */
  error?: ReadonlyErrorMessages | undefined;
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
  /**
   * The frame. `outline` draws the bordered box. `plain` draws no border, background or
   * padding, for a textarea inside a frame your app draws (a chat composer with its send
   * button in the same box); it keeps the focus outline, and the error message still shows
   * under it, but with no border to turn red, color your own frame for an invalid field.
   * Any other string is a type error whose message names the fix. @default "outline"
   * @claim "`plain` draws no border, background or" registry/ouro/components/ouro/text-field/text-area.test.tsx verify:testExists(registry/ouro/components/ouro/text-field/text-area.test.tsx::TextArea variant and size > draws no frame of its own with variant plain, and still outlines on keyboard focus)
   */
  variant?: "outline" | "plain" | (string & { 'default is "outline"; ghost, unstyled and borderless are "plain"': never }) | undefined;
  /**
   * Text size. `md` is 16px on phones and steps down to 14px from the `sm` breakpoint (640px).
   * `lg` is 20px at every width. The font family is inherited, so set a display font on a
   * parent. @default "md"
   * @claim "`md` is 16px on phones and" registry/ouro/components/ouro/text-field/text-area.test.tsx verify:testExists(registry/ouro/components/ouro/text-field/text-area.test.tsx::TextArea > uses a 16px font on phones, so iOS does not zoom on focus)
   * @claim "`lg` is 20px at every width" registry/ouro/components/ouro/text-field/text-area.test.tsx verify:testExists(registry/ouro/components/ouro/text-field/text-area.test.tsx::TextArea variant and size > sets 20px text on 28px lines with size lg, at phone and desktop widths)
   */
  size?: "md" | "lg" | (string & { 'default is "md"; "lg" is 20px text': never }) | undefined;
  /**
   * Lines of text it shows; with `autoGrow`, the fewest it shows. @default 3
   *
   * @claim "Lines of text it shows; with" registry/ouro/components/ouro/text-field/text-area.test.tsx verify:testExists(registry/ouro/components/ouro/text-field/text-area.test.tsx::TextArea > shows three rows by default, or rows, and the user can resize it)
   * @claim "Lines of text it shows; with" registry/ouro/components/ouro/text-field/text-area.test.tsx verify:testExists(registry/ouro/components/ouro/text-field/text-area.test.tsx::TextArea autoGrow > never caps below rows)
   */
  rows?: number | undefined;
  /**
   * Grows with the content, from `rows` lines up to `maxRows`, instead of scrolling. Use it
   * for messages and notes, so people see what they wrote. Its first frame already has the
   * height it settles at, with a starting value too. To change its vertical padding, set
   * `--ouro-text-area-py` (`className="[&_textarea]:[--ouro-text-area-py:12px]"`), not a `py-*` class.
   *
   * @claim "Its first frame already has the" registry/ouro/components/ouro/text-field/text-area.test.tsx verify:testExists(registry/ouro/components/ouro/text-field/text-area.test.tsx::TextArea autoGrow first frame > is its settled height on its first frame, with a defaultValue of several lines) verify:testExists(registry/ouro/components/ouro/text-field/text-area.test.tsx::TextArea autoGrow first frame > is its new height on the first frame after its value changes)
   * @claim "To change its vertical padding, set" registry/ouro/components/ouro/text-field/text-area.test.tsx verify:testExists(registry/ouro/components/ouro/text-field/text-area.test.tsx::TextArea development messages > warns that a py class leaves autoGrow's bounds out of step, and not for the padding variable)
   */
  autoGrow?: boolean | undefined;
  /**
   * With `autoGrow`, the most lines it grows to before it scrolls. Unset, it keeps growing.
   *
   * @claim "With `autoGrow`, the most lines it" registry/ouro/components/ouro/text-field/text-area.test.tsx verify:testExists(registry/ouro/components/ouro/text-field/text-area.test.tsx::TextArea autoGrow > grows with the content and stops at maxRows, then scrolls)
   * @claim "With `autoGrow`, the most lines it" registry/ouro/components/ouro/text-field/text-area.test.tsx verify:testExists(registry/ouro/components/ouro/text-field/text-area.test.tsx::TextArea autoGrow > grows without a cap when maxRows is not set)
   */
  maxRows?: number | undefined;
  /** The current text, for a controlled field; pair it with `onValueChange` or `onChange`. */
  value?: string | undefined;
  /** The starting text, for an uncontrolled field. */
  defaultValue?: string | undefined;
  /**
   * Called with the new text on every change.
   *
   * @claim "Called with the new text on" registry/ouro/components/ouro/text-field/text-area.test.tsx verify:testExists(registry/ouro/components/ouro/text-field/text-area.test.tsx::TextArea > passes textarea attributes, value and change handlers through)
   */
  onValueChange?: FieldControlProps["onValueChange"];
  /**
   * Ranges of the text to mark in place, each with a tone and a label: words an assistant
   * wrote in the person's draft, or spelling and grammar notes. The marks wrap with the words
   * and scroll with them, and screen readers hear each label with the words it marks in the
   * field's description. As the person types, pastes or undoes, the marks follow their
   * words: what the person types is never marked, an edit inside a mark splits it, and undo
   * brings back the marks the text had. Pass `[]` for none, rather than switching the prop
   * off and on, which remounts the textarea: with no marks the layer draws nothing and costs
   * nothing as the person types.
   * @claim "with no marks the layer draws nothing" registry/ouro/components/ouro/text-field/text-area.highlights.test.tsx verify:testExists(registry/ouro/components/ouro/text-field/text-area.highlights.test.tsx::TextArea highlights' cost > copies nothing and draws no text with no marks, as the person types or the parent renders, and stays hidden)
   * @claim "Ranges of the text to mark in" registry/ouro/components/ouro/text-field/text-area.highlights.test.tsx verify:testExists(registry/ouro/components/ouro/text-field/text-area.highlights.test.tsx::TextArea highlights > marks each range over its words, in a layer with the textarea's box and type, and lets the pointer through)
   * @claim "The marks wrap with the words" registry/ouro/components/ouro/text-field/text-area.highlights.test.tsx verify:testExists(registry/ouro/components/ouro/text-field/text-area.highlights.test.tsx::TextArea highlights > wraps a mark with its words onto the next line)
   * @claim "The marks wrap with the words" registry/ouro/components/ouro/text-field/text-area.highlights.test.tsx verify:testExists(registry/ouro/components/ouro/text-field/text-area.highlights.test.tsx::TextArea highlights layout > scrolls the marks with the text once autoGrow stops at maxRows)
   * @claim "The marks wrap with the words" registry/ouro/components/ouro/text-field/text-area.highlights.test.tsx verify:testExists(registry/ouro/components/ouro/text-field/text-area.highlights.test.tsx::TextArea highlights > describes the marks after the field's own description: each label once, with the words it marks)
   * @claim "As the person types, pastes or" registry/ouro/components/ouro/text-field/text-area.highlights.test.tsx verify:testExists(registry/ouro/components/ouro/text-field/text-area.highlights.test.tsx::TextArea highlights as the person edits > never marks what the person types, before, after or inside a mark, and splits a mark they type inside)
   * @claim "As the person types, pastes or" registry/ouro/components/ouro/text-field/text-area.highlights.test.tsx verify:testExists(registry/ouro/components/ouro/text-field/text-area.highlights.test.tsx::TextArea highlights as the person edits > brings the marks back when the person undoes an edit, and takes them away again on redo)
   */
  highlights?: readonly TextAreaHighlight[] | undefined;
  /**
   * Called with the highlights moved to fit the text after the person edits it. Store them
   * and pass them back as `highlights`, or recompute your own from your data.
   */
  onHighlightsChange?: ((highlights: TextAreaHighlight[]) => void) | undefined;
  /**
   * Layout only: margins, width, grid placement (`mt-4`, `col-span-2`). Appearance classes
   * warn in development; style fields in your theme.
   */
  className?: string | undefined;
  /** The textarea element. */
  ref?: Ref<HTMLTextAreaElement> | undefined;

  /** Not a prop. Ouro UI uses `highlights`: `<TextArea highlights={[{ start: 0, end: 5, label: "Suggested" }]}>`. */
  marks?: { 'Use <TextArea highlights={[{ start: 0, end: 5, label: "Suggested" }]}>': never };

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
 * Wraps the `on*` handlers and the `ref` Base UI's FieldControl rebuilds on a render in a
 * stable-identity function that calls the latest version, reusing one wrapper per key
 * across renders. The memoized native textarea below can then bail out of a commit a typed
 * keystroke would otherwise force on it, since its props compare equal.
 */
function stabilizeTextareaProps<P extends object>(
  props: P,
  state: { registry: Map<string, (...args: unknown[]) => unknown>; latest: P },
): P {
  state.latest = props;
  const next = { ...props } as Record<string, unknown>;
  for (const key of Object.keys(props as Record<string, unknown>)) {
    const value = (props as Record<string, unknown>)[key];
    // A textarea's only function-valued props are its `on*` handlers and a callback `ref`, so the type alone picks them out.
    if (typeof value !== "function") continue;
    let wrapped = state.registry.get(key);
    if (!wrapped) {
      wrapped = (...args: unknown[]) => {
        // The wrapper reaches the element only while `key` is in the latest props.
        const handler = (state.latest as Record<string, unknown>)[key] as (...a: unknown[]) => unknown;
        return handler(...args);
      };
      state.registry.set(key, wrapped);
    }
    next[key] = wrapped;
  }
  return next as P;
}

/**
 * The native textarea, memoized so a controlled TextArea's typing commits do not reach `value` or
 * `defaultValue` here: either would make React write `.defaultValue`, which replaces the
 * element's child text node, on a commit that revisits this fiber, whether or not the text
 * changed (ouro-ui#3759). `TextArea`'s own `useLayoutEffect` keeps `.value` in sync directly,
 * outside this leaf's props, so this bails out of a render a parent-driven re-render would
 * otherwise force on it.
 */
const RawTextarea = memo(function RawTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  return <textarea {...props} />;
});

/**
 * A labeled multi-line text field on the Field contract, a native `<textarea>`: pass
 * `label`, and `error` from your server action or client check. `autoGrow` makes it grow
 * with the text from `rows` lines up to `maxRows`.
 *
 * `variant="plain"` draws no frame, for a textarea inside a box your app draws, and
 * `size="lg"` sets 20px text. `highlights` marks ranges of the text in place, each with a
 * tone and a label screen readers hear, and the marks follow their words as the person edits.
 *
 * Use `TextField` instead for one line, `Composer` for a chat message box with its send
 * button, and `Field` with `FieldControl` for a control that is not text.
 *
 * For native-host quiet reading, see the [Resting caret guide](https://ui.ouroboros.bot/docs/resting-caret/).
 *
 * @group Forms
 * @see https://ui.ouroboros.bot/docs/text-area
 *
 * @example
 * <TextArea label="Notes" name="notes" description="Only you see these." />
 * <TextArea label="Message" name="message" autoGrow rows={2} maxRows={8} required error={errors?.message} />
 *
 * @example
 * // Words an assistant suggested, marked in the person's draft; the marks follow edits.
 * <TextArea
 *   label="Reply"
 *   value={text}
 *   onValueChange={setText}
 *   highlights={[{ start: 0, end: 22, label: "Suggested by your assistant" }]}
 *   onHighlightsChange={setHighlights}
 * />
 *
 * @example
 * // A chat composer: the box is the app's, and the textarea inside it has no frame.
 * <form className="flex items-end gap-2 rounded-ouro-xl border border-border p-2 focus-within:border-ring">
 *   <TextArea label="Message" hideLabel name="message" placeholder="Ask anything" variant="plain" autoGrow rows={1} maxRows={8} className="flex-1" />
 *   <Button type="submit">Send</Button>
 * </form>
 * @claim "marks ranges of the text in place" registry/ouro/components/ouro/text-field/text-area.highlights.test.tsx verify:testExists(registry/ouro/components/ouro/text-field/text-area.highlights.test.tsx::TextArea highlights > describes the marks after the field's own description: each label once, with the words it marks)
 * @claim "marks ranges of the text in place" registry/ouro/components/ouro/text-field/text-area.highlights.test.tsx verify:testExists(registry/ouro/components/ouro/text-field/text-area.highlights.test.tsx::TextArea highlights as the person edits > never marks what the person types, before, after or inside a mark, and splits a mark they type inside)
 * @claim "` draws no frame, for a textarea inside" registry/ouro/components/ouro/text-field/text-area.test.tsx verify:testExists(registry/ouro/components/ouro/text-field/text-area.test.tsx::TextArea variant and size > sets 20px text on 28px lines with size lg, at phone and desktop widths)
 * @claim "` draws no frame, for a textarea inside" registry/ouro/components/ouro/text-field/text-area.test.tsx verify:testExists(registry/ouro/components/ouro/text-field/text-area.test.tsx::TextArea variant and size > draws no frame of its own with variant plain, and still outlines on keyboard focus)
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
    variant: variantProp = "outline",
    size: sizeProp = "md",
    rows = 3,
    autoGrow = false,
    maxRows,
    className,
    ref,
    onChange,
    highlights,
    onHighlightsChange,
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
    marks,
    ...rest
  } = props;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const stableHandlersRef = useRef<{ registry: Map<string, (...args: unknown[]) => unknown>; latest: TextareaHTMLAttributes<HTMLTextAreaElement> } | null>(null);
  stableHandlersRef.current ??= { registry: new Map(), latest: {} };
  const variant = Object.hasOwn(textAreaVariants, variantProp) ? (variantProp as keyof typeof textAreaVariants) : "outline";
  const size = Object.hasOwn(textAreaSizes, sizeProp) ? (sizeProp as keyof typeof textAreaSizes) : "md";

  useDevWarnings(
    "TextArea",
    process.env.NODE_ENV !== "production"
      ? () => [
          ...contractWarnings("TextArea", { errorMessage, helperText, isInvalid, invalid, isRequired, isDisabled }),
          variant !== variantProp && controlVariantWarning("TextArea", String(variantProp)),
          size !== sizeProp && controlSizeWarning("TextArea", sizeProp),
          minRows !== undefined && ["minRows is not a prop; rows is the minimum", `<TextArea autoGrow rows={${String(minRows)}} maxRows={8}>`],
          autoResize !== undefined && ["autoResize is not a prop", "<TextArea autoGrow>"],
          autosize !== undefined && ["autosize is not a prop", "<TextArea autoGrow>"],
          maxRows !== undefined && !autoGrow && ["maxRows only applies with autoGrow", `<TextArea autoGrow maxRows={${maxRows}}>`],
          marks !== undefined && ["marks is not a prop", '<TextArea highlights={[{ start: 0, end: 5, label: "Suggested" }]}>'],
          ...highlightWarnings(highlights),
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );

  const highlighting = highlights !== undefined;
  const marked = useHighlights(textareaRef, highlights, rest.value, rest.defaultValue);

  // With autoGrow, the textarea renders with its bounds and, where the browser can, grows itself
  // (field-sizing), so its first frame already has its height and nothing is measured. Elsewhere
  // (WebKit), fit before the paint, once per change of the text and when a prop that sets the
  // height changes: an uncontrolled field as the person types, a controlled one once its value
  // arrives. A render that changes neither (a parent's, as a message arrives beside a composer)
  // measures nothing, since each fit reads the textarea's style and lays out the page. Without
  // autoGrow, measure nothing: the inline height is the user's resize handle. Turning autoGrow
  // off once clears the height autoGrow set, so `rows` applies again.
  const controlled = rest.value !== undefined;
  // Captured once at mount, like Base UI's own uncontrolled default: the memoized leaf below
  // renders this as its initial `defaultValue` (matching server markup before hydration's
  // effects run) and never sees it change again, so a controlled value's later edits never
  // reach the leaf's props at all; the layout effect below is what then keeps `.value` current.
  const initialControlledValueRef = useRef(rest.value);
  // Flips once, right after the first commit (before anything else can revisit the leaf's
  // fiber): the leaf's `defaultValue` below is then undefined for the rest of this instance's
  // life, so a later commit that touches some other prop (focus, dirty, filled) never re-reaches
  // `updateTextarea`'s unguarded defaultValue write (ouro-ui#3759). It mirrors the server markup
  // only for that one first commit, which is what hydration compares against.
  const [mounted, setMounted] = useState(false);
  // Stryker disable next-line ArrayDeclaration: equivalent; any constant dependency list runs this once, at mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useLayoutEffect(() => setMounted(true), []);
  const grew = useRef(false);
  const native = autoGrow && supportsFieldSizing();
  const watched = native ? undefined : rest.value;
  // Keeps the visible text in sync with a controlled value through the DOM `.value` property
  // directly, since the native textarea below is memoized and never receives `value` itself: once
  // the element's dirty-value flag is set (which this effect's first run does), setting `.value`
  // never touches the child text node the way `.defaultValue` does, so this never forces the
  // `:has()`-invalidating mutation `updateTextarea` would otherwise make on every commit (ouro-ui#3759).
  // Runs before the fit-height effect below, which measures this same `.value`. It also runs after
  // every change event (`changes`), as React's own controlled textarea restores after one: a change
  // the owner refuses leaves `value` as it was, so without this the person's or a script's text
  // would stay on screen beside a `value` that never took it (ouro-ui#3911).
  // Stryker disable next-line ArithmeticOperator: equivalent; any step changes the count, and only a change reruns the effect.
  const [changes, countChange] = useReducer((count: number) => count + 1, 0);
  useLayoutEffect(() => {
    const textarea = textareaRef.current!;
    // Stryker disable next-line ConditionalExpression: equivalent; the HTML value setter leaves the text and the caret as they are when the new value equals the old one.
    if (controlled && textarea.value !== String(rest.value)) textarea.value = String(rest.value);
  }, [controlled, rest.value, changes]);
  useLayoutEffect(() => {
    const textarea = textareaRef.current!;
    if (autoGrow && !native) {
      fitHeight(textarea, rows, maxRows);
      grew.current = true;
    } else if (autoGrow || grew.current) {
      // Where the browser grows it, a height left inline (the resize handle's, before autoGrow) would hold it still.
      clearFit(textarea);
      grew.current = false;
    }
  }, [autoGrow, native, rows, maxRows, size, variant, watched]);
  // The common case has no inline style, so this stays the same reference across keystrokes,
  // letting the memoized native textarea below bail out of commits; a custom style still applies.
  const autoGrowStyle = useMemo(() => (autoGrow ? autoGrowBounds(rows, maxRows) : undefined), [autoGrow, rows, maxRows]);
  // In development, once the field has painted: a class that sets the textarea's vertical padding
  // (`py-*`) leaves `--ouro-text-area-frame` out of step, so the bounds autoGrow renders miss it.
  const checked = useRef({});
  useEffect(() => {
    /* istanbul ignore else @preserve -- the else path exists only in production bundles */
    if (process.env.NODE_ENV !== "production") {
      if (!autoGrow) return;
      const textarea = textareaRef.current!;
      const frame = requestAnimationFrame(() => {
        const style = getComputedStyle(textarea);
        const chrome = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
        const ours = textarea.style.minHeight === autoGrowBounds(rows, maxRows).minHeight;
        // Firefox and WebKit report a border snapped to device pixels (0.67px at 150%), under 1px in all; a py class moves it by more.
        // Stryker disable next-line EqualityOperator: no padding is exactly 1px out, so > and >= find the same classes.
        if (ours && Math.abs(parseFloat(style.minHeight) - (rows * parseFloat(style.lineHeight) + chrome)) > 1) {
          devWarn(
            "TextArea",
            "a class sets the textarea's vertical padding, so autoGrow's rows and maxRows leave it out",
            'set its variable instead: <TextArea autoGrow className="[&_textarea]:[--ouro-text-area-py:12px]">',
            checked.current,
          );
        }
      });
      // Stryker disable next-line ArrowFunction: a check that runs after unmount reads a detached textarea, whose styles are empty, and says nothing.
      return () => cancelAnimationFrame(frame);
    }
  }, [autoGrow, rows, maxRows, size, variant]);
  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    // A controlled field fits once its value arrives, in the effect above.
    if (autoGrow && !native && !controlled) fitHeight(event.currentTarget, rows, maxRows);
    // Without highlights there is nothing to move, so this only skips the work.
    // Stryker disable next-line ConditionalExpression: as above.
    if (highlights !== undefined) {
      const moved = marked.edit(event.currentTarget.value, event.currentTarget.selectionStart, (event.nativeEvent as InputEvent).inputType);
      if (moved) onHighlightsChange?.(moved);
    }
    onChange?.(event);
    // Stryker disable next-line ConditionalExpression: equivalent; the sync it reruns writes nothing to an uncontrolled field.
    if (controlled) countChange();
  };
  // The text rewraps when the width changes (a rotated phone, a resized window). The refit
  // runs in the next frame, never inside the observer's callback: a height set there is a new
  // observation the browser cannot deliver in the same frame, which it reports on the window
  // as "ResizeObserver loop completed with undelivered notifications".
  useEffect(() => {
    // Stryker disable next-line ConditionalExpression: observing on the native path only refits to the same height.
    if (!autoGrow || native) return;
    const textarea = textareaRef.current!;
    let width = textarea.offsetWidth;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (textarea.offsetWidth === width) return;
      width = textarea.offsetWidth;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => fitHeight(textarea, rows, maxRows));
    });
    observer.observe(textarea);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  },
  // Stryker disable next-line ArrayDeclaration: an empty list keeps the first rows and maxRows, which the width refit tests change.
  [autoGrow, native, rows, maxRows]);

  const setRef = useMergedRef(ref, textareaRef);
  const descriptionId = useId();
  const marksDescription = highlighting ? describeHighlights(marked.text, marked.ranges) : "";
  const describedBy = [rest["aria-describedby"], marksDescription ? descriptionId : undefined].filter(Boolean).join(" ") || undefined;

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
          aria-describedby={describedBy}
          ref={setRef as Ref<HTMLInputElement>}
          onChange={handleChange as unknown as FieldControlProps["onChange"]}
          render={(controlProps) => {
            // Dropping `value` here, not just from the destructure below, keeps a controlled textarea's
            // typed text out of what the memoized leaf receives: `useLayoutEffect` above syncs `.value`
            // on the DOM node directly instead (ouro-ui#3759).
            const { style, value: controlledValue, defaultValue: uncontrolledDefault, ...textareaProps } = controlProps as TextareaHTMLAttributes<HTMLTextAreaElement>;
            const stableProps = stabilizeTextareaProps(textareaProps, stableHandlersRef.current!);
            const mergedStyle = style === undefined ? autoGrowStyle : { ...autoGrowStyle, ...style };
            // Present only for the first commit (matching server markup); undefined for every
            // commit after `mounted` flips, so no later commit's `updateTextarea` call rewrites it.
            const defaultValue = mounted ? undefined : controlledValue !== undefined ? initialControlledValueRef.current : uncontrolledDefault;
            const textarea = (
              <RawTextarea
                {...stableProps}
                defaultValue={defaultValue}
                style={mergedStyle}
                rows={rows}
                data-ouro-control="text-area"
                data-ouro-part="input"
                data-variant={variant}
                data-size={size}
                className={cn(textAreaClass, textAreaVariants[variant], textAreaSizes[size], autoGrow ? autoGrowClass : "resize-y")}
              />
            );
            if (!highlighting) return textarea;
            // The marks are drawn over the textarea in a layer the same size, so they need a box around both.
            return (
              <div data-ouro-highlights="" className="relative min-w-0">
                {textarea}
                <HighlightLayer textareaRef={textareaRef} text={marked.text} highlights={marked.ranges} styleKey={`${size} ${variant}`} />
                {marksDescription && (
                  <span id={descriptionId} hidden>
                    {marksDescription}
                  </span>
                )}
              </div>
            );
          }}
        />
      </Field>
    </FieldOwnerContext.Provider>
  );
}

/** What `useHighlights` gives TextArea: the text, the marks that fit it, and the edit handler. */
interface Highlighted {
  text: string;
  ranges: TextAreaHighlight[];
  /** Moves the marks for the text after an edit of the input type given; returns them when they changed. */
  edit: (next: string, caret: number, inputType: string | undefined) => TextAreaHighlight[] | undefined;
}

/** The marks undo can bring back, at most this many texts. */
const historyLength = 100;

/**
 * The marks that fit the text now. New `highlights` (by content, not by array) are taken as
 * given; otherwise, when the text changes, the marks move with it: by the person's edit when
 * they made one, and by comparing the texts when the app changed the value.
 */
function useHighlights(textareaRef: { current: HTMLTextAreaElement | null }, highlights: readonly TextAreaHighlight[] | undefined, value: unknown, defaultValue: unknown): Highlighted {
  const controlled = value !== undefined;
  const [ownText, setOwnText] = useState(() => (defaultValue === undefined ? "" : String(defaultValue)));
  const text = controlled ? String(value) : ownText;
  const key = highlightsKey(highlights);
  // Stryker disable next-line ObjectLiteral: an empty start differs from the first render's key, which then takes the highlights as given all the same.
  const [track, setTrack] = useState(() => ({ key, text, ranges: normalizeHighlights(highlights, text.length) }));
  // The marks the person's last edit gave, for the text it made.
  const [edited, setEdited] = useState<{ text: string; ranges: TextAreaHighlight[] } | null>(null);
  // The selection when the input in progress began (the native beforeinput), so an edit is placed where it was made.
  const input = useRef<HighlightEdit["before"] | null>(null);
  const history = useRef(new Map<string, TextAreaHighlight[]>());

  let ranges = track.ranges;
  if (track.key !== key || track.text !== text) {
    if (track.key !== key) ranges = normalizeHighlights(highlights, text.length);
    else if (edited?.text === text) ranges = edited.ranges;
    else ranges = moveHighlights(track.ranges, track.text, text, null);
    setTrack({ key, text, ranges });
  }

  useEffect(() => {
    const seen = history.current;
    // A text seen before keeps its first place, so undo reaches back about historyLength texts.
    if (!seen.has(track.text)) seen.set(track.text, track.ranges);
    if (seen.size > historyLength) seen.delete(seen.keys().next().value!);
  }, [track]);

  useEffect(() => {
    const textarea = textareaRef.current!;
    const record = () => {
      input.current = { start: textarea.selectionStart, end: textarea.selectionEnd };
    };
    textarea.addEventListener("beforeinput", record);
    // Stryker disable next-line ArrowFunction,StringLiteral: an unmounted textarea's listener records a selection nothing reads.
    return () => textarea.removeEventListener("beforeinput", record);
  },
  // Stryker disable next-line ArrayDeclaration: the textarea is the same for the field's life, so once is enough with any fixed list.
  [textareaRef]);

  const edit = (next: string, caret: number, inputType: string | undefined) => {
    const before = input.current;
    input.current = null;
    // Undo and redo bring back the marks the text had, when it had any.
    const restored = inputType?.startsWith("history") ? history.current.get(next) : undefined;
    const moved = restored ?? moveHighlights(ranges, text, next, before && { before, caret });
    setEdited({ text: next, ranges: moved });
    // A controlled field reads its text from value, so its own copy is never read.
    // Stryker disable next-line ConditionalExpression: as above.
    if (!controlled) setOwnText(next);
    return highlightsKey(moved) === highlightsKey(ranges) ? undefined : moved;
  };
  return { text, ranges, edit };
}

/** Copies the textarea's box and type onto the layer and scrolls the layer's text with it. */
function syncLayer(textarea: HTMLTextAreaElement, layer: HTMLDivElement): void {
  const style = getComputedStyle(textarea);
  const target = layer.style;
  for (const name of mirroredStyles) target[name] = style[name];
  // A classic scrollbar takes width from the text, at the inline end.
  const borders = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
  const scrollbar = Math.max(0, textarea.offsetWidth - textarea.clientWidth - borders);
  const side = style.direction === "rtl" ? "paddingLeft" : "paddingRight";
  target[side] = `${parseFloat(style[side]) + scrollbar}px`;
  (layer.firstElementChild as HTMLElement).style.transform = `translateY(${-textarea.scrollTop}px)`;
  target.visibility = "visible";
}

/**
 * The marks, drawn over the textarea: the same text, transparent, with the marked runs
 * underlined in their tones. It is measured after mount, so the server writes it hidden.
 *
 * Copying the textarea's box and type reads its computed style and lays out the page, so it runs
 * only when that can change: when marks appear, when a prop that styles the textarea changes
 * (`styleKey`), when the textarea's size changes (a breakpoint's type, a scrollbar) and when it
 * scrolls. Not as the person types: the layer's text changes with the textarea's, in the same
 * box. With no marks it draws no text and copies nothing, and stays hidden.
 *
 * @claim "With no marks it draws no text" registry/ouro/components/ouro/text-field/text-area.highlights.test.tsx verify:testExists(registry/ouro/components/ouro/text-field/text-area.highlights.test.tsx::TextArea highlights' cost > copies nothing and draws no text with no marks, as the person types or the parent renders, and stays hidden)
 */
function HighlightLayer({ textareaRef, text, highlights, styleKey }: { textareaRef: { current: HTMLTextAreaElement | null }; text: string; highlights: readonly TextAreaHighlight[]; styleKey: string }): JSX.Element {
  const layerRef = useRef<HTMLDivElement>(null);
  const marking = highlights.length > 0;
  const live = useRef(marking);
  useLayoutEffect(() => {
    live.current = marking;
    const layer = layerRef.current!;
    if (marking) syncLayer(textareaRef.current!, layer);
    // Without marks the class hides it again.
    else layer.style.visibility = "";
  }, [textareaRef, marking, styleKey]);
  useEffect(() => {
    const textarea = textareaRef.current!;
    const layer = layerRef.current!;
    const sync = () => {
      if (live.current) syncLayer(textarea, layer);
    };
    textarea.addEventListener("scroll", sync);
    // The type can change with the size (a breakpoint's font size). As in autoGrow, the sync runs in the next frame, never inside the observer's callback.
    let frame = 0;
    const observer = new ResizeObserver(() => {
      // Stryker disable next-line CallExpression: a second sync in the same frame copies the same styles.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    });
    observer.observe(textarea);
    // Stryker disable next-line ArrowFunction,CallExpression,StringLiteral: an unmounted layer is gone, so its syncs change nothing shown.
    return () => (cancelAnimationFrame(frame), observer.disconnect(), textarea.removeEventListener("scroll", sync));
  },
  // Stryker disable next-line ArrayDeclaration: the textarea is the same for the field's life, so once is enough with any fixed list.
  [textareaRef]);
  return (
    <div ref={layerRef} aria-hidden="true" data-ouro-highlights-layer="" className={cn(highlightLayerClass, "invisible")}>
      <div>
        {marking &&
          highlightRuns(text, highlights).map((run, index) => {
            if (run.mark === undefined) return run.text;
            const tone = highlightTone(highlights[run.mark]!);
            return (
              <span key={index} data-ouro-highlight={tone} className={cn("rounded-xs box-decoration-clone forced-colors:decoration-[CanvasText]", highlightTones[tone])}>
                {run.text}
              </span>
            );
          })}
        {/* The textarea keeps a line under a last line break; so does the layer. */}
        {"\n\u200b"}
      </div>
    </div>
  );
}
