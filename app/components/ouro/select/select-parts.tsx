"use client";

import { Select as BaseSelect } from "@base-ui/react/select";
import { createContext, useContext, type JSX, type ReactNode } from "react";
import { devThrow } from "~/lib/ouro/dev";
import { groupLabelClass, itemClass, itemIndicatorClass } from "~/components/ouro/select/select-styles";

/** Whether a part is inside a Select's list. */
const SelectListContext = createContext(false);

/** The JSX a part belongs in, for the dev message when it is not there. */
const SHAPE = '<Select label="Fruit"><SelectItem value="apple">Apple</SelectItem></Select>';

/** Throws in development, with the JSX the part belongs in, outside a Select. */
function useSelectPart(part: string): void {
  if (!useContext(SelectListContext)) {
    devThrow(
      part,
      "must be rendered inside <Select>",
      process.env.NODE_ENV !== "production" ? SHAPE : /* istanbul ignore next @preserve -- production only */ "",
    );
  }
}

/**
 * Marks Select's list, so the parts know they are in place.
 *
 * @internal For `Select`; apps use `Select`.
 */
export function SelectListScope({ children }: { children: ReactNode }): JSX.Element {
  return <SelectListContext.Provider value>{children}</SelectListContext.Provider>;
}

/** Props for {@link SelectItem}. */
export interface SelectItemProps {
  /** What the form submits and `onValueChange` receives when this option is chosen. */
  value: string;
  /** What the list and the trigger show: text, or text with an icon. */
  children: ReactNode;
  /** The option shows but cannot be chosen. */
  disabled?: boolean | undefined;
  /**
   * The text typing a letter matches, when `children` is not plain text:
   * `label="Apple"` for `<><AppleIcon /> Apple</>`.
   */
  label?: string | undefined;
}

/** A check mark, drawn in the text color at 16px. */
function CheckIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8.5l3.5 3.5L13 4.5" />
    </svg>
  );
}

/**
 * Part: one option in a `Select`, for options that need more than text (an icon, a color
 * swatch). Pass `options` to `Select` instead when every option is text; it renders these
 * for you.
 *
 * @example
 * <Select label="Course" name="course">
 *   <SelectItem value="starter">Starter</SelectItem>
 *   <SelectItem value="main">Main</SelectItem>
 * </Select>
 */
export function SelectItem({ value, children, disabled, label }: SelectItemProps): JSX.Element {
  useSelectPart("SelectItem");
  return (
    <BaseSelect.Item value={value} disabled={disabled} label={label} className={itemClass}>
      <BaseSelect.ItemIndicator className={itemIndicatorClass}>
        <CheckIcon />
      </BaseSelect.ItemIndicator>
      <BaseSelect.ItemText className="col-start-2 min-w-0">{children}</BaseSelect.ItemText>
    </BaseSelect.Item>
  );
}

/** Props for {@link SelectGroup}. */
export interface SelectGroupProps {
  /** The group's heading, which also names the group for screen readers. */
  label: string;
  /** The group's `SelectItem`s. */
  children: ReactNode;
}

/**
 * Part: a labeled group of `SelectItem`s. With `options`, pass a group as
 * `{ label: "Fruit", options: [...] }` instead.
 *
 * @example
 * <Select label="Produce" name="produce">
 *   <SelectGroup label="Fruit">
 *     <SelectItem value="apple">Apple</SelectItem>
 *   </SelectGroup>
 * </Select>
 */
export function SelectGroup({ label, children }: SelectGroupProps): JSX.Element {
  useSelectPart("SelectGroup");
  return (
    <BaseSelect.Group className="block py-0.5">
      <BaseSelect.GroupLabel className={groupLabelClass}>{label}</BaseSelect.GroupLabel>
      {children}
    </BaseSelect.Group>
  );
}
