"use client";

import type { JSX, ReactNode, Ref } from "react";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { devThrow } from "~/lib/ouro/dev";
import { RouterLink } from "~/lib/ouro/router-link";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";

/** Props shared by every kind of Pagination (`href` or `onPageChange`, `pageCount` or `hasNextPage`). */
export interface PaginationBaseProps {
  /** The current page, counting from 1. */
  page: number;
  /**
   * How many pages show on each side of the current one before a gap ("1 … 4 5 6 … 12" is
   * `1`). The list keeps the same number of cells on every page, so Next never moves.
   * @default 1
   */
  siblings?: number | undefined;
  /** Names the navigation for screen readers. @default "Pagination" */
  label?: string | undefined;
  /** The text of the link to the page before. @default "Previous" */
  previousLabel?: string | undefined;
  /** The text of the link to the page after. @default "Next" */
  nextLabel?: string | undefined;
  /** What a screen reader calls each page number; `{page}` is the number. @default "Page {page}" */
  pageLabel?: string | undefined;
  /**
   * The text between Previous and Next below 640px, where the page numbers do not fit;
   * `{page}` and `{pageCount}` are the numbers. @default "Page {page} of {pageCount}"
   */
  summaryLabel?: string | undefined;
  /** Layout only: margins, width, grid placement (`mt-6`). Appearance classes warn in development. */
  className?: string | undefined;
  ref?: Ref<HTMLElement> | undefined;

  /** Not a prop. Ouro UI uses `page`, counting from 1: `<Pagination page={1} pageCount={12}>`. */
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

/** A Pagination of links: every page has its own address, so it works before JavaScript loads. */
export type PaginationLinkProps = PaginationBaseProps & {
  /**
   * The address of a page: a string with `{page}` (`href="/recipes?page={page}"`, which a
   * Server Component can pass) or a function (`href={(page) => `/recipes?page=${page}`}`).
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
  "rounded-md border-0 bg-transparent px-2 font-[inherit] text-base pointer-fine:text-sm leading-5 font-medium text-foreground no-underline " +
  "tabular-nums select-none touch-manipulation [-webkit-tap-highlight-color:transparent] " +
  "outline-ring outline-offset-2 focus-visible:outline-2 focus-visible:outline-solid";
const live = "cursor-pointer pointer-fine:hover:bg-accent pointer-fine:hover:text-accent-foreground motion-safe:active:scale-(--ouro-press-scale)";
const currentCell = "aria-[current=page]:bg-secondary aria-[current=page]:text-secondary-foreground";
const off = "cursor-not-allowed opacity-50";

function fill(template: string, page: number, pageCount?: number): string {
  const filled = template.replaceAll("{page}", String(page));
  return pageCount === undefined ? filled : filled.replaceAll("{pageCount}", String(pageCount));
}

/**
 * The cells of the page list: page numbers, and `0` for a gap. Every page of a long list
 * gets the same number of cells (first, last, the current page with its siblings, two gaps
 * or the pages they would hide), so a gap never stands for a single page.
 */
function cells(page: number, pageCount: number, siblings: number): number[] {
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index);
  const edge = siblings * 2 + 3;
  if (pageCount <= edge + 2) return range(1, pageCount);
  if (page <= siblings + 3) return [...range(1, edge), 0, pageCount];
  if (page >= pageCount - siblings - 2) return [1, 0, ...range(pageCount - edge + 1, pageCount)];
  return [1, 0, ...range(page - siblings, page + siblings), 0, pageCount];
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
 * Without `pageCount`, for a list that is not counted, it shows Previous and Next only, and
 * `hasNextPage` enables Next.
 *
 * Use `ShowMore` instead when the next rows should join the list in place. Use `Tabs` to
 * switch between a few named views.
 *
 * @group Navigation
 * @see https://ourostack.github.io/ouro-ui/docs/pagination
 *
 * @example
 * <Pagination page={3} pageCount={12} href="/recipes?page={page}" />
 * <Pagination page={page} pageCount={12} onPageChange={setPage} />
 * <Pagination page={page} hasNextPage={rows.length > pageSize} href="?page={page}" />
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
    return (
      <button {...attributes} type="button" disabled={!enabled} onClick={() => onPageChange!(target)} className={cn(cell, enabled ? live : off, classes)}>
        {children}
      </button>
    );
  };

  return (
    <nav ref={ref} data-ouro="pagination" aria-label={label} className={cn("min-w-0", className)}>
      <ul className="m-0 flex list-none items-center justify-between gap-1 p-0 sm:justify-center">
        <li>
          {control(
            page - 1,
            page > 1,
            { "data-ouro-pagination-previous": "", rel: href !== undefined && page > 1 ? "prev" : undefined },
            "px-3",
            <>
              <Chevron back />
              {previousLabel}
            </>,
          )}
        </li>
        {pageCount !== undefined && (
        <li className="sm:hidden">
          <span data-ouro-pagination-summary="" aria-current="page" className="px-2 text-base leading-5 text-muted-foreground tabular-nums">
            {fill(summaryLabel, page, pageCount)}
          </span>
        </li>
        )}
        {(pageCount === undefined ? [] : cells(page, pageCount, Math.max(0, Math.floor(siblings)))).map((target, index) =>
          target === 0 ? (
            <li key={`gap${index}`} className="max-sm:hidden">
              <span data-ouro-pagination-gap="" aria-hidden="true" className="inline-flex h-11 min-w-9 pointer-fine:h-9 items-center justify-center text-base text-muted-foreground select-none">
                …
              </span>
            </li>
          ) : (
            <li key={target} className="max-sm:hidden">
              {control(
                target,
                true,
                { "data-ouro-pagination-page": "", "aria-label": fill(pageLabel, target, pageCount), "aria-current": target === page ? "page" : undefined },
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
            { "data-ouro-pagination-next": "", rel: href !== undefined && hasNext ? "next" : undefined },
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
