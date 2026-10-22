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
 * @claim "The types TextField supports" registry/ouro/components/ouro/text-field/text-field.test.tsx verify:testExists(registry/ouro/components/ouro/text-field/text-field.test.tsx::TextField types > renders a text input and lists the types for any other type)
 * @claim "The types TextField supports" registry/ouro/components/ouro/text-field/text-field-styles.ts verify:fileLine(registry/ouro/components/ouro/text-field/text-field-styles.ts, /const\stextFieldTypes\s=\s\["text",\s"email",\s"password",\s"tel",\s"url",\s"search",\s"date",\s"time"\]/)
 */
const textFieldTypes = ["text", "email", "password", "tel", "url", "search", "date", "time"] as const;

/**
 * A type TextField supports.
 *
 * @internal
 * @claim "A type TextField supports" registry/ouro/components/ouro/text-field/text-field.test.tsx verify:testExists(registry/ouro/components/ouro/text-field/text-field.test.tsx::TextField types > renders a text input and lists the types for any other type)
 * @claim "A type TextField supports" registry/ouro/components/ouro/text-field/text-field-styles.ts verify:fileLine(registry/ouro/components/ouro/text-field/text-field-styles.ts, /const\stextFieldTypes\s=/)
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
 * @claim "Each type's keyboard (`inputMode`) and autofill" registry/ouro/components/ouro/text-field/text-field.test.tsx verify:testExists(registry/ouro/components/ouro/text-field/text-field.test.tsx::TextField > lets the app's inputMode and autoComplete win over the type's defaults)
 * @claim "Each type's keyboard (`inputMode`) and autofill" registry/ouro/components/ouro/text-field/text-field.test.tsx verify:testExists(registry/ouro/components/ouro/text-field/text-field.test.tsx::TextField types > turns off capitalization and spell check for email and url)
 * @claim "Date and time open the OS" registry/ouro/components/ouro/text-field/text-field-styles.ts verify:fileLine(registry/ouro/components/ouro/text-field/text-field-styles.ts, /^\s+date:\s\{\sautoComplete:\s"off"\s\},/)
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
 * @claim "`plain` draws no border, background or" registry/ouro/components/ouro/text-field/text-field.test.tsx verify:testExists(registry/ouro/components/ouro/text-field/text-field.test.tsx::TextField variant and size > draws no frame of its own with variant plain, and still outlines on keyboard focus)
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
 * @claim "`md` is 44px tall with a" registry/ouro/components/ouro/text-field/text-field.test.tsx verify:testExists(registry/ouro/components/ouro/text-field/text-field.test.tsx::TextField looks > uses a 16px font on phones, so iOS does not zoom on focus, and a 44px box)
 * @claim "`lg` is 56px tall, 48px from" registry/ouro/components/ouro/text-field/text-field.test.tsx verify:testExists(registry/ouro/components/ouro/text-field/text-field.test.tsx::TextField variant and size > sets 20px text in a taller box with size lg, at phone and desktop widths)
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
 * @claim "On a coarse pointer they sit" registry/ouro/components/ouro/text-field/text-field.touch.test.tsx verify:testExists(registry/ouro/components/ouro/text-field/text-field.touch.test.tsx::gives the toggle a 44px hit area, though it is smaller than the box)
 * @claim "On a coarse pointer they sit" registry/ouro/components/ouro/text-field/text-field.touch.test.tsx verify:testExists(registry/ouro/components/ouro/text-field/text-field.touch.test.tsx::keeps the clear button's and the toggle's touch areas apart)
 * @claim "A plain box has no padding" registry/ouro/components/ouro/text-field/text-field.tsx verify:fileLine(registry/ouro/components/ouro/text-field/text-field.tsx, /variant\s===\s"plain"\s&&\s"me-0"/)
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
 * @claim "The dev message for a type" registry/ouro/components/ouro/text-field/text-field.test.tsx verify:testExists(registry/ouro/components/ouro/text-field/text-field.test.tsx::TextField types > renders a text input with a decimal keyboard and points to NumberField for type=number)
 * @claim "The dev message for a type" registry/ouro/components/ouro/text-field/text-field.test.tsx verify:testExists(registry/ouro/components/ouro/text-field/text-field.test.tsx::TextField types > renders a text input and lists the types for any other type)
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
