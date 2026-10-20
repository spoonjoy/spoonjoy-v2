"use client";

import { isValidElement, useEffect, useRef, useState, type CSSProperties, type JSX, type MouseEvent, type ReactNode, type Ref } from "react";
import { Button } from "~/components/ouro/button/button";
import { useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { cn } from "~/lib/ouro/cn";
import { serverElement } from "~/lib/ouro/server-element";
import { useDevWarnings } from "~/lib/ouro/use-dev-messages";
import {
  itemClass,
  listClass,
  showMoreHint,
  showMoreRootClass,
  textClass,
} from "~/components/ouro/collapsible/collapsible-styles";

/** Props every ShowMore takes. */
export interface ShowMoreBaseProps {
  /** The button's text while there is more to show. Translate it here. @default "Show more" */
  showMoreLabel?: string | undefined;
  /** Layout only: margins, width, grid placement (`mt-6`). Text classes go on a parent so the items inherit them. */
  className?: string | undefined;
  ref?: Ref<HTMLDivElement> | undefined;

  /** Not a prop. Ouro UI uses `lines`: `<ShowMore lines={3}>`. */
  maxLines?: { 'Use <ShowMore lines={3}>': never };
  /** Not a prop. Ouro UI uses `initialCount`: `<ShowMore items={items} initialCount={5}>`. */
  limit?: { 'Use <ShowMore items={items} initialCount={5}>': never };
}

/** Long text clamped to `lines` lines, with "Show more" and "Show less". */
export type ShowMoreLinesProps = ShowMoreBaseProps & {
  /** How many lines show while collapsed. The button appears only when the text is longer. */
  lines: number;
  /** The text. Screen readers always read all of it. */
  children: ReactNode;
  /** The button's text while everything shows. Translate it here. @default "Show less" */
  showLessLabel?: string | undefined;
  /** List modes only: not with `lines`. */
  items?: never;
  /** Only with `items` and no `onShowMore`. */
  initialCount?: never;
  /** List modes only: not with `lines`. */
  ordered?: never;
  /** Only for a list that loads more: with `items`, without `initialCount` or `lines`. */
  onShowMore?: never;
  /** Only with `onShowMore`. */
  hasMore?: never;
  /** Only with `onShowMore`. */
  loading?: never;
  /** Only with `onShowMore`. */
  loadingLabel?: never;
  /** Only with `onShowMore`. */
  loadedLabel?: never;
  /** Only with `onShowMore`. */
  noMoreLabel?: never;
  /** Only with `onShowMore`. */
  href?: never;
};

/** Props both list modes take. */
export interface ShowMoreListProps extends ShowMoreBaseProps {
  /**
   * Every item, in order. Each renders in its own list item; give elements a `key`. With
   * `onShowMore`, append each new page here.
   */
  items: readonly ReactNode[];
  /** Renders an `<ol>`, for a ranked or numbered list. @default false (`<ul>`) */
  ordered?: boolean | undefined;
  /** Text mode only: not with `items`. */
  lines?: never;
  /** Text mode only: a list takes `items`. */
  children?: never;
}

/** A list cut to its first `initialCount` items, with "Show more" and "Show less". */
export type ShowMoreItemsProps = ShowMoreListProps & {
  /** How many items show while collapsed. @default 5 */
  initialCount?: number | undefined;
  /** The button's text while everything shows. Translate it here. @default "Show less" */
  showLessLabel?: string | undefined;
  /** Only for a list that loads more: with `items`, without `initialCount` or `lines`. */
  onShowMore?: never;
  /** Only with `onShowMore`. */
  hasMore?: never;
  /** Only with `onShowMore`. */
  loading?: never;
  /** Only with `onShowMore`. */
  loadingLabel?: never;
  /** Only with `onShowMore`. */
  loadedLabel?: never;
  /** Only with `onShowMore`. */
  noMoreLabel?: never;
  /** Only with `onShowMore`. */
  href?: never;
};

/** A list the server grows a page at a time: "Show more" asks for the next page and appends it. */
export type ShowMoreLoadProps = ShowMoreListProps & {
  /** Asks for the next page. The button is busy while `loading`, and focus moves to the first new item when it arrives. */
  onShowMore: () => void;
  /** Whether there is another page. Without one, the button goes away. */
  hasMore: boolean;
  /** Shows the button as busy, and keeps it from asking twice. */
  loading?: boolean | undefined;
  /** What screen readers hear when loading starts. Translate it here. @default "Loading" */
  loadingLabel?: string | undefined;
  /**
   * What screen readers hear after each page, from the number of items now shown. Name the
   * items and translate it here: `(count) => \`Showing ${count} recipes\``.
   * @default (count) => `Showing ${count} items`
   */
  loadedLabel?: ((count: number) => string) | undefined;
  /** What screen readers hear when a page comes back empty and there is no more. Translate it here. @default "No more items" */
  noMoreLabel?: string | undefined;
  /**
   * The next page's URL, so the button is a link that works before JavaScript loads. With
   * JavaScript, pressing it calls `onShowMore` instead.
   */
  href?: string | undefined;
  /** Only with `items` and no `onShowMore`. */
  initialCount?: never;
  /** A list that loads more never shrinks, so it has no "Show less". */
  showLessLabel?: never;
};

/** Props for {@link ShowMore}: clamp text with `lines`, cut a list with `items`, or grow it from the server with `onShowMore`. */
export type ShowMoreProps = ShowMoreLinesProps | ShowMoreItemsProps | ShowMoreLoadProps;

const DEFAULT_COUNT = 5;
const DEFAULT_LINES = 3;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Focuses the first focusable thing in a row, or the row itself. */
function focusRow(row: Element): void {
  (row.querySelector<HTMLElement>(FOCUSABLE) ?? (row as HTMLElement)).focus();
}

/** The first item of a list that was empty when "Show more" was pressed: any first page is new items. */
const EMPTY = Symbol("empty");

/**
 * What stays the same for an item across renders: an element's key, or a text or number item
 * itself. An element without a key is a new object every render, so it has none (null).
 */
function identity(item: ReactNode): unknown {
  // An item a Server Component passed can be a lazy wrapper, a new object on every payload.
  const element = serverElement(item);
  if (isValidElement(element)) return element.key;
  return element;
}

/** The row's key: the item's own key, or its place in the list. */
function rowKey(item: ReactNode, index: number): string | number {
  const element = serverElement(item);
  return isValidElement(element) && element.key !== null ? element.key : index;
}

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0;

/**
 * "Show more" for a long list or a long text. It cuts a list to its first items, clamps text
 * to a number of lines, or grows a list a page at a time from the server, and moves focus to
 * the first newly shown item, so keyboard and screen reader users land on what they asked
 * for. A list that loads more also says how many items now show. The visible items are in
 * the server HTML. ShowMore draws the list itself: put a border around the list on a wrapping
 * element, and borders between rows on each item.
 *
 * Use `Collapsible` instead to hide a whole section behind its title. Use `Pagination`
 * instead when people need to jump to a page or share its URL.
 *
 * @group Lists
 * @see https://ourostack.github.io/ouro-ui/docs/show-more
 *
 * @example
 * <ShowMore items={reviews.map((review) => <Review key={review.id} {...review} />)} initialCount={3} />
 * <ShowMore lines={3}>{recipe.description}</ShowMore>
 * <ShowMore items={rows} hasMore={Boolean(nextCursor)} loading={loading} onShowMore={loadNext} href={nextHref} />
 */
export function ShowMore(props: ShowMoreProps): JSX.Element {
  const { showMoreLabel = "Show more", className, ref, maxLines, limit } = props;
  const { lines, initialCount, items } = props;
  useAppearanceClassNameCheck(
    "ShowMore",
    className,
    process.env.NODE_ENV !== "production" ? showMoreHint : /* istanbul ignore next @preserve -- production only */ "",
  );
  useDevWarnings(
    "ShowMore",
    process.env.NODE_ENV !== "production"
      ? () => [
          maxLines !== undefined && ["maxLines is not a prop", `<ShowMore lines={${String(maxLines)}}>`],
          limit !== undefined && ["limit is not a prop", `<ShowMore items={items} initialCount={${String(limit)}}>`],
          initialCount !== undefined &&
            !isCount(initialCount) && [
              `initialCount={${String(initialCount)}} is not a whole number above 0`,
              `<ShowMore items={items} initialCount={${DEFAULT_COUNT}}>`,
            ],
          lines !== undefined &&
            !isCount(lines) && [`lines={${String(lines)}} is not a whole number above 0`, `<ShowMore lines={${DEFAULT_LINES}}>`],
        ]
      : /* istanbul ignore next @preserve -- production only */ undefined,
  );
  if (items === undefined) {
    // Text mode. A guessed maxLines (a type error) still clamps, as lines would.
    const { children, showLessLabel = "Show less" } = props as ShowMoreLinesProps;
    const clamp = [lines, maxLines].find(isCount) ?? DEFAULT_LINES;
    return (
      <ShowMoreText
        lines={clamp}
        showMoreLabel={showMoreLabel}
        showLessLabel={showLessLabel}
        className={className}
        rootRef={ref}
      >
        {children}
      </ShowMoreText>
    );
  }
  return <ShowMoreList {...(props as ShowMoreItemsProps | ShowMoreLoadProps)} showMoreLabel={showMoreLabel} />;
}

function ShowMoreText({
  lines,
  children,
  showMoreLabel,
  showLessLabel,
  className,
  rootRef,
}: {
  lines: number;
  children: ReactNode;
  showMoreLabel: string;
  showLessLabel: string;
  className: string | undefined;
  rootRef: Ref<HTMLDivElement> | undefined;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  // Measured after mount, so server HTML has no button and hydration matches.
  const [overflowing, setOverflowing] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Expanded, the text never overflows; keep the button that collapses it.
    if (expanded) return;
    const text = textRef.current!;
    const measure = () => setOverflowing(text.scrollHeight > text.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(text);
    return () => observer.disconnect();
  }, [expanded, children, lines]);
  return (
    <div ref={rootRef} data-ouro="show-more" className={cn(showMoreRootClass, className)}>
      <div
        ref={textRef}
        data-ouro-show-more-text=""
        className={cn(textClass, !expanded && "line-clamp-(--ouro-show-more-lines)")}
        style={{ "--ouro-show-more-lines": lines } as CSSProperties}
      >
        {children}
      </div>
      {overflowing && (
        <Button variant="plain" size="sm" className="-ms-(--ouro-button-px)" data-ouro-show-more-toggle="" data-ouro-control="show-more" data-ouro-part="toggle" onClick={() => setExpanded(!expanded)}>
          {expanded ? showLessLabel : showMoreLabel}
        </Button>
      )}
    </div>
  );
}

function ShowMoreList(props: (ShowMoreItemsProps | ShowMoreLoadProps) & { showMoreLabel: string }): JSX.Element {
  const { items, ordered, showMoreLabel, className, ref } = props;
  const load = props.onShowMore !== undefined ? (props as ShowMoreLoadProps) : undefined;
  const { initialCount, showLessLabel = "Show less" } = props as ShowMoreItemsProps;
  const count = isCount(initialCount) ? initialCount : DEFAULT_COUNT;
  const [expanded, setExpanded] = useState(false);
  // Rows from this index on are newly shown: they fade in.
  const [freshFrom, setFreshFrom] = useState<number | null>(null);
  // The index of the first row the last press asked for, until focus has moved there, and the
  // first item when it was asked: a different first item means a new list, not the next page.
  const pending = useRef<number | null>(null);
  const pendingFirst = useRef<unknown>(undefined);
  const listRef = useRef<HTMLUListElement & HTMLOListElement>(null);
  const buttonRef = useRef<HTMLElement>(null);
  const loading = load?.loading === true;
  const visible = load || expanded ? items : items.slice(0, count);
  const hasButton = load ? load.hasMore : items.length > count;

  // What the status region says after a page loads (load mode only).
  const [status, setStatus] = useState("");
  // Whether `loading` was true since the last press, so a load that ends with no new items is noticed.
  const loaded = useRef(false);
  const loadedLabel = load?.loadedLabel ?? ((shown: number) => `Showing ${shown} items`);
  const noMoreLabel = load?.noMoreLabel ?? "No more items";

  useEffect(() => {
    const from = pending.current;
    if (from === null) return;
    if (loading) {
      loaded.current = true;
      return;
    }
    const rows = listRef.current!.children;
    const stop = () => {
      pending.current = null;
      loaded.current = false;
    };
    const arrive = (row: Element | undefined, message: string) => {
      stop();
      // The button is gone. An empty list whose load found nothing has no row, so focus moves
      // to the list itself (focusable and named by noMoreLabel while empty), never to the page.
      if (row) focusRow(row);
      else listRef.current!.focus();
      if (load) setStatus(message);
    };
    const replaced = pendingFirst.current !== EMPTY && identity(items[0]) !== pendingFirst.current;
    if (replaced || rows.length < from) {
      // The list was replaced (a new first item, or fewer items: a new search). Stop waiting,
      // so a later change to the list never moves focus.
      stop();
    } else if (rows.length > from) {
      arrive(rows[from]!, loadedLabel(rows.length));
    } else if (!hasButton) {
      // The last page came back empty and the button is gone: keep focus in the list.
      arrive(rows[rows.length - 1], noMoreLabel);
    } else if (loaded.current) {
      // The load ended with no new items (it failed): stop waiting, as above.
      stop();
    }
  });

  const press = (event: MouseEvent) => {
    if (load) {
      event.preventDefault();
      pending.current = items.length;
      pendingFirst.current = items.length === 0 ? EMPTY : identity(items[0]);
      loaded.current = false;
      setFreshFrom(items.length);
      load.onShowMore();
    } else if (expanded) {
      setExpanded(false);
      setFreshFrom(null);
      // The list shrinks above the button; keep the button on screen.
      requestAnimationFrame(() => buttonRef.current?.scrollIntoView({ block: "nearest" }));
    } else {
      pending.current = count;
      // The button shows only when there are more items than count, so the list is not empty.
      pendingFirst.current = identity(items[0]);
      setFreshFrom(count);
      setExpanded(true);
    }
  };

  const List = ordered ? "ol" : "ul";
  // An empty list with nothing more to load takes focus when the last load finds nothing, so it
  // is named for that already when focus lands.
  const emptyEnd = load !== undefined && items.length === 0 && !load.hasMore;
  const button = !hasButton ? null : load ? (
    <Button
      ref={buttonRef as Ref<HTMLAnchorElement & HTMLButtonElement>}
      variant="plain"
      size="sm"
      className="-ms-(--ouro-button-px)"
      data-ouro-show-more-toggle="" data-ouro-control="show-more" data-ouro-part="toggle"
      loading={loading}
      loadingLabel={load.loadingLabel}
      onClick={press}
      {...(load.href !== undefined ? { href: load.href } : {})}
    >
      {showMoreLabel}
    </Button>
  ) : (
    <Button ref={buttonRef as Ref<HTMLButtonElement>} variant="plain" size="sm" className="-ms-(--ouro-button-px)" data-ouro-show-more-toggle="" data-ouro-control="show-more" data-ouro-part="toggle" onClick={press}>
      {expanded ? showLessLabel : showMoreLabel}
    </Button>
  );
  return (
    <div ref={ref} data-ouro="show-more" className={cn(showMoreRootClass, className)}>
      {/* Safari drops list semantics from an unstyled list unless the role is explicit. */}
      <List
        ref={listRef}
        role="list"
        tabIndex={emptyEnd ? -1 : undefined}
        aria-label={emptyEnd ? noMoreLabel : undefined}
        className={cn(listClass, emptyEnd && "outline-none")}
      >
        {visible.map((item, index) => (
          <li
            key={rowKey(item, index)}
            tabIndex={-1}
            className={cn(
              itemClass,
              freshFrom !== null && index >= freshFrom && "transition-opacity duration-(--ouro-duration-base) ease-(--ouro-ease-out) starting:opacity-0",
            )}
          >
            {item}
          </li>
        ))}
      </List>
      {button}
      {/* Stays mounted after the last page, so the last count is still read. */}
      {load && (
        <p role="status" data-ouro-show-more-status="" className="sr-only">
          {status}
        </p>
      )}
    </div>
  );
}
