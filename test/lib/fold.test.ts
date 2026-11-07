import { afterEach, describe, expect, it, vi } from "vitest";
import { FOLD_BOOTSTRAP, readFold, resolveFold, type FoldWindow } from "~/lib/fold";

type Segment = { x: number; y: number; width: number; height: number };

function fakeWindow({
  width,
  height,
  screen = [669, 951],
  coarse = true,
  segments,
}: {
  width: number;
  height: number;
  screen?: [number, number];
  coarse?: boolean;
  segments?: Segment[];
}): FoldWindow {
  return {
    innerWidth: width,
    innerHeight: height,
    screen: { width: screen[0], height: screen[1] },
    matchMedia: (query: string) => ({ matches: query === "(pointer: coarse)" ? coarse : false }),
    viewport: segments ? { segments } : undefined,
  };
}

describe("resolveFold", () => {
  it("splits the iPhone Duo's inner screen down the middle when it is held like a book", () => {
    expect(resolveFold(fakeWindow({ width: 951, height: 669 }))).toEqual({
      axis: "vertical",
      start: 475.5,
      end: 475.5,
      source: "duo",
    });
  });

  it("puts the fold across the middle when the inner screen is held tall", () => {
    expect(resolveFold(fakeWindow({ width: 669, height: 951 }))).toEqual({
      axis: "horizontal",
      start: 475.5,
      end: 475.5,
      source: "duo",
    });
  });

  it("measures a tall fold from the top of the viewport when browser bars take some height", () => {
    expect(resolveFold(fakeWindow({ width: 669, height: 860 }))).toMatchObject({
      axis: "horizontal",
      start: 475.5,
    });
  });

  it("reads the screen size in either orientation order", () => {
    expect(resolveFold(fakeWindow({ width: 951, height: 669, screen: [951, 669] }))?.axis).toBe("vertical");
  });

  it("finds no fold in Split View, where the page fills only part of the inner screen", () => {
    expect(resolveFold(fakeWindow({ width: 475, height: 669 }))).toBeNull();
    expect(resolveFold(fakeWindow({ width: 600, height: 951 }))).toBeNull();
    expect(resolveFold(fakeWindow({ width: 951, height: 300 }))).toBeNull();
  });

  it("finds no fold on the outer screen, other phones, or a desktop window of the same size", () => {
    expect(resolveFold(fakeWindow({ width: 466, height: 678, screen: [466, 678] }))).toBeNull();
    expect(resolveFold(fakeWindow({ width: 402, height: 874, screen: [402, 874] }))).toBeNull();
    expect(resolveFold(fakeWindow({ width: 951, height: 669, coarse: false }))).toBeNull();
  });

  it("follows side-by-side viewport segments when the browser reports them", () => {
    const fold = resolveFold(
      fakeWindow({
        width: 1000,
        height: 700,
        screen: [1000, 700],
        coarse: false,
        segments: [
          { x: 0, y: 0, width: 490, height: 700 },
          { x: 510, y: 0, width: 490, height: 700 },
        ],
      }),
    );
    expect(fold).toEqual({ axis: "vertical", start: 490, end: 510, source: "segments" });
  });

  it("follows stacked viewport segments", () => {
    const fold = resolveFold(
      fakeWindow({
        width: 700,
        height: 1000,
        segments: [
          { x: 0, y: 0, width: 700, height: 480 },
          { x: 0, y: 520, width: 700, height: 480 },
        ],
      }),
    );
    expect(fold).toEqual({ axis: "horizontal", start: 480, end: 520, source: "segments" });
  });

  it("ignores a single viewport segment and falls back to the screen size", () => {
    const fold = resolveFold(
      fakeWindow({ width: 951, height: 669, segments: [{ x: 0, y: 0, width: 951, height: 669 }] }),
    );
    expect(fold?.source).toBe("duo");
  });

  it("finds no fold without matchMedia", () => {
    const win = fakeWindow({ width: 951, height: 669 });
    expect(resolveFold({ ...win, matchMedia: undefined })).toBeNull();
  });
});

describe("FOLD_BOOTSTRAP", () => {
  afterEach(() => {
    const root = document.documentElement;
    delete root.dataset.fold;
    root.style.removeProperty("--sj-fold-start");
    root.style.removeProperty("--sj-fold-end");
    vi.unstubAllGlobals();
  });

  function runBootstrap(win: FoldWindow) {
    const listeners: Record<string, () => void> = {};
    const target = {
      ...win,
      document,
      addEventListener: (type: string, fn: () => void) => {
        listeners[type] = fn;
      },
    };
    new Function("w", `(${FOLD_BOOTSTRAP})(w)`)(target);
    return { target, listeners };
  }

  it("marks the page with the fold before it paints, using the same rules as resolveFold", () => {
    runBootstrap(fakeWindow({ width: 951, height: 669 }));
    const root = document.documentElement;
    expect(root.dataset.fold).toBe("vertical");
    expect(root.style.getPropertyValue("--sj-fold-start")).toBe("475.5px");
    expect(root.style.getPropertyValue("--sj-fold-end")).toBe("475.5px");
    expect(readFold(document)).toEqual({ axis: "vertical", start: 475.5, end: 475.5 });
  });

  it("clears the fold when the page is resized into Split View", () => {
    const { target, listeners } = runBootstrap(fakeWindow({ width: 951, height: 669 }));
    target.innerWidth = 475;
    listeners.resize();
    expect(document.documentElement.dataset.fold).toBe("none");
    expect(readFold(document)).toBeNull();
  });

  it("updates on rotation", () => {
    const { target, listeners } = runBootstrap(fakeWindow({ width: 951, height: 669 }));
    target.innerWidth = 669;
    target.innerHeight = 951;
    listeners.orientationchange();
    expect(document.documentElement.dataset.fold).toBe("horizontal");
  });

  it("agrees with resolveFold on every case", () => {
    const cases = [
      fakeWindow({ width: 951, height: 669 }),
      fakeWindow({ width: 669, height: 951 }),
      fakeWindow({ width: 475, height: 669 }),
      fakeWindow({ width: 466, height: 678, screen: [466, 678] }),
      fakeWindow({ width: 951, height: 669, coarse: false }),
      fakeWindow({
        width: 1000,
        height: 700,
        segments: [
          { x: 0, y: 0, width: 490, height: 700 },
          { x: 510, y: 0, width: 490, height: 700 },
        ],
      }),
    ];
    for (const win of cases) {
      runBootstrap(win);
      const expected = resolveFold(win);
      expect(readFold(document)).toEqual(expected ? { axis: expected.axis, start: expected.start, end: expected.end } : null);
    }
  });

  it("does nothing when it throws, leaving the page unmarked", () => {
    expect(() => new Function("w", `(${FOLD_BOOTSTRAP})(w)`)({})).not.toThrow();
  });
});

describe("readFold", () => {
  it("returns null for a page the bootstrap never marked", () => {
    expect(readFold(document)).toBeNull();
  });

  it("returns null when the fold variables are missing", () => {
    document.documentElement.dataset.fold = "vertical";
    expect(readFold(document)).toBeNull();
    delete document.documentElement.dataset.fold;
  });
});
