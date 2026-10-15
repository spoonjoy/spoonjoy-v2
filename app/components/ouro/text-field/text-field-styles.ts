export {
  adornmentClass,
  controlSizeWarning,
  controlVariantWarning,
  endSlotClass,
  groupBaseClass,
  groupClass,
  groupSizes,
  groupVariants,
  inputClass,
  nativeClearClass,
  textFieldTypes,
  typeDefaults,
  typeWarning,
};
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
 * The box around the input and its adornments, whatever its variant and size: the focus
 * outline is on the box while the input has keyboard focus. Its height is one unprefixed
 * class that reads a variable the size sets.
 *
 * @internal
 */
const groupBaseClass =
  "relative m-0 box-border flex w-full min-w-0 items-center gap-2 h-(--ouro-control-h) py-0 cursor-text " +
  "rounded-md text-foreground " +
  "outline-ring outline-offset-2 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-solid " +
  "has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-50";

/**
 * The box's frame. `outline` is Field's control look. `plain` draws no border, background or
 * side padding, for a field inside a frame the app draws; it keeps the corner radius, which
 * only the focus outline shows.
 *
 * @internal
 */
const groupVariants = {
  outline:
    "px-3 border border-solid border-input bg-transparent " +
    "transition-[border-color] duration-(--ouro-duration-fast) ease-[ease] " +
    "has-[input[aria-invalid=true]]:border-destructive dark:bg-input/30",
  plain: "px-0 border-0 bg-transparent",
} as const;

/**
 * The box's height and font size. `md` is 44px tall with a 16px font on phones, stepping down
 * from `sm` with a fine pointer. `lg` is 56px tall, 48px from `sm` with a fine pointer, with
 * a 20px font and 20px icons at every width.
 *
 * @internal
 */
const groupSizes = {
  md: "[--ouro-control-h:calc(var(--spacing)*11)] sm:pointer-fine:[--ouro-control-h:calc(var(--spacing)*9)] text-base sm:pointer-fine:text-sm",
  lg:
    "[--ouro-control-h:calc(var(--spacing)*14)] sm:pointer-fine:[--ouro-control-h:calc(var(--spacing)*12)] text-xl " +
    "[&_[data-ouro-adornment]_svg]:size-5",
} as const;

/**
 * The outlined box at the medium size, for the controls that share TextField's box (Combobox,
 * DatePicker).
 *
 * @internal
 */
const groupClass = `${groupBaseClass} ${groupVariants.outline} ${groupSizes.md}`;

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
 * pointer they sit 12px apart, so their 44px touch areas do not overlap. A plain box has no
 * padding to pull them into, so TextField sets `me-0` there.
 *
 * @internal
 */
const endSlotClass = "-me-2 flex shrink-0 items-center gap-1 pointer-coarse:gap-3";

/** Types that are another component's job, with why and the fix. */
const otherComponents: Readonly<Record<string, (label: string) => readonly [string, string]>> = {
  number: (label) => ["NumberField parses, steps and formats numbers", `<NumberField label="${label}" />, or <TextField inputMode="numeric"> for digit codes`],
  "datetime-local": (label) => [
    "has no date-and-time field; DatePicker picks the date and a time TextField the time",
    `<DatePicker label="${label}" name="date" /> and <TextField label="Time" type="time" name="time" />`,
  ],
  month: (label) => ["DatePicker picks dates from a calendar", `<DatePicker label="${label}" />, or <TextField type="date"> for the OS picker`],
  week: (label) => ["DatePicker picks dates from a calendar", `<DatePicker label="${label}" />, or <TextField type="date"> for the OS picker`],
  file: (label) => ["FileField picks and lists files", `<FileField label="${label}" name="file" />`],
};

/**
 * The dev message for a type TextField does not support: the component that does the job when
 * there is one (NumberField, DatePicker, FileField), else the list of types. Development only.
 *
 * @internal
 */
function typeWarning(type: string, label: string): readonly [string, string] {
  if (Object.hasOwn(otherComponents, type)) {
    const [why, fix] = otherComponents[type]!(label);
    return [`type="${type}" is not a TextField type; ${why}`, fix];
  }
  return [`type="${type}" is not a TextField type; use ${textFieldTypes.map((name) => `"${name}"`).join(", ")}`, '<TextField type="text">'];
}

/** Names other libraries give a control without a frame. */
const plainNames: readonly string[] = ["ghost", "unstyled", "borderless", "bare", "none", "flushed", "transparent"];

/**
 * The dev message for a variant that is not one of a text control's. Development only.
 *
 * @internal
 */
function controlVariantWarning(component: string, variant: string): readonly [string, string] {
  return [`variant="${variant}" is not a variant; use "outline" or "plain"`, `<${component} variant="${plainNames.includes(variant) ? "plain" : "outline"}">`];
}

/**
 * The dev message for a size that is not one of a text control's. A number is the native
 * `size` attribute (a width in characters), which the prop replaces. Development only.
 *
 * @internal
 */
function controlSizeWarning(component: string, size: unknown): readonly [string, string] {
  if (typeof size === "number") {
    return [`size={${size}} is not a size; a width in characters is not supported, so set the width with className`, `<${component} className="w-40">`];
  }
  return [`size="${String(size)}" is not a size; use "md" or "lg"`, `<${component} size="md">`];
}
