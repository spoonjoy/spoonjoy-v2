import { toneFor } from "~/lib/ouro/appearance-hints";
import type { DevWarning } from "~/lib/ouro/use-dev-messages";

export {
  choicesClass,
  contractWarnings,
  controlClass,
  descriptionClass,
  errorClass,
  fieldHint,
  inlineLabelClass,
  inlineRootClass,
  labelClass,
  labelFrameClass,
  legendClass,
  requiredMarkClass,
  rootClass,
};
export type { ContractGuesses };

// Class strings and dev-message helpers shared by Field, Fieldset and the Field parts, apart
// from the components so each component file exports only components (React Fast Refresh).
// Class strings are literal so the app's Tailwind finds them when it compiles.

/**
 * The field's stack: label, description, control, error.
 *
 * @internal
 */
const rootClass = "group/field box-border grid min-w-0 content-start gap-2";

/**
 * A field whose control comes first, with the label to its right (a checkbox, a switch, a
 * radio): the control in the first column, the label, description and error in the second.
 *
 * @internal
 */
const inlineRootClass = "group/field box-border grid min-w-0 grid-cols-[auto_minmax(0,1fr)] content-start items-start gap-x-3 gap-y-1";

/**
 * The label beside an inline control, which is also its tap target: 16px text on 24px lines
 * on touch screens, stepping down to the field label's 14px on 20px lines from the `sm`
 * breakpoint with a fine pointer, so a landscape phone keeps the phone size.
 *
 * @internal
 * @claim "The label beside an inline control" registry/ouro/components/ouro/checkbox/checkbox.touch.test.tsx verify:testExists(registry/ouro/components/ouro/checkbox/checkbox.touch.test.tsx::keeps the 20px box and 16px label on a landscape phone, past the sm breakpoint)
 * @claim "The label beside an inline control" registry/ouro/components/ouro/field/field-styles.ts verify:fileLine(registry/ouro/components/ouro/field/field-styles.ts, /const\sinlineLabelClass\s=\s"text-base\sleading-6\ssm:pointer-fine:text-sm\ssm:pointer-fine:leading-5"/)
 */
const inlineLabelClass = "text-base leading-6 sm:pointer-fine:text-sm sm:pointer-fine:leading-5";

/**
 * The choices in a CheckboxGroup or RadioGroup: one under the other, or with `horizontal`,
 * in a row that wraps. On touch screens rows sit 20px apart, so each control's 44px hit area
 * stays clear of its neighbors'; with a fine pointer from the `sm` breakpoint, 12px.
 *
 * @internal
 * @claim "On touch screens rows sit 20px" registry/ouro/components/ouro/field/field-styles.ts verify:fileLine(registry/ouro/components/ouro/field/field-styles.ts, /vertical:\s"grid\sgap-5\ssm:pointer-fine:gap-3"/)
 */
const choicesClass = {
  vertical: "grid gap-5 sm:pointer-fine:gap-3",
  horizontal: "flex flex-wrap gap-x-6 gap-y-5 sm:pointer-fine:gap-y-3",
} as const;

/**
 * The element around the label, which sizes its text and takes the field's layout classes.
 * The required marker hangs off it, not off the label, so the label's text stays the label.
 *
 * @internal
 */
const labelFrameClass = "block justify-self-start text-sm leading-5 select-none";

/**
 * The label: medium weight, faded with the field when it is disabled. Inline, so the required
 * marker follows its last word, and padded to its line height, so its hit area is every
 * line it wraps to and the gaps between them: a checkbox's or switch's label is the
 * control's tap target on a phone. Vertical padding on an inline box does not move the lines.
 *
 * @internal
 * @claim "Inline, so the required marker follows" registry/ouro/components/ouro/field/field.test.tsx verify:testExists(registry/ouro/components/ouro/field/field.test.tsx::Field wiring > shows the required marker beside the label, and in forced colors too)
 * @claim "Inline, so the required marker follows" registry/ouro/components/ouro/field/field-styles.ts verify:fileLine(registry/ouro/components/ouro/field/field-styles.ts, /py-\[calc\(\(1lh-1em\)\/2\)\]/)
 */
const labelClass = "m-0 inline py-[calc((1lh-1em)/2)] font-medium text-foreground data-disabled:opacity-50";

/**
 * The required marker, on the element around a label or on a group's legend: an asterisk
 * drawn by CSS, so it is in no element's text and no control's name. `getByLabelText("Email")`
 * and `getByLabel("Email", { exact: true })` find a required field, and screen readers hear
 * "required" from the control. Its alternative text is empty, so screen readers in reading
 * mode do not say "star"; a browser without that syntax shows the plain asterisk. It is
 * generated text, so forced colors keep it visible. It fades when the field is disabled.
 *
 * @internal
 * @claim "The required marker, on the element" registry/ouro/components/ouro/field/field.test.tsx verify:testExists(registry/ouro/components/ouro/field/field.test.tsx::Field wiring > sets required and aria-required, and marks the label without adding to its text or name)
 * @claim "The required marker, on the element" registry/ouro/components/ouro/field/field.test.tsx verify:testExists(registry/ouro/components/ouro/field/field.test.tsx::Required marker > is an asterisk with empty alternative text, so screen readers do not read it)
 */
const requiredMarkClass =
  "after:ms-0.5 after:font-medium after:text-destructive after:content-['*'] supports-[content:'*'_/_'']:after:content-['*'_/_''] " +
  "group-data-disabled/field:after:opacity-50";

/**
 * Supporting text under the label, and under a fieldset's legend. It stays at full contrast when the
 * field is disabled, because it often says why.
 *
 * @internal
 */
const descriptionClass = "m-0 text-sm leading-5 text-muted-foreground";

/**
 * The error message: it fades and slides in, and with reduced motion only fades. Several
 * messages render as a list.
 *
 * @internal
 */
const errorClass =
  "m-0 text-sm leading-5 text-destructive " +
  "[transition:opacity_var(--ouro-duration-base)_var(--ouro-ease-out),translate_var(--ouro-duration-base)_var(--ouro-ease-out)] " +
  "data-starting-style:opacity-0 data-starting-style:-translate-y-1 " +
  "data-ending-style:opacity-0 data-ending-style:-translate-y-1 " +
  "motion-reduce:[transition:opacity_var(--ouro-duration-base)_var(--ouro-ease-out)] " +
  "motion-reduce:data-starting-style:translate-y-0 motion-reduce:data-ending-style:translate-y-0 " +
  "[&_ul]:m-0 [&_ul]:list-disc [&_ul]:ps-5";

/**
 * A fieldset's legend.
 *
 * @internal
 */
const legendClass = "m-0 p-0 text-base leading-6 font-semibold text-foreground data-disabled:opacity-50";

/**
 * The text control: 44px tall with a 16px font on phones (iOS zooms into smaller text on
 * focus), stepping down to desktop density from the `sm` breakpoint with a fine pointer, so a
 * landscape phone keeps the phone size. Its height is one
 * unprefixed class that reads a variable, so an app's `h-*` replaces it at every width.
 *
 * @internal
 * @claim "The text control: 44px tall with" registry/ouro/components/ouro/field/field.test.tsx verify:testExists(registry/ouro/components/ouro/field/field.test.tsx::Field looks > uses a 16px font on phones, so iOS does not zoom on focus, and steps down from sm)
 * @claim "The text control: 44px tall with" registry/ouro/components/ouro/field/field-styles.ts verify:fileLine(registry/ouro/components/ouro/field/field-styles.ts, /h-\(--ouro-control-h\)/)
 * @claim "Its height is one unprefixed class" registry/ouro/components/ouro/field/field-styles.ts verify:fileLine(registry/ouro/components/ouro/field/field-styles.ts, /h-\(--ouro-control-h\)/)
 */
const controlClass =
  "m-0 box-border block w-full min-w-0 h-(--ouro-control-h) px-3 py-0 " +
  "[--ouro-control-h:calc(var(--spacing)*11)] sm:pointer-fine:[--ouro-control-h:calc(var(--spacing)*9)] " +
  "rounded-md border border-solid border-input bg-transparent text-base text-foreground sm:pointer-fine:text-sm " +
  "font-[inherit] placeholder:text-muted-foreground " +
  "outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid " +
  "transition-[border-color] duration-(--ouro-duration-fast) ease-[ease] " +
  "aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50 " +
  "dark:bg-input/30";

/**
 * The fix for an appearance class on a field: an error color is the `error` prop; anything
 * else is the theme's job. Development only.
 *
 * @internal
 */
function fieldHint(token: string, component = "Field"): string {
  return toneFor(token) === "destructive" ? `<${component} error="What is wrong">` : "style fields in your theme (--input, --ring, --radius)";
}

/**
 * The Field contract's guessed prop names, which a control built on Field declares as hint types.
 *
 * @internal
 */
interface ContractGuesses {
  errorMessage?: unknown;
  helperText?: unknown;
  isInvalid?: unknown;
  invalid?: unknown;
  isRequired?: unknown;
  isDisabled?: unknown;
}

/**
 * The development messages for the contract's guessed props on a control built on Field,
 * each naming the real prop. Development only.
 *
 * @internal
 * @claim "The development messages for the contract's" registry/ouro/components/ouro/text-field/text-field.test.tsx verify:fileLine(registry/ouro/components/ouro/text-field/text-field.test.tsx, /\["helperText",\s\{\shelperText:\s"Hint"\s\},\s"helperText\sis\snot\sa\sprop",\s'<TextField\sdescription="Hint">'\]/)
 */
function contractWarnings(component: string, guesses: ContractGuesses): DevWarning[] {
  const { errorMessage, helperText, isInvalid, invalid, isRequired, isDisabled } = guesses;
  return [
    errorMessage !== undefined && ["errorMessage is not a prop", `<${component} error="${String(errorMessage)}">`],
    helperText !== undefined && ["helperText is not a prop", `<${component} description="${String(helperText)}">`],
    isInvalid !== undefined && ["isInvalid is not a prop", `<${component} error="What is wrong">`],
    invalid !== undefined && ["invalid is not a prop", `<${component} error="What is wrong">`],
    isRequired !== undefined && ["isRequired is not a prop", `<${component} required>`],
    isDisabled !== undefined && ["isDisabled is not a prop", `<${component} disabled>`],
  ];
}
