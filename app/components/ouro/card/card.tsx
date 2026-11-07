"use client";

import { createElement, type HTMLAttributes, type JSX, type ReactNode, type Ref } from "react";
import { radiusFor } from "~/lib/ouro/appearance-hints";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { RouterLink, safeRel } from "~/lib/ouro/router-link";
import { raiseControlsClass, stretchedLinkClass } from "~/lib/ouro/stretched-link";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import { Heading } from "~/components/ouro/text/heading";
import { Text } from "~/components/ouro/text/text";

/**
 * The props every Card takes, with or without `href`.
 *
 * @claim "The props every Card takes, with" registry/ouro/components/ouro/card/card.tsx verify:fileLine(registry/ouro/components/ouro/card/card.test-d.ts, /expectTypeOf<\{ href: "\/cookbooks\/1" \}>\(\)\.toExtend<CardProps>\(\)/)
 */
export interface CardOwnProps {
  /** The card's title, as a heading. With `href` it is the link's text, so a linked card needs one. */
  title?: ReactNode;
  /**
   * Makes the whole card one link, with one tab stop, named by its `title`. Internal paths
   * go through `OuroProvider`'s `linkComponent`, as with `Link`. Controls in any slot (a
   * share button over the `media`, a link in the body, a button in `action` or `footer`)
   * stay their own tab stops and take their own clicks and taps.
   */
  href?: string | undefined;
  /** With `href`: opens the link in a new tab, safely, and tells screen readers so. */
  external?: boolean | undefined;
  /** With `href`: a ref to the link's `<a>`, to move focus to it (as a "Show more" does for the first new card). */
  linkRef?: Ref<HTMLAnchorElement> | undefined;
  /** A sentence or a count under the title: "12 recipes". */
  description?: ReactNode;
  /**
   * One control beside the title, at the end: a menu or a share button. With `href` it
   * stays its own tab stop, above the link.
   */
  action?: ReactNode;
  /**
   * An image or video across the top, edge to edge: usually an `AspectRatio` around an
   * `<img>`, so the card keeps its shape while the image loads.
   */
  media?: ReactNode;
  /** The card's body, under the title. */
  children?: ReactNode;
  /** A row at the bottom for buttons or a timestamp. With `href`, controls here stay their own tab stops. */
  footer?: ReactNode;
  /**
   * Below this breakpoint the `action` drops under the title and description, as in a
   * settings panel on a phone. Without it the action stays beside the title at every width.
   * @claim "Without it the action stays beside" registry/ouro/components/ouro/card/card.test.tsx verify:testExists(registry/ouro/components/ouro/card/card.test.tsx::Card > keeps the action beside the title on a phone without stackBelow)
   */
  stackBelow?: "sm" | "md" | (string & { 'Use "sm" (640px) or "md" (768px)': never }) | undefined;
  /**
   * The title's heading level. Pick the level below the section the card sits in.
   * @default 3
   */
  headingLevel?: 2 | 3 | 4 | 5 | 6 | (number & { "Use 2 to 6, one below the section's heading": never }) | undefined;
  /**
   * `outline` is a bordered surface in the theme's card colors; `plain` has no frame or
   * padding, for a card's structure inside a surface of your own.
   * @default "outline"
   * @claim "`outline` is a bordered surface in" registry/ouro/components/ouro/card/card.test.tsx verify:testExists(registry/ouro/components/ouro/card/card.test.tsx::Card > is a bordered surface in the card colors, with 24px padding)
   * @claim "`outline` is a bordered surface in" registry/ouro/components/ouro/card/card.test.tsx verify:testExists(registry/ouro/components/ouro/card/card.test.tsx::Card > has no frame or padding with variant=plain)
   */
  variant?: "outline" | "plain" | (string & { 'Use "outline" or "plain"; elevation comes from the theme': never }) | undefined;
  /**
   * Padding: `md` is 24px, `sm` 16px for dense grids. @default "md"
   *
   * @claim "Padding: `md` is 24px, `sm` 16px" registry/ouro/components/ouro/card/card.test.tsx verify:testExists(registry/ouro/components/ouro/card/card.test.tsx::Card > is a bordered surface in the card colors, with 24px padding)
   * @claim "Padding: `md` is 24px, `sm` 16px" registry/ouro/components/ouro/card/card.test.tsx verify:testExists(registry/ouro/components/ouro/card/card.test.tsx::Card > is tighter with size=sm)
   */
  size?: "md" | "sm" | (string & { 'Use "md" or "sm"': never }) | undefined;
  /**
   * The element to render: `li` in a list of cards, `article` for a self-contained item.
   * @default "div"
   */
  as?: "div" | "article" | "section" | "li" | (string & { 'Use "div", "article", "section" or "li"; for a link use href': never }) | undefined;
  /** Layout only: margins, width, grid placement (`col-span-2`). Appearance classes warn in development; use `variant`. */
  className?: string | undefined;
  ref?: Ref<HTMLElement> | undefined;

  /** Not a prop. Ouro UI uses `description`: `<Card description="12 recipes">`. */
  subtitle?: { 'Use <Card description="12 recipes">': never };
  /** Not a prop. Ouro UI uses `media`: `<Card media={<AspectRatio ratio={4 / 3}><img … /></AspectRatio>}>`. */
  image?: { "Use <Card media={<AspectRatio ratio={4 / 3}>...</AspectRatio>}>": never };
  /** Not a prop. The header is `title`, `description` and `action`. */
  header?: { 'Use <Card title="..." description="..." action={...}>': never };
  /** Not a prop. Ouro UI uses `action` beside the title, or `footer` below the body. */
  actions?: { "Use <Card action={<Button>...</Button>}> or footer={...}": never };
  /** Not a prop. Ouro UI uses `href`, for router links too: `<Card href="/recipes/1" title="…">`. */
  to?: { 'Use <Card href="/recipes/1" title="...">': never };
  /** Not a prop. With `href` the whole card is a link: `<Card href="/recipes/1" title="…">`. */
  asChild?: { 'Use <Card href="/recipes/1" title="...">': never };
}

/**
 * Props for {@link Card}. With `href` the whole card is a link, named by its `title`. They
 * are one flat type, not a union on `href`: a union would drop the editor's hover docs on
 * `title` whenever another prop has a type error, so a link without a title is a
 * development message instead.
 */
export type CardProps = Omit<HTMLAttributes<HTMLElement>, keyof CardOwnProps> & CardOwnProps;

const elements = ["div", "article", "section", "li"] as const;
const levels = [2, 3, 4, 5, 6] as const;

const variants = {
  outline: "rounded-xl border border-border bg-card text-card-foreground shadow-(--shadow-xs)",
  plain: "bg-transparent text-foreground",
} as const;

// Vertical padding and gap on the root, inline padding on each section, so media can run edge to edge.
const rootSizes = {
  outline: { md: "gap-6 py-6", sm: "gap-4 py-4" },
  plain: { md: "gap-4 py-0", sm: "gap-3 py-0" },
} as const;
const inset = { outline: { md: "px-6", sm: "px-4" }, plain: { md: "px-0", sm: "px-0" } } as const;
const mediaPull = { outline: { md: "-mt-6", sm: "-mt-4" }, plain: { md: "rounded-xl", sm: "rounded-lg" } } as const;

// With href, the title's link stretches over the card (`stretchedLinkClass`), so the whole
// card is one link with one tab stop, and every control in any slot (a share button over
// the cover, a link in the body) sits above it (`raiseControlsClass`). A linked Item
// inside is raised whole, so its own stretched link keeps covering its row.
const linkRoot =
  "press cursor-pointer outline-ring -outline-offset-2 has-[[data-card-link]:focus-visible]:outline-2 has-[[data-card-link]:focus-visible]:outline-solid " +
  "motion-safe:has-[[data-card-link]:active]:scale-(--ouro-press-scale)";

// Below the breakpoint the header's action drops under the title, at the start.
const headerStacked = { sm: "max-sm:flex-col max-sm:gap-3", md: "max-md:flex-col max-md:gap-3" } as const;

function cardHint(token: string): string {
  if (token.startsWith("rounded")) return radiusFor(token);
  return `<Card variant="plain"> inside your own surface, or the theme's --card color`;
}

/**
 * A surface that groups one thing's content: a media slot across the top, a title with a
 * description and an action, a body, and a footer. With `href` the whole card is one link,
 * named by its title, with one tab stop, and its action and footer controls stay their own.
 *
 * Use `Item` instead for a compact row in a list (media, title, description and actions
 * side by side), and `Stack` when the group needs no surface.
 *
 * @group Display
 * @see https://ui.ouro.bot/docs/card
 *
 * @example
 * <Card title="Pantry" description="What you have on hand" action={<Button variant="plain">Edit</Button>}>
 *   <Text>Flour, rice, black beans.</Text>
 * </Card>
 * <Card
 *   href="/cookbooks/weeknight"
 *   media={<AspectRatio ratio={4 / 3}><img src={cover} alt="" /></AspectRatio>}
 *   title="Weeknight dinners"
 *   description="12 recipes"
 * />
 */
export function Card(props: CardProps): JSX.Element {
  const {
    href,
    title,
    external,
    linkRef,
    description,
    action,
    media,
    children,
    footer,
    stackBelow: stackBelowProp,
    headingLevel = 3,
    variant: variantProp = "outline",
    size: sizeProp = "md",
    as: asProp = "div",
    className,
    subtitle,
    image,
    header,
    actions,
    to,
    asChild,
    ...rest
  } = props;
  const variant = Object.hasOwn(variants, variantProp) ? (variantProp as keyof typeof variants) : "outline";
  const size: "md" | "sm" = sizeProp === "sm" ? "sm" : "md";
  const element = (elements as readonly string[]).includes(asProp) ? (asProp as (typeof elements)[number]) : "div";
  const level = (levels as readonly unknown[]).includes(headingLevel) ? (headingLevel as (typeof levels)[number]) : 3;
  const stackBelow: "sm" | "md" | undefined = stackBelowProp === "sm" ? "sm" : stackBelowProp === "md" ? "md" : undefined;
  const linked = href !== undefined && Boolean(title);
  useAppearanceClassNameCheck(
    "Card",
    className,
    process.env.NODE_ENV !== "production" ? cardHint : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "Card",
    process.env.NODE_ENV !== "production"
      ? () => [
          href !== undefined && !title && ["href needs a title, which is the link's text", `<Card href="${href}" title="Weeknight dinners">`],
          variant !== variantProp && [`variant="${String(variantProp)}" is not a variant; use "outline", "plain"`, '<Card variant="outline">'],
          size !== sizeProp && [`size="${String(sizeProp)}" is not a size; use "md", "sm"`, '<Card size="md">'],
          stackBelowProp !== undefined &&
            stackBelow !== stackBelowProp && [`stackBelow="${String(stackBelowProp)}" is not a breakpoint; use "sm", "md"`, '<Card stackBelow="sm">'],
          element !== asProp && [
            `as="${String(asProp)}" is not an element Card renders; use ${elements.map((name) => `"${name}"`).join(", ")}`,
            asProp === "a" ? '<Card href="/path" title="…">' : '<Card as="div">',
          ],
          level !== headingLevel && [`headingLevel must be 2, 3, 4, 5 or 6, got ${String(headingLevel)}`, "<Card headingLevel={2}>"],
          subtitle !== undefined && ["subtitle is not a prop", `<Card description="${String(subtitle)}">`],
          image !== undefined && ["image is not a prop", '<Card media={<AspectRatio ratio={4 / 3}><img src=… alt="" /></AspectRatio>}>'],
          header !== undefined && ["header is not a prop", '<Card title="…" description="…" action={…}>'],
          actions !== undefined && ["actions is not a prop", "<Card action={<Button>…</Button>}> beside the title, or footer={…} below"],
          to !== undefined && ["to is not a prop", `<Card href="${typeof to === "string" ? to : "/path"}" title="…">`],
          asChild !== undefined && ["asChild is not a prop", '<Card href="/path" title="…">'],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  const pad = inset[variant][size];
  const heading = title ? (
    <Heading level={level} size={size === "sm" ? "sm" : "md"}>
      {linked ? (
        <RouterLink
          href={href}
          ref={linkRef}
          target={external ? "_blank" : undefined}
          rel={external ? safeRel(undefined) : undefined}
          data-card-link=""
          data-stretched-link=""
          data-ouro-control="card"
          data-ouro-part="link"
          className={stretchedLinkClass}
        >
          {title}
          {external && <span className="sr-only"> (opens in a new tab)</span>}
        </RouterLink>
      ) : (
        title
      )}
    </Heading>
  ) : null;
  return createElement(
    element,
    {
      ...rest,
      "data-ouro": "card",
      "data-linked": linked ? "" : undefined,
      className: cn(
        "relative isolate flex min-w-0 list-none flex-col overflow-hidden",
        variants[variant],
        rootSizes[variant][size],
        linked && linkRoot,
        linked && raiseControlsClass,
        className,
      ),
    },
    media && <div className={cn("relative overflow-hidden", mediaPull[variant][size])}>{media}</div>,
    (heading || description || action) && (
      <div className={cn("flex items-start gap-4", stackBelow && headerStacked[stackBelow], pad)}>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {heading}
          {description && (
            <Text as="div" size="sm" tone="muted">
              {description}
            </Text>
          )}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
    ),
    children && <div className={cn("min-w-0", pad)}>{children}</div>,
    footer && <div className={cn("flex flex-wrap items-center gap-2", pad)}>{footer}</div>,
  );
}
