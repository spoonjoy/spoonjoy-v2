"use client";

import { useState, type HTMLAttributes, type JSX, type Ref } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";

/** The props Cover adds to the `<div>` attributes it passes through. */
export interface CoverOwnProps {
  /**
   * What the cover belongs to: "Lemon rice". Without a picture, its first letter is the tile's
   * mark. Required, so a tile without a picture still has a letter.
   * @claim "its first letter is the tile's mark" registry/ouro/components/ouro/cover/cover.test.tsx verify:testExists(registry/ouro/components/ouro/cover/cover.test.tsx::Cover > draws the title's first letter in the heading font, in the primary toward the foreground, on a wash from the muted color toward the primary, without a picture)
   */
  title: string;
  /**
   * The picture's address. Without it, or when it fails to load, the cover is the title's
   * initial on a tinted tile.
   * @claim "or when it fails to load" registry/ouro/components/ouro/cover/cover.test.tsx verify:testExists(registry/ouro/components/ouro/cover/cover.test.tsx::Cover > falls back to the initial when the picture fails to load)
   */
  src?: string | undefined;
  /**
   * What the cover shows, for a screen reader. Leave it out where the title is already beside the
   * cover, as in a list row: the cover is then decoration. @default ""
   * @claim "the cover is then decoration" registry/ouro/components/ouro/cover/cover.test.tsx verify:testExists(registry/ouro/components/ouro/cover/cover.test.tsx::Cover > is decoration without alt, and an image named by alt with it, picture or initial)
   */
  alt?: string | undefined;
  /**
   * How big the cover is: `sm` (40px) for a dense row, `md` (56px) for a list row, `lg` (96px)
   * for a card, and `fill`, as wide as its container, for a page's hero (set its aspect with
   * `className`, such as `aspect-video`). @default "md"
   * @claim "`sm` (40px) for a dense row" registry/ouro/components/ouro/cover/cover.test.tsx verify:testExists(registry/ouro/components/ouro/cover/cover.test.tsx::Cover > is 40, 56 and 96px square at sm, md and lg, and as wide as its container at fill)
   */
  size?: "sm" | "md" | "lg" | "fill" | (string & { 'Use "sm", "md", "lg" or "fill"': never }) | undefined;
  /**
   * `rounded` (the theme's lg corner) or `square`, for a cover that runs to the edges of its slot,
   * such as a page's hero on a phone. @default "rounded"
   */
  shape?: "rounded" | "square" | (string & { 'Use "rounded" or "square"': never }) | undefined;
  /** Layout only: margins, aspect for `size="fill"` (`aspect-video`). Appearance classes warn in development. */
  className?: string | undefined;
  ref?: Ref<HTMLDivElement> | undefined;

  /** Not a prop. The picture's address is `src`: `<Cover title="…" src={url} />`. */
  image?: { 'Use src={url}': never };
  /** Not a prop. The title is `title`: `<Cover title="Lemon rice" />`. */
  name?: { 'Use title="Lemon rice"': never };
  /** Not a prop. The letter comes from `title`: `<Cover title="Lemon rice" />`. */
  initials?: { 'Use title="Lemon rice"; the cover takes its first letter': never };
}

/** Props for {@link Cover}: its own props and the `<div>` attributes it passes through. */
export type CoverProps = Omit<HTMLAttributes<HTMLDivElement>, keyof CoverOwnProps> & CoverOwnProps;

const sizes = { sm: "size-ouro-10", md: "size-ouro-14", lg: "size-ouro-24", fill: "w-full aspect-square" } as const;

/**
 * A thing's cover: its picture, or, without one, the first letter of its title in the theme's
 * heading font on a wash from the muted color toward the primary. Use it beside a recipe, a book
 * or an album in a list row, on a card, or at full width as a page's hero. A theme sets the wash
 * with `--ouro-cover-from` and `--ouro-cover-to`, and the letter's color with `--ouro-cover-ink`.
 *
 * Use `Avatar` instead for a person or an account, and `AspectRatio` instead for a picture
 * that always has one.
 *
 * @group Display
 * @see https://ui.ouroboros.bot/docs/cover
 *
 * @example
 * <Cover title="Lemon rice" src={recipe.coverUrl} />
 */
export function Cover(props: CoverProps): JSX.Element {
  const {
    title,
    src,
    alt = "",
    // Stryker disable next-line StringLiteral: a size that is not one falls back to "md", so the default's value is the fallback's.
    size: sizeProp = "md",
    shape: shapeProp = "rounded",
    className,
    // Guard props (hint types), dropped here so they never reach the DOM.
    image,
    name,
    initials,
    ...rest
  } = props;
  const size = Object.hasOwn(sizes, sizeProp) ? (sizeProp as keyof typeof sizes) : "md";
  const shape = shapeProp === "square" ? "square" : "rounded";
  const [failed, setFailed] = useState<string | undefined>(undefined);
  useAppearanceClassNameCheck(
    "Cover",
    className,
    process.env.NODE_ENV !== "production"
      ? (token: string) => `remove "${token}"; Cover sets its own look from the theme`
      : // Stryker disable next-line StringLiteral: production only; the check never runs there.
        /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "Cover",
    process.env.NODE_ENV !== "production"
      ? () => [
          size !== sizeProp && [`size="${String(sizeProp)}" is not a size; use "sm", "md", "lg" or "fill"`, '<Cover size="md" />'],
          shape !== shapeProp && [`shape="${String(shapeProp)}" is not a shape; use "rounded" or "square"`, '<Cover shape="square" />'],
          image !== undefined && ["image is not a prop", "<Cover src={url} />"],
          name !== undefined && ["name is not a prop", `<Cover title="${typeof name === "string" ? name : "..."}" />`],
          initials !== undefined && ["initials is not a prop", '<Cover title="..." />'],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  const picture = Boolean(src) && failed !== src;
  // Array.from splits by code point, so an emoji keeps both halves of its surrogate pair.
  const initial = Array.from(title.trim())[0]?.toLocaleUpperCase() ?? "";
  return (
    <div
      {...rest}
      data-ouro="cover"
      data-size={size}
      data-shape={shape}
      role={!picture && alt ? "img" : undefined}
      aria-label={!picture && alt ? alt : undefined}
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden [container-type:size]",
        "bg-[linear-gradient(135deg,var(--ouro-cover-from,var(--muted)),var(--ouro-cover-to,color-mix(in_oklab,var(--primary)_32%,var(--muted))))]",
        "forced-colors:border forced-colors:border-solid",
        shape === "rounded" ? "rounded-ouro-lg" : "rounded-none",
        sizes[size],
        className,
      )}
    >
      {picture ? (
        <img src={src} alt={alt} onError={() => setFailed(src)} className="absolute inset-0 size-full object-cover" />
      ) : (
        <span aria-hidden="true" className="font-[family-name:var(--font-heading,inherit)] text-[42cqh] leading-none font-semibold text-(--ouro-cover-ink,color-mix(in_oklab,var(--primary)_60%,var(--foreground)))">
          {initial}
        </span>
      )}
    </div>
  );
}
