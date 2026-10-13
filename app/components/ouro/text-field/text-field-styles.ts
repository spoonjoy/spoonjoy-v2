export { adornmentClass, endSlotClass, groupClass, inputClass, nativeClearClass, numberWarning, textFieldTypes, typeDefaults, typeWarning };
export type { TextFieldType };

// Class strings, value lists and dev-message helpers for TextField, apart from the component
// so its file exports only components (React Fast Refresh). Class strings are literal so the
// app's Tailwind finds them when it compiles.

/**
 * The types TextField supports. `number` is not one: NumberField parses and steps numbers.
 *
 * @internal
 */
const textFieldTypes = ["text", "email", "password", "tel", "url", "search", "date", "time"] as const;

/**
 * A type TextField supports.
 *
 * @internal
 */
type TextFieldType = (typeof textFieldTypes)[number];

/** The attributes a type sets unless the app passes its own. */
interface TypeDefaults {
  inputMode?: "text" | "email" | "tel" | "url" | "search" | "decimal";
  autoComplete: string;
  autoCapitalize?: "none";
  spellCheck?: false;
  enterKeyHint?: "search";
}

/**
 * Each type's keyboard (`inputMode`) and autofill (`autoComplete`) defaults. A password
 * autofills the saved one; pass `autoComplete="new-password"` on sign-up. Date and time open
 * the OS picker, so they set no keyboard.
 *
 * @internal
 */
const typeDefaults: Readonly<Record<TextFieldType, TypeDefaults>> = {
  text: { inputMode: "text", autoComplete: "on" },
  email: { inputMode: "email", autoComplete: "email", autoCapitalize: "none", spellCheck: false },
  password: { inputMode: "text", autoComplete: "current-password" },
  tel: { inputMode: "tel", autoComplete: "tel" },
  url: { inputMode: "url", autoComplete: "url", autoCapitalize: "none", spellCheck: false },
  search: { inputMode: "search", autoComplete: "off", enterKeyHint: "search" },
  date: { autoComplete: "off" },
  time: { autoComplete: "off" },
};

/**
 * The box around the input and its adornments: Field's control look (44px tall with a 16px
 * font on phones, stepping down from `sm` with a fine pointer), with the focus outline on the box while the input
 * has keyboard focus. Its height is one unprefixed class that reads a variable.
 *
 * @internal
 */
const groupClass =
  "relative m-0 box-border flex w-full min-w-0 items-center gap-2 h-(--ouro-control-h) px-3 py-0 cursor-text " +
  "[--ouro-control-h:calc(var(--spacing)*11)] sm:pointer-fine:[--ouro-control-h:calc(var(--spacing)*9)] " +
  "rounded-md border border-solid border-input bg-transparent text-base text-foreground sm:pointer-fine:text-sm " +
  "outline-ring outline-offset-2 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-solid " +
  "transition-[border-color] duration-(--ouro-duration-fast) ease-out " +
  "has-[input[aria-invalid=true]]:border-destructive has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-50 " +
  "dark:bg-input/30";

/**
 * The input inside the box: borderless, filling it, in the box's font size. Date and time
 * values start at the inline start, as text does (iOS centers them).
 *
 * @internal
 */
const inputClass =
  "m-0 box-border block h-full min-w-0 flex-1 self-stretch border-0 bg-transparent p-0 " +
  "text-[length:inherit] text-inherit font-[inherit] outline-none placeholder:text-muted-foreground " +
  "disabled:cursor-not-allowed [&::-webkit-date-and-time-value]:text-start";

/**
 * The browser's own clear button on a search input, hidden when TextField draws its own.
 *
 * @internal
 */
const nativeClearClass = "[&::-webkit-search-cancel-button]:appearance-none";

/**
 * Text or an icon before or after the input, in the muted foreground.
 *
 * @internal
 */
const adornmentClass = "flex shrink-0 items-center whitespace-nowrap text-muted-foreground select-none [&_svg]:size-4 [&_svg]:shrink-0";

/**
 * The trailing buttons (clear, show password) sit close to the box's end edge. On a coarse
 * pointer they sit 12px apart, so their 44px touch areas do not overlap.
 *
 * @internal
 */
const endSlotClass = "-me-2 flex shrink-0 items-center gap-1 pointer-coarse:gap-3";

/**
 * The dev message for `type="number"`: NumberField is the fix. Development only.
 *
 * @internal
 */
function numberWarning(label: string): readonly [string, string] {
  return [
    'type="number" is not a TextField type; NumberField parses, steps and formats numbers',
    `<NumberField label="${label}" />, or <TextField inputMode="numeric"> for digit codes`,
  ];
}

/**
 * The dev message for a type TextField does not support. Development only.
 *
 * @internal
 */
function typeWarning(type: string): readonly [string, string] {
  return [`type="${type}" is not a TextField type; use ${textFieldTypes.map((name) => `"${name}"`).join(", ")}`, '<TextField type="text">'];
}
