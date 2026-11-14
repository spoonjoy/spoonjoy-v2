import { onTestFinished } from "vitest";

export { layoutReadNames, watchLayoutReads };
export type { LayoutRead, LayoutReads };

// Where each read lives, and whether it is a getter or a method.
const reads = [
  ["HTMLElement", "get", ["offsetHeight", "offsetWidth", "offsetTop", "offsetLeft", "offsetParent", "innerText"]],
  ["Element", "get", ["clientHeight", "clientWidth", "clientTop", "clientLeft", "scrollHeight", "scrollWidth", "scrollTop", "scrollLeft"]],
  ["Element", "call", ["getBoundingClientRect", "getClientRects", "computedStyleMap", "scrollIntoView"]],
  ["Range", "call", ["getBoundingClientRect", "getClientRects"]],
  ["SVGGraphicsElement", "call", ["getBBox"]],
  ["HTMLElement", "call", ["focus"]],
  ["SVGElement", "call", ["focus"]],
  ["Document", "call", ["elementFromPoint", "elementsFromPoint"]],
  ["window", "get", ["scrollX", "scrollY", "innerWidth", "innerHeight"]],
  ["window", "call", ["getComputedStyle"]],
] as const;

/**
 * The reads `watchLayoutReads` counts: each makes the browser bring style and layout up to date
 * first when anything changed since it last did, so inside a React commit, where the page has just
 * changed, each one lays the page out before it paints (a forced layout). `getComputedStyle` and
 * `computedStyleMap` count as soon as they are called, since nearly any property read from them
 * does that, and `focus` and `scrollIntoView` count because they lay the page out to find where the
 * element is.
 *
 * @claim "each makes the browser bring style and layout up to date" registry/ouro/lib/ouro/testing/layout-reads.test.ts verify:testExists(registry/ouro/lib/ouro/testing/layout-reads.test.ts::watchLayoutReads > reads a size changed a moment ago at once, which the browser can answer only by laying the page out first)
 */
const layoutReadNames = [...new Set(reads.flatMap(([, , names]) => names))];

/** One layout read: what was read, and the element, range, document or window it was read from. */
interface LayoutRead {
  name: (typeof layoutReadNames)[number];
  target: unknown;
}

/** What `watchLayoutReads` has seen. */
interface LayoutReads {
  /**
   * The reads in `layoutReadNames` since the watch started, in order.
   * @claim "The reads in `layoutReadNames` since the watch started, in order" registry/ouro/lib/ouro/testing/layout-reads.test.ts verify:testExists(registry/ouro/lib/ouro/testing/layout-reads.test.ts::watchLayoutReads > records each read that lays the page out, with what it was read from, in order)
   */
  readonly reads: readonly LayoutRead[];
  /** The names of those reads, in order: `[]` when nothing was read. */
  names(): string[];
  /**
   * Ends this watch; the browser's own getters and methods come back once no watch is running. Calling it again does nothing.
   * @claim "the browser's own getters and methods come back once no watch is running" registry/ouro/lib/ouro/testing/layout-reads.test.ts verify:testExists(registry/ouro/lib/ouro/testing/layout-reads.test.ts::watchLayoutReads > nests: each watch records from its own start to its own stop, in either order, and the last puts the browser's reads back)
   */
  stop(): void;
}

/** The watches running now. They share one set of stand-ins, put in place by the first and taken out after the last. */
const running = new Set<LayoutRead[]>();
let restore: (() => void) | undefined;

/**
 * Puts a recording stand-in in place of each read, over the browser's own, and returns what puts the browser's back.
 * @claim "Puts a recording stand-in in place of each read" registry/ouro/lib/ouro/testing/layout-reads.test.ts verify:testExists(registry/ouro/lib/ouro/testing/layout-reads.test.ts::watchLayoutReads > records each read that lays the page out, with what it was read from, in order) verify:testExists(registry/ouro/lib/ouro/testing/layout-reads.test.ts::watchLayoutReads > puts the browser's own reads back on stop, and at the end of the test)
 */
function standIns(): () => void {
  const undo: Array<() => void> = [];
  for (const [where, kind, names] of reads) {
    const owner = (where === "window" ? window : (window as unknown as Record<string, { prototype: object }>)[where]!.prototype) as Record<string, unknown>;
    for (const name of names) {
      const own = Object.getOwnPropertyDescriptor(owner, name)!;
      const record = (target: unknown) => {
        for (const watch of running) watch.push({ name, target });
      };
      const standIn: PropertyDescriptor =
        kind === "get"
          ? {
              ...own,
              get(this: unknown) {
                // WebKit calls a window getter on its inner global, not on `window`.
                record(where === "window" ? window : this);
                return own.get!.call(this);
              },
            }
          : {
              ...own,
              value: function (this: unknown, ...args: unknown[]) {
                record(where === "window" ? args[0] : this);
                return (own.value as (...args: unknown[]) => unknown).apply(this, args);
              },
            };
      Object.defineProperty(owner, name, standIn);
      undo.push(() => Object.defineProperty(owner, name, own));
    }
  }
  return () => undo.reverse().forEach((step) => step());
}

/**
 * Records the reads in `layoutReadNames`, which lay the page out, from now until `stop()` or the
 * end of the test, so a test proves that a render costs no forced layout: a re-render that
 * changes nothing a component measures should read nothing.
 *
 * Start it right before the change and stop it right after, around a render in `act`: it counts
 * those reads on the page while it runs, including your own and those a resize observer's
 * callback makes, where the layout is already done. Watches nest: each records from its own start
 * to its own stop, and the browser's own getters and methods come back when the last one stops.
 * Stub a read with `vi.spyOn` before the first watch starts or after the last one stops.
 *
 * @example
 * const reads = watchLayoutReads();
 * await act(() => root.render(<NavigationRail label="Main" items={withNewCount} />));
 * reads.stop();
 * expect(reads.names()).toEqual([]);
 * @claim "Records the reads in `layoutReadNames`, which lay the page out" registry/ouro/lib/ouro/testing/layout-reads.test.ts verify:testExists(registry/ouro/lib/ouro/testing/layout-reads.test.ts::watchLayoutReads > records each read that lays the page out, with what it was read from, in order)
 * @claim "from now until `stop()` or the end of the" registry/ouro/lib/ouro/testing/layout-reads.test.ts verify:testExists(registry/ouro/lib/ouro/testing/layout-reads.test.ts::watchLayoutReads > puts the browser's own reads back on stop, and at the end of the test)
 * @claim "Watches nest: each records from its own start" registry/ouro/lib/ouro/testing/layout-reads.test.ts verify:testExists(registry/ouro/lib/ouro/testing/layout-reads.test.ts::watchLayoutReads > nests: each watch records from its own start to its own stop, in either order, and the last puts the browser's reads back)
 */
function watchLayoutReads(): LayoutReads {
  const own: LayoutRead[] = [];
  running.add(own);
  restore ??= standIns();
  const stop = () => {
    if (!running.delete(own) || running.size > 0) return;
    restore!();
    restore = undefined;
  };
  // Started outside a test (in a `beforeAll`), there is no test to wait for.
  try {
    onTestFinished(stop);
  } catch {
    // Not in a test: the caller stops it.
  }
  return { reads: own, names: () => own.map((read) => read.name), stop };
}
