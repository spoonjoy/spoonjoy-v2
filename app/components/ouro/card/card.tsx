"use client";

import { createElement, useId, type HTMLAttributes, type JSX, type MouseEvent, type ReactNode, type Ref } from "react";
import { radiusFor } from "~/lib/ouro/appearance-hints";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { RouterLink, safeRel } from "~/lib/ouro/router-link";
import { followStretchedLink, raiseControlsClass, stretchedLinkClass } from "~/lib/ouro/stretched-link";
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
   * With `href` and `media`: the media's pictures (`img` and `video`) grow by 3% while the pointer
   * rests on the card or keyboard focus is in it, over `--ouro-duration-base` on
   * `--ouro-ease-out`, inside the media's frame, so the card's shape and size never change. With
   * reduced motion they hold still. Nothing fades.
   * @claim "the media's pictures (`img` and `video`)" registry/ouro/components/ouro/card/card.test.tsx verify:testExists(registry/ouro/components/ouro/card/card.test.tsx::Card with href, zoomMedia and revealDescription > grows the media's picture 3% inside its frame while the pointer rests on the card or keyboard focus is in it, and not with reduced motion)
   */
  zoomMedia?: boolean | undefined;
  /**
   * With `href` and `description`: on a screen with a mouse the description waits, transparent
   * and keeping its room, until the pointer rests on the card or keyboard focus is in it, then
   * fades in. On a touch screen it shows from the start. Screen readers read it while it is
   * transparent too, and the link names it as its description, so a person who tabs to the card
   * hears it.
   *
   * With `"rise"`, and `media` too, the title sits on the bottom of the media, and the
   * description stays folded away until the pointer rests on the card or keyboard focus is in it,
   * then rises over the media, while the card's box stays the same. On a touch screen a rising
   * description shows from the start. With reduced motion a rising description fades in place.
   * @claim "Screen readers read it while it" registry/ouro/components/ouro/card/card.test.tsx verify:testExists(registry/ouro/components/ouro/card/card.test.tsx::Card with href, zoomMedia and revealDescription > shows the description on hover or keyboard focus, keeping its room, and names it as the link's description)
   * @claim "On a touch screen it shows" registry/ouro/components/ouro/card/card.touch.test.tsx verify:testExists(registry/ouro/components/ouro/card/card.touch.test.tsx::shows a revealDescription card's description on a touch screen)
   * @claim "on a screen with a mouse" registry/ouro/components/ouro/card/card.test.tsx verify:testExists(registry/ouro/components/ouro/card/card.test.tsx::Card with href, zoomMedia and revealDescription > shows the description on hover or keyboard focus, keeping its room, and names it as the link's description)
   * @claim "the title sits on the bottom of the media" registry/ouro/components/ouro/card/card.test.tsx verify:testExists(registry/ouro/components/ouro/card/card.test.tsx::Card with href, zoomMedia and revealDescription > rises the description over the media with revealDescription="rise", taking no room before, and the card's box never changes)
   * @claim "On a touch screen a rising" registry/ouro/components/ouro/card/card.touch.test.tsx verify:testExists(registry/ouro/components/ouro/card/card.touch.test.tsx::shows a rising card's description on a touch screen)
   * @claim "With reduced motion a rising" registry/ouro/components/ouro/card/card.test.tsx verify:testExists(registry/ouro/components/ouro/card/card.test.tsx::Card with href, zoomMedia and revealDescription > with reduced motion, a rising description only fades, and nothing moves)
   */
  revealDescription?: boolean | "rise" | (string & { 'Use revealDescription, or revealDescription="rise"': never }) | undefined;
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
  /** Not a prop. A card with `href` is interactive; `zoomMedia` and `revealDescription` add hover and focus effects. */
  interactive?: { "Use <Card href=... zoomMedia revealDescription>": never };
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
  // Where corner-shape is missing, the surface slot paints the background and border instead (see ouro-base.css).
  outline:
    "rounded-ouro-xl border border-border bg-(--ouro-bg) border-(--ouro-bd) [--ouro-bg:var(--card)] [--ouro-bd:var(--border)] [--ouro-sq-w:1px] [--ouro-sq-r:calc(var(--radius)*var(--ouro-radius-scale,1)*1.4)] text-card-foreground shadow-(--shadow-xs)",
  plain: "bg-transparent text-foreground",
} as const;

// Vertical padding and gap on the root, inline padding on each section, so media can run edge to edge.
const rootSizes = {
  outline: { md: "gap-6 py-6", sm: "gap-4 py-4" },
  plain: { md: "gap-4 py-0", sm: "gap-3 py-0" },
} as const;
const inset = { outline: { md: "px-6", sm: "px-4" }, plain: { md: "px-0", sm: "px-0" } } as const;
const mediaPull = { outline: { md: "-mt-6", sm: "-mt-4" }, plain: { md: "rounded-ouro-xl", sm: "rounded-ouro-lg" } } as const;

// With href, the title's link stretches over the card (`stretchedLinkClass`), so the whole
// card is one link with one tab stop, and every control in any slot (a share button over
// the cover, a link in the body) sits above it (`raiseControlsClass`). A linked Item
// inside is raised whole, so its own stretched link keeps covering its row.
const linkRoot =
  "press cursor-pointer outline-ring -outline-offset-2 has-[[data-card-link]:focus-visible]:outline-2 has-[[data-card-link]:focus-visible]:outline-solid " +
  "motion-safe:has-[[data-card-link]:active]:scale-(--ouro-press-scale)";

// zoomMedia and revealDescription follow the card's hover with a mouse and keyboard focus anywhere in it.
// Only pictures grow: a control over the media keeps its place above the card's link.
const zoomMediaClass =
  "motion-safe:[&_:is(img,video)]:transition-transform motion-safe:[&_:is(img,video)]:duration-(--ouro-duration-base) motion-safe:[&_:is(img,video)]:ease-(--ouro-ease-out) " +
  "motion-safe:pointer-fine:group-hover/card:[&_:is(img,video)]:scale-[1.03] motion-safe:group-has-[:focus-visible]/card:[&_:is(img,video)]:scale-[1.03]";
// The rising description: no room until the card is hovered with a mouse or focus is in it, then it
// opens from nothing, and the body it is in, anchored to the media's bottom, grows up over the media.
const riseClass =
  "grid grid-rows-[1fr] transition-[grid-template-rows,opacity] duration-(--ouro-duration-base) ease-(--ouro-ease-out) " +
  "motion-reduce:transition-opacity motion-reduce:duration-(--ouro-duration-fast) " +
  "pointer-fine:[@media(hover:hover)]:not-group-hover/card:not-group-has-[:focus-visible]/card:grid-rows-[0fr] " +
  "pointer-fine:[@media(hover:hover)]:not-group-hover/card:not-group-has-[:focus-visible]/card:opacity-0";
const revealClass =
  "transition-opacity duration-(--ouro-duration-base) ease-(--ouro-ease-out) motion-reduce:duration-(--ouro-duration-fast) " +
  "pointer-fine:[@media(hover:hover)]:not-group-hover/card:not-group-has-[:focus-visible]/card:opacity-0";

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
 * A linked card can answer the pointer and the keyboard: `zoomMedia` grows its pictures a little
 * inside their frame, and `revealDescription` keeps its description back until the card is
 * hovered or focused, on a screen with a mouse; `revealDescription="rise"` lays the title on the
 * media and raises the description over it instead, from folded away. Both honour
 * reduced motion. A click anywhere on a linked card opens it, whatever the app's own layout does
 * to its parts, and a middle or Cmd/Ctrl click opens it in a new tab.
 *
 * Use `Item` instead for a compact row in a list (media, title, description and actions
 * side by side), and `Stack` when the group needs no surface.
 *
 * @group Display
 * @see https://ui.ouroboros.bot/docs/card
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
 * <Card
 *   href="/guides/braising"
 *   media={<AspectRatio ratio={4 / 3}><img src={cover} alt="" /></AspectRatio>}
 *   title="Braising"
 *   description="Low heat, a lid, and time"
 *   zoomMedia
 *   revealDescription
 * />
 * <Card
 *   href="/guides/searing"
 *   media={<AspectRatio ratio={4 / 3}><img src={cover} alt="" /></AspectRatio>}
 *   title="Searing"
 *   description="A dry pan and patience"
 *   revealDescription="rise"
 * />
 */
export function Card(props: CardProps): JSX.Element {
  const {
    href,
    title,
    external,
    linkRef,
    description,
    zoomMedia,
    revealDescription,
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
    interactive,
    ...rest
  } = props;
  const descriptionId = useId();
  const variant = Object.hasOwn(variants, variantProp) ? (variantProp as keyof typeof variants) : "outline";
  const size: "md" | "sm" = sizeProp === "sm" ? "sm" : "md";
  const element = (elements as readonly string[]).includes(asProp) ? (asProp as (typeof elements)[number]) : "div";
  const level = (levels as readonly unknown[]).includes(headingLevel) ? (headingLevel as (typeof levels)[number]) : 3;
  const stackBelow: "sm" | "md" | undefined = stackBelowProp === "sm" ? "sm" : stackBelowProp === "md" ? "md" : undefined;
  const linked = href !== undefined && Boolean(title);
  const zoom = linked && zoomMedia === true && Boolean(media);
  const reveal = linked && (revealDescription === true || revealDescription === "rise") && Boolean(description);
  // The rising description needs media to rise over; without it the description fades in place.
  const rise = reveal && revealDescription === "rise" && Boolean(media);
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
          interactive !== undefined && ["interactive is not a prop; a card with href is a link", '<Card href="/path" title="…" zoomMedia revealDescription>'],
          zoomMedia === true && !zoom && ["zoomMedia needs href, a title and media", '<Card href="/path" title="…" media={…} zoomMedia>'],
          revealDescription !== undefined &&
            revealDescription !== false &&
            revealDescription !== true &&
            revealDescription !== "rise" && [`revealDescription="${String(revealDescription)}" is not a reveal; use revealDescription or "rise"`, '<Card revealDescription="rise">'],
          (revealDescription === true || revealDescription === "rise") &&
            !reveal && ["revealDescription needs href, a title and a description", '<Card href="/path" title="…" description="…" revealDescription>'],
          revealDescription === "rise" && reveal && !rise && ['revealDescription="rise" needs media to rise over', '<Card href="/path" title="…" description="…" media={…} revealDescription="rise">'],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  const pad = inset[variant][size];
  // A rising title lies on a surface of its own over the media, so it keeps an outlined card's inset whatever the variant.
  const titlePad = rise ? inset.outline[size] : pad;
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
          aria-describedby={reveal ? descriptionId : undefined}
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
  // The title, description and action; for a rising description, laid over the media's bottom.
  const titleBlock = (place?: string) =>
    (heading || description || action) && (
      <div className={cn("flex items-start gap-4", stackBelow && headerStacked[stackBelow], titlePad, place)}>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {heading}
          {description &&
            (reveal ? (
              <div id={descriptionId} data-card-reveal={rise ? "rise" : ""} className={rise ? riseClass : revealClass}>
                <Text as="div" size="sm" tone="muted" className={rise ? "min-h-0 overflow-hidden" : undefined}>
                  {description}
                </Text>
              </div>
            ) : (
              <Text as="div" size="sm" tone="muted">
                {description}
              </Text>
            ))}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
    );
  return createElement(
    element,
    {
      ...rest,
      // A click anywhere on a linked card opens its link, wherever the app's layout leaves the link's layer.
      onClick: (event: MouseEvent<HTMLElement>) => (rest.onClick?.(event), followStretchedLink(event)),
      onAuxClick: (event: MouseEvent<HTMLElement>) => (rest.onAuxClick?.(event), followStretchedLink(event)),
      "data-ouro": "card",
      "data-ouro-squircle": variant === "outline" ? "" : undefined,
      "data-linked": linked ? "" : undefined,
      "data-follows-link": linked ? "" : undefined,
      className: cn(
        "relative isolate flex min-w-0 list-none flex-col overflow-hidden",
        variants[variant],
        rootSizes[variant][size],
        linked && linkRoot,
        (zoom || reveal) && "group/card",
        linked && raiseControlsClass,
        className,
      ),
    },
    variant === "outline" && <span data-ouro-surface="" aria-hidden="true" style={{ zIndex: -1 }} />,
    media && !rise && <div className={cn("relative overflow-hidden", mediaPull[variant][size], zoom && zoomMediaClass)}>{media}</div>,
    // The title stacked over the media in one grid cell, not positioned, so the link's layer still covers the whole
    // card; a cell grows to fit a title and description taller than the media rather than cutting the title off.
    rise && (
      <div className={cn("grid overflow-hidden", mediaPull[variant][size])}>
        <div className={cn("relative overflow-hidden [grid-area:1/1]", zoom && zoomMediaClass)}>{media}</div>
        {titleBlock("z-1 self-end [grid-area:1/1] bg-(--card,var(--background)) py-3 text-(--card-foreground,var(--foreground))")}
      </div>
    ),
    !rise && titleBlock(),
    children && <div className={cn("min-w-0", pad)}>{children}</div>,
    footer && <div className={cn("flex flex-wrap items-center gap-2", pad)}>{footer}</div>,
  );
}
