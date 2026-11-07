"use client";

import { Select as BaseSelect } from "@base-ui/react/select";
import { useMemo, type JSX, type ReactNode, type Ref } from "react";
import { Field } from "~/components/ouro/field/field";
import { contractWarnings } from "~/components/ouro/field/field-styles";
import { SelectGroup, SelectItem, SelectListScope } from "~/components/ouro/select/select-parts";
import {
  backdropClass,
  flattenOptions,
  isGroup,
  popupClass,
  positionerClass,
  sheetQuery,
  sheetTitleClass,
  triggerClass,
  type SelectOptions,
} from "~/components/ouro/select/select-styles";
import { controlRef } from "~/lib/ouro/control-ref";
import { FieldOwnerContext, useField, useFormErrors, type ReadonlyErrorMessages } from "~/lib/ouro/use-field";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { useMediaQuery } from "~/lib/ouro/use-media-query";
import { PortalScope, usePortalContainer } from "~/lib/ouro/portal-container";

export type { SelectOption, SelectOptionGroup, SelectOptions } from "~/components/ouro/select/select-styles";

/**
 * Props every Select takes, whether it picks one value or several.
 *
 * @claim "Props every Select takes, whether it" registry/ouro/components/ouro/select/select.test.tsx verify:testExists(registry/ouro/components/ouro/select/select.test.tsx::Select > picks several values with multiple, as a string array)
 * @claim "Props every Select takes, whether it" registry/ouro/components/ouro/select/select.test.tsx verify:testExists(registry/ouro/components/ouro/select/select.test.tsx::Select > chooses an option, shows its label and submits its value)
 */
export interface SelectBaseProps {
  /**
   * What the select is for, shown above it and read as its name. Required: every control
   * needs a name. To hide it visually, keep it and add `hideLabel`. On phones it also heads the list.
   * @claim "Required: every control needs a name" registry/ouro/components/ouro/select/select.test-d.ts verify:fileLine(registry/ouro/components/ouro/select/select.test-d.ts, /expectTypeOf<\{\soptions:\stypeof\scourses\s\}>\(\)\.not\.toExtend<SelectProps>/)
   */
  label: string;
  /** Hides the label visually; screen readers still read it as the select's name. */
  hideLabel?: boolean | undefined;
  /** Supporting text under the label, read after the label through `aria-describedby`. */
  description?: ReactNode | undefined;
  /**
   * What is wrong, from your server action or client check. The message (or several, as a
   * list) shows under the select, which gets `aria-invalid`. A message is text or a React node (one with a link); an empty string or array means valid.
   */
  error?: ReadonlyErrorMessages | undefined;
  /** A choice is required: the form will not submit without one, and the label gets a marker. */
  required?: boolean | undefined;
  /** Disables the select and fades it. */
  disabled?: boolean | undefined;
  /** The value can be seen but not changed. */
  readOnly?: boolean | undefined;
  /**
   * The form field name the value submits under. With `multiple`, each value submits under it.
   *
   * @claim "With `multiple`, each value submits under" registry/ouro/components/ouro/select/select.test.tsx verify:testExists(registry/ouro/components/ouro/select/select.test.tsx::Select > posts one entry per chosen value under its name with multiple, for formData.getAll)
   */
  name?: string | undefined;
  /** Shown in the trigger while nothing is chosen: `"Choose a course"`. It is not a label. */
  placeholder?: string | undefined;
  /**
   * The choices: `[{ value: "main", label: "Main" }]`, and groups as
   * `{ label: "Fruit", options: [...] }`. Pass `SelectItem` children instead when an option
   * needs more than text.
   */
  options?: SelectOptions | undefined;
  /** `SelectItem`s and `SelectGroup`s, when you do not pass `options`. */
  children?: ReactNode;
  /** Autofill hint for the hidden input that submits the value, such as `"country"`. */
  autoComplete?: string | undefined;
  /** The id of a form outside which the select sits, so its value submits with that form. */
  form?: string | undefined;
  /**
   * Layout only: margins, width, grid placement (`mt-4`, `col-span-2`). Appearance classes
   * warn in development; style fields in your theme.
   */
  className?: string | undefined;
  /** The trigger button. */
  ref?: Ref<HTMLButtonElement> | undefined;

  /** Not a prop. Select calls `onValueChange` with the value: `<Select onValueChange={(value) => setCourse(value)}>`. */
  onChange?: { 'Use onValueChange={(value) => ...}': never };
  /** Not a prop. Ouro UI uses `multiple`: `<Select multiple>`. */
  isMulti?: { 'Use <Select multiple>': never };
  /** Not a prop. Ouro UI uses `options`: `<Select options={[{ value: "main", label: "Main" }]}>`. */
  items?: { 'Use options={[{ value: "main", label: "Main" }]}': never };
  /** Not a prop. Ouro UI uses `error`: `<Select error="Required.">`. */
  errorMessage?: { 'Use <Select error="Required.">': never };
  /** Not a prop. Ouro UI uses `description`: `<Select description="...">`. */
  helperText?: { 'Use <Select description="...">': never };
  /** Not a prop. `error` marks the select invalid: `<Select error="What is wrong">`. */
  isInvalid?: { 'Use <Select error="What is wrong">': never };
  /** Not a prop. `error` marks the select invalid: `<Select error="What is wrong">`. */
  invalid?: { 'Use <Select error="What is wrong">': never };
  /** Not a prop. Ouro UI uses `required`: `<Select required>`. */
  isRequired?: { 'Use <Select required>': never };
  /** Not a prop. Ouro UI uses `disabled`: `<Select disabled>`. */
  isDisabled?: { 'Use <Select disabled>': never };
}

/** A Select that picks one value: a `string`, or `null` while nothing is chosen. */
export type SelectSingleProps = SelectBaseProps & {
  /** Pick several values: the list stays open while the user chooses, and the value is a `string[]` instead of `string | null`. */
  multiple?: false | undefined;
  /**
   * The chosen value, when you control it: a `string`, or `null` for none; with `multiple`, a `string[]`.
   *
   * @claim "The chosen value, when you control" registry/ouro/components/ouro/select/select.test-d.ts verify:fileLine(registry/ouro/components/ouro/select/select.test-d.ts, /\{\slabel:\s"Tags";\smultiple:\strue;\svalue:\s"quick"\s\}>\(\)\.not\.toExtend<SelectProps>/)
   */
  value?: string | null | undefined;
  /** The value chosen at first, when the select keeps its own state: a `string` or `null`; with `multiple`, a `string[]`. */
  defaultValue?: string | null | undefined;
  /**
   * Called with the new value when the user chooses an option: a `string` or `null`; with `multiple`, every chosen value as a `string[]`.
   *
   * @claim "Called with the new value when" registry/ouro/components/ouro/select/select.test.tsx verify:testExists(registry/ouro/components/ouro/select/select.test.tsx::Select > chooses an option, shows its label and submits its value)
   * @claim "Called with the new value when" registry/ouro/components/ouro/select/select.test.tsx verify:testExists(registry/ouro/components/ouro/select/select.test.tsx::Select > picks several values with multiple, as a string array)
   */
  onValueChange?: ((value: string | null) => void) | undefined;
};

/** A Select that picks several values, as a `string[]`. */
export type SelectMultipleProps = SelectBaseProps & {
  /** Pick several values: the list stays open while the user chooses, and the value is a `string[]` instead of `string | null`. */
  multiple: true;
  /**
   * The chosen value, when you control it: a `string`, or `null` for none; with `multiple`, a `string[]`.
   *
   * @claim "The chosen value, when you control" registry/ouro/components/ouro/select/select.test-d.ts verify:fileLine(registry/ouro/components/ouro/select/select.test-d.ts, /\{\slabel:\s"Tags";\smultiple:\strue;\svalue:\s"quick"\s\}>\(\)\.not\.toExtend<SelectProps>/)
   */
  value?: string[] | undefined;
  /** The value chosen at first, when the select keeps its own state: a `string` or `null`; with `multiple`, a `string[]`. */
  defaultValue?: string[] | undefined;
  /**
   * Called with the new value when the user chooses an option: a `string` or `null`; with `multiple`, every chosen value as a `string[]`.
   *
   * @claim "Called with the new value when" registry/ouro/components/ouro/select/select.test.tsx verify:testExists(registry/ouro/components/ouro/select/select.test.tsx::Select > chooses an option, shows its label and submits its value)
   * @claim "Called with the new value when" registry/ouro/components/ouro/select/select.test.tsx verify:testExists(registry/ouro/components/ouro/select/select.test.tsx::Select > picks several values with multiple, as a string array)
   */
  onValueChange?: ((value: string[]) => void) | undefined;
};

/** Props for {@link Select}: `multiple` switches the value from `string | null` to `string[]`. */
export type SelectProps = SelectSingleProps | SelectMultipleProps;

/** Field's messages and root name Select; its label is a `<div>` that names the trigger. */
const owner = { name: "Select", data: "select", nativeLabel: false as const };
/** Marks the hidden input Base UI submits the value with. */
const markInput = controlRef("select", "hidden-input");

/**
 * A chevron pointing up and down, drawn in the muted text color at 16px.
 *
 * @claim "A chevron pointing up and down" registry/ouro/components/ouro/select/select.tsx verify:fileLine(registry/ouro/components/ouro/select/select.tsx, /viewBox="0\s0\s16\s16"\sfill="none"\sstroke="currentColor"/)
 */
function ChevronIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 6.5L8 3.5l3 3M5 9.5l3 3 3-3" />
    </svg>
  );
}

/** The parts of Select that read the Field it sits in. */
function SelectControl({
  props,
  items,
}: {
  props: SelectProps;
  items: Array<{ value: string; label: ReactNode }>;
}): JSX.Element {
  const { label, required, disabled, readOnly, name, placeholder, options, children, autoComplete, form: formId, ref, multiple, value, defaultValue, onValueChange } =
    props as SelectBaseProps & {
      multiple?: boolean;
      value?: string | string[] | null;
      defaultValue?: string | string[] | null;
      onValueChange?: (value: string | string[] | null) => void;
    };
  const field = useField()!;
  const form = useFormErrors();
  // Phones (below sm, with a coarse pointer) get the list as a bottom sheet. The list only
  // renders open, after hydration, so the server's answer never shows.
  const sheet = useMediaQuery(sheetQuery, false);
  const presentation = sheet ? "sheet" : undefined;

  // Choosing a value drops a Form error for this name, as typing does in a text field.
  const handleValueChange = (next: string | string[] | null) => {
    if (name !== undefined) form?.clear(name);
    onValueChange?.(next);
  };

  const portal = usePortalContainer("Select");
  return (
    <BaseSelect.Root<string, boolean>
      items={items}
      multiple={multiple}
      {...(value !== undefined ? { value } : {})}
      {...(defaultValue !== undefined ? { defaultValue } : {})}
      onValueChange={handleValueChange}
      name={name}
      required={required}
      disabled={disabled}
      readOnly={readOnly}
      autoComplete={autoComplete}
      form={formId}
      inputRef={markInput}
    >
      <BaseSelect.Trigger
        ref={ref}
        data-ouro-control="select"
        data-ouro-part="trigger"
        className={triggerClass}
        aria-labelledby={field.labelId}
        aria-describedby={field.describedBy}
        aria-invalid={field.invalid || undefined}
      >
        <BaseSelect.Value placeholder={placeholder} className="min-w-0 flex-1 truncate" />
        <ChevronIcon />
      </BaseSelect.Trigger>
      {/* Base UI puts the portal inside a Dialog's or Sheet's portal when the Select is in one, where
          the dialog's layers sit at z-1000; 1000 above --ouro-layer clears them there and on the page. */}
      <BaseSelect.Portal {...portal} data-ouro="select-portal" className="relative isolate z-[calc(var(--ouro-layer)+1000)]">
        <PortalScope>
          {sheet && <BaseSelect.Backdrop data-ouro="select-backdrop" className={backdropClass} />}
          <BaseSelect.Positioner
            className={positionerClass}
            sideOffset={4}
            collisionPadding={8}
            alignItemWithTrigger={!sheet}
            data-ouro-presentation={presentation}
          >
            <BaseSelect.Popup className={popupClass} data-ouro="select-popup" data-ouro-presentation={presentation}>
              {sheet && (
                <div aria-hidden="true" className={sheetTitleClass}>
                  {label}
                </div>
              )}
              <BaseSelect.List className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                <SelectListScope>
                  {options
                    ? options.map((entry) =>
                        isGroup(entry) ? (
                          <SelectGroup key={`group:${entry.label}`} label={entry.label}>
                            {entry.options.map((option) => (
                              <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        ) : (
                          <SelectItem key={entry.value} value={entry.value} disabled={entry.disabled}>
                            {entry.label}
                          </SelectItem>
                        ),
                      )
                    : children}
                </SelectListScope>
              </BaseSelect.List>
            </BaseSelect.Popup>
          </BaseSelect.Positioner>
        </PortalScope>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}

/**
 * A labeled list of choices on the Field contract: pass `label`, `options` (or `SelectItem`
 * children) and `error` from your server action or client check. With `multiple` the value
 * is a `string[]`. On a phone the list opens as a bottom sheet you scroll with your thumb;
 * elsewhere it opens next to the trigger, over the chosen option. It submits its value under
 * `name` in a plain form post. Covers Catalyst's Listbox.
 *
 * A `multiple` Select posts one entry per chosen value, all under `name`, in the order they
 * were chosen, and no entry when nothing is chosen: read them with
 * `formData.getAll("tags")`, not `formData.get`. In a test, open the list and choose an
 * option with real pointer events (`userEvent.click` in Vitest browser mode, `locator.click()`
 * in Playwright): the options act on pointer events, so a synthetic `fireEvent.click`
 * chooses nothing.
 *
 * Use `NativeSelect` instead for the operating system's own picker (long lists of plain
 * text on phones, such as countries), `RadioGroup` for two to five choices that should all
 * show, and `Combobox` when the user needs to type to filter.
 *
 * @group Forms
 * @see https://ui.ouro.bot/docs/select
 *
 * @example
 * <Select
 *   label="Course"
 *   name="course"
 *   placeholder="Choose a course"
 *   options={[{ value: "starter", label: "Starter" }, { value: "main", label: "Main" }]}
 *   error={errors?.course}
 * />
 * <Select label="Tags" name="tags" multiple defaultValue={["quick"]} options={tags} />
 * @claim "A `multiple` Select posts one entry" registry/ouro/components/ouro/select/select.test.tsx verify:testExists(registry/ouro/components/ouro/select/select.test.tsx::Select > posts one entry per chosen value under its name with multiple, for formData.getAll)
 */
export function Select(props: SelectProps): JSX.Element {
  const {
    label,
    hideLabel,
    description,
    error,
    required,
    disabled,
    name,
    options,
    children,
    className,
    // Guard props (hint types), never passed on.
    onChange,
    isMulti,
    items: itemsGuess,
    errorMessage,
    helperText,
    isInvalid,
    invalid,
    isRequired,
    isDisabled,
  } = props;

  const hasChildren = children !== undefined && children !== null && children !== false;
  useDevWarnings(
    "Select",
    process.env.NODE_ENV !== "production"
      ? () => [
          onChange !== undefined && ["onChange is not a prop; Select calls onValueChange with the value", "<Select onValueChange={(value) => setValue(value)}>"],
          isMulti !== undefined && ["isMulti is not a prop", "<Select multiple>"],
          itemsGuess !== undefined && ["items is not a prop", '<Select options={[{ value: "main", label: "Main" }]}>'],
          ...contractWarnings("Select", { errorMessage, helperText, isInvalid, invalid, isRequired, isDisabled }),
          options !== undefined &&
            hasChildren && ["options and children are both set, so the children are ignored", `<Select label="${label}" options={options} />`],
          options === undefined &&
            !hasChildren && ["there are no options to choose from", `<Select label="${label}" options={[{ value: "main", label: "Main" }]} />`],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );

  // The trigger shows the chosen option's label, so Select needs every value's label up front.
  const items = useMemo(() => flattenOptions(options, options ? undefined : children, SelectItem), [options, children]);

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
        <SelectControl props={props} items={items} />
      </Field>
    </FieldOwnerContext.Provider>
  );
}
