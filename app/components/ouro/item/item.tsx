"use client";

import { createElement, type HTMLAttributes, type JSX, type ReactNode, type Ref } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { RouterLink, safeRel } from "~/lib/ouro/router-link";
import { raiseControlsClass, stretchedLinkClass } from "~/lib/ouro/stretched-link";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";

/** How big an Item's media is: an `icon` in a muted 40px tile, or an image at 40, 64 or 112px. */
export type ItemMediaSize = "icon" | "sm" | "md" | "lg";

/** The props every Item takes, with or without `href`. */
export interface ItemOwnProps {
  /** One or two lines under the title. Pass `<Text lines={2}>` to clamp a long one. */
  description?: ReactNode;
  /**
   * Leading media: an `<img>` (cropped square), an `Avatar`, or an icon with
   * `mediaSize="icon"`. Give an image `alt=""` when the title already names it.
   */
  media?: ReactNode;
  /**
   * The media's size: `icon` puts an icon in a muted 40px tile (and hides it from screen
   * readers); `sm` is 40px, `md` 64px, `lg` 112px for a recipe photo.
   * @default "sm"
   */
  mediaSize?: ItemMediaSize | (string & { 'Use "icon", "sm" (40px), "md" (64px) or "lg" (112px)': never }) | undefined;
  /**
   * Below this breakpoint the media leaves the row and runs full width above the text, at
   * 4:3, as a recipe list shows its photos on a phone; above it, it sits beside the text at
   * `mediaSize`. `always` keeps it above at every width.
   */
  mediaAbove?: "always" | "sm" | "md" | (string & { 'Use "always", "sm" (640px) or "md" (768px)': never }) | undefined;
  /**
   * Trailing content at the end of the row: buttons, a switch, a badge or a timestamp. With
   * `href`, controls here stay their own tab stops, above the link.
   */
  actions?: ReactNode;
  /**
   * Below this breakpoint the actions drop under the text, lined up with the title, as in a
   * settings row on a phone. Without it they stay at the end at every width.
   */
  stackBelow?: "sm" | "md" | (string & { 'Use "sm" (640px) or "md" (768px)': never }) | undefined;
  /**
   * `plain` has no frame, for rows in an `ItemGroup`; `outline` is a bordered, padded box for
   * a row on its own.
   * @default "plain"
   */
  variant?: "plain" | "outline" | (string & { 'Use "plain" or "outline"; muted is a Card': never }) | undefined;
  /** Row height: `md` has 12px above and below, `sm` 8px for dense lists. @default "md" */
  size?: "md" | "sm" | (string & { 'Use "md" or "sm"': never }) | undefined;
  /**
   * The element to render. `ItemGroup` already wraps each Item in an `<li>`.
   * @default "div"
   */
  as?: "div" | "li" | "article" | (string & { 'Use "div", "li" or "article"; for a link use href': never }) | undefined;
  /** Layout only: margins, grid placement (`mt-2`). Appearance classes warn in development; use `variant`. */
  className?: string | undefined;
  ref?: Ref<HTMLElement> | undefined;

  /** Not a prop. Ouro UI uses `description`: `<Item description="Four hours">`. */
  subtitle?: { 'Use <Item description="Four hours">': never };
  /** Not a prop. Ouro UI uses `media`: `<Item media={<Icon />} mediaSize="icon">`. */
  icon?: { 'Use <Item media={<Icon />} mediaSize="icon">': never };
  /** Not a prop. Ouro UI uses `media`: `<Item media={<Avatar … />}>`. */
  avatar?: { "Use <Item media={<Avatar ... />}>": never };
  /** Not a prop. Ouro UI uses `media`: `<Item media={<img src="…" alt="" />}>`. */
  image?: { 'Use <Item media={<img src="..." alt="" />}>': never };
  /** Not a prop. Ouro UI uses `media`: `<Item media={<img src="…" alt="" />}>`. */
  thumbnail?: { 'Use <Item media={<img src="..." alt="" />}>': never };
  /** Not a prop. Ouro UI uses `actions`, for one control or several: `<Item actions={<Button>…</Button>}>`. */
  action?: { "Use <Item actions={<Button>...</Button>}>": never };
  /** Not a prop. Ouro UI uses `title`: `<Item title="Braised short ribs">`. */
  label?: { 'Use <Item title="Braised short ribs">': never };
  /** Not a prop. Ouro UI uses `href`, for router links too: `<Item href="/recipes/1" title="…">`. */
  to?: { 'Use <Item href="/recipes/1" title="...">': never };
  /** Not a prop. With `href` the whole row is a link: `<Item href="/recipes/1" title="…">`. */
  asChild?: { 'Use <Item href="/recipes/1" title="...">': never };
}

/** Props for {@link Item}. The HTML attributes sit outside the `href` union, which keeps the editor's hover docs. */
export type ItemProps = Omit<HTMLAttributes<HTMLElement>, keyof ItemOwnProps | "title"> &
  ItemOwnProps & {
    /** What the row is: a name, a recipe title, a setting. It is the link's text with `href`. */
    title: ReactNode;
  } & (
    | {
        /**
         * Makes the whole row one link, with one tab stop, named by its title. Internal paths
         * go through `OuroProvider`'s `linkComponent`, as with `Link`. Controls anywhere in
         * the row (a link in the description, a button in the media or the actions) stay
         * their own tab stops and take their own clicks and taps. On a touch screen the row
         * is at least 44px tall.
         */
        href: string;
        /** Opens the link in a new tab, safely, and tells screen readers so. */
        external?: boolean | undefined;
        /** A ref to the link's `<a>`, to move focus to it. */
        linkRef?: Ref<HTMLAnchorElement> | undefined;
      }
    | {
        /** Not without `href`. Add `href` to make the whole row a link. */
        href?: never;
        /** Only with `href`. */
        external?: never;
        /** Only with `href`. */
        linkRef?: never;
      }
  );

const elements = ["div", "li", "article"] as const;
const variants = { plain: "", outline: "rounded-xl border border-border px-4" } as const;
const sizes = { md: "py-3", sm: "py-2" } as const;
const mediaSizes = {
  icon: "size-10 rounded-lg bg-muted text-muted-foreground flex items-center justify-center *:[svg]:size-5",
  sm: "size-10 rounded-md overflow-hidden *:size-full *:object-cover",
  md: "size-16 rounded-lg overflow-hidden *:size-full *:object-cover",
  lg: "size-28 rounded-lg overflow-hidden *:size-full *:object-cover",
} as const;

// Columns for each layout, and the stacked layout below a breakpoint, where the actions
// move under the text into the title's column. Literal strings so the app's Tailwind finds them.
const columns = {
  media: { actions: "grid-cols-[auto_minmax(0,1fr)_auto]", none: "grid-cols-[auto_minmax(0,1fr)]" },
  none: { actions: "grid-cols-[minmax(0,1fr)_auto]", none: "grid-cols-[minmax(0,1fr)]" },
} as const;
const stacked = {
  media: {
    sm: { root: "max-sm:grid-cols-[auto_minmax(0,1fr)]", actions: "max-sm:col-start-2 max-sm:justify-start" },
    md: { root: "max-md:grid-cols-[auto_minmax(0,1fr)]", actions: "max-md:col-start-2 max-md:justify-start" },
  },
  none: {
    sm: { root: "max-sm:grid-cols-[minmax(0,1fr)]", actions: "max-sm:col-start-1 max-sm:justify-start" },
    md: { root: "max-md:grid-cols-[minmax(0,1fr)]", actions: "max-md:col-start-1 max-md:justify-start" },
  },
} as const;

// With href, the title's link stretches over the row (`stretchedLinkClass`) and every
// control in the row sits above it (`raiseControlsClass`), as in Card and Table.
// A linked row is a full touch target on a coarse pointer, at either size.
const linkRoot =
  "press cursor-pointer outline-ring -outline-offset-2 has-[[data-item-link]:focus-visible]:outline-2 has-[[data-item-link]:focus-visible]:outline-solid " +
  "pointer-coarse:min-h-11";

// With mediaAbove, below the breakpoint the media takes its own full-width row at 4:3 and
// the columns drop the media's; `always` does so at every width.
const above = {
  always: {
    root: { actions: "grid-cols-[minmax(0,1fr)_auto]", none: "grid-cols-[minmax(0,1fr)]" },
    media: "col-span-full w-full h-auto aspect-[4/3] rounded-lg",
  },
  sm: {
    root: { actions: "max-sm:grid-cols-[minmax(0,1fr)_auto]", none: "max-sm:grid-cols-[minmax(0,1fr)]" },
    media: "max-sm:col-span-full max-sm:w-full max-sm:h-auto max-sm:aspect-[4/3] max-sm:rounded-lg",
  },
  md: {
    root: { actions: "max-md:grid-cols-[minmax(0,1fr)_auto]", none: "max-md:grid-cols-[minmax(0,1fr)]" },
    media: "max-md:col-span-full max-md:w-full max-md:h-auto max-md:aspect-[4/3] max-md:rounded-lg",
  },
} as const;

/**
 * One row of a list: leading media, a title with a description, and trailing actions.
 * With `href` the whole row is one link, named by its title, with one tab stop, and the
 * actions stay their own. Put rows in an `ItemGroup`, which makes them a list.
 *
 * Use `Card` instead for a larger tile with a cover image and a body, and `Row` for a
 * plain horizontal layout with no list semantics.
 *
 * @group Lists
 * @see https://ourostack.github.io/ouro-ui/docs/item
 *
 * @example
 * <Item
 *   href="/recipes/short-ribs"
 *   media={<img src={photo} alt="" />}
 *   mediaSize="md"
 *   title="Braised short ribs"
 *   description="Four hours, mostly hands-off"
 * />
 * <Item title="Passkey on iPhone" description="Added May 2" actions={<Button variant="plain">Remove</Button>} stackBelow="sm" />
 */
export function Item(props: ItemProps): JSX.Element {
  const {
    href,
    title,
    external,
    linkRef,
    description,
    media,
    mediaSize: mediaSizeProp = "sm",
    mediaAbove: mediaAboveProp,
    actions,
    stackBelow: stackBelowProp,
    variant: variantProp = "plain",
    size: sizeProp = "md",
    as: asProp = "div",
    className,
    subtitle,
    icon,
    avatar,
    image,
    thumbnail,
    action,
    label,
    to,
    asChild,
    ...rest
  } = props;
  const variant = Object.hasOwn(variants, variantProp) ? (variantProp as keyof typeof variants) : "plain";
  const size = Object.hasOwn(sizes, sizeProp) ? (sizeProp as keyof typeof sizes) : "md";
  const mediaSize = Object.hasOwn(mediaSizes, mediaSizeProp) ? (mediaSizeProp as ItemMediaSize) : "sm";
  const stackBelow: "sm" | "md" | undefined = stackBelowProp === "sm" ? "sm" : stackBelowProp === "md" ? "md" : undefined;
  const mediaAbove = mediaAboveProp !== undefined && Object.hasOwn(above, mediaAboveProp) ? (mediaAboveProp as keyof typeof above) : undefined;
  const element = (elements as readonly string[]).includes(asProp) ? (asProp as (typeof elements)[number]) : "div";
  const linked = href !== undefined;
  useAppearanceClassNameCheck(
    "Item",
    className,
    process.env.NODE_ENV !== "production"
      ? '<Item variant="outline">, or <ItemGroup variant="outline"> around the rows'
      : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "Item",
    process.env.NODE_ENV !== "production"
      ? () => [
          !title && ["title is required; it names the row", '<Item title="Braised short ribs">'],
          variant !== variantProp && [`variant="${String(variantProp)}" is not a variant; use "plain", "outline"`, '<Item variant="plain">'],
          size !== sizeProp && [`size="${String(sizeProp)}" is not a size; use "md", "sm"`, '<Item size="md">'],
          mediaSize !== mediaSizeProp && [
            `mediaSize="${String(mediaSizeProp)}" is not a media size; use "icon", "sm", "md", "lg"`,
            '<Item mediaSize="lg">',
          ],
          mediaAboveProp !== undefined &&
            mediaAbove !== mediaAboveProp && [
              `mediaAbove="${String(mediaAboveProp)}" is not a breakpoint; use "always", "sm", "md"`,
              '<Item mediaAbove="sm">',
            ],
          mediaAbove !== undefined && !media && ["mediaAbove needs media", '<Item media={<img src="…" alt="" />} mediaAbove="sm">'],
          mediaAbove !== undefined &&
            Boolean(media) &&
            mediaSize === "icon" && [
              "mediaAbove is for a photo, not an icon",
              '<Item media={<img src="…" alt="" />} mediaSize="lg" mediaAbove="sm">',
            ],
          stackBelowProp !== undefined &&
            stackBelow !== stackBelowProp && [`stackBelow="${String(stackBelowProp)}" is not a breakpoint; use "sm", "md"`, '<Item stackBelow="sm">'],
          element !== asProp && [
            `as="${String(asProp)}" is not an element Item renders; use ${elements.map((name) => `"${name}"`).join(", ")}`,
            asProp === "a" ? '<Item href="/path" title="…">' : '<Item as="div">',
          ],
          subtitle !== undefined && ["subtitle is not a prop", `<Item description="${String(subtitle)}">`],
          icon !== undefined && ["icon is not a prop", '<Item media={<Icon />} mediaSize="icon">'],
          avatar !== undefined && ["avatar is not a prop", "<Item media={<Avatar … />}>"],
          image !== undefined && ["image is not a prop", `<Item media={<img src="${String(image)}" alt="" />}>`],
          thumbnail !== undefined && ["thumbnail is not a prop", `<Item media={<img src="${String(thumbnail)}" alt="" />}>`],
          action !== undefined && ["action is not a prop", "<Item actions={<Button>…</Button>}>"],
          label !== undefined && ["label is not a prop", `<Item title="${String(label)}">`],
          to !== undefined && ["to is not a prop", `<Item href="${typeof to === "string" ? to : "/path"}" title="…">`],
          asChild !== undefined && ["asChild is not a prop", '<Item href="/path" title="…">'],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  const hasMedia = media ? "media" : "none";
  // Media above the text at some width: its own row there, and the stacked layout below
  // the smaller of the two breakpoints is the one without media.
  const lifted = media && mediaAbove && mediaSize !== "icon" ? above[mediaAbove] : undefined;
  const stackLayouts: { root: string; actions: string }[] = [];
  if (stackBelow && actions) {
    if (!lifted) stackLayouts.push(stacked[hasMedia][stackBelow]);
    else if (mediaAbove === "always") stackLayouts.push(stacked.none[stackBelow]);
    else {
      stackLayouts.push(stacked.media[stackBelow]);
      stackLayouts.push(stacked.none[mediaAbove === "sm" || stackBelow === "sm" ? "sm" : "md"]);
    }
  }
  return createElement(
    element,
    {
      ...rest,
      "data-ouro": "item",
      "data-linked": linked ? "" : undefined,
      className: cn(
        "relative isolate grid min-w-0 list-none items-center gap-x-4 gap-y-2",
        columns[hasMedia][actions ? "actions" : "none"],
        lifted?.root[actions ? "actions" : "none"],
        stackLayouts.map((layout) => layout.root),
        variants[variant],
        sizes[size],
        linked && linkRoot,
        linked && raiseControlsClass,
        className,
      ),
    },
    media && (
      <div aria-hidden={mediaSize === "icon" ? true : undefined} className={cn("shrink-0", mediaSizes[mediaSize], lifted?.media)}>
        {media}
      </div>
    ),
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="text-base font-medium text-foreground">
        {linked ? (
          <RouterLink
            href={href}
            ref={linkRef}
            target={external ? "_blank" : undefined}
            rel={external ? safeRel(undefined) : undefined}
            data-item-link=""
            data-stretched-link=""
            className={cn(stretchedLinkClass, variant === "outline" && "after:rounded-xl")}
          >
            {title}
            {external && <span className="sr-only"> (opens in a new tab)</span>}
          </RouterLink>
        ) : (
          title
        )}
      </div>
      {description && <div data-ouro-text="" className="text-sm text-muted-foreground">{description}</div>}
    </div>,
    actions && <div className={cn("flex flex-wrap items-center justify-end gap-2", stackLayouts.map((layout) => layout.actions))}>{actions}</div>,
  );
}
