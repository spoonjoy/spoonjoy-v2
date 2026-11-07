"use client";

import { useRef, type AnchorHTMLAttributes, type JSX, type MouseEvent, type ReactNode, type Ref } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { devWarn } from "~/lib/ouro/dev";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";

/** The props SkipLink adds to the anchor attributes it passes through. */
export interface SkipLinkOwnProps {
  /**
   * The `id` of the element the link skips to, without `#`: the page's main content,
   * `<main id="main">`. It need not be focusable; the link makes it take focus.
   * @default "main"
   */
  target?: string | undefined;
  /** The link's text. @default "Skip to main content" */
  children?: ReactNode;
  /** Layout only: rarely needed, since the link places itself at the top of the screen. Appearance classes warn in development. */
  className?: string | undefined;
  ref?: Ref<HTMLAnchorElement> | undefined;

  /** Not a prop. SkipLink takes the id, without `#`: `<SkipLink target="main" />`. */
  href?: { 'Use <SkipLink target="main" /> (the id, without #)': never };
  /** Not a prop. SkipLink takes the id: `<SkipLink target="main" />`. */
  to?: { 'Use <SkipLink target="main" />': never };
  /** Not a prop. The link's text is its children: `<SkipLink>Skip to recipes</SkipLink>`. */
  label?: { 'Use <SkipLink>Skip to recipes</SkipLink>': never };
}

/** Props for {@link SkipLink}: its own props and the anchor attributes it passes through. */
export type SkipLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof SkipLinkOwnProps> & SkipLinkOwnProps;

// Class strings are literal so the app's Tailwind finds them when it compiles. Until it has
// focus the link is clipped to a 1px box, still read by screen readers; a fixed element parked
// above the top edge would still paint in a full-page screenshot of a scrolled page.
const base =
  "fixed top-2 start-2 z-(--ouro-layer) box-border inline-flex min-h-9 pointer-coarse:min-h-11 items-center rounded-md " +
  "bg-background px-4 text-sm leading-5 font-medium text-foreground underline underline-offset-4 shadow-(--shadow-lg) ring-1 ring-border/60 " +
  "outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid print:hidden " +
  "not-focus:m-0 not-focus:size-px not-focus:min-h-0 not-focus:overflow-hidden not-focus:p-0 not-focus:whitespace-nowrap not-focus:ring-0 not-focus:[clip-path:inset(50%)]";

/** Whether the element takes focus without a tabindex of its own. */
function focusable(element: HTMLElement): boolean {
  return element.tabIndex >= 0 || element.hasAttribute("tabindex");
}

/**
 * The "Skip to main content" link a keyboard or screen-reader user meets first on every
 * page, so one Tab and Enter jump past the header and navigation. It stays out of sight
 * until it has focus, then shows at the top corner of the screen. It keeps `href="#main"`
 * for pages without JavaScript; with it, the link moves focus to the target and scrolls it
 * into view without adding a history entry, so Back still leaves the page.
 *
 * Render it as the first element in the page's body, before the header, and give the main
 * content its id: `<main id="main">`.
 *
 * Use `Link` instead for a link that shows all the time, and a table of contents of `Link`s
 * for jumps between sections of a long page.
 *
 * @group Navigation
 * @see https://ui.ouro.bot/docs/skip-link
 *
 * @example
 * <body>
 *   <SkipLink />
 *   <Navbar label="Main" items={items} />
 *   <main id="main">…</main>
 * </body>
 * @claim "link a keyboard or screen-reader user meets first" registry/ouro/components/ouro/skip-link/skip-link.test.tsx verify:testExists(registry/ouro/components/ouro/skip-link/skip-link.test.tsx::SkipLink > is the first tab stop, and Enter moves focus to the main content without a history entry)
 */
export function SkipLink(props: SkipLinkProps): JSX.Element {
  const {
    target = "main",
    children = "Skip to main content",
    className,
    onClick,
    // Guard props (hint types), dropped here so they never reach the DOM.
    href,
    to,
    label,
    ...rest
  } = props;
  useAppearanceClassNameCheck(
    "SkipLink",
    className,
    process.env.NODE_ENV !== "production"
      ? (token: string) => `remove "${token}"; SkipLink sets its own look from the theme`
      : /* istanbul ignore next @preserve -- production only */ "",
  );
  const id = target.replace(/^#/, "");
  useDevWarnings(
    "SkipLink",
    process.env.NODE_ENV !== "production"
      ? () => [
          href !== undefined && ["href is not a prop", `<SkipLink target="${typeof href === "string" ? String(href).replace(/^#/, "") : "main"}" />`],
          to !== undefined && ["to is not a prop", '<SkipLink target="main" />'],
          label !== undefined && ["label is not a prop", `<SkipLink>${typeof label === "string" ? label : "Skip to main content"}</SkipLink>`],
          target.startsWith("#") && [`target="${target}" starts with #`, `<SkipLink target="${id}" />`],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  // Each link names a missing target once, when it is used: the target may render after the link.
  const instance = useRef({});
  const skip = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    // A modified click (a new tab or window) keeps the browser's own behaviour.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
    const element = document.getElementById(id);
    if (!element) {
      /* istanbul ignore else @preserve -- the else path exists only in production bundles; scripts/dev-strip.test.mjs covers it */
      if (process.env.NODE_ENV !== "production") devWarn("SkipLink", `no element has id="${id}", so the link skips nowhere`, `<main id="${id}">`, instance.current);
      return;
    }
    event.preventDefault();
    if (!focusable(element)) element.setAttribute("tabindex", "-1");
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: "start" });
  };
  return (
    <a
      data-ouro-control="skip-link"
      data-ouro-part="root"
      {...rest}
      href={`#${id}`}
      onClick={skip}
      data-ouro="skip-link"
      className={cn(base, className)}
    >
      {children}
    </a>
  );
}
