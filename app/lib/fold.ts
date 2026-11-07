/**
 * Where a foldable screen bends, so a page can lay itself out as two pages instead of running across the fold.
 *
 * The iPhone Duo's inner screen is 669 × 951 points. Held like a book (951 wide) it folds down the middle; held
 * tall (669 wide) it folds across the middle, which is also how it stands half-open on a counter. Safari reports
 * the fold through the Viewport Segments API only behind a feature flag, so without segments the page assumes the
 * fold from the screen size: a coarse pointer, a 669 × 951 screen, and a page that fills that screen. In Split View
 * the page fills only part of the screen and no fold crosses it.
 *
 * `FOLD_BOOTSTRAP` runs inline in the document head, before first paint, and marks `<html>` with `data-fold`
 * (`vertical`, `horizontal` or `none`) and the `--sj-fold-start` / `--sj-fold-end` CSS variables, in CSS pixels
 * from the viewport's left (vertical) or top (horizontal) edge. Styles in app/styles/fold.css read them. It keeps
 * them current on resize and rotation. `resolveFold` is the same rule in TypeScript; the tests hold the two to
 * the same answers.
 */

export type FoldAxis = "vertical" | "horizontal";

export interface Fold {
  axis: FoldAxis;
  /** Where the first page ends, in CSS pixels. */
  start: number;
  /** Where the second page begins. Equal to `start` on a seamless screen such as the iPhone Duo's. */
  end: number;
  /** "segments" when the browser reported the fold, "duo" when it was assumed from the screen size. */
  source: "segments" | "duo";
}

interface FoldSegment {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The parts of `window` the fold depends on. */
export interface FoldWindow {
  innerWidth: number;
  innerHeight: number;
  screen: { width: number; height: number };
  matchMedia?: (query: string) => { matches: boolean };
  viewport?: { segments?: readonly FoldSegment[] | null };
}

/** The iPhone Duo's inner screen, in points. */
export const DUO_INNER_SCREEN = { short: 669, long: 951 } as const;
const TOLERANCE = 2;

function near(value: number, target: number) {
  return Math.abs(value - target) <= TOLERANCE;
}

export function resolveFold(win: FoldWindow): Fold | null {
  const segments = win.viewport?.segments;
  if (segments && segments.length === 2) {
    const [first, second] = segments;
    if (Math.abs(first.y - second.y) < 1) {
      return { axis: "vertical", start: first.x + first.width, end: second.x, source: "segments" };
    }
    return { axis: "horizontal", start: first.y + first.height, end: second.y, source: "segments" };
  }

  const shortSide = Math.min(win.screen.width, win.screen.height);
  const longSide = Math.max(win.screen.width, win.screen.height);
  const coarse = win.matchMedia?.("(pointer: coarse)").matches ?? false;
  if (!coarse || !near(shortSide, DUO_INNER_SCREEN.short) || !near(longSide, DUO_INNER_SCREEN.long)) {
    return null;
  }

  const middle = DUO_INNER_SCREEN.long / 2;
  if (win.innerWidth > win.innerHeight) {
    // Book: the page must span the whole width, and be tall enough that it is not a sliver above the keyboard.
    if (win.innerWidth < DUO_INNER_SCREEN.long - TOLERANCE || win.innerHeight < DUO_INNER_SCREEN.short / 2) {
      return null;
    }
    return { axis: "vertical", start: middle, end: middle, source: "duo" };
  }
  // Tall: Safari's bars sit at the bottom of the screen, so the fold stays half the screen down from the top.
  if (win.innerWidth < DUO_INNER_SCREEN.short - TOLERANCE) {
    return null;
  }
  return { axis: "horizontal", start: middle, end: middle, source: "duo" };
}

/**
 * The inline head script. It is plain ES5 with no imports so it can run before the app's bundle; keep its rules
 * in step with `resolveFold` (test/lib/fold.test.ts checks they agree).
 */
export const FOLD_BOOTSTRAP = `function (w) {
  try {
    var root = w.document.documentElement;
    var S = ${DUO_INNER_SCREEN.short}, L = ${DUO_INNER_SCREEN.long}, T = ${TOLERANCE};
    var near = function (v, t) { return Math.abs(v - t) <= T; };
    var resolve = function () {
      var segs = w.viewport && w.viewport.segments;
      if (segs && segs.length === 2) {
        var a = segs[0], b = segs[1];
        if (Math.abs(a.y - b.y) < 1) return ["vertical", a.x + a.width, b.x];
        return ["horizontal", a.y + a.height, b.y];
      }
      var lo = Math.min(w.screen.width, w.screen.height), hi = Math.max(w.screen.width, w.screen.height);
      var coarse = !!(w.matchMedia && w.matchMedia("(pointer: coarse)").matches);
      if (!coarse || !near(lo, S) || !near(hi, L)) return null;
      if (w.innerWidth > w.innerHeight) {
        if (w.innerWidth < L - T || w.innerHeight < S / 2) return null;
        return ["vertical", L / 2, L / 2];
      }
      if (w.innerWidth < S - T) return null;
      return ["horizontal", L / 2, L / 2];
    };
    var apply = function () {
      var f = resolve();
      root.setAttribute("data-fold", f ? f[0] : "none");
      if (f) {
        root.style.setProperty("--sj-fold-start", f[1] + "px");
        root.style.setProperty("--sj-fold-end", f[2] + "px");
      } else {
        root.style.removeProperty("--sj-fold-start");
        root.style.removeProperty("--sj-fold-end");
      }
    };
    apply();
    w.addEventListener("resize", apply);
    w.addEventListener("orientationchange", apply);
  } catch (e) {}
}`;

/** The fold the head script found, read back from `<html>`; null when there is none. */
export function readFold(doc: Document): Omit<Fold, "source"> | null {
  const root = doc.documentElement;
  const axis = root.dataset.fold;
  if (axis !== "vertical" && axis !== "horizontal") {
    return null;
  }
  const start = Number.parseFloat(root.style.getPropertyValue("--sj-fold-start"));
  const end = Number.parseFloat(root.style.getPropertyValue("--sj-fold-end"));
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return null;
  }
  return { axis, start, end };
}
