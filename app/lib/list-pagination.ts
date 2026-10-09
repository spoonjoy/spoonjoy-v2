/**
 * Page-numbered pagination for long public lists that render on the server (a chef's
 * recipes on their profile, and the public recipe list). Pages are 1-based and travel
 * in the `?page=` query parameter, so every page is a plain, shareable, crawlable URL,
 * the same convention as My Recipes and the fellow-chefs pages.
 *
 * Page numbers (OFFSET) rather than keyset cursors: these lists order by DateTime
 * columns that D1 can hold as either integer milliseconds or ISO text, and an OFFSET
 * always agrees with the SQL ORDER BY, whatever the stored form.
 *
 * Render the links with `Pagination`, `PaginationPrevious` and `PaginationNext` from
 * `~/components/ui/pagination`.
 */

export const LIST_PAGE_SIZE = 24;

/** Requests for deeper pages are read as this page, so no request scans further. */
export const MAX_LIST_PAGE = 1_000;

export const PAGE_PARAM = "page";

/** The requested page: 1 when absent or not a positive whole number, at most MAX_LIST_PAGE. */
export function parseListPage(url: URL): number {
  const raw = url.searchParams.get(PAGE_PARAM);
  const page = raw !== null && /^\d+$/.test(raw) ? Number(raw) : 1;
  return Math.min(Math.max(page, 1), MAX_LIST_PAGE);
}

export function listOffset(page: number, pageSize = LIST_PAGE_SIZE): number {
  return (page - 1) * pageSize;
}

/** The path and query for `page` of the list at `url`, keeping every other parameter. */
export function listPageHref(url: URL, page: number): string {
  const next = new URL(url);
  if (page <= 1) next.searchParams.delete(PAGE_PARAM);
  else next.searchParams.set(PAGE_PARAM, String(page));
  const query = next.searchParams.toString();
  return `${next.pathname}${query ? `?${query}` : ""}`;
}

export interface ListPageInfo {
  page: number;
  totalPages: number;
  totalItems: number;
  /** Path and query of the neighbouring pages, or null at either end. */
  previousHref: string | null;
  nextHref: string | null;
}

export function listPageInfo(url: URL, page: number, totalItems: number, pageSize = LIST_PAGE_SIZE): ListPageInfo {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  return {
    page,
    totalPages,
    totalItems,
    previousHref: page > 1 ? listPageHref(url, page - 1) : null,
    nextHref: page < totalPages ? listPageHref(url, page + 1) : null,
  };
}
