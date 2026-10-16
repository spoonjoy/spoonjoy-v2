"use client";

import type { AnchorHTMLAttributes, JSX, ReactNode, Ref } from "react";
import { fontFor, toneFor } from "~/lib/ouro/appearance-hints";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { RouterLink, safeRel } from "~/lib/ouro/router-link";
import { toneWarning } from "~/lib/ouro/tones";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";

/** The props Link adds to the anchor attributes it passes through. */
export interface LinkOwnProps {
  /**
   * Where the link goes. Internal paths render through `OuroProvider`'s `linkComponent`
   * (your router's link), so navigation stays client-side; `http(s)://`, `mailto:` and
   * other absolute URLs render as a plain `<a>`. Router links that take `to` take `href`
   * here: the adapter maps it.
   */
  href: string;
  /**
   * Opens the link in a new tab: sets `target="_blank"`, adds `rel="noopener noreferrer"`
   * (keeping your own `rel` tokens) and an icon, and tells screen readers "opens in a new tab".
   */
  external?: boolean | undefined;
  /**
   * Text color from the theme, named after its token. `secondary` is the page's foreground,
   * for links in navigation and lists; the underline still marks it as a link.
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
   * Whether the link sits in running text. On a touch screen a link that stands alone
   * ("Forgot password?", "Back to recipes", a link in a list item or a table cell) is a box at
   * least 44px tall and wide with its text centred, which takes its room in the layout; a link in
   * running text stays as tall as its line. Unset, a link is in running text inside a `<p>`,
   * a `<label>`, a `<dt>` or `<dd>`, a `Text`, and Ouro's own text (a field's description and
   * error, a Form's message, an Alert's text, an Item's description). Pass `inline` for a
   * sentence in another element, and `inline={false}` for a link that is alone in its `Text`.
   */
  inline?: boolean | undefined;
  /** The link text. Make it say where the link goes: "Browse recipes", not "click here". */
  children: ReactNode;
  /** Layout only: margins, display, grid placement (`ms-2`). Appearance classes warn in development; use `tone`. */
  className?: string | undefined;
  ref?: Ref<HTMLAnchorElement> | undefined;

  /** Not a prop. Ouro UI uses `href`, for router links too: `<Link href="/recipes">`. */
  to?: { 'Use <Link href="/recipes">': never };
  /** Not a prop. Ouro UI uses `external`: `<Link href="https://…" external>`. */
  isExternal?: { 'Use <Link href="https://..." external>': never };
  /** Not a prop. Ouro UI uses `tone`: `<Link tone="destructive">`. */
  color?: { 'Use <Link tone="destructive">': never };
}

/** Props for {@link Link}: its own props and the anchor attributes it passes through. */
export type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkOwnProps> & LinkOwnProps;

// Class strings are literal so the app's Tailwind finds them when it compiles.
const base =
  "rounded-xs underline decoration-current/40 decoration-1 underline-offset-4 " +
  "transition-[text-decoration-color] duration-(--ouro-duration-fast) ease-[ease] pointer-fine:hover:decoration-current active:opacity-70 " +
  "outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid";

// On a coarse pointer a link that is not in running text is a 44px box with its text
// centred. Running text is found with CSS ancestor selectors, so the server HTML is right.
const standalone =
  "pointer-coarse:not-in-[:is(p,label,dt,dd,[data-ouro=text],[data-ouro-text])]:inline-flex " +
  "pointer-coarse:not-in-[:is(p,label,dt,dd,[data-ouro=text],[data-ouro-text])]:min-h-11 " +
  "pointer-coarse:not-in-[:is(p,label,dt,dd,[data-ouro=text],[data-ouro-text])]:min-w-11 " +
  "pointer-coarse:not-in-[:is(p,label,dt,dd,[data-ouro=text],[data-ouro-text])]:items-center";
const alwaysStandalone = "pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:items-center";

const tones = {
  primary: "text-primary",
  secondary: "text-foreground",
  destructive: "text-destructive",
  success: "text-success",
  warning: "text-warning",
} as const;

function linkHint(token: string): string {
  if (token.startsWith("font-")) return fontFor("Link", token);
  return `tone="${toneFor(token)}"`;
}

/**
 * A text link that navigates through your router. Internal `href`s render through
 * `OuroProvider`'s `linkComponent`, the same path `Button` with `href` takes, and
 * `external` opens a new tab safely and says so.
 *
 * Link is for text links only: it sets the text color and the underline, so wrapping a
 * card, a list row or a tab in it restyles their text. Inside running text, put the Link in
 * a `Text`.
 *
 * Use `Button` with `href` instead when the link is the main action and should look like a
 * button. Use `Card` with `href` instead when a whole card is the link, `Item` with `href`
 * for a whole list row, and `Table` with `rowHref` (or `TableRow` with `href`) for a
 * table row: each makes the surface one link with one tab stop, through the same router
 * link, and keeps its own look. Use `Navbar` or `Sidebar` instead for the links that move
 * between an app's pages, which mark the current one: `Tabs` and `SegmentedControl` switch
 * a view in place and take no `href`.
 *
 * On a touch screen a link that stands alone is a box at least 44px tall and wide, with its text
 * centred, so it is easy to tap and never overlaps a neighbour. A link in running text (a
 * `<p>`, a `<label>`, a `Text`, a field's description or error) stays as tall as its line;
 * `inline` says the same anywhere else. With a mouse every link is as tall as its text.
 *
 * @group Text
 * @see https://ourostack.github.io/ouro-ui/docs/link
 *
 * @example
 * <Link href="/recipes">Browse recipes</Link>
 * <Link href="https://ouro.bot" external>Ouro</Link>
 * <Text>Read the <Link href="/terms">terms</Link> first.</Text>
 * <Text size="sm"><Link href="/forgot" inline={false}>Forgot password?</Link></Text>
 */
export function Link(props: LinkProps): JSX.Element {
  const {
    href,
    external,
    tone: toneProp = "primary",
    inline: inlineProp,
    children,
    className,
    target,
    rel,
    // Guard props (hint types), dropped here so they never reach the DOM.
    to,
    isExternal,
    color,
    ...rest
  } = props;
  // A tone that is not one of Ouro UI's (a type error) warns and renders the default.
  const tone = Object.hasOwn(tones, toneProp) ? (toneProp as keyof typeof tones) : "primary";
  useAppearanceClassNameCheck(
    "Link",
    className,
    process.env.NODE_ENV !== "production" ? linkHint : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "Link",
    process.env.NODE_ENV !== "production"
      ? () => [
          tone !== toneProp && toneWarning("Link", String(toneProp), Object.keys(tones)),
          to !== undefined && ["to is not a prop", `<Link href="${typeof to === "string" ? to : "/path"}">`],
          isExternal !== undefined && ["isExternal is not a prop", '<Link href="https://…" external>'],
          color !== undefined && ["color is not a prop", `<Link tone="${toneFor(`text-${String(color)}`)}">`],
          !external &&
            target === "_blank" && ['target="_blank" opens a new tab without saying so', '<Link href="https://…" external>'],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  return (
    <RouterLink
      {...rest}
      href={href}
      target={external ? "_blank" : target}
      rel={external ? safeRel(rel) : rel}
      data-ouro="link"
      data-inline={inlineProp ? "" : undefined}
      className={cn(base, inlineProp === undefined ? standalone : !inlineProp && alwaysStandalone, tones[tone], className)}
    >
      {children}
      {external && (
        <>
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="ms-0.5 inline size-[0.75em] align-baseline"
          >
            <path d="M6 3h7v7M13 3 4 12" />
          </svg>
          <span className="sr-only"> (opens in a new tab)</span>
        </>
      )}
    </RouterLink>
  );
}
