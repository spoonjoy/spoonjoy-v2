import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkTheme, devThrow, devWarn } from "~/lib/ouro/dev";

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("devWarn", () => {
  it("uses the spec format", () => {
    devWarn("Button", "bg-red-500 sets appearance", 'tone="destructive"', {});
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/^\[ouro-ui\] Button: .+\. Fix: .+\.$/);
  });

  it("warns once per key", () => {
    const key = {};
    devWarn("Button", "problem one", "fix one", key);
    devWarn("Button", "problem one", "fix one", key);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("warns separately for different keys and different messages on one key", () => {
    const a = {};
    devWarn("Button", "same problem", "same fix", a);
    devWarn("Button", "same problem", "same fix", {});
    devWarn("Button", "another problem", "same fix", a);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("de-duplicates by message text when there is no key", () => {
    devWarn("Dialog", "keyless problem", "keyless fix");
    devWarn("Dialog", "keyless problem", "keyless fix");
    devWarn("Dialog", "other keyless problem", "keyless fix");
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("does not double a trailing period", () => {
    devWarn("Sheet", "ends with a period.", "also does.", {});
    expect(warn).toHaveBeenCalledWith("[ouro-ui] Sheet: ends with a period. Fix: also does.");
  });
});

// Production behavior (no warning, no fix text, strings stripped) is tested against a
// real Vite production bundle in scripts/dev-strip.test.mjs.
describe("devThrow", () => {
  it("throws the full message in development", () => {
    expect(() => devThrow("Sheet.Title", "outside Sheet", "<Sheet title='x' />")).toThrow(
      "[ouro-ui] Sheet.Title: outside Sheet. Fix: <Sheet title='x' />.",
    );
  });
});

describe("checkTheme", () => {
  const MESSAGE =
    "[ouro-ui] theme: ouro-base is not in this page's CSS (--ouro-layer is unset), so overlays have no backdrop, layer or motion and fields have no border. Fix: npx shadcn@latest add ourostack/ouro-ui/ouro-base#v1.2.0.";
  const root = document.documentElement;
  const again = () => delete (window as unknown as Record<symbol, unknown>)[Symbol.for("ouro-ui.theme-checked")];
  /** The page as it is in an app that never added ouro-base: the token has no value. */
  const withoutTheme = () => root.style.setProperty("--ouro-layer", "initial");

  afterEach(() => {
    root.style.removeProperty("--ouro-layer");
    again();
  });

  it("says nothing on a page that has ouro-base", () => {
    again();
    expect(getComputedStyle(root).getPropertyValue("--ouro-layer").trim()).not.toBe("");
    checkTheme();
    expect(warn).not.toHaveBeenCalled();
  });

  it("checks a page that is still loading once it has loaded", () => {
    again();
    const listen = vi.spyOn(window, "addEventListener");
    vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    withoutTheme();
    checkTheme();
    expect(warn).not.toHaveBeenCalled();
    expect(listen).toHaveBeenCalledWith("load", expect.any(Function), { once: true });
    // The stylesheet arrived before the load event: nothing to say.
    root.style.removeProperty("--ouro-layer");
    (listen.mock.calls[0]![1] as () => void)();
    expect(warn).not.toHaveBeenCalled();
  });

  it("names the command that adds ouro-base, once per page, when the token is unset", () => {
    again();
    withoutTheme();
    checkTheme();
    expect(warn.mock.calls).toEqual([[MESSAGE]]);
    root.style.removeProperty("--ouro-layer");
    checkTheme();
    withoutTheme();
    checkTheme();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
