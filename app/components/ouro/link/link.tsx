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
   * Navigates with a full page load: renders a plain `<a>` for an internal path too, skipping
   * `OuroProvider`'s `linkComponent`, so your router never handles it. Use it for a path your
   * router has no page for: a resource route (`/mcp`, `/feed.xml`), a file download, a sign-in
   * that starts on the server (`/auth/github`). A link with `download` does the same.
   * @claim "Navigates with a full page load:" registry/ouro/components/ouro/link/link.test.tsx verify:testExists(registry/ouro/components/ouro/link/link.test.tsx::Link > renders a plain <a> with reloadDocument or download, skipping the router's link, in the same look)
   */
  reloadDocument?: boolean | undefined;
  /**
   * Opens the link in a new tab: sets `target="_blank"`, adds `rel="noopener noreferrer"`
   * (keeping your own `rel` tokens) and an icon, and tells screen readers "opens in a new tab".
   */
  external?: boolean | undefined;
  /**
   * Text color from the theme, named after its token. `secondary` is the page's foreground,
   * for links in navigation and lists; the underline still marks it as a link. `primary`
   * reads `--primary`, not a theme's `--ouro-action`: a link is text in a sentence and the
   * action colour is a fill. For a link that looks like the page's main action, use
   * `<Button href>`.
   * @claim "`primary` reads `--primary`, not a theme's" test/action-token.test.tsx verify:testExists(test/action-token.test.tsx::the action token > repaints the solid primary Button, as a button and as a link, and leaves every selection on --primary)
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
   * @claim "On a touch screen a link" registry/ouro/components/ouro/link/link.touch.test.tsx verify:testExists(registry/ouro/components/ouro/link/link.touch.test.tsx::gives a link on its own line a 44px box, centred on its text)
   * @claim "On a touch screen a link" registry/ouro/components/ouro/link/link.test.tsx verify:testExists(registry/ouro/components/ouro/link/link.test.tsx::Link with a mouse > is as tall as its text with a fine pointer, standing alone or in a sentence)
   * @claim "On a touch screen a link" registry/ouro/components/ouro/link/link.touch.test.tsx verify:testExists(registry/ouro/components/ouro/link/link.touch.test.tsx::a link in running text keeps to its line)
   */
  inline?: boolean | undefined;
  /**
   * Marks this link as the current one: the page you are on in a list of chapters, steps or
   * sections. `true` sets `aria-current="page"`; pass another value (`"step"`, `"location"`,
   * `"true"`) for a link that is not a page of its own. The link is then drawn as `Navbar` and
   * `NavigationMenu` draw their current link: semibold, in the page's text colour, with a 2px
   * underline in the primary colour, so a reader tells it from the others at a glance. Under
   * forced colours it takes the selection's colours. `false` or unset marks nothing.
   * @claim "Marks this link as the current" registry/ouro/components/ouro/link/link.test.tsx verify:testExists(registry/ouro/components/ouro/link/link.test.tsx::Link current > marks the current link aria-current="page", or the value passed, and nothing for false)
   * @claim "The link is then drawn as" registry/ouro/components/ouro/link/link.test.tsx verify:testExists(registry/ouro/components/ouro/link/link.test.tsx::Link current > draws the current link as Navbar draws its current link: semibold, the page's text colour, a 2px primary underline)
   */
  current?: boolean | "page" | "step" | "location" | "date" | "time" | "true" | (string & { 'Use current or current="step"': never }) | undefined;
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
  /** Not a prop. Ouro UI uses `current`: `<Link href="/chapter-2" current>`. */
  active?: { 'Use <Link current>': never };
  /** Not a prop. Ouro UI uses `current`: `<Link href="/chapter-2" current>`. */
  isActive?: { 'Use <Link current>': never };
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

// In running text an outline would cover the next character (a comma right after the link), so
// focus thickens the underline in the ring's colour. The outline stays, transparent, because
// forced colours show it and drop the underline's colour.
const inTextFocus =
  "in-[:is(p,label,dt,dd,[data-ouro=text],[data-ouro-text])]:focus-visible:outline-transparent " +
  "in-[:is(p,label,dt,dd,[data-ouro=text],[data-ouro-text])]:focus-visible:decoration-ring " +
  "in-[:is(p,label,dt,dd,[data-ouro=text],[data-ouro-text])]:focus-visible:decoration-2";
const inlineFocus = "focus-visible:outline-transparent focus-visible:decoration-ring focus-visible:decoration-2";

// An icon of the app's own (a back arrow) stays on its text's line, a little apart. The base styles make an svg a
// block, which in a link laid out as a block (one in a column) takes a line of its own: the icon is inline instead.
// A link that stands alone lays its icon and text out in a row with a gap; one in running text stays inline, so it
// sits on the sentence's baseline and wraps, and its icon takes a little room on each side. The rules sit in a nested
// layer, so the app's own classes still win; the external icon, already inline, is left out.
const iconInlineClass =
  "[@layer_ouro-reset]:[&>svg:not([data-ouro-external])]:inline-block " +
  "[@layer_ouro-reset]:[&>svg:not([data-ouro-external])]:align-[-0.125em]";
const iconRowClass =
  "[@layer_ouro-reset]:not-in-[:is(p,label,dt,dd,[data-ouro=text],[data-ouro-text])]:has-[>svg:not([data-ouro-external])]:inline-flex " +
  "[@layer_ouro-reset]:not-in-[:is(p,label,dt,dd,[data-ouro=text],[data-ouro-text])]:has-[>svg:not([data-ouro-external])]:items-center " +
  "[@layer_ouro-reset]:not-in-[:is(p,label,dt,dd,[data-ouro=text],[data-ouro-text])]:has-[>svg:not([data-ouro-external])]:gap-1.5";
const iconInTextClass =
  "[@layer_ouro-reset]:in-[:is(p,label,dt,dd,[data-ouro=text],[data-ouro-text])]:[&>svg:not([data-ouro-external])]:mx-[0.25em]";
const alwaysIconRowClass =
  "[@layer_ouro-reset]:has-[>svg:not([data-ouro-external])]:inline-flex " +
  "[@layer_ouro-reset]:has-[>svg:not([data-ouro-external])]:items-center " +
  "[@layer_ouro-reset]:has-[>svg:not([data-ouro-external])]:gap-1.5";
const alwaysIconInTextClass = "[@layer_ouro-reset]:[&>svg:not([data-ouro-external])]:mx-[0.25em]";

const tones = {
  primary: "text-primary",
  secondary: "text-foreground",
  destructive: "text-destructive",
  success: "text-success",
  warning: "text-warning",
} as const;

// The current link, drawn as Navbar and NavigationMenu draw theirs: semibold, the page's text
// colour, a 2px underline in the primary colour that hover keeps. Forced colours paint every link
// alike, so there it takes the selection's colours.
const currentClass =
  "data-current:font-semibold data-current:text-foreground data-current:decoration-primary data-current:decoration-2 " +
  "data-current:underline-offset-5 data-current:[text-decoration-skip-ink:none] data-current:pointer-fine:hover:decoration-primary " +
  "forced-colors:data-current:bg-[Highlight] forced-colors:data-current:text-[HighlightText]";

const ariaCurrents: readonly string[] = ["page", "step", "location", "date", "time", "true"];

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
 * In a list of chapters, steps or sections, `current` marks the one you are on
 * (`aria-current="page"`) with the same look as `Navbar`'s current link.
 *
 * Keyboard focus draws an outline around a link that stands alone. In running text it thickens
 * the underline in the ring's colour instead, since an outline would cover the next character.
 *
 * An icon you put in the link (a back arrow before "Recipes") stays on its text's line, a little
 * apart, wherever the link is laid out; mark it `aria-hidden` so the link's name is its text.
 *
 * @group Text
 * @see https://ui.ouroboros.bot/docs/link
 *
 * @example
 * <Link href="/recipes">Browse recipes</Link>
 * <Link href="https://ouro.bot" external>Ouro</Link>
 * <Link href="/mcp" reloadDocument>MCP server metadata</Link>
 * <Text>Read the <Link href="/terms">terms</Link> first.</Text>
 * <Text size="sm"><Link href="/forgot" inline={false}>Forgot password?</Link></Text>
 * <Link href="/guide/2" current>Chapter 2</Link>
 * @claim "On a touch screen a link" registry/ouro/components/ouro/link/link.test.tsx verify:testExists(registry/ouro/components/ouro/link/link.test.tsx::Link with a mouse > is as tall as its text with a fine pointer, standing alone or in a sentence)
 * @claim "On a touch screen a link" registry/ouro/components/ouro/link/link.touch.test.tsx verify:testExists(registry/ouro/components/ouro/link/link.touch.test.tsx::gives a link on its own line a 44px box, centred on its text)
 * @claim "Keyboard focus draws an outline" registry/ouro/components/ouro/link/link.test.tsx verify:testExists(registry/ouro/components/ouro/link/link.test.tsx::Link > marks keyboard focus in running text with a thick underline in the ring's colour, not an outline drawn over the next character)
 * @claim "An icon you put in the" registry/ouro/components/ouro/link/link.test.tsx verify:testExists(registry/ouro/components/ouro/link/link.test.tsx::Link > keeps an icon of the app's own on its text's line, a little apart, wherever the link is laid out)
 * @claim "With a mouse every link is" registry/ouro/components/ouro/link/link.test.tsx verify:testExists(registry/ouro/components/ouro/link/link.test.tsx::Link with a mouse > is as tall as its text with a fine pointer, standing alone or in a sentence)
 */
export function Link(props: LinkProps): JSX.Element {
  const {
    href,
    external,
    reloadDocument,
    tone: toneProp = "primary",
    inline: inlineProp,
    current: currentProp,
    children,
    className,
    target,
    rel,
    // Guard props (hint types), dropped here so they never reach the DOM.
    to,
    isExternal,
    color,
    active,
    isActive,
    ...rest
  } = props;
  // `true` is the page; a value that is not one of aria-current's (a type error) warns and marks the page.
  const current: AnchorHTMLAttributes<HTMLAnchorElement>["aria-current"] =
    currentProp === undefined || currentProp === false
      ? undefined
      : ariaCurrents.includes(currentProp as string)
        ? (currentProp as AnchorHTMLAttributes<HTMLAnchorElement>["aria-current"])
        : "page";
  // An `aria-current` passed straight through (a NavLink habit) gets the same look.
  const passed = rest["aria-current"];
  const marked = current !== undefined || (passed !== undefined && passed !== false && passed !== "false");
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
          active !== undefined && ["active is not a prop", "<Link current>"],
          isActive !== undefined && ["isActive is not a prop", "<Link current>"],
          currentProp !== undefined &&
            typeof currentProp !== "boolean" &&
            !ariaCurrents.includes(currentProp) && [`current="${currentProp}" is not an aria-current value`, '<Link current> or <Link current="step">'],
          !external &&
            target === "_blank" && ['target="_blank" opens a new tab without saying so', '<Link href="https://…" external>'],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  return (
    <RouterLink
      data-ouro-control="link"
      data-ouro-part="root"
      {...rest}
      href={href}
      reloadDocument={reloadDocument}
      target={external ? "_blank" : target}
      rel={external ? safeRel(rel) : rel}
      data-ouro="link"
      data-inline={inlineProp ? "" : undefined}
      {...(current ? { "aria-current": current } : {})}
      data-current={marked ? "" : undefined}
      className={cn(base, iconInlineClass, inlineProp === undefined ? [standalone, inTextFocus, iconRowClass, iconInTextClass] : inlineProp ? [inlineFocus, alwaysIconInTextClass] : [alwaysStandalone, alwaysIconRowClass], tones[tone], currentClass, className)}
    >
      {children}
      {external && (
        <>
          <svg
            aria-hidden="true"
            data-ouro-external=""
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
