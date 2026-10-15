"use client";

import { Fieldset as BaseFieldset } from "@base-ui/react/fieldset";
import { useId, type JSX, type ReactNode } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { descriptionClass, fieldHint, legendClass } from "~/components/ouro/field/field-styles";

/** Props for {@link Fieldset}. Groups take `legend` where a single control takes `label`. */
export interface FieldsetProps {
  /**
   * What the group is, shown above it and read as the group's name. Required: a group of
   * controls needs a name. To hide it visually, keep it and add `hideLegend`.
   */
  legend: string;
  /** Hides the legend visually; screen readers still read it as the group's name. */
  hideLegend?: boolean | undefined;
  /** Supporting text under the legend, read after it through `aria-describedby`. */
  description?: ReactNode | undefined;
  /** Disables every native control and every `Field` inside it, and fades the legend. */
  disabled?: boolean | undefined;
  /** The fields and controls in the group. */
  children: ReactNode;
  /** Layout only: margins, width, grid placement (`mt-6`). Appearance classes warn in development. */
  className?: string | undefined;

  /** Not a prop. Groups take `legend`: `<Fieldset legend="Shipping address">`. */
  label?: { 'Use <Fieldset legend="Shipping address">': never };
}

/**
 * A titled group of related fields, such as an address, rendered as a `<fieldset>` named
 * by its legend. `disabled` disables every native control and every `Field` inside it at once.
 *
 * Use `Field` instead for a single control. A group of checkboxes or radios that make one
 * choice uses their group component, which takes the same `legend`.
 *
 * @group Forms
 * @see https://ourostack.github.io/ouro-ui/docs/fieldset
 *
 * @example
 * <Fieldset legend="Shipping address" description="Where we send your order.">
 *   <Field label="Street" name="street"><FieldControl autoComplete="street-address" /></Field>
 *   <Field label="City" name="city"><FieldControl autoComplete="address-level2" /></Field>
 * </Fieldset>
 */
export function Fieldset(props: FieldsetProps): JSX.Element {
  const { legend, hideLegend, description, disabled, children, className, label } = props;
  const id = useId();
  const legendId = `${id}-legend`;
  const descriptionId = `${id}-description`;
  const hasDescription = description !== undefined && description !== null && description !== false && description !== "";
  useAppearanceClassNameCheck(
    "Fieldset",
    className,
    process.env.NODE_ENV !== "production" ? fieldHint : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "Fieldset",
    process.env.NODE_ENV !== "production"
      ? () => [
          legend === "" && [
            "legend is empty, so the group has no name",
            '<Fieldset legend="Shipping address" hideLegend> to hide a legend you still need',
          ],
          label !== undefined && ["label is not a prop", `<Fieldset legend="${String(label)}">`],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );

  // Ids are set here, not left to Base UI's effects, so the server HTML names and
  // describes the group before hydration.
  const legendElement = (
    <BaseFieldset.Legend id={legendId} className={cn(legendClass, hideLegend && "sr-only")}>
      {legend}
    </BaseFieldset.Legend>
  );
  return (
    <BaseFieldset.Root
      disabled={disabled}
      aria-labelledby={legendId}
      aria-describedby={hasDescription ? descriptionId : undefined}
      data-ouro="fieldset"
      className={cn("[@layer_ouro-reset]:m-0 box-border grid min-w-0 content-start gap-4 border-0 p-0", className)}
    >
      {hasDescription ? (
        <div className="grid gap-1">
          {legendElement}
          <p id={descriptionId} className={descriptionClass}>
            {description}
          </p>
        </div>
      ) : (
        legendElement
      )}
      {children}
    </BaseFieldset.Root>
  );
}
