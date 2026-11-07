import type { ComponentType, SVGProps } from "react";
import { radiusFor, sizeFor } from "~/lib/ouro/appearance-hints";

export { iconClass, looks, sizes, squareClass, toggleBase, toggleHint, toggleSizeWarning, toggleVariantWarning };
export type { ToggleIcon, ToggleSize, ToggleVariant };

// Class strings, value lists and dev-message helpers shared by Toggle and ToggleGroup, apart
// from the components so each component file exports only components (React Fast Refresh).
// Class strings are literal so the app's Tailwind finds them when it compiles.

/**
 * An icon component, such as one from `lucide-react` or `@heroicons/react`.
 *
 * @internal
 */
type ToggleIcon = ComponentType<SVGProps<SVGSVGElement>>;

/**
 * The toggle's shape and feedback: Button's state layer (a wash in the text color on hover,
 * deeper while pressed), the press scale when motion is allowed, and the focus outline
 * in the ring color.
 *
 * @internal
 */
const toggleBase =
  "press relative box-border inline-flex shrink-0 items-center justify-center align-middle " +
  "rounded-lg border border-solid font-medium whitespace-nowrap " +
  "no-underline select-none touch-manipulation [-webkit-tap-highlight-color:transparent] " +
  "outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid " +
  "before:pointer-events-none before:absolute before:-inset-px before:rounded-[inherit] before:bg-current " +
  "before:opacity-0 before:transition-opacity before:duration-(--ouro-duration-fast) before:ease-[ease] " +
  "not-data-disabled:not-active:pointer-fine:hover:before:opacity-8 not-data-disabled:active:before:opacity-14 " +
  "motion-safe:not-data-disabled:active:scale-(--ouro-press-scale) " +
  "disabled:cursor-not-allowed disabled:opacity-50 " +
  // Pressed: the primary tone at 10% behind text mixed 20% toward the foreground, as Button's soft look.
  "data-pressed:bg-primary/10 data-pressed:text-[color-mix(in_oklab,var(--primary)_80%,var(--foreground))] contrast-more:data-pressed:border-current";

/**
 * Height and padding read two variables, so the toggle has one unprefixed `h-*` and `px-*`
 * class and the app's own replaces it at every width. Phones keep 16px text and the phone
 * height; the desktop density applies from `sm` with a fine pointer only, so a landscape
 * phone keeps it too.
 *
 * @internal
 * @claim "Phones keep 16px text and the" registry/ouro/components/ouro/toggle/toggle.touch.test.tsx verify:testExists(registry/ouro/components/ouro/toggle/toggle.touch.test.tsx::keeps 44px toggles and 16px text on a landscape phone, past the sm breakpoint)
 * @claim "Phones keep 16px text and the" registry/ouro/components/ouro/toggle/toggle.test.tsx verify:testExists(registry/ouro/components/ouro/toggle/toggle.test.tsx::Toggle looks > is 44px tall on phones and steps down with a fine pointer from sm, per size)
 * @claim "Height and padding read two variables" registry/ouro/components/ouro/toggle/toggle-styles.ts verify:fileLine(registry/ouro/components/ouro/toggle/toggle-styles.ts, /h-\(--ouro-toggle-h\)\spx-\(--ouro-toggle-px\)/)
 * @claim "Height and padding read two variables" registry/ouro/components/ouro/toggle/toggle.test.tsx verify:testExists(registry/ouro/components/ouro/toggle/toggle.test.tsx::Toggle > lets app layout classes win)
 */
const sizes = {
  sm:
    "h-(--ouro-toggle-h) px-(--ouro-toggle-px) gap-1.5 text-sm [--ouro-toggle-h:calc(var(--spacing)*9)] [--ouro-toggle-px:calc(var(--spacing)*3)] " +
    "sm:pointer-fine:[--ouro-toggle-h:calc(var(--spacing)*8)] sm:pointer-fine:[--ouro-toggle-px:calc(var(--spacing)*2.5)]",
  md:
    "h-(--ouro-toggle-h) px-(--ouro-toggle-px) gap-2 text-base sm:pointer-fine:text-sm [--ouro-toggle-h:calc(var(--spacing)*11)] [--ouro-toggle-px:calc(var(--spacing)*3.5)] " +
    "sm:pointer-fine:[--ouro-toggle-h:calc(var(--spacing)*9)] sm:pointer-fine:[--ouro-toggle-px:calc(var(--spacing)*3)]",
  lg:
    "h-(--ouro-toggle-h) px-(--ouro-toggle-px) gap-2 text-base [--ouro-toggle-h:calc(var(--spacing)*12)] [--ouro-toggle-px:calc(var(--spacing)*4)] " +
    "sm:pointer-fine:[--ouro-toggle-h:calc(var(--spacing)*11)]",
} as const;

/**
 * A toggle size.
 *
 * @internal
 */
type ToggleSize = keyof typeof sizes;

/**
 * An icon-only toggle is as wide as it is tall.
 *
 * @internal
 */
const squareClass = "aspect-square px-0";

/**
 * `plain` has no border until it is pressed; `outline` always has one, in the primary tone while pressed.
 *
 * @internal
 * @claim "`plain` has no border until it" registry/ouro/components/ouro/toggle/toggle.test.tsx verify:testExists(registry/ouro/components/ouro/toggle/toggle.test.tsx::Toggle looks > draws a border with variant outline)
 */
const looks = {
  plain: "border-transparent bg-transparent text-foreground",
  outline: "border-border bg-transparent text-foreground data-pressed:border-primary/45",
} as const;

/**
 * A toggle look.
 *
 * @internal
 */
type ToggleVariant = keyof typeof looks;

/**
 * The icon, at the label's size.
 *
 * @internal
 */
const iconClass = "size-[1.25em] shrink-0";

/**
 * The fix for an appearance class on a toggle. Development only.
 *
 * @internal
 */
function toggleHint(component: string): (token: string) => string {
  return (token) => {
    const size = sizeFor(token, ["sm", "sm", "md", "lg", "lg", "lg", "lg"]);
    if (size) return `<${component} size="${size}">`;
    if (token.startsWith("rounded")) return radiusFor(token);
    return `<${component} variant="outline">`;
  };
}

/**
 * The dev message for a variant that is not one of the toggle's, such as shadcn's `default`. Development only.
 *
 * @internal
 */
function toggleVariantWarning(component: string, variant: string): readonly [string, string] {
  const shadcn = variant === "default" || variant === "ghost";
  return [`variant="${variant}" is not a variant`, shadcn ? `<${component}>` : `<${component} variant="plain">`];
}

/**
 * The dev message for a size that is not one of the toggle's. Development only.
 *
 * @internal
 */
function toggleSizeWarning(component: string, size: string): readonly [string, string] {
  return [`size="${size}" is not a size`, `<${component} size="md">`];
}
