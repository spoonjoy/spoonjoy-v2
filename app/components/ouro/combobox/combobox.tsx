"use client";

import { Autocomplete as BaseAutocomplete } from "@base-ui/react/autocomplete";
import { Combobox as BaseCombobox } from "@base-ui/react/combobox";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type ReactNode, type Ref, type RefCallback, type RefObject } from "react";
import { Button } from "~/components/ouro/button/button";
import { Field } from "~/components/ouro/field/field";
import { contractWarnings } from "~/components/ouro/field/field-styles";
import { SheetFrame } from "~/components/ouro/sheet/sheet";
import { endSlotClass, groupClass, inputClass } from "~/components/ouro/text-field/text-field-styles";
import { TouchTarget } from "~/lib/ouro/touch-target";
import { FieldOwnerContext, useField, useFormErrors, type ReadonlyErrorMessages } from "~/lib/ouro/use-field";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { usePickerSheet } from "~/lib/ouro/use-sheet-presentation";
import { controlRef } from "~/lib/ouro/control-ref";
import { useMergedRef } from "~/lib/ouro/refs";
import {
  chipClass,
  chipRemoveClass,
  chipsGroupClass,
  chipsInputClass,
  emptyClass,
  itemClass,
  listClass,
  popupClass,
  sheetClearClass,
  sheetFieldClass,
  sheetInputClass,
  sheetListClass,
  statusClass,
  triggerClass,
} from "~/components/ouro/combobox/combobox-styles";

/**
 * An item to pick: a string, which is both what shows and what submits, or an object with
 * the `value` that submits and the `label` that shows. `disabled` items show but can't be picked.
 */
export type ComboboxItem = string | { value: string; label: string; disabled?: boolean | undefined };

/**
 * Props every Combobox takes, whatever it picks.
 *
 * @claim "Props every Combobox takes, whatever it" registry/ouro/components/ouro/combobox/combobox.test-d.ts verify:fileLine(registry/ouro/components/ouro/combobox/combobox.test-d.ts, /expectTypeOf<\{\slabel:\s"Herb";\sitems:\s\["Basil",\s"Dill"\]\s\}>\(\)\.toExtend<ComboboxProps>/)
 */
export interface ComboboxBaseProps {
  /**
   * What the field is for, shown above it and read as its name. Required: every control
   * needs a name. To hide it visually, keep it and add `hideLabel`. A placeholder is not a label.
   * @claim "Required: every control needs a name" registry/ouro/components/ouro/combobox/combobox.test-d.ts verify:fileLine(registry/ouro/components/ouro/combobox/combobox.test-d.ts, /expectTypeOf<\{\sitems:\sstring\[\]\s\}>\(\)\.not\.toExtend<ComboboxProps>/)
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
  /** Something must be picked: the input gets `aria-required`, and the label a marker. */
  required?: boolean | undefined;
  /** Disables the field and its buttons, and fades it. */
  disabled?: boolean | undefined;
  /** The form field name the picked value submits under; `multiple` submits one entry per pick. */
  name?: string | undefined;
  /**
   * What people pick from: strings, or `{ value, label }` objects. Combobox filters them as
   * people type, unless you pass `onInputChange`, which makes them your search results.
   */
  items: readonly ComboboxItem[];
  /** An example shown while the input is empty: `"Search herbs"`. It is not a label; pass `label`. */
  placeholder?: string | undefined;
  /**
   * Called with the text as people type. Pass it to search on your server: Combobox then
   * shows `items` as you give them, without filtering, and you set `loading` while a search
   * runs. Keep the picked items in `items`, so their labels stay known.
   */
  onInputChange?: ((text: string) => void) | undefined;
  /** A search is running: the list shows a spinner and `loadingLabel`, and is `aria-busy`. */
  loading?: boolean | undefined;
  /**
   * The text the list shows while `loading`. Translate it with your app.
   * @default "Loading…"
   */
  loadingLabel?: string | undefined;
  /**
   * The text the list shows when nothing matches. Translate it with your app.
   * @default "No results"
   */
  emptyLabel?: string | undefined;
  /**
   * The name of the button that clears the field, as visually hidden text and not an
   * `aria-label`, so a test's label lookup for the field finds the field alone. It shows while
   * there is something to clear. Translate it with your app.
   * @default "Clear"
   */
  clearLabel?: string | undefined;
  /**
   * The label of the button that closes the sheet on a phone (a visible button with
   * `multiple`). Translate it with your app.
   * @default "Done"
   */
  doneLabel?: string | undefined;
  /**
   * Layout only: margins, width, grid placement (`mt-4`, `col-span-2`). Appearance classes
   * warn in development; style fields in your theme.
   */
  className?: string | undefined;
  /** The input element. On a phone, it is the search input in the sheet, while the sheet is open. */
  ref?: Ref<HTMLInputElement> | undefined;

  /** Not a prop. Ouro UI uses `error`: `<Combobox error="Required.">`. */
  errorMessage?: { 'Use <Combobox error="Required.">': never };
  /** Not a prop. Ouro UI uses `description`: `<Combobox description="...">`. */
  helperText?: { 'Use <Combobox description="...">': never };
  /** Not a prop. `error` marks the field invalid: `<Combobox error="What is wrong">`. */
  isInvalid?: { 'Use <Combobox error="What is wrong">': never };
  /** Not a prop. `error` marks the field invalid: `<Combobox error="What is wrong">`. */
  invalid?: { 'Use <Combobox error="What is wrong">': never };
  /** Not a prop. Ouro UI uses `required`: `<Combobox required>`. */
  isRequired?: { 'Use <Combobox required>': never };
  /** Not a prop. Ouro UI uses `disabled`: `<Combobox disabled>`. */
  isDisabled?: { 'Use <Combobox disabled>': never };
  /** Not a prop. Ouro UI uses `items`: `<Combobox items={["Basil", "Dill"]}>`. */
  options?: { 'Use <Combobox items={["Basil", "Dill"]}>': never };
  /** Not a prop. Ouro UI uses `loading`: `<Combobox loading>`. */
  isLoading?: { 'Use <Combobox loading>': never };
  /** Not a prop. Ouro UI uses `multiple`: `<Combobox multiple>`. */
  isMulti?: { 'Use <Combobox multiple>': never };
  /** Not a prop. Ouro UI uses `allowCustomValue`: `<Combobox allowCustomValue>`. */
  freeSolo?: { 'Use <Combobox allowCustomValue>': never };
  /** Not a prop. Ouro UI uses `allowCustomValue`: `<Combobox allowCustomValue>`. */
  creatable?: { 'Use <Combobox allowCustomValue>': never };
  /** Not a prop. Ouro UI uses `onInputChange`: `<Combobox onInputChange={(text) => …}>`. */
  onSearch?: { 'Use <Combobox onInputChange={(text) => ...}>': never };
  /** Not a prop. Ouro UI uses `onInputChange`: `<Combobox onInputChange={(text) => …}>`. */
  onInputValueChange?: { 'Use <Combobox onInputChange={(text) => ...}>': never };
  /** Not a prop. Combobox reports the pick itself: `<Combobox onValueChange={(value) => …}>`. */
  onChange?: { 'Use <Combobox onValueChange={(value) => ...}>': never };
  /** Not a prop. Ouro UI uses `emptyLabel`: `<Combobox emptyLabel="No herbs">`. */
  noOptionsMessage?: { 'Use <Combobox emptyLabel="No herbs">': never };
  /** Not a prop. The clear button shows whenever there is something to clear. */
  isClearable?: { 'The clear button shows whenever there is a value': never };
}

/** A Combobox that picks one item: its value, or `null` when nothing is picked. */
export type ComboboxSingleProps = ComboboxBaseProps & {
  /** Pick several items, shown as chips. */
  multiple?: false | undefined;
  /** Accept any text, not only an item. */
  allowCustomValue?: false | undefined;
  /** The picked item's value, when you control it; `null` is nothing picked. */
  value?: string | null | undefined;
  /** The item picked at first, when the field keeps its own. */
  defaultValue?: string | null | undefined;
  /** Called with the picked item's value, or `null` when cleared. */
  onValueChange?: ((value: string | null) => void) | undefined;
  /** Only with `multiple`. */
  removeLabel?: never;
  /** Only with `allowCustomValue`. */
  customValueLabel?: never;
};

/** A Combobox that picks several items, shown as chips in the input. */
export type ComboboxMultipleProps = ComboboxBaseProps & {
  /** Pick several items, shown as chips; the value is an array. */
  multiple: true;
  /** Not with `multiple`: `allowCustomValue` keeps one typed value. */
  allowCustomValue?: false | undefined;
  /** The picked items' values, when you control them. */
  value?: string[] | undefined;
  /** The items picked at first, when the field keeps its own. */
  defaultValue?: string[] | undefined;
  /** Called with the picked items' values. */
  onValueChange?: ((value: string[]) => void) | undefined;
  /**
   * The name of a chip's remove button, from the item's label, as visually hidden text and not
   * an `aria-label`. Translate it with your app.
   * @default (label) => `Remove ${label}`
   */
  removeLabel?: ((label: string) => string) | undefined;
  /** Only with `allowCustomValue`. */
  customValueLabel?: never;
};

/** A Combobox that accepts any text, suggesting matching items as people type. */
export type ComboboxCustomProps = ComboboxBaseProps & {
  /** Accept any text: the value is what is in the input, and items are suggestions. */
  allowCustomValue: true;
  /** Not with `allowCustomValue`: it keeps one typed value. */
  multiple?: false | undefined;
  /** The text, when you control it. */
  value?: string | undefined;
  /** The text at first, when the field keeps its own. */
  defaultValue?: string | undefined;
  /**
   * Called with the text as people type or pick a suggestion. A suggestion puts its `label`
   * in the input, and the text is the value, so an `{ value, label }` item submits its label.
   */
  onValueChange?: ((value: string) => void) | undefined;
  /**
   * The sheet's row (on a phone) that keeps what was typed, from the text. Translate it with
   * your app.
   * @default (text) => `Use “${text}”`
   */
  customValueLabel?: ((text: string) => string) | undefined;
  /** Only with `multiple`. */
  removeLabel?: never;
};

/**
 * Props for {@link Combobox}: one item (the default), several with `multiple`, or any text
 * with `allowCustomValue`.
 */
export type ComboboxProps = ComboboxSingleProps | ComboboxMultipleProps | ComboboxCustomProps;

/** An item as Base UI's list holds it. */
interface Option {
  value: string;
  label: string;
  disabled?: boolean | undefined;
  /** The sheet's row that keeps the typed text (`allowCustomValue`): it shows `label` but picks `value`. */
  custom?: boolean | undefined;
}

/** What the field shows inside it, from the props, for either way of picking. */
interface ControlProps {
  sheet: boolean;
  onReset: (() => void) | undefined;
  label: string;
  items: readonly ComboboxItem[];
  multiple: boolean;
  value: unknown;
  defaultValue: unknown;
  onValueChange: ((value: never) => void) | undefined;
  onInputChange: ((text: string) => void) | undefined;
  placeholder: string | undefined;
  required: boolean | undefined;
  loading: boolean | undefined;
  loadingLabel: string;
  emptyLabel: string;
  clearLabel: string;
  doneLabel: string;
  removeLabel: (label: string) => string;
  customValueLabel: (text: string) => string;
  /** `allowCustomValue` on a phone: one value, which may be typed text. */
  custom: boolean;
  inputRef: Ref<HTMLInputElement> | undefined;
}

/** Field's messages and root name Combobox. */
const owner = { name: "Combobox", data: "combobox" };
/** Marks the hidden input Base UI submits a picked value with. */
const markInput = controlRef("combobox", "hidden-input");

/**
 * A callback ref that marks the visually hidden Dismiss button Base UI adds for screen readers
 * while the list is open, beside the input and beside the popup. Base UI takes neither props
 * nor a ref for it, so the marker goes on whenever one appears under the element.
 */
function dismissMarker(item: string, part: string): RefCallback<HTMLElement> {
  return (element) => {
    const mark = () => {
      for (const dismiss of element!.querySelectorAll('span[role="button"]:not([data-base-ui-focus-guard])')) {
        dismiss.setAttribute("data-ouro-control", item);
        dismiss.setAttribute("data-ouro-part", part);
      }
    };
    mark();
    const observer = new MutationObserver(mark);
    observer.observe(element!, { childList: true, subtree: true });
    return () => observer.disconnect();
  };
}
const markDismiss = dismissMarker("combobox", "dismiss");
const markPopupDismiss = dismissMarker("combobox", "popup-dismiss");

const toOption = (item: ComboboxItem): Option => (typeof item === "string" ? { value: item, label: item } : item);

/**
 * Icons drawn in the text color at 16px, like the other Ouro icons.
 *
 * @claim "Icons drawn in the text color" registry/ouro/components/ouro/combobox/combobox.tsx verify:fileLine(registry/ouro/components/ouro/combobox/combobox.tsx, /viewBox="0\s0\s16\s16"/)
 * @claim "Icons drawn in the text color" registry/ouro/components/ouro/combobox/combobox.tsx verify:fileLine(registry/ouro/components/ouro/combobox/combobox.tsx, /\[&_svg\]:size-4/)
 */
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
    >
      {children}
    </svg>
  );
}

const CrossIcon = () => (
  <Icon>
    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
  </Icon>
);

const ChevronIcon = () => (
  <Icon>
    <path d="M4.5 6.5 8 10l3.5-3.5" />
  </Icon>
);

/**
 * A text input that filters a list of items as people type, on the Field contract: pass
 * `label`, `items`, and `error` from your server action or client check. It picks one item,
 * several as chips with `multiple`, or accepts any text with `allowCustomValue`. Pass
 * `onInputChange` and `loading` to search on your server. A clear button shows while there
 * is a value. On a phone (below 640px with touch) the field is a button that opens a
 * full-height bottom sheet with the search input pinned at the top, and a clear button sits
 * beside it. With `allowCustomValue` the sheet's first row keeps what was typed
 * (`customValueLabel`). The sheet opens with focus on itself, not the search input, so the
 * keyboard does not cover the list until people tap the search (as Base UI does for touch).
 *
 * Use `Select` instead for a short list people don't need to search, and `TextField` for
 * free text with no suggestions.
 *
 * @group Forms
 * @see https://ourostack.github.io/ouro-ui/docs/combobox
 *
 * @example
 * <Combobox label="Herb" name="herb" items={["Basil", "Dill", "Thyme"]} />
 * <Combobox label="Tags" name="tags" multiple items={tags} defaultValue={["Quick"]} />
 * <Combobox label="Recipe" items={results} loading={searching} onInputChange={search} />
 * <Combobox label="Cuisine" name="cuisine" allowCustomValue items={["Italian", "Thai"]} />
 * @claim "On a phone (below 640px with" registry/ouro/components/ouro/combobox/combobox.touch.test.tsx verify:testExists(registry/ouro/components/ouro/combobox/combobox.touch.test.tsx::Combobox on a phone > is a button in the field that opens a sheet titled with the label)
 * @claim "On a phone (below 640px with" registry/ouro/components/ouro/combobox/combobox.touch.test.tsx verify:testExists(registry/ouro/components/ouro/combobox/combobox.touch.test.tsx::Combobox on a phone > clears a single pick with a clear button beside the field, by tap or from the keyboard)
 */
export function Combobox(props: ComboboxProps): JSX.Element {
  const {
    label,
    hideLabel,
    description,
    error,
    required,
    disabled,
    name,
    items,
    placeholder,
    onInputChange,
    loading,
    loadingLabel = "Loading…",
    emptyLabel = "No results",
    clearLabel = "Clear",
    doneLabel = "Done",
    className,
    ref,
    multiple = false,
    allowCustomValue = false,
    value,
    defaultValue,
    onValueChange,
    removeLabel = (item: string) => `Remove ${item}`,
    customValueLabel = (text: string) => `Use “${text}”`,
    // Guard props (hint types), dropped here so they never reach the DOM.
    errorMessage,
    helperText,
    isInvalid,
    invalid,
    isRequired,
    isDisabled,
    options,
    isLoading,
    isMulti,
    freeSolo,
    creatable,
    onSearch,
    onInputValueChange,
    onChange,
    noOptionsMessage,
    isClearable,
  } = props as ComboboxBaseProps & {
    multiple?: boolean;
    allowCustomValue?: boolean;
    value?: unknown;
    defaultValue?: unknown;
    onValueChange?: (value: never) => void;
    removeLabel?: (label: string) => string;
    customValueLabel?: (text: string) => string;
  };
  const form = useFormErrors();
  const [ownCustomValue, setOwnCustomValue] = useState(defaultValue ?? "");
  // A change drops a Form error for this name, as typing does in a text field.
  const handleValueChange = (next: never) => {
    if (allowCustomValue && !multiple && value === undefined) setOwnCustomValue(next);
    if (name !== undefined) form?.clear(name);
    onValueChange?.(next);
  };
  const sheet = usePickerSheet();
  const custom = allowCustomValue && !multiple;
  const customProps = props.allowCustomValue && !props.multiple ? props : undefined;
  const resetCustom = customProps && customProps.value === undefined ? () => {
    const next = customProps.defaultValue ?? "";
    if (next !== ownCustomValue) {
      setOwnCustomValue(next);
      if (name !== undefined) form?.clear(name);
      customProps.onValueChange?.(next);
    }
  } : undefined;

  useDevWarnings(
    "Combobox",
    process.env.NODE_ENV !== "production"
      ? () => [
          ...contractWarnings("Combobox", { errorMessage, helperText, isInvalid, invalid, isRequired, isDisabled }),
          options !== undefined && ["options is not a prop", "<Combobox items={[…]}>"],
          isLoading !== undefined && ["isLoading is not a prop", "<Combobox loading>"],
          isMulti !== undefined && ["isMulti is not a prop", "<Combobox multiple>"],
          freeSolo !== undefined && ["freeSolo is not a prop", "<Combobox allowCustomValue>"],
          creatable !== undefined && ["creatable is not a prop", "<Combobox allowCustomValue>"],
          onSearch !== undefined && ["onSearch is not a prop", "<Combobox onInputChange={(text) => …}>"],
          onInputValueChange !== undefined && ["onInputValueChange is not a prop", "<Combobox onInputChange={(text) => …}>"],
          onChange !== undefined && ["onChange is not a prop", "<Combobox onValueChange={(value) => …}>"],
          noOptionsMessage !== undefined && ["noOptionsMessage is not a prop", `<Combobox emptyLabel="${String(noOptionsMessage)}">`],
          isClearable !== undefined && ["isClearable is not a prop; the clear button shows whenever there is a value", "<Combobox>"],
          multiple &&
            allowCustomValue && [
              "multiple and allowCustomValue do not combine; allowCustomValue keeps one typed value",
              "<Combobox multiple items={tags}>",
            ],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );

  const control: ControlProps = {
    sheet,
    onReset: resetCustom,
    label,
    items,
    multiple,
    value: custom && value === undefined ? ownCustomValue : value,
    defaultValue,
    onValueChange: handleValueChange,
    onInputChange,
    placeholder,
    required,
    loading,
    loadingLabel,
    emptyLabel,
    clearLabel,
    doneLabel,
    removeLabel,
    customValueLabel,
    custom,
    inputRef: ref,
  };

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
        {/* On a phone, allowCustomValue uses the sheet too, with a row that keeps the typed text. */}
        {custom && !sheet ? <AutocompleteControl {...control} /> : <ComboboxControl {...control} />}
      </Field>
    </FieldOwnerContext.Provider>
  );
}

/** The list's status, empty message and items, in the popup or the sheet. */
function ListBody({
  loading,
  loadingLabel,
  emptyLabel,
  showEmpty,
  className,
  renderItem,
}: {
  loading: boolean | undefined;
  /** Whether "nothing matched" applies: not before a server search has been typed. */
  showEmpty: boolean;
  loadingLabel: string;
  emptyLabel: string;
  className: string;
  renderItem: (option: Option) => JSX.Element;
}): JSX.Element {
  return (
    <>
      <BaseCombobox.Status className={statusClass}>
        {loading && (
          <>
            <svg
              aria-hidden="true"
              data-ouro-spinner=""
              viewBox="0 0 24 24"
              fill="none"
              className="size-4 animate-[ouro-spin_0.8s_linear_infinite] motion-reduce:animate-[ouro-pulse_1.6s_ease-in-out_infinite]"
            >
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            {loadingLabel}
          </>
        )}
      </BaseCombobox.Status>
      <BaseCombobox.Empty className={emptyClass}>{!loading && showEmpty && emptyLabel}</BaseCombobox.Empty>
      <BaseCombobox.List className={className}>{renderItem}</BaseCombobox.List>
    </>
  );
}

/** The popup under (or over) the input, on wider screens and with a mouse. */
function Popup({ loading, children }: { loading: boolean | undefined; children: ReactNode }): JSX.Element {
  return (
    <BaseCombobox.Portal data-ouro="combobox-portal" className="relative isolate z-(--ouro-layer)">
      <BaseCombobox.Positioner ref={markPopupDismiss} sideOffset={4} className="outline-none">
        <BaseCombobox.Popup data-ouro="combobox-popup" aria-busy={loading || undefined} className={popupClass}>
          {children}
        </BaseCombobox.Popup>
      </BaseCombobox.Positioner>
    </BaseCombobox.Portal>
  );
}

/**
 * The end of the box: the clear button, while there is something to clear, and a chevron.
 * The chevron is drawn, not a button: pressing anywhere in the box opens the list, and the
 * arrow keys open it from the keyboard. (Base UI gives a trigger button the input's id on the
 * server, so a server-rendered page would hold that id twice.)
 */
function EndButtons({ clearLabel }: { clearLabel: string }): JSX.Element {
  return (
    <span className={endSlotClass}>
      <BaseCombobox.Clear
        render={
          <Button variant="plain" tone="secondary" size="sm" data-ouro-combobox-clear="" data-ouro-control="combobox" data-ouro-part="clear" className="aspect-square px-0">
            <CrossIcon />
            <span className="sr-only">{clearLabel}</span>
          </Button>
        }
      />
      <BaseCombobox.Icon data-ouro-combobox-icon="" className="flex size-8 items-center justify-center text-muted-foreground sm:pointer-fine:size-6 [&_svg]:size-4">
        <ChevronIcon />
      </BaseCombobox.Icon>
    </span>
  );
}

/** Restores a custom value only after an uncancelled reset, unless a later edit or unmount won. */
function useCustomReset(ref: RefObject<HTMLInputElement | HTMLButtonElement | null>, value: unknown, onReset: (() => void) | undefined) {
  const latest = useRef({ value, onReset });
  useLayoutEffect(() => { latest.current = { value, onReset }; });
  useEffect(() => {
    const element = ref.current;
    const form = element?.form;
    if (!form || !onReset) return;
    const reset = (event: Event) => {
      const before = latest.current.value;
      queueMicrotask(() => {
        if (!event.defaultPrevented && event.target === form && ref.current === element && latest.current.value === before) latest.current.onReset?.();
      });
    };
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [ref, onReset]);
}

/** A Combobox that picks one item or several, on Base UI Combobox. */
function ComboboxControl(props: ControlProps): JSX.Element {
  const { label, items, multiple, value, defaultValue, onValueChange, onInputChange, placeholder, required, loading } = props;
  const { loadingLabel, emptyLabel, clearLabel, doneLabel, removeLabel, customValueLabel, custom, inputRef, sheet } = props;
  const field = useField()!;
  // Ouro's own invalid state (the error prop or the Form's error for this name), not Base UI's,
  // which would count it as a failed check and block the next submit.
  const invalid = field.invalid;
  // The input's text: for the "nothing matched" line and the row that keeps typed text.
  const [text, setText] = useState("");
  // With allowCustomValue the text is the value, so an item's label is what it submits, as in
  // the popup (Autocomplete), whatever its `value`.
  const options = useMemo(
    () => items.map((item) => {
      const option = toOption(item);
      return custom ? { ...option, value: option.label } : option;
    }),
    [items, custom],
  );
  // Every item seen so far, so a picked value keeps its label when search results change.
  // A map kept for the component's life (state that is never set), added to as items arrive.
  const [known] = useState(() => new Map<string, Option>());
  for (const option of options) known.set(option.value, option);
  const toSelected = (picked: string): Option => known.get(picked) ?? { value: picked, label: picked };
  const toBase = (picked: unknown) =>
    multiple
      ? ((picked as string[] | undefined) ?? []).map(toSelected)
      : picked == null || (custom && picked === "")
        ? null
        : toSelected(picked as string);
  // With allowCustomValue, typed text that is not an item gets a row of its own, first.
  const typed = text.trim();
  const listed =
    custom && typed !== "" && !options.some((option) => option.label === typed)
      ? [{ value: typed, label: customValueLabel(typed), custom: true }, ...options]
      : options;
  const shown = (option: Option) => (option.custom ? option.value : option.label);

  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const resetInputRef = useRef<HTMLInputElement>(null);
  const setInputRef = useMergedRef(inputRef, resetInputRef);
  useCustomReset(sheet ? triggerRef : resetInputRef, value, props.onReset);
  const report = onValueChange as ((value: string | string[] | null) => void) | undefined;
  const showEmpty = !onInputChange || text !== "";

  const renderItem = (option: Option) => (
    <BaseCombobox.Item key={option.value} value={option} disabled={option.disabled} data-ouro-control="combobox" data-ouro-part="option" className={itemClass}>
      <BaseCombobox.ItemIndicator className="col-start-1 flex">
        <Icon>
          <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
        </Icon>
      </BaseCombobox.ItemIndicator>
      <span className="col-start-2">{option.label}</span>
    </BaseCombobox.Item>
  );
  const body = (className: string) => (
    <ListBody
      loading={loading}
      loadingLabel={loadingLabel}
      emptyLabel={emptyLabel}
      showEmpty={showEmpty}
      className={className}
      renderItem={renderItem}
    />
  );

  const input = (className: string, extra: { "aria-label"?: string } = {}) => (
    <BaseCombobox.Input
      {...extra}
      ref={setInputRef}
      data-ouro-control="combobox"
      data-ouro-part="input"
      placeholder={placeholder}
      aria-describedby={sheet ? undefined : field.describedBy}
      {...(invalid && !sheet ? { "aria-invalid": true } : {})}
      className={className}
    />
  );

  return (
    <BaseCombobox.Root
      items={listed}
      multiple={multiple}
      isItemEqualToValue={(item: Option, picked: Option) => item.value === picked.value}
      itemToStringLabel={shown}
      filter={onInputChange ? null : undefined}
      onInputValueChange={(next, details) => {
        setText(next);
        if (details.reason !== "item-press") onInputChange?.(next);
      }}
      required={required}
      inputRef={markInput}
      openOnInputClick
      open={open}
      onOpenChange={(next: boolean, details: { reason: string }) => {
        // An inline trigger closes Base UI's always-open list; its own click opens our sheet.
        if (!sheet || details.reason !== "trigger-press") setOpen(next);
      }}
      {...(value !== undefined ? { value: toBase(value) } : { defaultValue: toBase(defaultValue) })}
      onValueChange={(next: Option | Option[] | null) =>
        report?.(Array.isArray(next) ? next.map((option) => option.value) : (next?.value ?? (custom ? "" : null)))
      }
      {...(sheet
        ? {
            inline: true,
          }
        : {})}
    >
      {sheet ? (
        <div data-ouro-combobox-field="" className={sheetFieldClass}>
          <BaseCombobox.Trigger
            ref={triggerRef}
            aria-describedby={field.describedBy}
            {...(invalid ? { "aria-invalid": true } : {})}
            data-ouro-combobox-trigger=""
            data-ouro-control="combobox"
            data-ouro-part="trigger"
            className={triggerClass}
            // With an inline list there is no Base UI popup for the trigger to open: it opens the sheet.
            onClick={() => setOpen(true)}
          >
            <BaseCombobox.Value placeholder={placeholder}>
              {(picked: Option | Option[] | null) => {
                const labels = (Array.isArray(picked) ? picked : picked ? [picked] : []).map(shown);
                return <span>{labels.length > 0 ? labels.join(", ") : placeholder}</span>;
              }}
            </BaseCombobox.Value>
            <ChevronIcon />
          </BaseCombobox.Trigger>
          {!multiple && (
            // Beside the button, not in it: a button can't hold another. It is in the Tab order
            // here, since the button, not an input, has focus; clearing puts focus back on the button.
            <BaseCombobox.Clear
              tabIndex={0}
              data-ouro-combobox-clear=""
              className={sheetClearClass}
              onClick={() => triggerRef.current?.focus()}
              render={
                <Button variant="plain" tone="secondary" size="sm" data-ouro-control="combobox" data-ouro-part="clear" className="aspect-square px-0">
                  <CrossIcon />
                  <span className="sr-only">{clearLabel}</span>
                </Button>
              }
            />
          )}
          <SheetFrame
            title={label}
            closeLabel={doneLabel}
            side="bottom"
            // One tall snap point: the sheet keeps its height as results filter and load, so the
            // search input stays where the thumb left it.
            snapPoints={[1]}
            open={open}
            onOpenChange={setOpen}
            finalFocus={triggerRef}
            footer={
              multiple ? (
                <Button fullWidth data-ouro-control="combobox" data-ouro-part="done" onClick={() => setOpen(false)}>
                  {doneLabel}
                </Button>
              ) : undefined
            }
          >
            <div data-ouro-combobox-search="" className={sheetInputClass}>
              <div ref={markDismiss} data-ouro-input-group="" className={groupClass}>
                {input(inputClass, { "aria-label": label })}
              </div>
            </div>
            {body(sheetListClass)}
          </SheetFrame>
        </div>
      ) : (
        <>
          <BaseCombobox.InputGroup ref={markDismiss} data-ouro-input-group="" className={multiple ? chipsGroupClass : groupClass}>
            {multiple ? (
              <BaseCombobox.Chips className="contents">
                <BaseCombobox.Value>
                  {(picked: Option[]) => (
                    <>
                      {picked.map((option) => (
                        <BaseCombobox.Chip key={option.value} data-ouro-combobox-chip="" className={chipClass}>
                          <span>{option.label}</span>
                          <BaseCombobox.ChipRemove data-ouro-combobox-chip-remove="" data-ouro-control="combobox" data-ouro-part="chip-remove" className={chipRemoveClass}>
                            <TouchTarget />
                            <CrossIcon />
                            <span className="sr-only">{removeLabel(option.label)}</span>
                          </BaseCombobox.ChipRemove>
                        </BaseCombobox.Chip>
                      ))}
                      {input(chipsInputClass)}
                    </>
                  )}
                </BaseCombobox.Value>
              </BaseCombobox.Chips>
            ) : (
              input(inputClass)
            )}
            <EndButtons clearLabel={clearLabel} />
          </BaseCombobox.InputGroup>
          <Popup loading={loading}>{body(listClass)}</Popup>
        </>
      )}
    </BaseCombobox.Root>
  );
}

/** A Combobox that accepts any text, on Base UI Autocomplete. */
function AutocompleteControl(props: ControlProps): JSX.Element {
  const { items, value, onValueChange, onInputChange, placeholder, required, loading } = props;
  const { loadingLabel, emptyLabel, clearLabel, inputRef } = props;
  const field = useField()!;
  // Ouro's own invalid state (the error prop or the Form's error for this name), not Base UI's,
  // which would count it as a failed check and block the next submit.
  const invalid = field.invalid;
  const suggestions = useMemo(() => items.map((item) => toOption(item)), [items]);
  const report = onValueChange as ((value: string) => void) | undefined;
  const resetInputRef = useRef<HTMLInputElement>(null);
  const setInputRef = useMergedRef(inputRef, resetInputRef);
  useCustomReset(resetInputRef, value, props.onReset);
  return (
    <BaseAutocomplete.Root
      items={suggestions}
      inputRef={markInput}
      itemToStringValue={(option: Option) => option.label}
      filter={onInputChange ? null : undefined}
      required={required}
      openOnInputClick
      value={value as string}
      onValueChange={(next, details) => {
        report?.(next);
        // A picked suggestion is not a new search.
        if (details.reason !== "item-press") onInputChange?.(next);
      }}
    >
      <BaseAutocomplete.InputGroup ref={markDismiss} data-ouro-input-group="" className={groupClass}>
        <BaseAutocomplete.Input
          ref={setInputRef}
          data-ouro-control="combobox"
          data-ouro-part="input"
          placeholder={placeholder}
          aria-describedby={field.describedBy}
          {...(invalid ? { "aria-invalid": true } : {})}
          className={inputClass}
        />
        <EndButtons clearLabel={clearLabel} />
      </BaseAutocomplete.InputGroup>
      <Popup loading={loading}>
        <ListBody
          loading={loading}
          loadingLabel={loadingLabel}
          emptyLabel={emptyLabel}
          showEmpty={!onInputChange || value !== ""}
          className={listClass}
          renderItem={(option) => (
            <BaseAutocomplete.Item key={option.value} value={option} disabled={option.disabled} data-ouro-control="combobox" data-ouro-part="option" className={itemClass}>
              <span className="col-start-2">{option.label}</span>
            </BaseAutocomplete.Item>
          )}
        />
      </Popup>
    </BaseAutocomplete.Root>
  );
}
