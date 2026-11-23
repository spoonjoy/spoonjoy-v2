import type { ComponentType, SVGProps } from "react";
import { radiusFor, sizeFor } from "~/lib/ouro/appearance-hints";
import { cn } from "~/lib/ouro/cn";
import { scrollFadeClass } from "~/lib/ouro/scroll-fade";

export {
  iconClass,
  looks,
  overflowScrollerClass,
  shapes,
  sizes,
  squareClass,
  toggleBase,
  toggleHint,
  toggleOverflowWarning,
  toggleShapeWarning,
  toggleSizeWarning,
  toggleVariantWarning,
};
export type { ToggleIcon, ToggleShape, ToggleSize, ToggleVariant };

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
  "press relative isolate box-border inline-flex shrink-0 items-center justify-center align-middle " +
  "border border-solid whitespace-nowrap " +
  "no-underline select-none touch-manipulation [-webkit-tap-highlight-color:transparent] " +
  "outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid " +
  "before:pointer-events-none before:absolute before:-inset-px before:rounded-[inherit] before:[corner-shape:inherit] before:bg-current " +
  "before:opacity-0 before:transition-opacity before:duration-(--ouro-duration-fast) before:ease-[ease] " +
  // Stryker disable next-line StringLiteral: a class string in a class position; test/state-hovers.test.tsx reads its tokens, outside this file's tests
  "not-data-disabled:not-active:pointer-fine:hover:before:opacity-[var(--ouro-state-hover,8%)] not-data-disabled:active:before:opacity-[var(--ouro-state-pressed,14%)] " +
  // Where corner-shape is missing, the surface slot paints the background, border and state layer instead (see ouro-base.css).
  "bg-(--ouro-bg) border-(--ouro-bd) [--ouro-sq-w:1px] " +
  // Stryker disable next-line StringLiteral: a class string in a class position; test/state-hovers.test.tsx reads its tokens, outside this file's tests
  "not-data-disabled:not-active:pointer-fine:hover:[--ouro-state:var(--ouro-state-hover,8%)] not-data-disabled:active:[--ouro-state:var(--ouro-state-pressed,14%)] " +
  "motion-safe:not-data-disabled:active:scale-(--ouro-press-scale) " +
  "disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 " +
  // Pressed: the primary tone at 10% behind text mixed 20% toward the foreground, as Button's soft look.
  // Forced colours drop the tint, so a pressed toggle fills with the system highlight there. It opts
  // out of forcing, or the label's backplate would hide HighlightText; its focus ring stays a system colour.
  "data-pressed:[--ouro-bg:color-mix(in_oklab,var(--primary)_10%,transparent)] data-pressed:text-[color-mix(in_oklab,var(--primary)_80%,var(--foreground))] contrast-more:data-pressed:[--ouro-bd:currentColor] " +
  "forced-colors:data-pressed:forced-color-adjust-none forced-colors:data-pressed:[--ouro-bd:Highlight] forced-colors:data-pressed:[--ouro-bg:Highlight] " +
  "forced-colors:data-pressed:text-[HighlightText] forced-colors:data-pressed:outline-[CanvasText]";

/**
 * Height and padding read two variables, so the toggle has one unprefixed `h-*` and `px-*`
 * class and the app's own replaces it at every width. Phones keep 16px text and the phone
 * height; the desktop density applies from `sm` with a fine pointer only, so a landscape
 * phone keeps it too.
 *
 * @internal
 * @claim "Phones keep 16px text and the" registry/ouro/components/ouro/toggle/toggle.touch.test.tsx verify:testExists(registry/ouro/components/ouro/toggle/toggle.touch.test.tsx::keeps 44px toggles and 16px text on a landscape phone, past the sm breakpoint)
 * @claim "Phones keep 16px text and the" registry/ouro/components/ouro/toggle/toggle.test.tsx verify:testExists(registry/ouro/components/ouro/toggle/toggle.test.tsx::Toggle looks > is 44px tall on phones and steps down with a fine pointer from sm, per size)
 * @claim "Height and padding read two variables" registry/ouro/components/ouro/toggle/toggle-styles.ts verify:fileLine(registry/ouro/components/ouro/toggle/toggle-styles.ts, /h-\[max\(var\(--ouro-toggle-h\),var\(--ouro-size-6\)\)\]\spx-\(--ouro-toggle-px\)/)
 * @claim "Height and padding read two variables" registry/ouro/components/ouro/toggle/toggle.test.tsx verify:testExists(registry/ouro/components/ouro/toggle/toggle.test.tsx::Toggle > lets app layout classes win)
 */
const sizes = {
  xs:
    "h-[max(var(--ouro-toggle-h),var(--ouro-size-6))] px-(--ouro-toggle-px) gap-1 text-sm sm:pointer-fine:text-xs [--ouro-toggle-h:calc(var(--spacing)*8)] [--ouro-toggle-px:calc(var(--spacing)*3)] " +
    "sm:pointer-fine:[--ouro-toggle-h:calc(var(--spacing)*6)] sm:pointer-fine:[--ouro-toggle-px:calc(var(--spacing)*2.5)]",
  sm:
    "h-[max(var(--ouro-toggle-h),var(--ouro-size-6))] px-(--ouro-toggle-px) gap-1.5 text-sm [--ouro-toggle-h:calc(var(--spacing)*9)] [--ouro-toggle-px:calc(var(--spacing)*3)] " +
    "sm:pointer-fine:[--ouro-toggle-h:calc(var(--spacing)*8)] sm:pointer-fine:[--ouro-toggle-px:calc(var(--spacing)*2.5)]",
  md:
    "h-[max(var(--ouro-toggle-h),var(--ouro-size-6))] px-(--ouro-toggle-px) gap-2 text-base sm:pointer-fine:text-sm [--ouro-toggle-h:calc(var(--spacing)*11)] [--ouro-toggle-px:calc(var(--spacing)*3.5)] " +
    "sm:pointer-fine:[--ouro-toggle-h:calc(var(--spacing)*9)] sm:pointer-fine:[--ouro-toggle-px:calc(var(--spacing)*3)]",
  lg:
    "h-[max(var(--ouro-toggle-h),var(--ouro-size-6))] px-(--ouro-toggle-px) gap-2 text-base [--ouro-toggle-h:calc(var(--spacing)*12)] [--ouro-toggle-px:calc(var(--spacing)*4)] " +
    "sm:pointer-fine:[--ouro-toggle-h:calc(var(--spacing)*11)]",
} as const;

/**
 * A toggle size.
 *
 * @internal
 */
type ToggleSize = keyof typeof sizes;

/**
 * `rect` has the theme's corners (`--radius`) and medium text; `pill` is fully rounded with
 * regular-weight text, as filter chips are. An icon-only pill is a circle.
 *
 * @internal
 * @claim "`pill` is fully rounded with regular-weight" registry/ouro/components/ouro/toggle/toggle.test.tsx verify:testExists(registry/ouro/components/ouro/toggle/toggle.test.tsx::Toggle looks > rounds fully with regular-weight text with shape pill)
 */
const shapes = {
  rect: "rounded-ouro-control font-medium",
  pill: "rounded-full font-normal",
} as const;

/**
 * A toggle shape.
 *
 * @internal
 */
type ToggleShape = keyof typeof shapes;

/**
 * An icon-only toggle is as wide as it is tall.
 *
 * @internal
 */
const squareClass = "aspect-square px-0 pointer-fine:min-w-ouro-6";

/**
 * `plain` has no border until it is pressed; `outline` always has one, in the primary tone while pressed.
 * Forced colours draw no border on an unpressed plain toggle at rest, since its colour is transparent:
 * pressed keeps its border, in the Highlight colour from toggleBase above.
 *
 * @internal
 * @claim "`plain` has no border until it" registry/ouro/components/ouro/toggle/toggle.test.tsx verify:testExists(registry/ouro/components/ouro/toggle/toggle.test.tsx::Toggle looks > draws a border with variant outline)
 * @claim "Forced colours draw no border on an unpressed plain toggle" registry/ouro/components/ouro/toggle/toggle.test.tsx verify:testExists(registry/ouro/components/ouro/toggle/toggle.test.tsx::Toggle under forced colours > draws no border on an unpressed plain toggle at rest, and keeps the Highlight border once pressed (#3098))
 */
const looks = {
  plain: "[--ouro-bd:transparent] [--ouro-bg:transparent] text-foreground forced-colors:not-data-pressed:border-0",
  outline: "[--ouro-bd:var(--border)] [--ouro-bg:transparent] text-foreground data-pressed:[--ouro-bd:color-mix(in_oklab,var(--primary)_45%,transparent)]",
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
 * {@link ToggleGroupBaseProps.overflow} `"scroll"`: the row keeps to one line and scrolls
 * sideways, with its scrollbar hidden and the fade {@link scrollFadeClass} draws at a cut edge
 * (a fine pointer's wheel still scrolls it; `overscroll-x-contain` keeps a swipe at either end
 * from paging back). Forced colours, which flatten the fade, keep an outline around the row
 * instead, as a second sign that it scrolls.
 *
 * @internal
 */
const overflowScrollerClass = cn(
  "flex-nowrap overflow-x-auto overflow-y-hidden overscroll-x-contain " +
    "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden " +
    "forced-colors:rounded-ouro-md forced-colors:outline-1 forced-colors:outline-solid forced-colors:-outline-offset-1",
  scrollFadeClass,
);

/**
 * The fix for an appearance class on a toggle. Development only.
 *
 * @internal
 */
function toggleHint(component: string): (token: string) => string {
  return (token) => {
    const size = sizeFor(token, ["xs", "sm", "md", "lg", "lg", "lg", "lg"]);
    if (size) return `<${component} size="${size}">`;
    if (token === "rounded-full") return `<${component} shape="pill">`;
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
 * The dev message for a shape that is not one of the toggle's. A round guess points to `pill`. Development only.
 *
 * @internal
 */
function toggleShapeWarning(component: string, shape: string): readonly [string, string] {
  const round = /round|full|circle|chip/i.test(shape);
  return [`shape="${shape}" is not a shape`, round ? `<${component} shape="pill">` : `<${component}>`];
}

/**
 * The dev message for a size that is not one of the toggle's. Development only.
 *
 * @internal
 */
function toggleSizeWarning(component: string, size: string): readonly [string, string] {
  return [`size="${size}" is not a size`, `<${component} size="md">`];
}

/**
 * The dev message for an overflow that is not `"wrap"` or `"scroll"`. Development only.
 *
 * @internal
 */
function toggleOverflowWarning(overflow: string): readonly [string, string] {
  return [`overflow="${overflow}" is not an overflow`, '<ToggleGroup overflow="scroll">'];
}
