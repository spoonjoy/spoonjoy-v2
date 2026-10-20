"use client";

import type { HTMLAttributes, JSX, ReactNode, Ref } from "react";
import { fontFor, sizeFor, toneFor } from "~/lib/ouro/appearance-hints";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { devThrow } from "~/lib/ouro/dev";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { alignClasses, checkAlign, type TextAlign } from "~/components/ouro/text/text-styles";

/** A heading size from the theme's type scale. `display` is for a page's hero headline. */
export type HeadingSize = "sm" | "md" | "lg" | "xl" | "2xl" | "display";

/** Props for {@link Heading}. */
export interface HeadingProps extends Omit<HTMLAttributes<HTMLHeadingElement>, "color" | "className" | "children"> {
  /**
   * Outline level: sets the tag (`level={2}` renders `<h2>`). Required, because
   * the level is about document structure, not looks; use `size` to change how
   * big it looks.
   */
  level: 1 | 2 | 3 | 4 | 5 | 6 | (number & { 'Use 1 to 6; size sets the look': never });
  /**
   * Visual size, independent of the level. `display` is the hero headline of a
   * landing page, tightly set and larger from the `sm` breakpoint: `<Heading level={1} size="display">`.
   * @default derived from `level` (1 is `2xl`, 2 is `xl`, 3 is `lg`, 4 is `md`, 5 and 6 are `sm`)
   */
  size?: HeadingSize | (string & { 'Use "sm", "md", "lg", "xl", "2xl" or, larger, "display"': never }) | undefined;
  /** Alignment in writing direction. @default inherited */
  align?: TextAlign | (string & { 'Use "start", "center" or "end": left is "start", right is "end"': never }) | undefined;
  /**
   * Layout only: margins, width, grid placement (`mb-2`). Appearance classes
   * warn in development; use `size` and `align`.
   */
  className?: string | undefined;
  /** The heading text. */
  children: ReactNode;
  ref?: Ref<HTMLHeadingElement> | undefined;
  /** Not a prop. The tag comes from `level`: `<Heading level={2}>`. */
  as?: { 'Use <Heading level={2}>': never };
  /** Not a prop. Headings use the theme's foreground color; for colored text use `<Text tone="…">`. */
  color?: { 'Use <Text tone="primary">': never };
}

const sizes = {
  sm: "text-base",
  md: "text-lg tracking-[-0.01em]",
  lg: "text-xl tracking-[-0.015em]",
  xl: "text-2xl tracking-[-0.02em]",
  "2xl": "text-3xl tracking-[-0.025em]",
  display: "text-[2.5rem] leading-[1.05] tracking-[-0.035em] sm:text-6xl sm:leading-[1.02]",
} as const;

const sizeByLevel = { 1: "2xl", 2: "xl", 3: "lg", 4: "md", 5: "sm", 6: "sm" } as const;

function headingHint(token: string): string {
  if (/^text-[4-9]xl$/.test(token)) return 'size="display"';
  const size = sizeFor(token, ["sm", "sm", "sm", "md", "lg", "xl", "2xl"]);
  if (size) return `size="${size}"`;
  if (token.startsWith("font-")) return fontFor("Heading", token);
  return "<Heading level={2}>…</Heading>";
}

/**
 * A section title, `<h1>` to `<h6>`, in the theme's foreground color. `level` sets
 * the tag and a default size; `size` changes only the look.
 *
 * Use `Text` instead for body copy, and for a dialog or sheet title use its
 * `title` prop, which also labels it for assistive technology.
 *
 * @group Text
 * @see https://ourostack.github.io/ouro-ui/docs/heading
 *
 * @example
 * <Heading level={1}>Recipes</Heading>
 * <Heading level={2} size="lg">Ingredients</Heading>
 * <Heading level={1} size="display">Dinner, sorted</Heading>
 */
export function Heading(props: HeadingProps): JSX.Element {
  const { level: levelProp, size: sizeProp, align: alignProp, className, ref, color, as, ...rest } = props;
  const level = levelProp as keyof typeof sizeByLevel;
  const [align, alignWarning] = checkAlign("Heading", alignProp);
  if (!(level in sizeByLevel) || typeof level !== "number") {
    devThrow(
      "Heading",
      `level must be 1, 2, 3, 4, 5 or 6, got ${JSON.stringify(level)}`,
      process.env.NODE_ENV !== "production" ? "<Heading level={2}>" : /* istanbul ignore next @preserve -- production only */ "",
    );
  }
  // A size that is not one of Ouro UI's (a type error) warns and renders the level's default.
  const size = sizeProp !== undefined && Object.hasOwn(sizes, sizeProp) ? (sizeProp as HeadingSize) : sizeByLevel[level];
  useAppearanceClassNameCheck(
    "Heading",
    className,
    process.env.NODE_ENV !== "production" ? headingHint : /* istanbul ignore next @preserve -- production only */ "",
    process.env.NODE_ENV !== "production" ? 'align="center"' : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  useDevWarnings(
    "Heading",
    process.env.NODE_ENV !== "production"
      ? () => [
          alignWarning,
          color !== undefined && [
            "color is not a prop; headings use the theme foreground color",
            `<Text tone="${toneFor(`text-${String(color)}`)}">`,
          ],
          sizeProp !== undefined &&
            size !== sizeProp && [
              `size="${String(sizeProp)}" is not a size; use ${Object.keys(sizes).map((name) => `"${name}"`).join(", ")}`,
              `<Heading level={${level}} size="${/^\d+xl$/.test(String(sizeProp)) ? "display" : sizeByLevel[level]}">`,
            ],
          as !== undefined && [
            "as is not a prop; level sets the tag",
            `<Heading level={${/^h[1-6]$/.test(String(as)) ? String(as).slice(1) : 2}}>`,
          ],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  const Tag = `h${level}` as const;
  const classes = cn(
    "[@layer_ouro-reset]:m-0 font-[family-name:var(--font-heading,inherit)] font-semibold text-balance text-foreground",
    sizes[size],
    align && alignClasses[align],
    className,
  );
  return <Tag {...rest} ref={ref} data-ouro="heading" className={classes} />;
}
