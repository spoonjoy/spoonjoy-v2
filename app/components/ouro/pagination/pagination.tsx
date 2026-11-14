"use client";

import { useLayoutEffect, useRef, useState, type JSX, type ReactNode, type Ref, type RefObject } from "react";
import { flushSync } from "react-dom";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { devThrow } from "~/lib/ouro/dev";
import { RouterLink } from "~/lib/ouro/router-link";
import { useMergedRef } from "~/lib/ouro/refs";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";

/**
 * Props shared by every kind of Pagination (`href` or `onPageChange`, `pageCount` or `hasNextPage`).
 *
 * @claim "Props shared by every kind of" registry/ouro/components/ouro/pagination/pagination.test-d.ts verify:fileLine(registry/ouro/components/ouro/pagination/pagination.test-d.ts, /expectTypeOf<\{\spage:\s1;\spageCount:\s12;\shref:\s"\?page=\{page\}"\s\}>\(\)\.toExtend<PaginationProps>/)
 * @claim "Props shared by every kind of" registry/ouro/components/ouro/pagination/pagination.test-d.ts verify:fileLine(registry/ouro/components/ouro/pagination/pagination.test-d.ts, /expectTypeOf<\{\spage:\s1;\spageCount:\s12;\sonPageChange:/)
 */
export interface PaginationBaseProps {
  /**
   * The current page, counting from 1.
   *
   * @claim "The current page, counting from 1" registry/ouro/components/ouro/pagination/pagination.test.tsx verify:testExists(registry/ouro/components/ouro/pagination/pagination.test.tsx::Pagination > renders a labelled nav of plain links, with the current page marked)
   */
  page: number;
  /**
   * How many pages show on each side of the current one before a gap ("1 … 4 5 6 … 12" is
   * `1`). The list keeps the same number of cells on every page, so Next never moves.
   * @default 1
   * @claim "How many pages show on each" registry/ouro/components/ouro/pagination/pagination.test.tsx verify:testExists(registry/ouro/components/ouro/pagination/pagination.test.tsx::Pagination > shows a gap after the first pages near the start)
   * @claim "How many pages show on each" registry/ouro/components/ouro/pagination/pagination.test.tsx verify:testExists(registry/ouro/components/ouro/pagination/pagination.test.tsx::Pagination > shows a gap on both sides in the middle)
   * @claim "How many pages show on each" registry/ouro/components/ouro/pagination/pagination.test.tsx verify:testExists(registry/ouro/components/ouro/pagination/pagination.test.tsx::Pagination > shows a gap before the last pages near the end)
   * @claim "The list keeps the same number" registry/ouro/components/ouro/pagination/pagination.test.tsx verify:testExists(registry/ouro/components/ouro/pagination/pagination.test.tsx::Pagination > shows a gap after the first pages near the start)
   * @claim "The list keeps the same number" registry/ouro/components/ouro/pagination/pagination.test.tsx verify:testExists(registry/ouro/components/ouro/pagination/pagination.test.tsx::Pagination > shows a gap on both sides in the middle)
   * @claim "The list keeps the same number" registry/ouro/components/ouro/pagination/pagination.test.tsx verify:testExists(registry/ouro/components/ouro/pagination/pagination.test.tsx::Pagination > shows a gap before the last pages near the end)
   */
  siblings?: number | undefined;
  /** Names the navigation for screen readers. @default "Pagination" */
  label?: string | undefined;
  /** The text of the link to the page before. @default "Previous" */
  previousLabel?: string | undefined;
  /** The text of the link to the page after. @default "Next" */
  nextLabel?: string | undefined;
  /**
   * What a screen reader calls each page number; `{page}` is the number. @default "Page {page}"
   *
   * @claim "What a screen reader calls each" registry/ouro/components/ouro/pagination/pagination.test.tsx verify:testExists(registry/ouro/components/ouro/pagination/pagination.test.tsx::Pagination > takes every visible and spoken string as a prop)
   */
  pageLabel?: string | undefined;
  /**
   * The text between Previous and Next where the page numbers do not fit: below 640px, or in a
   * container too narrow for them. `{page}` and `{pageCount}` are the numbers. @default "Page {page} of {pageCount}"
   * @claim "The text between Previous and Next" registry/ouro/components/ouro/pagination/pagination.test.tsx verify:testExists(registry/ouro/components/ouro/pagination/pagination.test.tsx::Pagination > shows only Previous, the summary and Next below 640px)
   * @claim "The text between Previous and Next" registry/ouro/components/ouro/pagination/pagination.test.tsx verify:testExists(registry/ouro/components/ouro/pagination/pagination.test.tsx::Pagination > builds hrefs from a string with {page}, which a Server Component can pass)
   */
  summaryLabel?: string | undefined;
  /** Layout only: margins, width, grid placement (`mt-6`). Appearance classes warn in development. */
  className?: string | undefined;
  ref?: Ref<HTMLElement> | undefined;

  /**
   * Not a prop. Ouro UI uses `page`, counting from 1: `<Pagination page={1} pageCount={12}>`.
   *
   * @claim "Ouro UI uses `page`, counting from" registry/ouro/components/ouro/pagination/pagination.test.tsx verify:testExists(registry/ouro/components/ouro/pagination/pagination.test.tsx::Pagination > renders a labelled nav of plain links, with the current page marked)
   */
  currentPage?: { "Use <Pagination page={1} pageCount={12}>": never };
  /** Not a prop. Ouro UI uses `pageCount`: `<Pagination page={1} pageCount={12}>`. */
  totalPages?: { "Use <Pagination page={1} pageCount={12}>": never };
  /** Not a prop. Pass the number of pages: `pageCount={Math.ceil(total / pageSize)}`. */
  total?: { "Use pageCount={Math.ceil(total / pageSize)}": never };
  /** Not a prop. Ouro UI uses `pageCount`: `<Pagination page={1} pageCount={12}>`. */
  count?: { "Use <Pagination page={1} pageCount={12}>": never };
  /** Not a prop. Ouro UI uses `onPageChange`, which gets the page number: `onPageChange={(page) => …}`. */
  onChange?: { "Use <Pagination onPageChange={(page) => ...}>": never };
}

/** A Pagination that knows how many pages there are: Previous, the numbers with gaps, and Next. */
export interface PaginationCountProps {
  /** How many pages there are. From a count of rows: `Math.ceil(total / pageSize)`. */
  pageCount: number;
  /** Not with `pageCount`, which decides whether there is a next page. */
  hasNextPage?: never;
}

/**
 * A Pagination for a list without a count of its rows: Previous and Next only, as a query
 * that fetches one row more than a page can tell (`hasNextPage: rows.length > pageSize`).
 */
export interface PaginationPagerProps {
  /** Leave it out when the list has no count; pass it to show the page numbers. */
  pageCount?: undefined;
  /** Whether there is a page after this one, which enables Next. @default false */
  hasNextPage?: boolean | undefined;
}

/**
 * A Pagination of links: every page has its own address, so it works before JavaScript loads.
 *
 * @claim "A Pagination of links: every page" registry/ouro/components/ouro/pagination/pagination.test.tsx verify:testExists(registry/ouro/components/ouro/pagination/pagination.test.tsx::Pagination > works with no JavaScript: the server HTML holds every link)
 */
export type PaginationLinkProps = PaginationBaseProps & {
  /**
   * The address of a page: a string with `{page}` (`href="/recipes?page={page}"`, which a
   * Server Component can pass) or a function (`` href={(page) => `/recipes?page=${page}`} ``).
   * Internal paths go through `OuroProvider`'s `linkComponent`, so your router navigates.
   */
  href: string | ((page: number) => string);
  /** Not with `href`. Remove `href` to render buttons that call `onPageChange`. */
  onPageChange?: never;
};

/** A Pagination of buttons, for a list that pages in place without changing the address. */
export type PaginationButtonProps = PaginationBaseProps & {
  /** Called with the page number when the person picks a page. Update `page` in it. */
  onPageChange: (page: number) => void;
  /** Not with `onPageChange`. Remove `onPageChange` to render links. */
  href?: never;
};

/**
 * Props for {@link Pagination}: `href` for links or `onPageChange` for buttons, and
 * `pageCount` for the numbers or `hasNextPage` for Previous and Next only.
 */
export type PaginationProps = (PaginationLinkProps | PaginationButtonProps) & (PaginationCountProps | PaginationPagerProps);

// Class strings are literal so the app's Tailwind finds them when it compiles.

// A cell: 44px with 16px text on a coarse pointer at every width, 36px with 14px text with a fine one.
const cell =
  "press relative m-0 box-border inline-flex h-11 min-w-11 pointer-fine:h-9 pointer-fine:min-w-9 items-center justify-center gap-1 " +
  "rounded-md border-0 forced-colors:border forced-colors:border-solid bg-transparent px-2 font-[inherit] text-base pointer-fine:text-sm leading-5 font-medium text-foreground no-underline " +
  "tabular-nums select-none touch-manipulation [-webkit-tap-highlight-color:transparent] " +
  "outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid";
const live = "cursor-pointer pointer-fine:hover:bg-accent pointer-fine:hover:text-accent-foreground motion-safe:active:scale-(--ouro-press-scale)";
// Forced colours drop the fill, so the current page takes the system's highlight pair, kept as it
// is (Chromium paints even a system colour behind a link in the canvas colour otherwise).
const currentCell =
  "aria-[current=page]:bg-secondary aria-[current=page]:text-secondary-foreground " +
  "forced-colors:aria-[current=page]:forced-color-adjust-none forced-colors:aria-[current=page]:bg-[Highlight] forced-colors:aria-[current=page]:text-[HighlightText]";
const off = "cursor-not-allowed opacity-50";

function fill(template: string, page: number, pageCount?: number): string {
  const filled = template.replaceAll("{page}", String(page));
  return pageCount === undefined ? filled : filled.replaceAll("{pageCount}", String(pageCount));
}

/**
 * The cells of the page list: page numbers, and `0` for a gap. Every page of a long list
 * gets the same number of cells (first, last, the current page with its siblings, two gaps
 * or the pages they would hide), so a gap never stands for a single page.
 * @claim "Every page of a long list" registry/ouro/components/ouro/pagination/pagination.test.tsx verify:testExists(registry/ouro/components/ouro/pagination/pagination.test.tsx::Pagination > shows a gap after the first pages near the start)
 * @claim "Every page of a long list" registry/ouro/components/ouro/pagination/pagination.test.tsx verify:testExists(registry/ouro/components/ouro/pagination/pagination.test.tsx::Pagination > shows a gap before the last pages near the end)
 * @claim "Every page of a long list" registry/ouro/components/ouro/pagination/pagination.test.tsx verify:testExists(registry/ouro/components/ouro/pagination/pagination.test.tsx::Pagination > shows a gap on both sides in the middle)
 */
function cells(page: number, pageCount: number, siblings: number): number[] {
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index);
  const edge = siblings * 2 + 3;
  if (pageCount <= edge + 2) return range(1, pageCount);
  if (page <= siblings + 3) return [...range(1, edge), 0, pageCount];
  if (page >= pageCount - siblings - 2) return [1, 0, ...range(pageCount - edge + 1, pageCount)];
  return [1, 0, ...range(page - siblings, page + siblings), 0, pageCount];
}

/** The room the container gives the nav: its content box, less the nav's own margins. */
function roomFor(nav: HTMLElement): number {
  const container = nav.parentElement!;
  const containerStyle = getComputedStyle(container);
  const navStyle = getComputedStyle(nav);
  return container.clientWidth - parseFloat(containerStyle.paddingLeft) - parseFloat(containerStyle.paddingRight) - parseFloat(navStyle.marginLeft) - parseFloat(navStyle.marginRight);
}

/** The width of the page list in full: its shown cells and the gaps between them. */
function fullWidth(list: HTMLElement): number {
  const items = [...list.children].filter((item) => !item.querySelector("[data-ouro-pagination-summary]"));
  // Below 640px the sm rule hides the numbers, so the list is not laid out and there is nothing to measure.
  if (items.some((item) => item.getClientRects().length === 0)) return 0;
  const gap = parseFloat(getComputedStyle(list).columnGap);
  return items.reduce((sum, item) => sum + item.getBoundingClientRect().width, 0) + gap * (items.length - 1);
}

/**
 * Whether the page list fits the room its container gives the nav. It shows unless it would
 * overflow, and then the summary shows instead. A layout effect measures the list before paint,
 * so the first paint is the fitted list. A list the summary replaces is not laid out, so its
 * width is kept for the cells it was measured with, and measured again when those change or
 * when the list shows again.
 *
 * Server HTML and the first paint show the list. The `sm` rule hides the list below its
 * breakpoint, where nothing is measured.
 */
function useListFit(navRef: RefObject<HTMLElement | null>, listRef: RefObject<HTMLUListElement | null>, key: string | undefined): boolean {
  const [fits, setFits] = useState(true);
  const measured = useRef<{ key: string; width: number } | null>(null);
  const measure = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    measure.current = () => {
      // Stryker disable next-line ConditionalExpression: without a page count the pager has no page numbers or summary, so a fit either way changes no class or focus.
      if (key === undefined) return;
      const nav = navRef.current!;
      const list = listRef.current!;
      const room = roomFor(nav) + 0.5;
      if (!fits) {
        if (measured.current === null || measured.current.key !== key) {
          setFits(true);
          return;
        }
        setFits(measured.current.width <= room);
        return;
      }
      const width = fullWidth(list);
      if (width === 0) return;
      measured.current = { key, width };
      if (width > room) {
        // A focused page number moves focus to Next (or Previous on the last page) before the summary replaces it.
        if (list.querySelector("[data-ouro-pagination-page]:focus")) {
          const control = (part: string) => list.querySelector<HTMLElement>(`[data-ouro-pagination-${part}]:is(a, button:not([aria-disabled]))`);
          (control("next") ?? control("previous"))?.focus({ preventScroll: true });
        }
        setFits(false);
      }
    };
    measure.current!();
  }, [fits, key, navRef, listRef]);

  useLayoutEffect(
    () => {
      const observer = new ResizeObserver(() => flushSync(() => measure.current!()));
      observer.observe(navRef.current!.parentElement!);
      observer.observe(document.documentElement);
      // Fonts change the cells' widths and may change nothing the observer sees. A font that
      // finishes loading measures again once it is ready, unless the nav has gone.
      const fonts = document.fonts;
      const refit = () =>
        void fonts.ready.then(() => {
          if (navRef.current === null) return;
          measured.current = null;
          measure.current!();
        });
      fonts.addEventListener("loading", refit);
      refit();
      return () => {
        observer.disconnect();
        fonts.removeEventListener("loading", refit);
      };
    },
    // Stryker disable next-line ArrayDeclaration: the nav's and the list's refs are the same objects for the nav's life, so any constant list runs this effect once, as this one does.
    [navRef, listRef],
  );

  return fits;
}

function Chevron({ back }: { back?: boolean }): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0 rtl:-scale-x-100">
      <path d={back ? "M10 3 5 8l5 5" : "m6 3 5 5-5 5"} />
    </svg>
  );
}

/**
 * Page navigation for a long list: Previous, the page numbers with gaps, and Next, with the
 * current page marked `aria-current="page"`. With `href` every page is a real link, so it
 * works with no JavaScript and through your router; with `onPageChange` the pages are
 * buttons. Below 640px the numbers give way to "Page 3 of 12" between Previous and Next.
 * They give way too when they are wider than the space their container gives them, so the
 * list stays inside a narrow column. Without `pageCount`, for a list that is not counted, it
 * shows Previous and Next only, and `hasNextPage` enables Next.
 *
 * Use `ShowMore` instead when the next rows should join the list in place. Use `Tabs` to
 * switch between a few named views.
 *
 * @group Navigation
 * @see https://ui.ouroboros.bot/docs/pagination
 *
 * @example
 * <Pagination page={3} pageCount={12} href="/recipes?page={page}" />
 * <Pagination page={page} pageCount={12} onPageChange={setPage} />
 * <Pagination page={page} hasNextPage={rows.length > pageSize} href="?page={page}" />
 * @claim "Below 640px the numbers give way" registry/ouro/components/ouro/pagination/pagination.test.tsx verify:testExists(registry/ouro/components/ouro/pagination/pagination.test.tsx::Pagination > shows only Previous, the summary and Next below 640px)
 * @claim "They give way too when they are wider" registry/ouro/components/ouro/pagination/pagination.test.tsx verify:testExists(registry/ouro/components/ouro/pagination/pagination.test.tsx::Pagination in a column > shows the summary, not overflowing, in a column too narrow for every page)
 * @claim "They give way too when they are wider" registry/ouro/components/ouro/pagination/pagination.test.tsx verify:testExists(registry/ouro/components/ouro/pagination/pagination.test.tsx::Pagination in a column > switches to the summary when the column narrows, and back when it widens)
 * @claim "With `href` every page is a" registry/ouro/components/ouro/pagination/pagination.test.tsx verify:testExists(registry/ouro/components/ouro/pagination/pagination.test.tsx::Pagination > works with no JavaScript: the server HTML holds every link)
 * @claim "With `href` every page is a" registry/ouro/components/ouro/pagination/pagination.test.tsx verify:testExists(registry/ouro/components/ouro/pagination/pagination.test.tsx::Pagination without a page count > pages in place with onPageChange)
 */
export function Pagination(props: PaginationProps): JSX.Element {
  const {
    page: pageProp,
    pageCount: pageCountProp,
    hasNextPage,
    siblings = 1,
    label = "Pagination",
    previousLabel = "Previous",
    nextLabel = "Next",
    pageLabel = "Page {page}",
    summaryLabel = "Page {page} of {pageCount}",
    className,
    ref,
    href,
    onPageChange,
    // Guard props (hint types), dropped here so they never reach the DOM.
    currentPage,
    totalPages,
    total,
    count,
    onChange,
  } = props as PaginationBaseProps & {
    pageCount?: number;
    hasNextPage?: boolean;
    href?: string | ((page: number) => string);
    onPageChange?: (page: number) => void;
  };

  if ((href === undefined) === (onPageChange === undefined)) {
    devThrow(
      "Pagination",
      href === undefined ? "needs href or onPageChange" : "takes href or onPageChange, not both",
      process.env.NODE_ENV !== "production"
        ? 'Pass href="?page={page}" for links, or onPageChange={(page) => …} for buttons'
        : /* istanbul ignore next @preserve -- production only */ "",
    );
  }

  // A count or a page out of range (a bug in the caller) renders the nearest valid state and warns.
  // Without a count, only Previous and Next show.
  const pageCount = pageCountProp === undefined ? undefined : Math.max(1, Math.floor(pageCountProp));
  const page = Math.min(Math.max(1, Math.floor(pageProp)), pageCount ?? Infinity);
  const hasNext = pageCount === undefined ? Boolean(hasNextPage) : page < pageCount;

  useAppearanceClassNameCheck(
    "Pagination",
    className,
    process.env.NODE_ENV !== "production"
      ? (token: string) => `remove "${token}"; Pagination sets its own look`
      : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "Pagination",
    process.env.NODE_ENV !== "production"
      ? () => [
          pageCount !== pageCountProp && [`pageCount={${pageCountProp}} is not a count of pages`, `<Pagination page={${page}} pageCount={${pageCount}}>`],
          pageCount === pageCountProp &&
            page !== pageProp && [
              pageCount === undefined ? `page={${pageProp}} is not a page number` : `page={${pageProp}} is outside 1 to ${pageCount}`,
              pageCount === undefined ? `<Pagination page={${page}}>` : `<Pagination page={${page}} pageCount={${pageCount}}>`,
            ],
          pageCount !== undefined &&
            hasNextPage !== undefined && [
              "hasNextPage is for a list without a page count; pageCount decides",
              `<Pagination page={${page}} pageCount={${pageCount}}> or <Pagination page={${page}} hasNextPage>`,
            ],
          typeof href === "string" &&
            !href.includes("{page}") && [
              `href="${href}" has no {page}, so every link goes to one address`,
              `<Pagination href="${href}${href.includes("?") ? "&" : "?"}page={page}">`,
            ],
          currentPage !== undefined && ["currentPage is not a prop", "<Pagination page={1} pageCount={12}>"],
          totalPages !== undefined && ["totalPages is not a prop", "<Pagination page={1} pageCount={12}>"],
          total !== undefined && ["total is not a prop; pass the number of pages", "<Pagination page={1} pageCount={Math.ceil(total / pageSize)}>"],
          count !== undefined && ["count is not a prop", "<Pagination page={1} pageCount={12}>"],
          onChange !== undefined && ["onChange is not a prop", "<Pagination onPageChange={(page) => …}>"],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );

  const pages = pageCount === undefined ? [] : cells(page, pageCount, Math.max(0, Math.floor(siblings)));
  // What decides the width of the full list: its cells and the two labels. The nav's own classes do not.
  // Stryker disable next-line ConditionalExpression: without a count there are no page numbers or summary to show or hide, so a fit either way changes no class or focus.
  const fitKey = pageCount === undefined ? undefined : JSON.stringify([pages, previousLabel, nextLabel]);
  const navRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const fits = useListFit(navRef, listRef, fitKey);
  const navigationRef = useMergedRef(ref, navRef);
  // The summary shows when the list does not fit, and below 640px, where the sm rule hides the list.
  const pageClass = fits ? "max-sm:hidden" : "hidden";

  /** One control: a link with `href`, a button with `onPageChange`, or plain text when it leads nowhere. */
  const control = (target: number, enabled: boolean, attributes: Record<string, string | undefined>, classes: string, children: ReactNode) => {
    if (href !== undefined) {
      if (!enabled) {
        return (
          <span {...attributes} aria-disabled="true" className={cn(cell, off, classes)}>
            {children}
          </span>
        );
      }
      return (
        <RouterLink {...attributes} href={typeof href === "string" ? fill(href, target, pageCount) : href(target)} className={cn(cell, live, classes)}>
          {children}
        </RouterLink>
      );
    }
    // A button at an end says it is disabled rather than being disabled, so it keeps focus when
    // a press takes the reader there (a disabled button would drop focus to the page).
    return (
      <button {...attributes} type="button" aria-disabled={enabled ? undefined : true} onClick={enabled ? () => onPageChange!(target) : undefined} className={cn(cell, enabled ? live : off, classes)}>
        {children}
      </button>
    );
  };

  return (
    <nav ref={navigationRef} data-ouro="pagination" aria-label={label} className={cn("min-w-0", className)}>
      <ul ref={listRef} className="m-0 flex list-none items-center justify-between gap-1 p-0 sm:justify-center">
        <li>
          {control(
            page - 1,
            page > 1,
            { "data-ouro-pagination-previous": "", "data-ouro-control": "pagination", "data-ouro-part": "previous", rel: href !== undefined && page > 1 ? "prev" : undefined },
            "px-3",
            <>
              <Chevron back />
              {previousLabel}
            </>,
          )}
        </li>
        {pageCount !== undefined && (
        <li className={fits ? "sm:hidden" : undefined}>
          <span data-ouro-pagination-summary="" aria-current="page" className="px-2 text-base leading-5 text-muted-foreground tabular-nums">
            {fill(summaryLabel, page, pageCount)}
          </span>
        </li>
        )}
        {pages.map((target, index) =>
          target === 0 ? (
            <li key={`gap${index}`} className={pageClass}>
              <span data-ouro-pagination-gap="" aria-hidden="true" className="inline-flex h-11 min-w-9 pointer-fine:h-9 items-center justify-center text-base text-muted-foreground select-none">
                …
              </span>
            </li>
          ) : (
            <li key={target} className={pageClass}>
              {control(
                target,
                true,
                { "data-ouro-pagination-page": "", "data-ouro-control": "pagination", "data-ouro-part": "page", "aria-label": fill(pageLabel, target, pageCount), "aria-current": target === page ? "page" : undefined },
                currentCell,
                target,
              )}
            </li>
          ),
        )}
        <li>
          {control(
            page + 1,
            hasNext,
            { "data-ouro-pagination-next": "", "data-ouro-control": "pagination", "data-ouro-part": "next", rel: href !== undefined && hasNext ? "next" : undefined },
            "px-3",
            <>
              {nextLabel}
              <Chevron />
            </>,
          )}
        </li>
      </ul>
    </nav>
  );
}
