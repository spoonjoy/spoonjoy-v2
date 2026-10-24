"use client";

import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { createContext, useContext, useId, type JSX, type ReactNode, type Ref } from "react";
import { boxClass, indicatorClass, tickClass } from "~/components/ouro/checkbox/checkbox-styles";
import {
  actionClass,
  descriptionClass,
  groupDescriptionClass,
  groupLabelClass,
  headerClass,
  hitClass,
  labelClass,
  rootClass,
  rowClass,
  rowInnerClass,
  rowsClass,
  strikeClass,
  textClass,
  valueClass,
} from "~/components/ouro/checklist/checklist-styles";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { controlRef } from "~/lib/ouro/control-ref";
import { devThrow } from "~/lib/ouro/dev";

const ChecklistContext = createContext(false);

/** Marks the hidden input that Base UI submits a box with. */
const markInput = controlRef("checklist", "hidden-input");

/** The className hint for the parts: their look comes from the theme. */
const ownLook = (part: string) => `<${part}>, styled through your theme's tokens; className takes layout only`;

/** Props for {@link ChecklistRoot}. */
export interface ChecklistRootProps {
  /** What the list is, shown above the rows and read as the group's name. Required: a group needs a name. */
  label: string;
  /** Hides the label visually; screen readers still read it as the group's name. */
  hideLabel?: boolean | undefined;
  /** Supporting text under the label, read after it through `aria-describedby`. */
  description?: ReactNode | undefined;
  /** Controls at the end of the header, such as a "Clear checked" button. */
  actions?: ReactNode | undefined;
  /** The rows: `ChecklistItem`s. */
  children?: ReactNode;
  /** Layout only: margins, width, grid placement (`mt-4`). */
  className?: string | undefined;
  /** The group element, a `<div role="group">`. */
  ref?: Ref<HTMLDivElement> | undefined;
}

/**
 * Part: the group a checklist built from parts renders its rows in, named by `label`. Use the
 * `Checklist` component instead unless its `items` cannot express your rows; a row removed from
 * a ChecklistRoot goes at once, while `Checklist` lets it leave.
 *
 * @example
 * <ChecklistRoot label="Steps">
 *   <ChecklistItem label="Preheat the oven" checked={done.oven} onCheckedChange={(checked) => mark("oven", checked)} />
 * </ChecklistRoot>
 */
export function ChecklistRoot(props: ChecklistRootProps): JSX.Element {
  useAppearanceClassNameCheck("ChecklistRoot", props.className, process.env.NODE_ENV !== "production" ? ownLook("ChecklistRoot") : /* istanbul ignore next @preserve -- production only */ "");
  return <ChecklistRootUnchecked {...props} />;
}

/**
 * The root without its own className check, for `Checklist`, which checks its own. `reserve`
 * keeps the header's height for actions that come and go.
 *
 * @internal
 */
export function ChecklistRootUnchecked({ label, hideLabel, description, actions, children, className, ref, reserve }: ChecklistRootProps & { reserve?: boolean | undefined }): JSX.Element {
  const id = useId();
  const labelNode = (
    <div id={`${id}-label`} data-ouro-checklist-label="" className={hideLabel ? "sr-only" : groupLabelClass}>
      {label}
    </div>
  );
  const header = !hideLabel || description !== undefined || actions || reserve;
  return (
    <ChecklistContext.Provider value>
      <div
        ref={ref}
        role="group"
        // Focus falls back here when the focused row leaves and none is left.
        tabIndex={-1}
        data-ouro="checklist"
        aria-labelledby={`${id}-label`}
        aria-describedby={description !== undefined ? `${id}-description` : undefined}
        className={cn(rootClass, className)}
      >
        {header ? (
          <div className={headerClass}>
            <div className="grid min-w-0 gap-0.5">
              {labelNode}
              {description !== undefined && (
                <div id={`${id}-description`} className={groupDescriptionClass}>
                  {description}
                </div>
              )}
            </div>
            {actions}
          </div>
        ) : (
          labelNode
        )}
        <div data-ouro-checklist-rows="" className={rowsClass}>
          {children}
        </div>
      </div>
    </ChecklistContext.Provider>
  );
}

/** Props for {@link ChecklistItem}. */
export interface ChecklistItemProps {
  /** What to tick off, read as the row's checkbox name. */
  label: string;
  /** Supporting text under the label: a note, a substitution. */
  description?: ReactNode | undefined;
  /** Trailing text at the end of the row, such as an amount (`1 cup`) or a time. */
  value?: ReactNode | undefined;
  /** Whether the row is checked. */
  checked: boolean;
  /** Called with the new state when the row is checked or unchecked. */
  onCheckedChange: (checked: boolean) => void;
  /** Disables the row's box and fades it. */
  disabled?: boolean | undefined;
  /** A control of the row's own beside it (a button, a menu), its own tab stop outside the row's label. */
  action?: ReactNode | undefined;
}

/**
 * Part: one row of a `ChecklistRoot`. The whole row but its `action` toggles it: a label holding
 * the box, the text and the value, with the action beside it. Use the `Checklist` component
 * instead unless its `items` cannot express your rows.
 *
 * @example
 * <ChecklistItem label="rolled oats" value="1 cup" checked={oats} onCheckedChange={setOats} />
 */
export function ChecklistItem(props: ChecklistItemProps): JSX.Element {
  return <ChecklistRow {...props} />;
}

/**
 * A row with its phase, for `Checklist`, which lets rows enter and leave; `ChecklistItem` stays
 * put.
 *
 * @internal
 */
export function ChecklistRow({
  label,
  description,
  value,
  checked,
  onCheckedChange,
  disabled,
  action,
  phase = "present",
  rowRef,
}: ChecklistItemProps & { phase?: "entering" | "present" | "leaving" | undefined; rowRef?: Ref<HTMLDivElement> | undefined }): JSX.Element {
  if (!useContext(ChecklistContext)) {
    devThrow(
      "ChecklistItem",
      "must be rendered inside <ChecklistRoot>",
      process.env.NODE_ENV !== "production"
        ? '<ChecklistRoot label="…"><ChecklistItem label="…" checked={…} onCheckedChange={…} /></ChecklistRoot>'
        : /* istanbul ignore next @preserve -- production only */ "",
    );
  }
  const id = useId();
  const leaving = phase === "leaving";
  const describedBy = [description !== undefined && `${id}-description`, value !== undefined && `${id}-value`].filter(Boolean).join(" ") || undefined;
  return (
    <div
      ref={rowRef}
      data-slot="checklist-row"
      data-ouro-part="row"
      data-checked={checked ? "" : undefined}
      data-unchecked={checked ? undefined : ""}
      data-disabled={disabled ? "" : undefined}
      data-starting-style={phase === "entering" ? "" : undefined}
      data-ending-style={leaving ? "" : undefined}
      inert={leaving || undefined}
      aria-hidden={leaving || undefined}
      className={rowClass}
    >
      <div className={rowInnerClass}>
        <label className={hitClass}>
          <BaseCheckbox.Root
            checked={checked}
            onCheckedChange={(next) => onCheckedChange(next)}
            disabled={disabled}
            inputRef={markInput}
            data-ouro-control="checklist"
            data-ouro-part="box"
            aria-labelledby={`${id}-label`}
            aria-describedby={describedBy}
            className={boxClass}
          >
            <BaseCheckbox.Indicator keepMounted className={indicatorClass}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-full">
                <path d="M3.5 8.5 6.5 11.5 12.5 4.5" pathLength={1} data-ouro-part="tick" className={tickClass} />
              </svg>
            </BaseCheckbox.Indicator>
          </BaseCheckbox.Root>
          <span className={textClass}>
            <span id={`${id}-label`} data-ouro-part="label" className={labelClass}>
              {label}
              <span aria-hidden="true" data-ouro-part="strike" className={strikeClass} />
            </span>
            {description !== undefined && (
              <span id={`${id}-description`} data-ouro-checklist-description="" className={descriptionClass}>
                {description}
              </span>
            )}
          </span>
          {value !== undefined && (
            <span id={`${id}-value`} data-ouro-part="value" className={valueClass}>
              {value}
            </span>
          )}
        </label>
        {action !== undefined && <div className={actionClass}>{action}</div>}
      </div>
    </div>
  );
}
