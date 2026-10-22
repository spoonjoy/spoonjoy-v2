"use client";

import { Toggle as BaseToggle } from "@base-ui/react/toggle";
import type { ButtonHTMLAttributes, JSX, Ref } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { TouchTarget } from "~/lib/ouro/touch-target";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import {
  iconClass,
  looks,
  sizes,
  squareClass,
  toggleBase,
  toggleHint,
  toggleSizeWarning,
  toggleVariantWarning,
  type ToggleIcon,
} from "~/components/ouro/toggle/toggle-styles";

/** The props Toggle adds to the button attributes it passes through. */
export interface ToggleOwnProps {
  /**
   * What the toggle turns on, such as "Bold". It is the button's name and stays the same
   * while pressed: `aria-pressed` says whether it is on. Required: every toggle needs a name.
   * @claim "Required: every toggle needs a name" registry/ouro/components/ouro/toggle/toggle.test-d.ts verify:fileLine(registry/ouro/components/ouro/toggle/toggle.test-d.ts, /expectTypeOf<\{\spressed:\strue\s\}>\(\)\.not\.toExtend<ToggleProps>/)
   */
  label: string;
  /**
   * Shows only the icon; the label stays the toggle's name for screen readers. Pass `icon` with it.
   */
  hideLabel?: boolean | undefined;
  /** Icon before the label, or alone with `hideLabel`. Pass the component, not an element: `icon={BoldIcon}`. */
  icon?: ToggleIcon | undefined;
  /** Whether the toggle is on, when you control it. Pair it with `onPressedChange`. */
  pressed?: boolean | undefined;
  /** Whether the toggle starts on, when it keeps its own state. @default false */
  defaultPressed?: boolean | undefined;
  /** Called with the new state when the person presses the toggle. */
  onPressedChange?: ((pressed: boolean) => void) | undefined;
  /** Keeps the toggle from being pressed, and fades it. */
  disabled?: boolean | undefined;
  /**
   * `plain` has no border until pressed; `outline` always has one. Either way a pressed toggle
   * gets the primary tint. shadcn's `default` is `plain`.
   * @default "plain"
   * @claim "`plain` has no border until pressed" registry/ouro/components/ouro/toggle/toggle.test.tsx verify:testExists(registry/ouro/components/ouro/toggle/toggle.test.tsx::Toggle looks > draws a border with variant outline)
   */
  variant?: "plain" | "outline" | (string & { 'From shadcn? default is "plain"; use "plain" or "outline"': never }) | undefined;
  /**
   * Control size, as Button's: each is taller on phones and steps down to desktop density from
   * the `sm` breakpoint with a fine pointer. shadcn's `default` is `md`.
   * @default "md"
   * @claim "Control size, as Button's: each is" registry/ouro/components/ouro/toggle/toggle.test.tsx verify:testExists(registry/ouro/components/ouro/toggle/toggle.test.tsx::Toggle looks > is 44px tall on phones and steps down with a fine pointer from sm, per size)
   * @claim "Control size, as Button's: each is" https://ui.shadcn.com/docs/components/toggle verify:urlOk(https://ui.shadcn.com/docs/components/toggle)
   */
  size?: "sm" | "md" | "lg" | (string & { 'From shadcn? default is "md"': never }) | undefined;
  /**
   * Layout only: margins, grid placement (`mt-4`). Appearance classes warn in development;
   * use `variant` and `size` instead.
   */
  className?: string | undefined;
  /** The button element. */
  ref?: Ref<HTMLButtonElement> | undefined;

  /**
   * Not a prop. The label is a prop, so the toggle always has a name: `<Toggle label="Bold">`.
   *
   * @claim "The label is a prop, so" registry/ouro/components/ouro/toggle/toggle.test.tsx verify:testExists(registry/ouro/components/ouro/toggle/toggle.test.tsx::Toggle > with hideLabel shows only the icon, in a square, and keeps the label as the name)
   * @claim "The label is a prop, so" registry/ouro/components/ouro/toggle/toggle.test.tsx verify:testExists(registry/ouro/components/ouro/toggle/toggle.test.tsx::Toggle development messages > warns when the label is empty)
   */
  children?: { 'Use <Toggle label="Bold">': never };
  /** Not a prop. Ouro UI uses `pressed`: `<Toggle pressed>`. */
  isPressed?: { 'Use <Toggle pressed>': never };
  /** Not a prop. A toggle is pressed, not checked: `<Toggle pressed>`. For a setting, use `Switch`. */
  checked?: { 'Use <Toggle pressed>': never };
  /** Not a prop. A toggle is pressed, not checked: `<Toggle defaultPressed>`. */
  defaultChecked?: { 'Use <Toggle defaultPressed>': never };
  /** Not a prop. Ouro UI uses `onPressedChange`: `<Toggle onPressedChange={(pressed) => ...}>`. */
  onCheckedChange?: { 'Use <Toggle onPressedChange={(pressed) => ...}>': never };
  /**
   * Not a prop: a button's change event never fires. Use `onPressedChange`: `<Toggle onPressedChange={(pressed) => ...}>`.
   *
   * @claim "Not a prop: a button's change" registry/ouro/components/ouro/toggle/toggle.test-d.ts verify:fileLine(registry/ouro/components/ouro/toggle/toggle.test-d.ts, /\{\slabel:\s"Bold";\sonChange:\s\(\)\s=>\svoid\s\}>\(\)\.not\.toExtend<ToggleProps>/)
   */
  onChange?: { 'Use <Toggle onPressedChange={(pressed) => ...}>': never };
  /** Not a prop. Ouro UI uses `pressed`: `<Toggle pressed>`. */
  selected?: { 'Use <Toggle pressed>': never };
  /** Not a prop. Ouro UI uses `pressed`: `<Toggle pressed>`. */
  isSelected?: { 'Use <Toggle pressed>': never };
  /** Not a prop. Ouro UI uses `pressed`: `<Toggle pressed>`. */
  active?: { 'Use <Toggle pressed>': never };
  /** Not a prop. Ouro UI uses `icon`: `<Toggle icon={BoldIcon}>`. */
  startIcon?: { 'Use <Toggle icon={BoldIcon}>': never };
  /** Not a prop. A pressed toggle uses the primary tint; `variant="outline"` adds a border. */
  tone?: { 'Use <Toggle variant="outline">': never };
}

/** Props for {@link Toggle}: its own props and the button attributes it passes through. */
export type ToggleProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof ToggleOwnProps | "type" | "value" | "defaultValue"> &
  ToggleOwnProps;

/**
 * A button that stays pressed until it is pressed again, such as Bold in a text toolbar. It
 * keeps one name (`label`) and reports its state with `aria-pressed`; a pressed toggle gets
 * the primary tint. Pass `icon` with `hideLabel` for an icon-only toggle; it has a 44px touch
 * target on phones.
 *
 * Use `ToggleGroup` instead for a row of related toggles with arrow-key focus. Use `Switch`
 * instead for a setting that takes effect at once, and `Checkbox` for a form value.
 *
 * @group Actions
 * @see https://ourostack.github.io/ouro-ui/docs/toggle
 *
 * @example
 * <Toggle label="Bold" icon={BoldIcon} hideLabel pressed={bold} onPressedChange={setBold} />
 * <Toggle label="Show completed" variant="outline" defaultPressed />
 */
export function Toggle(props: ToggleProps): JSX.Element {
  const {
    label,
    hideLabel,
    icon: Icon,
    pressed,
    defaultPressed,
    onPressedChange,
    disabled,
    variant: variantProp = "plain",
    size: sizeProp = "md",
    className,
    ref,
    // Guard props (hint types), dropped here so they never reach the DOM.
    children,
    isPressed,
    checked,
    defaultChecked,
    onCheckedChange,
    onChange,
    selected,
    isSelected,
    active,
    startIcon,
    tone,
    ...rest
  } = props;
  // A variant or size that is not one of Toggle's (a type error) warns and renders the default.
  const variant = Object.hasOwn(looks, variantProp) ? (variantProp as keyof typeof looks) : "plain";
  const size = Object.hasOwn(sizes, sizeProp) ? (sizeProp as keyof typeof sizes) : "md";
  useAppearanceClassNameCheck(
    "Toggle",
    className,
    process.env.NODE_ENV !== "production" ? toggleHint("Toggle") : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "Toggle",
    process.env.NODE_ENV !== "production"
      ? () => [
          variant !== variantProp && toggleVariantWarning("Toggle", String(variantProp)),
          size !== sizeProp && toggleSizeWarning("Toggle", String(sizeProp)),
          !label && ["label is empty, so the toggle has no name", '<Toggle label="Bold">'],
          hideLabel && !Icon && ["hideLabel leaves nothing to see without an icon", `<Toggle label="${label}" icon={BoldIcon} hideLabel>`],
          children !== undefined && ["children is not a prop; the label is", `<Toggle label="${typeof children === "string" ? children : "Bold"}">`],
          isPressed !== undefined && ["isPressed is not a prop", "<Toggle pressed>"],
          checked !== undefined && ["checked is not a prop; a toggle is pressed", "<Toggle pressed>"],
          defaultChecked !== undefined && ["defaultChecked is not a prop", "<Toggle defaultPressed>"],
          onCheckedChange !== undefined && ["onCheckedChange is not a prop", "<Toggle onPressedChange={(pressed) => …}>"],
          onChange !== undefined && ["onChange never fires on a toggle", "<Toggle onPressedChange={(pressed) => …}>"],
          selected !== undefined && ["selected is not a prop", "<Toggle pressed>"],
          isSelected !== undefined && ["isSelected is not a prop", "<Toggle pressed>"],
          active !== undefined && ["active is not a prop", "<Toggle pressed>"],
          startIcon !== undefined && ["startIcon is not a prop", "<Toggle icon={BoldIcon}>"],
          tone !== undefined && ["tone is not a prop; a pressed toggle uses the primary tint", '<Toggle variant="outline">'],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  const iconOnly = Boolean(hideLabel && Icon);

  return (
    <BaseToggle
      data-ouro-control="toggle"
      data-ouro-part="root"
      {...rest}
      ref={ref}
      pressed={pressed}
      defaultPressed={defaultPressed}
      onPressedChange={onPressedChange && ((next) => onPressedChange(next))}
      disabled={disabled}
      aria-label={hideLabel ? label : rest["aria-label"]}
      data-ouro="toggle"
      data-variant={variant}
      className={cn(toggleBase, sizes[size], looks[variant], iconOnly && squareClass, className)}
    >
      <TouchTarget />
      {Icon && <Icon aria-hidden="true" className={cn(iconClass, "relative", !hideLabel && "-ms-0.5")} />}
      {!iconOnly && <span className={cn("relative", hideLabel && "sr-only")}>{label}</span>}
    </BaseToggle>
  );
}
