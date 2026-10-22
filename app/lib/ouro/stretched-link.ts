export { raiseControlsClass, stretchedLinkClass };

/**
 * The class for a link that stretches over its whole row or card through its `::after`,
 * so the row is one link with one tab stop (`Item`, `Card` and `Table` with a row link).
 * The linked root is `relative` (and `isolate`), and the link carries
 * `data-stretched-link=""`. The layer is `z-1`, so positioned content that is not a
 * control (a ScrollArea, an AspectRatio) stays under it; raised controls are `z-10`.
 *
 * @internal
 * @example
 * <div data-linked="" className={cn("relative isolate", raiseControlsClass)}>
 *   <a href="/recipes/1" data-stretched-link="" className={stretchedLinkClass}>Ribs</a>
 * </div>
 */
const stretchedLinkClass =
  "text-inherit no-underline outline-none after:absolute after:inset-0 after:z-1 after:content-[''] " +
  "after:transition-colors after:duration-(--ouro-duration-fast) pointer-fine:hover:after:bg-foreground/[0.03] active:after:bg-foreground/[0.06]";

/**
 * The class for a linked root that lifts every control inside it (a link, a button, an
 * input, anything with a tab stop) above its stretched link, so the control takes its own
 * clicks and taps and the text around it opens the link. A nested linked root (a linked
 * `Item` in a linked `Card`, marked `data-linked=""`) is lifted whole, so its own link
 * keeps covering it. The selector is inside `:where()`, with no specificity, so a
 * control's own `absolute` or `z-*` class still wins. An element that takes focus only
 * from code (`tabindex="-1"`, as a ScrollArea that fits) stays under the link.
 *
 * @internal
 * @example
 * <tr data-linked="" className={cn("relative isolate", raiseControlsClass)}>…</tr>
 * @claim "The class for a linked root" registry/ouro/components/ouro/card/card.test.tsx verify:testExists(registry/ouro/components/ouro/card/card.test.tsx::Card with href > keeps the action and footer controls on top, as their own tab stops)
 * @claim "The selector is inside `:where()`, with" registry/ouro/lib/ouro/stretched-link.ts verify:fileLine(registry/ouro/lib/ouro/stretched-link.ts, /:where\(/)
 */
const raiseControlsClass =
  "[:where(&_:is(a,button,input,select,textarea,label,summary,[tabindex]:not([tabindex='-1']),[role=button],[data-linked]):not([data-stretched-link]))]:relative " +
  "[:where(&_:is(a,button,input,select,textarea,label,summary,[tabindex]:not([tabindex='-1']),[role=button],[data-linked]):not([data-stretched-link]))]:z-10";
