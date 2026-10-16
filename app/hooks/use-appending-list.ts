import { useCallback, useEffect, useRef, useState } from 'react'
import { useFetcher } from 'react-router'

// The one way a long public list grows: a cursor-based "Show more".
//
// The server reads one page after a cursor (the id of the last row shown) and says whether there is
// another. Without JavaScript, "Show more" is an ordinary link to the next page. With it, the next
// page is fetched in place and appended, focus moves to the first new row, and a polite live region
// says how many rows are now shown, so keyboard and screen-reader users keep their place.

export interface ListPage<T> {
  items: T[]
  nextCursor: string | null
}

export interface AppendingList<T> {
  items: T[]
  nextCursor: string | null
  loading: boolean
  // Index of the first row the last "Show more" added, or null before any.
  firstNewIndex: number | null
  showMore(): void
  announcement: string
}

export function useAppendingList<T extends { id: string }, D>({
  page,
  resetKey,
  loadHref,
  select,
  noun,
}: {
  page: ListPage<T>
  // Changes when the list itself changes (a new search, a new first page), dropping appended rows.
  resetKey: string
  // The URL the fetcher loads for the page after `cursor`.
  loadHref(cursor: string): string
  select(data: D): ListPage<T>
  // Plural noun for the announcement, such as "recipes".
  noun: string
}): AppendingList<T> {
  const fetcher = useFetcher()
  // The fetcher loads the same route as the page, so its data has the page's loader shape.
  const data = fetcher.data as D | undefined
  const [state, setState] = useState<{ key: string; extra: T[]; nextCursor: string | null; firstNewIndex: number | null }>({
    key: resetKey,
    extra: [],
    nextCursor: page.nextCursor,
    firstNewIndex: null,
  })
  const current = state.key === resetKey ? state : { key: resetKey, extra: [], nextCursor: page.nextCursor, firstNewIndex: null }
  const handledData = useRef<D | undefined>(data)
  const pendingLoad = useRef(false)
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    if (state.key !== resetKey) {
      setState({ key: resetKey, extra: [], nextCursor: page.nextCursor, firstNewIndex: null })
      setAnnouncement('')
    }
  }, [resetKey, state.key, page.nextCursor])

  useEffect(() => {
    if (fetcher.state !== 'idle' || data === undefined || data === handledData.current) return
    handledData.current = data
    const next = select(data)
    const seen = new Set([...page.items, ...current.extra].map((item) => item.id))
    const added = next.items.filter((item) => !seen.has(item.id))
    const shownBefore = page.items.length + current.extra.length
    setState({
      key: resetKey,
      extra: [...current.extra, ...added],
      nextCursor: next.nextCursor,
      firstNewIndex: added.length > 0 ? shownBefore : current.firstNewIndex,
    })
    setAnnouncement(`Showing ${shownBefore + added.length} ${noun}`)
  }, [fetcher.state, data, select, resetKey, page.items, current.extra, current.firstNewIndex, noun])

  const { load } = fetcher
  const cursor = current.nextCursor
  const showMore = useCallback(() => {
    // Native clicks can arrive in one batch before Router commits its loading
    // render. The real load promise, not render timing, owns this in-flight gate.
    if (cursor && !pendingLoad.current) {
      pendingLoad.current = true
      void load(loadHref(cursor)).finally(() => { pendingLoad.current = false })
    }
  }, [cursor, load, loadHref])

  return {
    items: current.extra.length > 0 ? [...page.items, ...current.extra] : page.items,
    nextCursor: current.nextCursor,
    // Router publishes idle data before the effect appends it. Keep the list busy through
    // that accepted-answer render so ShowMore never mistakes it for an empty completion.
    loading: fetcher.state !== 'idle' || (data !== undefined && data !== handledData.current),
    firstNewIndex: current.firstNewIndex,
    showMore,
    announcement,
  }
}
