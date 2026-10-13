"use client";

import { Button as BaseButton } from "@base-ui/react/button";
import { useEffect, useRef } from "react";
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ComponentType,
  JSX,
  MouseEvent,
  ReactNode,
  Ref,
  SVGProps,
} from "react";
import { announce } from "~/lib/ouro/announce";
import { fontFor, radiusFor, sizeFor, toneFor } from "~/lib/ouro/appearance-hints";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { RouterLink } from "~/lib/ouro/router-link";
import { TouchTarget } from "~/lib/ouro/touch-target";
import { useDevWarnings } from "~/lib/ouro/use-dev-warnings";
import { toneWarning } from "~/lib/ouro/tones";

/** An icon component, such as one from `lucide-react` or `@heroicons/react`. */
export type ButtonIcon = ComponentType<SVGProps<SVGSVGElement>>;

/** Props shared by both kinds of Button (`href` switches between them). */
export interface ButtonBaseProps {
  /**
   * Color role from the theme, named after its token: `primary` reads `--primary`.
   * shadcn's `variant="destructive"` is `tone="destructive"`, and its `variant="secondary"` is `tone="secondary"`.
   * @default "primary"
   */
  tone?:
    | "primary"
    | "secondary"
    | "destructive"
    | "success"
    | "warning"
    | (string & { 'danger is "destructive"; accent is "primary"; neutral is "secondary"': never })
    | undefined;
  /**
   * Visual weight: `solid` for the primary action, `soft` for secondary actions,
   * `outline` for a quiet bordered control, `plain` for a borderless one.
   * shadcn's `default` is `solid` (the default), `ghost` and `link` are `plain`, and
   * `destructive` and `secondary` are tones: `tone="destructive"`. Any other
   * string is a type error whose message names the fix.
   * Variant is visual only. For a toggle, pass `aria-pressed`; for the current
   * nav item, `aria-current="page"`.
   * @default "solid"
   */
  variant?:
    | "solid"
    | "soft"
    | "outline"
    | "plain"
    | (string & { 'From shadcn? Use tone="destructive" or tone="secondary". default is "solid"; ghost and link are "plain"': never })
    | undefined;
  /**
   * Control size. Each size is taller on phones and steps down to desktop
   * density from the `sm` breakpoint (640px). shadcn's `default` is `md`; for an
   * icon-only button, pass the icon as children and an `aria-label`. Any other
   * string is a type error whose message names the fix. @default "md"
   */
  size?:
    | "sm"
    | "md"
    | "lg"
    | (string & { 'From shadcn? default is "md"; for icon, pass aria-label with the icon as children': never })
    | undefined;
  /** Stretches the button to the width of its container. */
  fullWidth?: boolean | undefined;
  /**
   * Shows a centered spinner, keeps the width, sets `aria-busy` and disables
   * the button. It stays focusable, so focus is not lost when a pressed button
   * turns busy.
   */
  loading?: boolean | undefined;
  /**
   * What screen readers hear, politely, when `loading` turns on. It is spoken
   * through a shared live region, so the button's name stays its label. Use the
   * action in progress: `loadingLabel="Saving recipe"`. @default "Loading"
   */
  loadingLabel?: string | undefined;
  /** Icon before the label. Pass the component, not an element: `startIcon={PlusIcon}`. */
  startIcon?: ButtonIcon | undefined;
  /** Icon after the label. Pass the component, not an element: `endIcon={ArrowRightIcon}`. */
  endIcon?: ButtonIcon | undefined;
  /** The label. For an icon-only button, also pass `aria-label`. */
  children: ReactNode;
  /**
   * Layout only: margins, width, grid placement (`mt-4`, `col-span-2`). Your
   * classes always win over Ouro UI's. Appearance classes warn in development;
   * use `tone`, `variant` and `size` instead.
   */
  className?: string | undefined;

  /** Not a prop. Ouro UI uses `loading`: `<Button loading>`. */
  isLoading?: { 'Use <Button loading>': never };
  /** Not a prop. Ouro UI uses `tone`: `<Button tone="destructive">`. */
  color?: { 'Use <Button tone="destructive">': never };
  /** Not a prop. To render a link, pass `href`: `<Button href="/recipes">`. For other elements, use parts. */
  asChild?: { 'Use <Button href="/path">': never };
  /** Not a prop. Ouro UI uses `startIcon`: `<Button startIcon={PlusIcon}>`. */
  leftIcon?: { 'Use <Button startIcon={Icon}>': never };
  /** Not a prop. Ouro UI uses `endIcon`: `<Button endIcon={ArrowRightIcon}>`. */
  rightIcon?: { 'Use <Button endIcon={Icon}>': never };
}

/** A Button with `href`: renders a link that looks like a button. */
export type ButtonLinkProps = ButtonBaseProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof ButtonBaseProps | "type"> & {
    /**
     * Where the link goes. Internal paths render through `OuroProvider`'s
     * `linkComponent` (your router's link); `http(s)://`, `mailto:` and other
     * absolute URLs render as a plain `<a>`. An absolute URL with
     * `target="_blank"` always gets `rel="noopener noreferrer"`, merged with
     * any `rel` you pass.
     */
    href: string;
    /** Links have no `type`. Remove `href` to make a submit button: `<Button type="submit">`. */
    type?: never;
    /** A link cannot be disabled. Remove `href` to render a disabled button, or don't render the link. */
    disabled?: never;
    ref?: Ref<HTMLAnchorElement> | undefined;
  };

/** A Button without `href`: renders a native `<button>`. */
export type ButtonButtonProps = ButtonBaseProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof ButtonBaseProps | "type"> & {
    /** Not set: this is a `<button>`. Pass `href` to render a link instead. */
    href?: never;
    /**
     * The button's role in a form: `submit` sends it, `reset` clears it.
     * @default "button" (never submits a form by accident)
     */
    type?: "button" | "submit" | "reset" | (string & { 'Use "button", "submit" or "reset"; for looks use tone and variant': never }) | undefined;
    ref?: Ref<HTMLButtonElement> | undefined;
  };

/** Props for {@link Button}. Passing `href` makes it a link; otherwise it is a `<button>`. */
export type ButtonProps = ButtonLinkProps | ButtonButtonProps;

// Class strings are literal so the app's Tailwind finds them when it compiles.
const base =
  "press relative m-0 box-border inline-flex shrink-0 items-center justify-center align-middle " +
  "rounded-lg border border-solid font-medium whitespace-nowrap " +
  "no-underline select-none touch-manipulation [-webkit-tap-highlight-color:transparent] " +
  "outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid " +
  // A state layer in the text color: a light wash on hover, a deeper one while pressed.
  "before:pointer-events-none before:absolute before:-inset-px before:rounded-[inherit] before:bg-current " +
  "before:opacity-0 before:transition-opacity before:duration-(--ouro-duration-fast) before:ease-out " +
  "not-data-disabled:hover:before:opacity-8 not-data-disabled:active:before:opacity-14 " +
  // Press feedback: scale only when motion is allowed and the button is enabled.
  "motion-safe:not-data-disabled:active:scale-(--ouro-press-scale) active:duration-(--ouro-duration-fast) active:ease-out " +
  "disabled:cursor-not-allowed disabled:opacity-50 aria-busy:cursor-progress";

// Height and padding step down to desktop density at the `sm` breakpoint through two
// variables, so the button has one unprefixed `h-*` and `px-*` class and the app's own
// (`className="h-20"`) replaces it at every width.
const density = "h-(--ouro-button-h) px-(--ouro-button-px)";
const sizes = {
  sm:
    `${density} gap-1.5 text-sm [--ouro-button-h:calc(var(--spacing)*9)] [--ouro-button-px:calc(var(--spacing)*3)] ` +
    "sm:[--ouro-button-h:calc(var(--spacing)*8)] sm:[--ouro-button-px:calc(var(--spacing)*2.5)]",
  md:
    `${density} gap-2 text-base sm:text-sm [--ouro-button-h:calc(var(--spacing)*11)] [--ouro-button-px:calc(var(--spacing)*4)] ` +
    "sm:[--ouro-button-h:calc(var(--spacing)*9)] sm:[--ouro-button-px:calc(var(--spacing)*3.5)]",
  lg:
    `${density} gap-2 text-base [--ouro-button-h:calc(var(--spacing)*12)] [--ouro-button-px:calc(var(--spacing)*5)] ` +
    "sm:[--ouro-button-h:calc(var(--spacing)*11)]",
} as const;

// `soft` is the tone at low opacity behind text in the tone, the pattern shadcn uses for
// destructive, with the text mixed 20% toward the foreground so it keeps 4.5:1 on the
// tint under shadcn's stock values too (plain `text-destructive` there is 3.97:1). `secondary` is shadcn's: a quiet surface (`bg-secondary`) with its own
// foreground, so its outline and plain text are the page's foreground.
const looks = {
  solid: {
    primary: "border-transparent bg-primary text-primary-foreground",
    secondary: "border-transparent bg-secondary text-secondary-foreground",
    destructive: "border-transparent bg-destructive text-destructive-foreground",
    success: "border-transparent bg-success text-success-foreground",
    warning: "border-transparent bg-warning text-warning-foreground",
  },
  soft: {
    primary: "border-transparent bg-primary/10 text-[color-mix(in_oklab,var(--primary)_80%,var(--foreground))]",
    secondary: "border-transparent bg-secondary/50 text-secondary-foreground",
    destructive: "border-transparent bg-destructive/10 text-[color-mix(in_oklab,var(--destructive)_80%,var(--foreground))]",
    success: "border-transparent bg-success/10 text-[color-mix(in_oklab,var(--success)_80%,var(--foreground))]",
    warning: "border-transparent bg-warning/10 text-[color-mix(in_oklab,var(--warning)_80%,var(--foreground))]",
  },
  outline: {
    primary: "border-primary/45 bg-transparent text-primary",
    secondary: "border-border bg-transparent text-foreground",
    destructive: "border-destructive/45 bg-transparent text-destructive",
    success: "border-success/45 bg-transparent text-success",
    warning: "border-warning/45 bg-transparent text-warning",
  },
  plain: {
    primary: "border-transparent bg-transparent text-primary",
    secondary: "border-transparent bg-transparent text-foreground",
    destructive: "border-transparent bg-transparent text-destructive",
    success: "border-transparent bg-transparent text-success",
    warning: "border-transparent bg-transparent text-warning",
  },
} as const;

const iconClass = "size-[1.25em] shrink-0";

const buttonTypes = ["button", "submit", "reset"] as const;

function buttonHint(token: string): string {
  const size = sizeFor(token, ["sm", "sm", "md", "lg", "lg", "lg", "lg"]);
  if (size) return `size="${size}"`;
  if (token.startsWith("font-")) return fontFor("Button", token);
  if (token.startsWith("rounded")) return radiusFor(token);
  if (/^(border|ring|shadow)/.test(token)) return 'variant="outline"';
  if (/^bg-(transparent|none)$/.test(token)) return 'variant="plain"';
  return `tone="${toneFor(token)}"`;
}

/** shadcn's Button variants, with the Ouro UI props that do the same job. Development only. */
const shadcnVariants: Readonly<Record<string, string>> = {
  default: "<Button>",
  destructive: '<Button tone="destructive">',
  secondary: '<Button tone="secondary">',
  ghost: '<Button variant="plain">',
  link: '<Button variant="plain" href="/path">',
};

/** The dev message for a variant that is not one of Ouro UI's. */
function variantWarning(variant: string): readonly [string, string] {
  const fix = Object.hasOwn(shadcnVariants, variant) ? shadcnVariants[variant]! : '<Button variant="solid">';
  return [`variant="${variant}" is not a variant`, fix];
}

/** The dev message for a size that is not one of Ouro UI's, such as shadcn's `default` and `icon`. */
function sizeWarning(size: string): readonly [string, string] {
  const fix = size === "icon" ? '<Button aria-label="Add"><PlusIcon /></Button>' : '<Button size="md">';
  return [`size="${size}" is not a size`, fix];
}

function Spinner(): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="absolute inset-0 flex items-center justify-center transition-opacity duration-(--ouro-duration-base) ease-out starting:opacity-0"
    >
      <svg
        data-ouro-spinner=""
        viewBox="0 0 24 24"
        fill="none"
        className="size-[1.25em] animate-[ouro-spin_0.8s_linear_infinite] motion-reduce:animate-[ouro-pulse_1.6s_ease-in-out_infinite]"
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </span>
  );
}

const preventDefault = (event: MouseEvent) => event.preventDefault();

/**
 * A button, or a link styled as one. The obvious name for any action: pressing
 * it gives physical feedback, it has a 44px touch target on phones, and `loading`
 * handles the busy state without the layout jumping.
 *
 * Use `href` to navigate (it renders a link); use `type="submit"` in a form.
 * Use `Text` with an `<a>` instead when a link sits inside running text.
 *
 * @group Actions
 * @see https://ourostack.github.io/ouro-ui/docs/button
 *
 * @example
 * <Button onClick={save} loading={saving}>Save</Button>
 * <Button href="/recipes/new" startIcon={PlusIcon}>New recipe</Button>
 * <Button tone="destructive" variant="soft" type="submit">Delete</Button>
 */
export function Button(props: ButtonProps): JSX.Element {
  const {
    tone: toneProp = "primary",
    variant: variantProp = "solid",
    size: sizeProp = "md",
    fullWidth,
    loading,
    loadingLabel = "Loading",
    startIcon: StartIcon,
    endIcon: EndIcon,
    children,
    className,
    // Guard props (hint types), dropped here so they never reach the DOM.
    isLoading,
    color,
    asChild,
    leftIcon,
    rightIcon,
    ...rest
  } = props;
  // A tone, variant or size that is not one of Ouro UI's (a type error) warns and renders the default.
  const tone = Object.hasOwn(looks.solid, toneProp) ? (toneProp as keyof typeof looks.solid) : "primary";
  const variant = Object.hasOwn(looks, variantProp) ? (variantProp as keyof typeof looks) : "solid";
  const size = Object.hasOwn(sizes, sizeProp) ? (sizeProp as keyof typeof sizes) : "md";
  useAppearanceClassNameCheck(
    "Button",
    className,
    process.env.NODE_ENV !== "production" ? buttonHint : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "Button",
    process.env.NODE_ENV !== "production"
      ? () => {
          const link = rest as { href?: string; type?: string; disabled?: boolean };
          return [
            tone !== toneProp && toneWarning("Button", String(toneProp), Object.keys(looks.solid)),
            variant !== variantProp && variantWarning(String(variantProp)),
            size !== sizeProp && sizeWarning(String(sizeProp)),
            isLoading !== undefined && ["isLoading is not a prop", "<Button loading>"],
            color !== undefined && ["color is not a prop", `<Button tone="${toneFor(`bg-${String(color)}`)}">`],
            asChild !== undefined && ["asChild is not a prop", '<Button href="/path">'],
            leftIcon !== undefined && ["leftIcon is not a prop", "<Button startIcon={Icon}>"],
            rightIcon !== undefined && ["rightIcon is not a prop", "<Button endIcon={Icon}>"],
            link.href === undefined &&
              link.type !== undefined &&
              !buttonTypes.includes(link.type as (typeof buttonTypes)[number]) && [
                `type="${link.type}" is not a button type; use "button", "submit", "reset"`,
                Object.hasOwn(looks.solid, link.type) ? `<Button tone="${link.type}">` : '<Button type="button">',
              ],
            link.href !== undefined &&
              link.type !== undefined && [
                `a link has no type, so type="${link.type}" is ignored`,
                `<Button type="${link.type}"> without href`,
              ],
            link.href !== undefined &&
              link.disabled !== undefined && ["a link cannot be disabled", "<Button disabled> without href"],
          ];
        }
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );

  // Speak the busy state when loading turns on. The shared region sits outside the
  // button, so the button's accessible name stays exactly its label.
  const wasLoading = useRef(loading);
  useEffect(() => {
    if (loading && !wasLoading.current) announce(loadingLabel);
    wasLoading.current = loading;
  }, [loading, loadingLabel]);

  const classes = cn(base, sizes[size], looks[variant][tone], fullWidth && "w-full", className);

  // The touch target comes first and the label is positioned, so the label paints above
  // the target: the target still enlarges the hit area, and nothing covers the text
  // (axe can check its contrast).
  const content = (
    <>
      <TouchTarget />
      <span
        data-ouro-label=""
        className={cn(
          "relative inline-flex items-center gap-[inherit] transition-opacity duration-(--ouro-duration-fast) ease-out",
          loading && "opacity-0",
        )}
      >
        {StartIcon && <StartIcon aria-hidden="true" className={cn(iconClass, "-ms-0.5")} />}
        {children}
        {EndIcon && <EndIcon aria-hidden="true" className={cn(iconClass, "-me-0.5")} />}
      </span>
      {loading && <Spinner />}
    </>
  );

  if (rest.href !== undefined) {
    // `type` and `disabled` are typed `never` on links; drop them if they arrive anyway.
    const { onClick, type: _type, disabled: _disabled, ...anchorProps } = rest as Omit<ButtonLinkProps, keyof ButtonBaseProps>;
    return (
      <RouterLink
        {...anchorProps}
        onClick={loading ? preventDefault : onClick}
        onAuxClick={loading ? preventDefault : anchorProps.onAuxClick}
        className={classes}
        data-ouro="button"
        data-variant={variant}
        data-loading={loading ? "" : undefined}
        data-disabled={loading ? "" : undefined}
        aria-busy={loading || undefined}
        aria-disabled={loading || undefined}
      >
        {content}
      </RouterLink>
    );
  }

  const { ref, disabled, type: typeProp = "button", ...buttonProps } = rest as Omit<ButtonButtonProps, keyof ButtonBaseProps>;
  // A type that is not a button type would submit forms (the browser's default), so it renders "button".
  const type = buttonTypes.includes(typeProp as (typeof buttonTypes)[number]) ? (typeProp as (typeof buttonTypes)[number]) : "button";
  return (
    <BaseButton
      {...buttonProps}
      ref={ref as Ref<HTMLElement> | undefined}
      type={type}
      disabled={Boolean(disabled || loading)}
      focusableWhenDisabled={Boolean(loading && !disabled)}
      className={classes}
      data-ouro="button"
      data-variant={variant}
      data-loading={loading ? "" : undefined}
      aria-busy={loading || undefined}
    >
      {content}
    </BaseButton>
  );
}
