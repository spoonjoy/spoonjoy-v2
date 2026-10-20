"use client";

import { Separator as BaseSeparator } from "@base-ui/react/separator";
import type { HTMLAttributes, JSX, Ref } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";

/** The props Separator adds to the `<div>` attributes it passes through. */
export interface SeparatorOwnProps {
  /**
   * `horizontal` spans the width of its container between stacked content; `vertical`
   * stands as tall as its row between side-by-side items (put it in a flex row).
   * @default "horizontal"
   */
  orientation?: "horizontal" | "vertical" | (string & { 'Use "horizontal" or "vertical"': never }) | undefined;
  /**
   * Hides the line from screen readers (`role="none"`). Use it when the line only
   * decorates, such as between a heading and its text; leave it off when it divides
   * two groups of content a reader should hear as separate.
   */
  decorative?: boolean | undefined;
  /** Layout only: margins, width, flex sizing (`my-4`, `flex-1`). Appearance classes warn in development. */
  className?: string | undefined;
  ref?: Ref<HTMLDivElement> | undefined;

  /** Not a prop. Ouro UI uses `orientation`: `<Separator orientation="vertical" />`. */
  vertical?: { 'Use <Separator orientation="vertical" />': never };
  /** Not a prop. A separator has no content; put a label beside it. */
  children?: { 'Separator takes no children; put a <Text> between two Separators': never };
}

/** Props for {@link Separator}: its own props and the `<div>` attributes it passes through. */
export type SeparatorProps = Omit<HTMLAttributes<HTMLDivElement>, keyof SeparatorOwnProps | "role"> & SeparatorOwnProps;

const orientations = {
  horizontal: "h-px w-full",
  vertical: "w-px self-stretch",
} as const;

/**
 * A thin line in the theme's border color between groups of content, horizontal or
 * vertical. Built on Base UI's Separator, so it is a `role="separator"` with its
 * orientation for screen readers, unless `decorative`.
 *
 * Use spacing (margins or a gap) instead when whitespace alone separates the groups,
 * and a `Heading` when the next group needs a name.
 *
 * @group Display
 * @see https://ourostack.github.io/ouro-ui/docs/separator
 *
 * @example
 * <Separator className="my-4" />
 * <div className="flex items-center gap-3">
 *   <Button variant="plain">Edit</Button>
 *   <Separator orientation="vertical" />
 *   <Button variant="plain">Share</Button>
 * </div>
 */
export function Separator(props: SeparatorProps): JSX.Element {
  const {
    orientation: orientationProp = "horizontal",
    decorative,
    className,
    // Guard props (hint types), dropped here so they never reach the DOM.
    vertical,
    children,
    ...rest
  } = props;
  // An orientation that is not one of Ouro UI's (a type error) warns and renders horizontal.
  const orientation = Object.hasOwn(orientations, orientationProp) ? (orientationProp as keyof typeof orientations) : "horizontal";
  useAppearanceClassNameCheck(
    "Separator",
    className,
    process.env.NODE_ENV !== "production"
      ? (token: string) => `remove "${token}"; Separator uses the theme's --border color`
      : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "Separator",
    process.env.NODE_ENV !== "production"
      ? () => [
          vertical !== undefined && ["vertical is not a prop", '<Separator orientation="vertical" />'],
          orientation !== orientationProp && [
            `orientation="${String(orientationProp)}" is not an orientation; use "horizontal", "vertical"`,
            /col|vert|^y$/i.test(String(orientationProp)) ? '<Separator orientation="vertical" />' : '<Separator orientation="horizontal" />',
          ],
          children !== undefined && [
            "Separator takes no children",
            '<div className="flex items-center gap-3"><Separator className="flex-1" /><Text>or</Text><Separator className="flex-1" /></div>',
          ],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  return (
    <BaseSeparator
      {...rest}
      orientation={orientation}
      {...(decorative ? { role: "none", "aria-orientation": undefined } : {})}
      data-ouro="separator"
      className={cn("shrink-0 border-0 bg-border", orientations[orientation], className)}
    />
  );
}
