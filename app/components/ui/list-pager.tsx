import { Pagination, PaginationNext, PaginationPrevious } from './pagination'
import { Text } from './text'
import type { ListPageInfo } from '~/lib/list-pagination'

/**
 * Previous and next links with "Page N of M" between them, for a list paged with
 * `~/lib/list-pagination`. Renders nothing when the whole list fits on one page.
 */
export function ListPager({
  pages,
  'aria-label': ariaLabel,
  className = 'mt-6',
}: {
  pages: Pick<ListPageInfo, 'page' | 'totalPages' | 'previousHref' | 'nextHref'>
  'aria-label': string
  className?: string
}) {
  if (pages.totalPages <= 1) return null
  return (
    <Pagination className={className} aria-label={ariaLabel}>
      <PaginationPrevious href={pages.previousHref} />
      <Text className="self-center font-sj-ui text-xs uppercase tracking-[0.14em]">
        Page {pages.page} of {pages.totalPages}
      </Text>
      <PaginationNext href={pages.nextHref} />
    </Pagination>
  )
}
