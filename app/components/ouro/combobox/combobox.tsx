"use client";

import "~/lib/ouro/last-input";
import { Autocomplete as BaseAutocomplete } from "@base-ui/react/autocomplete";
import { Combobox as BaseCombobox } from "@base-ui/react/combobox";
import { mergeProps } from "@base-ui/react/merge-props";
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type JSX, type KeyboardEvent, type ReactNode, type Ref, type RefCallback, type RefObject } from "react";
import { Button } from "~/components/ouro/button/button";
import { Field } from "~/components/ouro/field/field";
import { contractWarnings } from "~/components/ouro/field/field-styles";
import { SheetFrame } from "~/components/ouro/sheet/sheet";
import { endSlotClass, groupClass, inputClass } from "~/components/ouro/text-field/text-field-styles";
import { TouchTarget } from "~/lib/ouro/touch-target";
import { cn } from "~/lib/ouro/cn";
import { FieldOwnerContext, useField, useFormErrors, type ReadonlyErrorMessages } from "~/lib/ouro/use-field";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { usePickerSheet } from "~/lib/ouro/use-sheet-presentation";
import { controlRef } from "~/lib/ouro/control-ref";
import { PageDirection } from "~/lib/ouro/page-direction";
import { useMergedRef } from "~/lib/ouro/refs";
import { holdPageAtPress } from "~/lib/ouro/page-scroll-hold";
import { floatingPositionMethod } from "~/lib/ouro/floating";
import { PortalScope, usePortalContainer } from "~/lib/ouro/portal-container";
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
  sheetChipsClass,
  sheetChipsFieldClass,
  sheetChipsTriggerClass,
  sheetFieldClass,
  sheetInputClass,
  sheetListClass,
  statusClass,
  triggerClass,
} from "~/components/ouro/combobox/combobox-styles";

/**
 * An item to pick: a string, which is both what shows and what submits, or an object with
 * the `value` that submits and the `label` that shows. `disabled` items show but can't be picked.
 * An object can also show a picture, a second line and a mark, as a people picker does: `media`
 * (an `Avatar`), `description` and `meta` (a `Badge`).
 */
export type ComboboxItem = string | ComboboxItemObject;

/** An item as an object: what it submits, what it shows, and what shows around it. */
export interface ComboboxItemObject {
  /** What the item submits, and what `value` and `onValueChange` hold. */
  value: string;
  /** What the item shows, on its row and on its chip with `multiple`; screen readers hear it first. */
  label: string;
  /** The item shows but can't be picked. */
  disabled?: boolean | undefined;
  /**
   * A second, muted line under the label, such as a person's job title or email. It stays on
   * one line, cut with an ellipsis, and shows whole on hover (its `title`).
   * @claim "It stays on one line, cut" registry/ouro/components/ouro/combobox/combobox.test.tsx verify:testExists(registry/ouro/components/ouro/combobox/combobox.test.tsx::Combobox rich items > shows media, a description and a mark on a row, and media on its chip)
   */
  description?: string | undefined;
  /**
   * A picture before the label, on the row and, with `multiple`, on the chip: an `Avatar` with
   * `alt=""` (the label already names it) and `size="xs"`, which fits a chip.
   */
  media?: ReactNode;
  /** A small mark at the row's end, such as a `<Badge>` that says "1:1". */
  meta?: ReactNode;
}

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
   * The query that `items` answer; `null` means no answer yet. With `autoHighlight`,
   * Enter waits for this query's answer and picks its first enabled, unpicked item.
   * Queries compare ignoring case and extra spaces. Keep `loading` true until the
   * answer is complete; on failure, pass an empty answer for that query and show your error.
   * Editing, Escape, moving focus or closing the list cancels the waiting pick.
   * Omit for local filtering. Not used with `allowCustomValue`.
   * @claim "The query that `items` answer; `null` means no answer yet." registry/ouro/components/ouro/combobox/combobox.test.tsx verify:testExists(registry/ouro/components/ouro/combobox/combobox.test.tsx::Combobox keys > cancels a waiting Enter on edit, Escape, blur or a closed list)
   * @claim "Enter waits for this query's answer" registry/ouro/components/ouro/combobox/combobox.test.tsx verify:testExists(registry/ouro/components/ouro/combobox/combobox.test.tsx::Combobox keys > waits for the typed query's answer on Enter, then picks one enabled unpicked result)
   * @claim "Editing, Escape, moving focus or closing the list cancels the waiting pick." registry/ouro/components/ouro/combobox/combobox.test.tsx verify:testExists(registry/ouro/components/ouro/combobox/combobox.test.tsx::Combobox keys > cancels a waiting Enter on edit, Escape, blur or a closed list)
   */
  resultsFor?: string | null | undefined;
  /**
   * The first item that matches is highlighted as people type, so Enter picks it.
   * @claim "The first item that matches is" registry/ouro/components/ouro/combobox/combobox.test.tsx verify:testExists(registry/ouro/components/ouro/combobox/combobox.test.tsx::Combobox keys > picks the first match on Enter with autoHighlight, and nothing without it)
   */
  autoHighlight?: boolean | undefined;
  /**
   * Called on each key pressed in the input, before Combobox acts on it. Call
   * `event.preventDefault()` to stop Combobox's own handling of that key (Enter picking, Tab,
   * the arrows), such as to move on from an empty input on Enter.
   * @claim "Called on each key pressed in" registry/ouro/components/ouro/combobox/combobox.test.tsx verify:testExists(registry/ouro/components/ouro/combobox/combobox.test.tsx::Combobox keys > hands the app each key first, and leaves a key the app prevents alone)
   */
  onInputKeyDown?: ((event: KeyboardEvent<HTMLInputElement>) => void) | undefined;
  /**
   * People can see the field and what is picked but not change it: the input takes no text,
   * nothing in the list can be picked, and the clear and remove buttons go. The list still opens,
   * to browse.
   * @claim "People can see the field and" registry/ouro/components/ouro/combobox/combobox.test.tsx verify:testExists(registry/ouro/components/ouro/combobox/combobox.test.tsx::Combobox keys > keeps a read-only field as it is)
   */
  readOnly?: boolean | undefined;
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
   * Content for the empty state in place of `emptyLabel`, such as a picture with words:
   * `empty={<Empty icon={<SearchIcon />} title="No herbs by that name" />}`, in the popup and in the
   * phone's sheet alike. Screen readers hear it politely, once each time nothing comes to match.
   * @claim "Content for the empty state" registry/ouro/components/ouro/combobox/combobox.test.tsx verify:testExists(registry/ouro/components/ouro/combobox/combobox.test.tsx::Combobox > takes content for its empty state, such as a picture with words, said politely once each time nothing matches)
   * @claim "Content for the empty state" registry/ouro/components/ouro/combobox/combobox.touch.test.tsx verify:testExists(registry/ouro/components/ouro/combobox/combobox.touch.test.tsx::Combobox on a phone > shows its empty content in the sheet when nothing matches, said politely once)
   * @claim "Screen readers hear it politely" registry/ouro/components/ouro/combobox/combobox.test.tsx verify:testExists(registry/ouro/components/ouro/combobox/combobox.test.tsx::Combobox > takes content for its empty state, such as a picture with words, said politely once each time nothing matches)
   * @claim "Screen readers hear it politely" registry/ouro/components/ouro/combobox/combobox.touch.test.tsx verify:testExists(registry/ouro/components/ouro/combobox/combobox.touch.test.tsx::Combobox on a phone > shows its empty content in the sheet when nothing matches, said politely once)
   */
  empty?: ReactNode;
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
   * The name of the sheet's own close button on a phone: an icon button in the top corner,
   * distinct from `doneLabel`'s visible footer button with `multiple`, so a screen reader
   * does not read a matching name for both controls. Translate it with your app.
   * @default "Close"
   */
  closeLabel?: string | undefined;
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
  /**
   * The input's text, when you control it with `onInputChange`. Set it to `""` in
   * `onValueChange` to clear the input after a pick.
   */
  inputValue?: string | undefined;
  /** Only with `multiple`. */
  removeLabel?: never;
  /** Only with `allowCustomValue`. */
  customValueLabel?: never;
};

/** What both ways of picking several items take: chips, an array value and the input's text. */
interface ComboboxChipsProps {
  /** Pick several items, shown as chips; the value is an array. */
  multiple: true;
  /** The chips' values, when you control them. */
  value?: string[] | undefined;
  /** The chips at first, when the field keeps its own. */
  defaultValue?: string[] | undefined;
  /** Called with the chips' values: picked items' values, and typed text with `allowCustomValue`. */
  onValueChange?: ((value: string[]) => void) | undefined;
  /**
   * The input's text, when you control it with `onInputChange`. Set it to `""` in
   * `onValueChange` to clear the input after a pick.
   * @claim "in `onValueChange` to clear the input after a pick" registry/ouro/components/ouro/combobox/combobox.test.tsx verify:testExists(registry/ouro/components/ouro/combobox/combobox.test.tsx::Combobox keys > takes its text from inputValue, and clears it after a pick when the app says so)
   */
  inputValue?: string | undefined;
  /**
   * The name of a chip's remove button, from the chip's label, as visually hidden text and not
   * an `aria-label`. Translate it with your app.
   * @default (label) => `Remove ${label}`
   */
  removeLabel?: ((label: string) => string) | undefined;
}

/** A Combobox that picks several items, shown as chips in the input. */
export type ComboboxMultipleProps = ComboboxBaseProps & ComboboxChipsProps & {
  /** Also take typed text as chips: see {@link ComboboxTokensProps}. */
  allowCustomValue?: false | undefined;
  /** Only with `allowCustomValue`. */
  customValueLabel?: never;
};

/**
 * A token input: picks several items as chips, and makes typed text a chip too, as for a
 * recipe's tags. Suggestions match ignoring case and extra spaces. Enter picks the highlighted
 * suggestion, or, with none highlighted, makes the typed text a chip; a comma also makes a chip,
 * so a pasted "quick, vegan" becomes two. Text that matches an item ignoring case picks that
 * item, so "weeknight" adds the existing "Weeknight" and no duplicate chip appears.
 *
 * @claim "Enter picks the highlighted suggestion, or" registry/ouro/components/ouro/combobox/combobox.test.tsx verify:testExists(registry/ouro/components/ouro/combobox/combobox.test.tsx::Combobox multiple allowCustomValue > makes typed text a chip on Enter when no suggestion is highlighted, and submits one entry per chip)
 * @claim "Enter picks the highlighted suggestion, or" registry/ouro/components/ouro/combobox/combobox.test.tsx verify:testExists(registry/ouro/components/ouro/combobox/combobox.test.tsx::Combobox multiple allowCustomValue > picks a highlighted suggestion on Enter)
 * @claim "Suggestions match ignoring case and extra spaces" registry/ouro/components/ouro/combobox/combobox.test.tsx verify:testExists(registry/ouro/components/ouro/combobox/combobox.test.tsx::Combobox multiple allowCustomValue > suggests items ignoring case and extra spaces)
 * @claim "a comma also makes a chip" registry/ouro/components/ouro/combobox/combobox.test.tsx verify:testExists(registry/ouro/components/ouro/combobox/combobox.test.tsx::Combobox multiple allowCustomValue > makes a chip at each comma, and a pasted list becomes a chip per entry)
 * @claim "Text that matches an item ignoring case picks that" registry/ouro/components/ouro/combobox/combobox.test.tsx verify:testExists(registry/ouro/components/ouro/combobox/combobox.test.tsx::Combobox multiple allowCustomValue > picks the item that typed text matches ignoring case, so no duplicate chip appears)
 */
export type ComboboxTokensProps = ComboboxBaseProps & ComboboxChipsProps & {
  /** Typed text becomes a chip too, on Enter or at a comma. */
  allowCustomValue: true;
  /**
   * The sheet's row (on a phone) that adds what was typed as a chip, from the text. Translate it
   * with your app.
   * @default (text) => `Use “${text}”`
   * @claim "The sheet's row (on a phone) that adds" registry/ouro/components/ouro/combobox/combobox.touch.test.tsx verify:testExists(registry/ouro/components/ouro/combobox/combobox.touch.test.tsx::Combobox on a phone > adds typed text as a chip from the sheet's row with multiple and allowCustomValue)
   */
  customValueLabel?: ((text: string) => string) | undefined;
};

/** A Combobox that accepts any text, suggesting matching items as people type. */
export type ComboboxCustomProps = ComboboxBaseProps & {
  /** Accept any text: the value is what is in the input, and items are suggestions. */
  allowCustomValue: true;
  /** One typed value. With `multiple` too, typed text becomes chips: see {@link ComboboxTokensProps}. */
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
  /** Not with `allowCustomValue`: the text is the value, which `value` controls. */
  inputValue?: never;
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
 * Props for {@link Combobox}: one item (the default), several with `multiple`, any text
 * with `allowCustomValue`, or several items and typed text as chips with both.
 */
export type ComboboxProps = ComboboxSingleProps | ComboboxMultipleProps | ComboboxTokensProps | ComboboxCustomProps;

/** An item as Base UI's list holds it. */
interface Option {
  value: string;
  label: string;
  disabled?: boolean | undefined;
  description?: string | undefined;
  media?: ReactNode;
  meta?: ReactNode;
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
  empty: ReactNode;
  clearLabel: string;
  doneLabel: string;
  closeLabel: string;
  removeLabel: (label: string) => string;
  customValueLabel: (text: string) => string;
  /** `allowCustomValue` on a phone: one value, which may be typed text. */
  custom: boolean;
  /** `multiple` with `allowCustomValue`: typed text becomes chips. */
  tokens: boolean;
  inputRef: Ref<HTMLInputElement> | undefined;
  autoHighlight: boolean | undefined;
  onInputKeyDown: ((event: KeyboardEvent<HTMLInputElement>) => void) | undefined;
  readOnly: boolean | undefined;
  inputValue: string | undefined;
  resultsFor: string | null | undefined;
  disabled: boolean | undefined;
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
/** Text as a token input compares it: trimmed, inner runs of space as one, and in upper case, where "ß" is "SS". */
const normalized = (text: string) => text.trim().replace(/\s+/g, " ").toLocaleUpperCase();

/**
 * Icons drawn in the text color at 16px, like the other Ouro icons.
 *
 * @claim "Icons drawn in the text color" registry/ouro/components/ouro/combobox/combobox.tsx verify:fileLine(registry/ouro/components/ouro/combobox/combobox.tsx, /viewBox="0\s0\s16\s16"/)
 * @claim "Icons drawn in the text color" registry/ouro/components/ouro/combobox/combobox.tsx verify:fileLine(registry/ouro/components/ouro/combobox/combobox.tsx, /className = "size-ouro-4"/)
 */
function Icon({ children, className = "size-ouro-4" }: { children: ReactNode; className?: string | undefined }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("pointer-events-none", className)}
    >
      {children}
    </svg>
  );
}

const CrossIcon = ({ className }: { className?: string | undefined }) => (
  <Icon className={className}>
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
 * several as chips with `multiple`, or accepts any text with `allowCustomValue`.
 *
 * Pass `onInputChange` and `loading` to search on your server. Add `autoHighlight` and
 * `resultsFor` to wait for the typed query's answer when Enter arrives before the results.
 *
 * With `multiple` and `allowCustomValue`
 * together it is a token input, for tags: typed text becomes a chip on Enter or at a comma, and
 * text that matches an item ignoring case picks that item. A clear button shows while there
 * is a value. On a phone (below 640px with touch) the field is a button that opens a
 * full-height bottom sheet with the search input pinned at the top, and a clear button sits
 * beside it. With `allowCustomValue` the sheet's first row keeps what was typed
 * (`customValueLabel`), and with `multiple` that row adds it as a chip. The sheet opens with focus on itself, not the search input, so the
 * keyboard does not cover the list until people tap the search (as Base UI does for touch).
 * In a right-to-left page (`dir="rtl"` on `<html>`) the arrow keys move between chips from the right: ArrowRight goes from the input to the last chip.
 * There, End also scrolls long typed text to its end, on the left.
 *
 * Use `Select` instead for a short list people don't need to search, and `TextField` for
 * free text with no suggestions.
 *
 * @group Forms
 * @see https://ui.ouroboros.bot/docs/combobox
 *
 * @example
 * <Combobox label="Herb" name="herb" items={["Basil", "Dill", "Thyme"]} />
 * <Combobox label="Tags" name="tags" multiple items={tags} defaultValue={["Quick"]} />
 * <Combobox label="Recipe" items={results} loading={searching} onInputChange={search} />
 * <Combobox label="To" multiple autoHighlight items={people} resultsFor={answeredQuery} loading={searching} onInputChange={search} />
 * <Combobox label="Cuisine" name="cuisine" allowCustomValue items={["Italian", "Thai"]} />
 * <Combobox label="Tags" name="tags" multiple allowCustomValue items={["Weeknight", "Vegan"]} />
 * @claim "With `multiple` and `allowCustomValue`" registry/ouro/components/ouro/combobox/combobox.test.tsx verify:testExists(registry/ouro/components/ouro/combobox/combobox.test.tsx::Combobox multiple allowCustomValue > makes a chip at each comma, and a pasted list becomes a chip per entry)
 * @claim "With `multiple` and `allowCustomValue`" registry/ouro/components/ouro/combobox/combobox.test.tsx verify:testExists(registry/ouro/components/ouro/combobox/combobox.test.tsx::Combobox multiple allowCustomValue > picks the item that typed text matches ignoring case, so no duplicate chip appears)
 * @claim "On a phone (below 640px with" registry/ouro/components/ouro/combobox/combobox.touch.test.tsx verify:testExists(registry/ouro/components/ouro/combobox/combobox.touch.test.tsx::Combobox on a phone > is a button in the field that opens a sheet titled with the label)
 * @claim "In a right-to-left page" registry/ouro/components/ouro/combobox/combobox.test.tsx verify:testExists(registry/ouro/components/ouro/combobox/combobox.test.tsx::Combobox multiple > moves between its chips with the arrow keys of a right-to-left page, where the last chip sits right of the input)
 * @claim "There, End also scrolls long" registry/ouro/components/ouro/combobox/combobox.test.tsx verify:testExists(registry/ouro/components/ouro/combobox/combobox.test.tsx::Combobox allowCustomValue > shows the end of long text on End in a right-to-left page, where the end is on the left)
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
    resultsFor,
    autoHighlight,
    onInputKeyDown,
    readOnly,
    loadingLabel = "Loading…",
    emptyLabel = "No results",
    empty,
    clearLabel = "Clear",
    doneLabel = "Done",
    closeLabel = "Close",
    className,
    ref,
    multiple = false,
    allowCustomValue = false,
    value,
    defaultValue,
    onValueChange,
    removeLabel = (item: string) => `Remove ${item}`,
    customValueLabel = (text: string) => `Use “${text}”`,
    inputValue,
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
    inputValue?: string;
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
          inputValue !== undefined &&
            !onInputChange && ["inputValue needs onInputChange, or the text can never change", "<Combobox inputValue={text} onInputChange={setText}>"],
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
    empty,
    clearLabel,
    doneLabel,
    closeLabel,
    removeLabel,
    customValueLabel,
    custom,
    tokens: allowCustomValue && multiple,
    inputRef: ref,
    autoHighlight,
    onInputKeyDown,
    readOnly,
    inputValue,
    resultsFor,
    disabled,
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

/**
 * The input's press and key handlers: the page hold's, with the app's `onInputKeyDown` ahead of
 * it. Base UI merges handlers so the last runs first; a key the app prevents skips the rest, the
 * page hold's and Base UI's own.
 */
function inputHandlers(onInputKeyDown: ((event: KeyboardEvent<HTMLInputElement>) => void) | undefined) {
  return mergeProps<"input">(holdPageAtPress.listInput, {
    onKeyDown: (event) => {
      onInputKeyDown?.(event);
      if (event.defaultPrevented) event.preventBaseUIHandler();
    },
  });
}

/** An item's row: its label alone, or with its picture, second line and mark. */
function ItemContent({ option }: { option: Option }): JSX.Element {
  if (option.media == null && !option.description && option.meta == null) return <span className="col-start-2">{option.label}</span>;
  return (
    <span className="col-start-2 flex min-w-0 items-center gap-2">
      {option.media != null && (
        <span data-ouro-combobox-media="" className="flex shrink-0">
          {option.media}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{option.label}</span>
        {option.description && (
          // Muted, nudged toward the text color (as ConversationList's quiet lines), so it keeps 4.5:1 on a highlighted row too.
          <span
            data-ouro-combobox-description=""
            title={option.description}
            className="truncate text-xs text-[color-mix(in_oklab,var(--muted-foreground)_80%,var(--foreground))]"
          >
            {option.description}
          </span>
        )}
      </span>
      {option.meta != null && (
        <span data-ouro-combobox-meta="" className="flex shrink-0">
          {option.meta}
        </span>
      )}
    </span>
  );
}

/** The list's status, empty message and items, in the popup or the sheet. */
function ListBody({
  loading,
  loadingLabel,
  emptyLabel,
  empty,
  showEmpty,
  className,
  renderItem,
}: {
  loading: boolean | undefined;
  /** Whether "nothing matched" applies: not before a server search has been typed. */
  showEmpty: boolean;
  loadingLabel: string;
  emptyLabel: string;
  empty: ReactNode;
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
              className="size-ouro-4 animate-[ouro-spin_0.8s_linear_infinite] motion-reduce:animate-[ouro-pulse_1.6s_ease-in-out_infinite]"
            >
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            {loadingLabel}
          </>
        )}
      </BaseCombobox.Status>
      <BaseCombobox.Empty className={emptyClass}>{!loading && showEmpty && (empty ?? emptyLabel)}</BaseCombobox.Empty>
      <BaseCombobox.List className={className}>{renderItem}</BaseCombobox.List>
    </>
  );
}

/**
 * Keeps the page exposed to assistive technology while the list is open. Base UI hides the
 * page around the input and the list with aria-hidden on the children of their ancestors,
 * which leaves the page's links and fields focusable yet hidden and takes its heading away. A
 * combobox list leaves the page as it is, so such a child that gains aria-hidden while the list
 * is open loses it at once, unless the same change hid what holds the input or the list, as a
 * dialog opened over the list hides the page around itself. What the app hid before, and what
 * it hides deeper in the page, stays hidden. It reads only the input and the list, never the
 * whole page, so opening the list costs no search of the page. It renders in the portal, which
 * holds the list only while it is open.
 *
 * @claim "It reads only the input and the list, never the whole page, so opening the list costs no search of the page." registry/ouro/components/ouro/combobox/combobox.test.tsx verify:testExists(registry/ouro/components/ouro/combobox/combobox.test.tsx::Combobox > opens its list without searching the whole page, while it keeps the page exposed)
 */
function KeepPageExposed({ input, list }: { input: RefObject<HTMLElement | null>; list: RefObject<HTMLElement | null> }): null {
  useLayoutEffect(
    () => {
      const observer = new MutationObserver((records) => {
        const kept = [input.current, list.current];
        const targets = records.map(({ target }) => target as Element);
        if (targets.some((target) => kept.some((element) => target.contains(element)))) return;
        for (const target of targets) if (kept.some((element) => target.parentNode!.contains(element))) target.removeAttribute("aria-hidden");
      });
      observer.observe(document.body, { attributes: true, attributeFilter: ["aria-hidden"], subtree: true });
      // Stryker disable next-line ArrowFunction: once the list closes nothing is around it to unhide, so an observer left connected changes nothing.
      return () => observer.disconnect();
    },
    // Stryker disable next-line ArrayDeclaration: the refs are the same objects for the popup's life, so the effect runs once whatever its dependencies.
    [input, list],
  );
  return null;
}

/** The popup under (or over) the input, on wider screens and with a mouse. */
function Popup({ input, loading, children }: { input: RefObject<HTMLElement | null>; loading: boolean | undefined; children: ReactNode }): JSX.Element {
  const portal = usePortalContainer("Combobox", true);
  const list = useRef<HTMLDivElement>(null);
  const positionerRef = useMergedRef(markPopupDismiss, list);
  // Inside a Dialog its own layers sit at z-1000; 1000 above --ouro-layer clears them there and
  // on the page, as Select's list does.
  return (
    <BaseCombobox.Portal {...portal} data-ouro="combobox-portal" className="relative isolate z-[calc(var(--ouro-layer)+1000)]">
      <PortalScope>
        <KeepPageExposed input={input} list={list} />
        <BaseCombobox.Positioner ref={positionerRef} sideOffset={() => parseFloat(getComputedStyle(document.documentElement).fontSize) / 2} positionMethod={floatingPositionMethod} className="outline-none">
          <BaseCombobox.Popup data-ouro="combobox-popup" aria-busy={loading || undefined} className={popupClass}>
            {children}
          </BaseCombobox.Popup>
        </BaseCombobox.Positioner>
      </PortalScope>
    </BaseCombobox.Portal>
  );
}

/**
 * The end of the box: the clear button, while there is something to clear, and a chevron.
 * The chevron is drawn, not a button: pressing anywhere in the box opens the list, and the
 * arrow keys open it from the keyboard. (Base UI gives a trigger button the input's id on the
 * server, so a server-rendered page would hold that id twice.)
 */
function EndButtons({ clearLabel, readOnly }: { clearLabel: string; readOnly: boolean | undefined }): JSX.Element {
  return (
    <span className={endSlotClass}>
      {!readOnly && (
      <BaseCombobox.Clear
        render={
          <Button variant="plain" tone="secondary" size="sm" data-ouro-combobox-clear="" data-ouro-control="combobox" data-ouro-part="clear" className="aspect-square px-0">
            <CrossIcon />
            <span className="sr-only">{clearLabel}</span>
          </Button>
        }
      />
      )}
      <BaseCombobox.Icon data-ouro-combobox-icon="" className="flex size-ouro-8 items-center justify-center text-muted-foreground sm:pointer-fine:size-ouro-6">
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
  const { loadingLabel, emptyLabel, empty, clearLabel, doneLabel, closeLabel, removeLabel, customValueLabel, custom, tokens, inputRef, sheet } = props;
  const { autoHighlight, onInputKeyDown, readOnly, inputValue, resultsFor, disabled } = props;
  const field = useField()!;
  // Ouro's own invalid state (the error prop or the Form's error for this name), not Base UI's,
  // which would count it as a failed check and block the next submit.
  const invalid = field.invalid;
  // The input's text: for the "nothing matched" line and the row that keeps typed text.
  const [text, setText] = useState("");
  const queryAware = resultsFor !== undefined && !custom && !tokens;
  const currentText = inputValue ?? text;
  const stale = queryAware && (resultsFor === null || normalized(resultsFor) !== normalized(currentText));
  const [pending, setPending] = useState<string | null>(null);
  const [ownValue, setOwnValue] = useState(defaultValue);
  const selected = value === undefined ? ownValue : value;
  const selectedValues: string[] = Array.isArray(selected) ? selected : [];
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
  // A token input keeps its own chips unless the app controls them, so typed text can join them.
  const [ownTokens, setOwnTokens] = useState(() => (defaultValue as string[] | undefined) ?? []);
  // The chips: read only by a token input, the one mode whose value is the app's array or its own.
  const picked = (value as string[] | undefined) ?? ownTokens;
  const typed = text.trim();
  // With allowCustomValue, typed text that is not an item gets a row of its own, first: on a
  // token input, only in the sheet, and only for text no item or chip already holds.
  const offerTyped =
    typed !== "" &&
    (tokens
      ? sheet && ![...options, ...picked.map(toSelected)].some((option) => normalized(option.label) === normalized(typed))
      : custom && !options.some((option) => option.label === typed));
  const available = queryAware && multiple ? options.filter((option) => !selectedValues.includes(option.value)) : options;
  const listed = stale || (queryAware && loading) ? [] : offerTyped ? [{ value: typed, label: customValueLabel(typed), custom: true }, ...available] : available;
  const shown = (option: Option) => (option.custom ? option.value : option.label);

  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const resetInputRef = useRef<HTMLInputElement>(null);
  const setInputRef = useMergedRef(inputRef, resetInputRef);
  // Combobox always passes its own handler, which calls the app's.
  const report = onValueChange as (value: string | string[] | null) => void;
  // The item highlighted in the list, so Enter knows whether to pick it or keep the typed text.
  const [highlighted, setHighlighted] = useState(false);

  /**
   * Sets a token input's chips, leaving out a chip whose label is already there ignoring case.
   * @claim "Sets a token input's chips" registry/ouro/components/ouro/combobox/combobox.test.tsx verify:testExists(registry/ouro/components/ouro/combobox/combobox.test.tsx::Combobox multiple allowCustomValue > picks the item that typed text matches ignoring case, so no duplicate chip appears)
   */
  const setTokens = (next: string[]) => {
    const values: string[] = [];
    for (const chip of next) {
      if (!values.some((kept) => normalized(toSelected(kept).label) === normalized(toSelected(chip).label))) values.push(chip);
    }
    if (values.length === picked.length && values.every((chip, index) => chip === picked[index])) return;
    // Kept even when the app controls the chips, where `value` wins over it.
    setOwnTokens(values);
    report(values);
  };
  /**
   * Makes typed text chips, one per comma-separated entry: an entry becomes the item whose label it
   * matches ignoring case, nothing when that item is disabled, or else itself with its spaces tidied.
   * False when there is nothing to add.
   */
  const addTyped = (entered: string) => {
    const entries = entered.split(",").filter((entry) => entry.trim() !== "");
    if (readOnly || entries.length === 0) return false;
    const chips: string[] = [];
    for (const entry of entries) {
      const text = entry.trim().replace(/\s+/g, " ");
      const item = options.find((option) => normalized(option.label) === normalized(text));
      if (item?.disabled) continue;
      chips.push(item ? item.value : text);
    }
    setTokens([...picked, ...chips]);
    return true;
  };
  const setTyped = (next: string) => {
    setText(next);
    onInputChange?.(next);
  };
  const finishPending = useEffectEvent(() => {
    if (!open || readOnly || disabled || !queryAware || normalized(currentText) !== pending) {
      setPending(null);
      return;
    }
    if (stale || loading) return;
    setPending(null);
    const first = options.find((option) => !option.disabled && !selectedValues.includes(option.value));
    if (!first) return;
    const next = multiple ? [...selectedValues, first.value] : first.value;
    setOwnValue(next);
    setTyped(multiple ? "" : first.label);
    report(next);
    if (!multiple) setOpen(false);
  });
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) finishPending(); });
    return () => { cancelled = true; };
  }, [pending, open, readOnly, disabled, queryAware, currentText, stale, loading, options, selected]);
  const busy = loading || pending !== null;
  useCustomReset(
    sheet ? triggerRef : resetInputRef,
    tokens ? picked : value,
    tokens && value === undefined ? () => setTokens((defaultValue as string[] | undefined) ?? []) : props.onReset,
  );
  const tokenHandlers = tokens
    ? {
        onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
          onInputKeyDown?.(event);
          // Enter with no suggestion highlighted makes the typed text a chip, and leaves an empty input's Enter to the form.
          if (event.defaultPrevented || event.key !== "Enter" || event.nativeEvent.isComposing || (open && highlighted)) return;
          if (addTyped(event.currentTarget.value)) {
            event.preventDefault();
            setTyped("");
          }
        },
        onPaste: (event: ClipboardEvent<HTMLInputElement>) => {
          const pasted = event.clipboardData.getData("text/plain");
          if (!pasted.includes(",")) return;
          event.preventDefault();
          // A text input always has a selection, so neither end is null.
          const input = event.currentTarget;
          if (addTyped(input.value.slice(0, input.selectionStart!) + pasted + input.value.slice(input.selectionEnd!))) setTyped("");
        },
      }
    : {
        onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
          onInputKeyDown?.(event);
          if (event.defaultPrevented) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") setPending(null);
          if (!queryAware || !autoHighlight || readOnly || disabled || event.key !== "Enter" ||
            event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
            !event.currentTarget.value.trim() || (!stale && !loading)) return;
          event.preventDefault();
          setPending(normalized(event.currentTarget.value));
          setOpen(true);
        },
      };
  // The sheet's clear button, beside the field for a single pick that can change.
  // Stryker disable next-line ConditionalExpression,LogicalOperator,BooleanLiteral: the sheet shows only on a coarse-pointer phone, which the Chromium project mutation runs in cannot be; combobox.touch.test.tsx holds a read-only field's missing clear button there.
  const sheetClear = !multiple && !readOnly;
  const showEmpty = !onInputChange || (inputValue ?? text) !== "";

  // A picked item's chip, in the desktop box or beside the button on a phone. On a phone its
  // remove button is in the Tab order, since no input is there to arrow into the chips from, and
  // removing puts focus back on the button.
  const renderChip = (option: Option) => (
    // Base UI marks a read-only field's chips aria-readonly, which a chip (no role) may
    // not carry; the input's readonly already says it. On a phone the chip leaves keys to the
    // browser: Base UI's arrow keys lead to an input that is not there, and its Tab handling
    // puts focus back on the chip, so Tab would never leave it.
    <BaseCombobox.Chip
      key={option.value}
      data-ouro-combobox-chip=""
      className={chipClass}
      render={(chip) => <div {...chip} aria-readonly={undefined} onKeyDown={sheet ? undefined : chip.onKeyDown} />}
    >
      {option.media != null && (
        <div data-ouro-combobox-chip-media="" className="-ms-1 flex shrink-0">
          {option.media}
        </div>
      )}
      <span>{option.label}</span>
      {!readOnly && (
        <BaseCombobox.ChipRemove
          data-ouro-combobox-chip-remove=""
          data-ouro-control="combobox"
          data-ouro-part="chip-remove"
          className={chipRemoveClass}
          {...(sheet ? { tabIndex: 0, onClick: () => triggerRef.current!.focus() } : {})}
        >
          <TouchTarget />
          <CrossIcon className="size-ouro-3_5" />
          <span className="sr-only">{removeLabel(option.label)}</span>
        </BaseCombobox.ChipRemove>
      )}
    </BaseCombobox.Chip>
  );

  const renderItem = (option: Option) => (
    <BaseCombobox.Item key={option.value} value={option} disabled={option.disabled} data-ouro-control="combobox" data-ouro-part="option" className={itemClass}>
      <BaseCombobox.ItemIndicator className="col-start-1 flex">
        <Icon>
          <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
        </Icon>
      </BaseCombobox.ItemIndicator>
      <ItemContent option={option} />
    </BaseCombobox.Item>
  );
  const body = (className: string) => (
    <ListBody
      loading={busy}
      loadingLabel={loadingLabel}
      emptyLabel={emptyLabel}
      empty={empty}
      showEmpty={showEmpty && !stale}
      className={className}
      renderItem={renderItem}
    />
  );

  const input = (className: string, extra: { "aria-label"?: string } = {}) => (
    <BaseCombobox.Input
      {...extra}
      {...inputHandlers(tokenHandlers.onKeyDown)}
      onPaste={tokenHandlers.onPaste}
      onBlur={() => setPending(null)}
      readOnly={readOnly}
      ref={setInputRef}
      data-ouro-control="combobox"
      data-ouro-part="input"
      placeholder={placeholder}
      aria-busy={busy || undefined}
      aria-describedby={sheet ? undefined : field.describedBy}
      {...(invalid && !sheet ? { "aria-invalid": true } : {})}
      className={className}
    />
  );

  const directed = (
    <BaseCombobox.Root
      items={listed}
      multiple={multiple}
      isItemEqualToValue={(item: Option, picked: Option) => item.value === picked.value}
      itemToStringLabel={shown}
      filter={onInputChange ? null : tokens ? (option: Option, query: string) => option.custom || normalized(option.label).includes(normalized(query)) : undefined}
      onInputValueChange={(next, details) => {
        // On a token input a comma ends a chip: what comes before it becomes chips.
        const comma = tokens ? next.lastIndexOf(",") : -1;
        // Stryker disable next-line EqualityOperator: a comma first leaves no text before it, which addTyped turns down, the same as no comma.
        if (comma >= 0 && addTyped(next.slice(0, comma))) {
          setTyped(next.slice(comma + 1).trimStart());
          return;
        }
        setText(next);
        setPending(null);
        if (details.reason !== "item-press") onInputChange?.(next);
      }}
      onItemHighlighted={(option: Option | undefined) => setHighlighted(option !== undefined)}
      // Stryker disable next-line ConditionalExpression: the other modes' uncontrolled input shows the same text that onInputValueChange keeps in step.
      inputValue={tokens || (queryAware && multiple) ? currentText : inputValue}
      autoHighlight={autoHighlight}
      readOnly={readOnly}
      required={required}
      inputRef={markInput}
      openOnInputClick
      open={open}
      onOpenChange={(next: boolean, details: { reason: string }) => {
        // An inline trigger closes Base UI's always-open list; its own click opens our sheet.
        if (!sheet || details.reason !== "trigger-press") setOpen(next);
      }}
      {...(tokens ? { value: toBase(picked) } : queryAware ? { value: toBase(selected) } : value !== undefined ? { value: toBase(value) } : { defaultValue: toBase(defaultValue) })}
      onValueChange={(next: Option | Option[] | null) => {
        if (tokens) setTokens((next as Option[]).map((option) => option.value));
        else {
          const picked = Array.isArray(next) ? next.map((option) => option.value) : (next?.value ?? (custom ? "" : null));
          setOwnValue(picked);
          report(picked);
        }
      }}
      {...(sheet
        ? {
            inline: true,
          }
        : {})}
    >
      {sheet ? (
        <div data-ouro-combobox-field="" className={multiple ? sheetChipsFieldClass : sheetFieldClass}>
          <BaseCombobox.Trigger
            ref={triggerRef}
            aria-describedby={field.describedBy}
            {...(invalid ? { "aria-invalid": true } : {})}
            data-ouro-combobox-trigger=""
            data-ouro-control="combobox"
            data-ouro-part="trigger"
            className={multiple ? sheetChipsTriggerClass : triggerClass}
            // With an inline list there is no Base UI popup for the trigger to open: it opens the sheet.
            onClick={() => setOpen(true)}
          >
            <BaseCombobox.Value placeholder={placeholder}>
              {(picked: Option | Option[] | null) => {
                // With multiple the chips beside the button show the picks: the button shows only the placeholder.
                if (Array.isArray(picked)) return <span>{picked.length > 0 ? null : placeholder}</span>;
                return <span>{picked ? shown(picked) : placeholder}</span>;
              }}
            </BaseCombobox.Value>
            <ChevronIcon />
          </BaseCombobox.Trigger>
          {multiple && (
            // Beside the button, over it, not in it: a button can't hold the chips' remove buttons.
            // A tap on a chip's label goes through to the button, which opens the sheet.
            // Not a toolbar, as Base UI makes it: Tab, not the arrow keys, moves between the remove buttons.
            <BaseCombobox.Chips data-slot="combobox-chips" data-ouro-combobox-chips="" className={sheetChipsClass} render={(chips) => <div {...chips} role={undefined} />}>
              <BaseCombobox.Value>{(picked: Option[]) => picked.map(renderChip)}</BaseCombobox.Value>
            </BaseCombobox.Chips>
          )}
          {sheetClear && (
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
            closeLabel={closeLabel}
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
                      {picked.map(renderChip)}
                      <div data-slot="combobox-input-row" className="flex min-w-32 flex-1 items-center">
                        {input(chipsInputClass)}
                        <EndButtons clearLabel={clearLabel} readOnly={readOnly} />
                      </div>
                    </>
                  )}
                </BaseCombobox.Value>
              </BaseCombobox.Chips>
            ) : (
              input(inputClass)
            )}
            {!multiple && <EndButtons clearLabel={clearLabel} readOnly={readOnly} />}
          </BaseCombobox.InputGroup>
          <Popup input={resetInputRef} loading={busy}>{body(listClass)}</Popup>
        </>
      )}
    </BaseCombobox.Root>
  );
  // The input decides the direction: a right-to-left page's arrow keys move between its chips from the right.
  return <PageDirection of={resetInputRef}>{directed}</PageDirection>;
}

/** A Combobox that accepts any text, on Base UI Autocomplete. */
function AutocompleteControl(props: ControlProps): JSX.Element {
  const { items, value, onValueChange, onInputChange, placeholder, required, loading } = props;
  const { loadingLabel, emptyLabel, empty, clearLabel, inputRef, autoHighlight, onInputKeyDown, readOnly } = props;
  const field = useField()!;
  // Ouro's own invalid state (the error prop or the Form's error for this name), not Base UI's,
  // which would count it as a failed check and block the next submit.
  const invalid = field.invalid;
  const suggestions = useMemo(() => items.map((item) => toOption(item)), [items]);
  const report = onValueChange as ((value: string) => void) | undefined;
  const resetInputRef = useRef<HTMLInputElement>(null);
  const setInputRef = useMergedRef(inputRef, resetInputRef);
  useCustomReset(resetInputRef, value, props.onReset);
  const directed = (
    <BaseAutocomplete.Root
      items={suggestions}
      inputRef={markInput}
      itemToStringValue={(option: Option) => option.label}
      filter={onInputChange ? null : undefined}
      autoHighlight={autoHighlight}
      readOnly={readOnly}
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
          {...inputHandlers(onInputKeyDown)}
          readOnly={readOnly}
          ref={setInputRef}
          data-ouro-control="combobox"
          data-ouro-part="input"
          placeholder={placeholder}
          aria-describedby={field.describedBy}
          {...(invalid ? { "aria-invalid": true } : {})}
          className={inputClass}
        />
        <EndButtons clearLabel={clearLabel} readOnly={readOnly} />
      </BaseAutocomplete.InputGroup>
      <Popup input={resetInputRef} loading={loading}>
        <ListBody
          loading={loading}
          loadingLabel={loadingLabel}
          emptyLabel={emptyLabel}
          empty={empty}
          showEmpty={!onInputChange || value !== ""}
          className={listClass}
          renderItem={(option) => (
            <BaseAutocomplete.Item key={option.value} value={option} disabled={option.disabled} data-ouro-control="combobox" data-ouro-part="option" className={itemClass}>
              <ItemContent option={option} />
            </BaseAutocomplete.Item>
          )}
        />
      </Popup>
    </BaseAutocomplete.Root>
  );
  // End scrolls the input to its end, which in a right-to-left input is a negative scrollLeft.
  return <PageDirection of={resetInputRef}>{directed}</PageDirection>;
}
