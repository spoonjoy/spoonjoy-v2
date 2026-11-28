import { createRef, useState, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { Button } from "~/components/ouro/button/button";
import { TextArea, type TextAreaProps } from "~/components/ouro/text-field/text-area";
import { canFieldSize, supportsFieldSizing } from "~/components/ouro/text-field/text-area-styles";
import { act } from "~/lib/ouro/testing/act";
import { holdFrames } from "~/lib/ouro/testing/frames";
import { watchLayoutReads } from "~/lib/ouro/testing/layout-reads";

const roots: Root[] = [];
let mounted: HTMLElement[] = [];

/** Waits for the frame after a render, where the native fit runs. */
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

async function render(node: ReactNode) {
  const host = document.createElement("div");
  host.style.padding = "24px";
  host.style.width = "360px";
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  await frame();
  return {
    host,
    rerender: async (next: ReactNode) => {
      await act(async () => root.render(next));
      await frame();
    },
    get root() {
      return host.querySelector<HTMLElement>('[data-ouro="text-area"]')!;
    },
    get textarea() {
      return host.querySelector<HTMLTextAreaElement>("textarea")!;
    },
  };
}

const describedBy = (element: Element) => (element.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
const height = (element: Element) => element.getBoundingClientRect().height;
/** The height of `n` lines of text in the textarea, with its padding and border. */
function linesHeight(textarea: HTMLTextAreaElement, n: number) {
  const style = getComputedStyle(textarea);
  const chrome = ["paddingTop", "paddingBottom", "borderTopWidth", "borderBottomWidth"].reduce(
    (sum, key) => sum + parseFloat(style[key as "paddingTop"]),
    0,
  );
  return n * parseFloat(style.lineHeight) + chrome;
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
  await page.viewport(414, 896);
});

describe("TextArea", () => {
  it("is a labeled native textarea built on the Field contract", async () => {
    const { root, textarea, host } = await render(
      <TextArea label="Notes" name="notes" description="Only you see these." error="Too long." required />,
    );
    expect(root.getAttribute("data-ouro")).toBe("text-area");
    expect(textarea.labels![0]!.textContent).toContain("Notes");
    expect(textarea.name).toBe("notes");
    expect(textarea.required).toBe(true);
    expect(textarea.getAttribute("aria-required")).toBe("true");
    expect(textarea.getAttribute("aria-invalid")).toBe("true");
    expect(describedBy(textarea).map((id) => host.querySelector(`#${CSS.escape(id)}`)!.textContent)).toEqual([
      "Only you see these.",
      "Too long.",
    ]);
    await expect.element(page.getByRole("textbox", { name: "Notes" })).toBeVisible();
  });

  it("shows three rows by default, or rows, and the user can resize it", async () => {
    const { host } = await render(
      <>
        <TextArea label="One" />
        <TextArea label="Two" rows={5} />
      </>,
    );
    const [three, five] = [...host.querySelectorAll("textarea")];
    expect(three!.rows).toBe(3);
    expect(five!.rows).toBe(5);
    expect(height(three!)).toBeCloseTo(linesHeight(three!, 3), 0);
    expect(getComputedStyle(three!).resize).toBe("vertical");
  });

  it("passes textarea attributes, value and change handlers through", async () => {
    const onChange = vi.fn();
    const onValueChange = vi.fn();
    let element: HTMLTextAreaElement | null = null;
    const { textarea } = await render(
      <TextArea
        label="Notes"
        defaultValue="Salt"
        maxLength={200}
        placeholder="Anything to remember"
        onChange={onChange}
        onValueChange={onValueChange}
        ref={(node) => void (element = node)}
      />,
    );
    expect(element).toBe(textarea);
    expect(textarea.value).toBe("Salt");
    expect(textarea.maxLength).toBe(200);
    expect(textarea.placeholder).toBe("Anything to remember");
    textarea.focus();
    textarea.setSelectionRange(4, 4);
    await userEvent.keyboard("!");
    expect(textarea.value).toBe("Salt!");
    expect(onChange).toHaveBeenCalled();
    expect(onValueChange).toHaveBeenLastCalledWith("Salt!", expect.anything());
  });

  it("calls the latest handler, and none once it is removed", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { textarea, rerender } = await render(<TextArea label="Notes" onFocus={first} />);
    textarea.focus();
    expect(first).toHaveBeenCalledTimes(1);
    textarea.blur();
    await rerender(<TextArea label="Notes" onFocus={second} />);
    textarea.focus();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    textarea.blur();
    await rerender(<TextArea label="Notes" />);
    textarea.focus();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("syncs a controlled value through the DOM property, never rewriting defaultValue as the person types", async () => {
    function Controlled() {
      const [value, setValue] = useState("a");
      return <TextArea label="Notes" value={value} onValueChange={setValue} />;
    }
    const { textarea } = await render(<Controlled />);
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe(textarea, { childList: true });
    textarea.focus();
    textarea.setSelectionRange(1, 1);
    await userEvent.keyboard("bcd");
    await frame();
    observer.disconnect();
    expect(textarea.value).toBe("abcd");
    // Setting defaultValue replaces the textarea's child text node: a childList mutation that
    // invalidates every :has() rule whose subject can contain it (ouro-ui#3759).
    expect(mutations.filter((record) => record.type === "childList")).toHaveLength(0);
  });

  it("shows its value again after a change its owner refuses, as React's own controlled textarea does (#3911)", async () => {
    const onValueChange = vi.fn();
    const { textarea } = await render(<TextArea label="Notes" value="stored" onValueChange={onValueChange} />);
    // A script's input: the native value setter and an input event, as an untrusted page script would write it.
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(textarea, "forged");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onValueChange).toHaveBeenLastCalledWith("forged", expect.anything());
    expect(textarea.value).toBe("stored");
    textarea.focus();
    textarea.setSelectionRange(6, 6);
    await userEvent.keyboard("!");
    expect(textarea.value).toBe("stored");
  });

  it("shows the value its owner keeps when the owner takes only part of a change (#3911)", async () => {
    function Capped() {
      const [value, setValue] = useState("abc");
      return <TextArea label="Notes" value={value} onValueChange={(next) => setValue(next.slice(0, 4))} />;
    }
    const { textarea } = await render(<Capped />);
    textarea.focus();
    textarea.setSelectionRange(3, 3);
    await userEvent.keyboard("d");
    expect(textarea.value).toBe("abcd");
    // Already at the cap: the owner's value doesn't change, so nothing re-renders with a new value.
    await userEvent.keyboard("e");
    expect(textarea.value).toBe("abcd");
  });

  it("writes nothing to the native textarea when a parent re-renders it with the same props", async () => {
    // A new ref and handler each render, as an inline one is: TextArea hands the textarea stable stand-ins for them.
    const field = () => <TextArea label="Notes" defaultValue="Salt" ref={() => {}} onFocus={() => {}} />;
    const { textarea, rerender } = await render(field());
    // Every commit that reaches a textarea ends in React writing its defaultValue, so counting those writes counts commits.
    const writes: string[] = [];
    const own = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "defaultValue")!;
    Object.defineProperty(textarea, "defaultValue", {
      configurable: true,
      get() {
        return own.get!.call(this);
      },
      set(value: string) {
        writes.push(value);
        own.set!.call(this, value);
      },
    });
    await rerender(field());
    expect(writes).toEqual([]);
    expect(textarea.value).toBe("Salt");
  });

  it("treats a handler given as undefined as no handler at all", async () => {
    const { textarea } = await render(<TextArea label="Notes" onCopy={undefined} />);
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => {
      errors.push(event.error);
      event.preventDefault();
    };
    window.addEventListener("error", onError);
    textarea.dispatchEvent(new ClipboardEvent("copy", { bubbles: true }));
    window.removeEventListener("error", onError);
    expect(errors).toEqual([]);
  });

  it("server-renders a controlled value as the textarea's text", () => {
    expect(renderToString(<TextArea label="Notes" value="Salt" onValueChange={() => {}} />)).toMatch(/<textarea[^>]*>Salt<\/textarea>/);
  });

  it("keeps the label pointing at the textarea, by the id Field gives it", async () => {
    const { host, textarea } = await render(<TextArea label="Notes" />);
    expect(textarea.id).not.toBe("");
    expect(host.querySelector("label")!.htmlFor).toBe(textarea.id);
  });

  it("passes aria-required through without making the textarea natively required", async () => {
    const { textarea } = await render(<TextArea label="Method" aria-required />);
    expect(textarea.getAttribute("aria-required")).toBe("true");
    expect(textarea.required).toBe(false);
  });

  it("keeps the size the user dragged it to while they type", async () => {
    const { textarea } = await render(<TextArea label="Notes" defaultValue="Salt" />);
    // The resize handle writes the dragged size into the inline style.
    textarea.style.height = "150px";
    textarea.focus();
    textarea.setSelectionRange(4, 4);
    await userEvent.keyboard("!");
    expect(textarea.value).toBe("Salt!");
    expect(textarea.style.height).toBe("150px");
  });

  it("forwards an object ref to the textarea", async () => {
    const object = createRef<HTMLTextAreaElement>();
    const { textarea } = await render(<TextArea label="Notes" ref={object} />);
    expect(object.current).toBe(textarea);
  });

  it("disables the textarea with disabled", async () => {
    const { textarea } = await render(<TextArea label="Notes" disabled />);
    expect(textarea.disabled).toBe(true);
    expect(getComputedStyle(textarea).opacity).toBe("0.5");
  });

  it("uses a 16px font on phones, so iOS does not zoom on focus", async () => {
    await page.viewport(390, 844);
    const { textarea } = await render(<TextArea label="Notes" />);
    expect(parseFloat(getComputedStyle(textarea).fontSize)).toBeGreaterThanOrEqual(16);
    await page.viewport(1280, 800);
    await expect.poll(() => getComputedStyle(textarea).fontSize).toBe("14px");
  });

  it("lets app layout classes win on the root", async () => {
    const { root } = await render(<TextArea label="Notes" className="mt-6" />);
    expect(getComputedStyle(root).marginTop).toBe("24px");
  });
});

describe("TextArea autoGrow", () => {
  it("grows with the content and stops at maxRows, then scrolls", async () => {
    const { textarea } = await render(<TextArea label="Notes" autoGrow rows={2} maxRows={4} />);
    expect(getComputedStyle(textarea).resize).toBe("none");
    expect(height(textarea)).toBeCloseTo(linesHeight(textarea, 2), 0);
    // Where the browser grows it, the cap alone decides whether it scrolls.
    const scrolls = (capped: boolean) => (supportsFieldSizing() ? "auto" : capped ? "auto" : "hidden");
    expect(getComputedStyle(textarea).overflowY).toBe(scrolls(false));

    // Each edit is one input event, as a paste is: typed a key at a time, its 27 keys were each a
    // round trip through Vitest, which took WebKit past the test's 15 seconds on a busy runner.
    // The next test types key by key.
    await userEvent.fill(textarea, "one\ntwo\nthree");
    expect(height(textarea)).toBeCloseTo(linesHeight(textarea, 3), 0);

    await userEvent.fill(textarea, "one\ntwo\nthree\nfour\nfive\nsix");
    expect(height(textarea)).toBeCloseTo(linesHeight(textarea, 4), 0);
    expect(getComputedStyle(textarea).overflowY).toBe(scrolls(true));
    expect(textarea.scrollHeight).toBeGreaterThan(textarea.clientHeight);

    // Shrinks back when text is removed, never below rows.
    await userEvent.clear(textarea);
    expect(height(textarea)).toBeCloseTo(linesHeight(textarea, 2), 0);
  });

  it("leaves what scrolls around it where it was as it grows a line, at the end of a scrolling list", async () => {
    const { host, textarea } = await render(
      // A conversation keeps its own place and turns the browser's scroll anchoring off, as MessageList does.
      <div style={{ height: 200, overflowY: "auto", overflowAnchor: "none" }}>
        <div style={{ height: 600 }} />
        <TextArea label="Notes" autoGrow rows={1} maxRows={6} defaultValue={"one\ntwo\nthree"} />
        <div style={{ height: 40 }} />
      </div>,
    );
    const list = host.firstElementChild as HTMLElement;
    list.scrollTop = list.scrollHeight;
    const end = list.scrollTop;
    // Each key collapses the textarea to measure it, which would pull the list's end up, and the browser
    // would then bring only the caret back into view, short of the space below the textarea.
    await userEvent.type(textarea, "{End}{Enter}four");
    expect(list.scrollTop).toBeGreaterThanOrEqual(end);
    await userEvent.type(textarea, " and five");
    expect(list.scrollTop).toBeGreaterThanOrEqual(end);
  });

  it("grows without a cap when maxRows is not set", async () => {
    const { textarea } = await render(<TextArea label="Notes" autoGrow defaultValue={"1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12"} />);
    expect(height(textarea)).toBeCloseTo(linesHeight(textarea, 12), 0);
  });

  it("follows a controlled value", async () => {
    function Controlled() {
      const [value, setValue] = useState("one");
      return (
        <>
          <TextArea label="Notes" autoGrow rows={1} maxRows={3} value={value} onValueChange={(next) => setValue(next)} />
          <button type="button" onClick={() => setValue("one\ntwo\nthree")}>
            Fill
          </button>
        </>
      );
    }
    const { host, textarea } = await render(<Controlled />);
    expect(height(textarea)).toBeCloseTo(linesHeight(textarea, 1), 0);
    await userEvent.click(host.querySelector("button")!);
    expect(height(textarea)).toBeCloseTo(linesHeight(textarea, 3), 0);
  });

  it("measures once per change of its text, and not on a render that changes nothing it fits", async () => {
    /** How many times the textarea's style was read: each fit reads it once, and lays out the page. */
    const reads = (textarea: HTMLTextAreaElement) => {
      const spy = vi.spyOn(window, "getComputedStyle");
      return () => spy.mock.calls.filter(([element]) => element === textarea).length;
    };
    function Controlled({ tick }: { tick: number }) {
      const [value, setValue] = useState("one");
      return <TextArea label="Notes" autoGrow rows={1} maxRows={4} value={value} onValueChange={setValue} data-tick={tick} />;
    }
    for (const node of [(tick: number) => <Controlled tick={tick} />, (tick: number) => <TextArea label="Notes" autoGrow rows={1} maxRows={4} defaultValue="one" data-tick={tick} />]) {
      const { textarea, rerender } = await render(node(0));
      textarea.focus();
      textarea.setSelectionRange(3, 3);
      const count = reads(textarea);
      await userEvent.keyboard("\n");
      // Where the browser grows it, a keystroke measures nothing.
      const expected = supportsFieldSizing() ? 0 : 1;
      expect(count()).toBe(expected);
      // A parent's render, as a message arrives beside a composer.
      await rerender(node(1));
      expect(count()).toBe(expected);
      vi.restoreAllMocks();
      expect(height(textarea)).toBeCloseTo(linesHeight(textarea, 2), 0);
      roots.pop()!.unmount();
    }
  });

  it("forces no layout as the text changes where the browser grows it, and one measure per edit elsewhere", async () => {
    const { textarea } = await render(<TextArea label="Notes" autoGrow rows={1} maxRows={4} defaultValue="one" />);
    textarea.focus();
    textarea.setSelectionRange(3, 3);
    const watch = watchLayoutReads();
    await userEvent.keyboard("{Enter}two{Enter}three");
    const fits = watch.reads.filter((read) => read.target === textarea && (read.name === "scrollHeight" || read.name === "getComputedStyle"));
    watch.stop();
    if (supportsFieldSizing()) expect(fits).toHaveLength(0);
    else expect(fits.length).toBeGreaterThan(0);
    expect(height(textarea)).toBeCloseTo(linesHeight(textarea, 3), 0);
  });

  it("sizes a textarea itself only where the property parses, and not in WebKit alone", () => {
    const safari = "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
    const chrome = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
    const edge = "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Edg/130.0";
    const firefox = "Mozilla/5.0 (Macintosh; rv:130.0) Gecko/20100101 Firefox/130.0";
    expect(canFieldSize(chrome, true)).toBe(true);
    expect(canFieldSize(chrome, false)).toBe(false);
    expect(canFieldSize(edge, true)).toBe(true);
    expect(canFieldSize(firefox, true)).toBe(true);
    expect(canFieldSize(safari, true)).toBe(false);
    expect(canFieldSize(safari, false)).toBe(false);
    const chromium = /Chrome/.test(navigator.userAgent);
    expect(supportsFieldSizing()).toBe(chromium);
  });

  it("measures with fitHeight when the user agent is Safari, clearing what it set when the browser sizes it, and back again", async () => {
    const safari = "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
    const agent = vi.spyOn(navigator, "userAgent", "get").mockReturnValue(safari);
    const { textarea, rerender } = await render(<TextArea label="Notes" autoGrow rows={1} maxRows={4} defaultValue={"a\nb\nc"} />);
    expect(textarea.style.getPropertyValue("field-sizing")).toBe("fixed");
    // It beats the class that lets the browser size the textarea, which WebKit parses.
    if (CSS.supports("field-sizing", "content")) expect(getComputedStyle(textarea).getPropertyValue("field-sizing")).toBe("fixed");
    expect(textarea.style.height).not.toBe("");
    expect(height(textarea)).toBeCloseTo(linesHeight(textarea, 3), 0);
    agent.mockRestore();
    await rerender(<TextArea label="Notes" autoGrow rows={1} maxRows={4} defaultValue={"a\nb\nc"} />);
    if (supportsFieldSizing()) {
      expect(textarea.style.getPropertyValue("field-sizing")).toBe("");
      expect(textarea.style.height).toBe("");
      expect(height(textarea)).toBeCloseTo(linesHeight(textarea, 3), 0);
    }
    await rerender(<TextArea label="Notes" rows={2} defaultValue={"a\nb\nc"} />);
    expect(textarea.style.height).toBe("");
    expect(textarea.style.overflowY).toBe("");
    expect(textarea.style.getPropertyValue("field-sizing")).toBe("");
    expect(textarea.style.minHeight).toBe("");
    expect(textarea.style.maxHeight).toBe("");
  });

  describe("on the measured path", () => {
    const safari = "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
    const frames = async (n: number) => {
      for (let i = 0; i < n; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
    };
    afterEach(() => vi.restoreAllMocks());

    it("goes back to rows and a resize handle when autoGrow turns off after it measured", async () => {
      vi.spyOn(navigator, "userAgent", "get").mockReturnValue(safari);
      const value = "1\n2\n3\n4\n5";
      const { rerender, textarea } = await render(<TextArea label="Notes" autoGrow defaultValue={value} />);
      expect(textarea.style.height).not.toBe("");
      await rerender(<TextArea label="Notes" defaultValue={value} />);
      expect(textarea.style.height).toBe("");
      expect(textarea.style.getPropertyValue("field-sizing")).toBe("");
      expect(height(textarea)).toBeCloseTo(linesHeight(textarea, 3), 0);
    });

    it("fits an uncontrolled field as it is typed in", async () => {
      vi.spyOn(navigator, "userAgent", "get").mockReturnValue(safari);
      const { textarea } = await render(<TextArea label="Notes" autoGrow rows={1} maxRows={6} />);
      await userEvent.fill(textarea, "a\nb\nc");
      expect(height(textarea)).toBeCloseTo(linesHeight(textarea, 3), 0);
    });

    it("refits when the width changes, with the rows it has now", async () => {
      vi.spyOn(navigator, "userAgent", "get").mockReturnValue(safari);
      const long = "word ".repeat(40);
      const { host, textarea, rerender } = await render(<TextArea label="Notes" autoGrow rows={1} maxRows={20} defaultValue={long} />);
      await rerender(<TextArea label="Notes" autoGrow rows={4} maxRows={20} defaultValue={long} />);
      host.style.width = "900px";
      await expect.poll(() => height(textarea)).toBeLessThan(linesHeight(textarea, 10));
      host.style.width = "360px";
      await expect.poll(() => height(textarea)).toBeGreaterThan(linesHeight(textarea, 3));
    });

    it("does not watch the width when the browser does the sizing, or when the field does not grow", async () => {
      const long = "word ".repeat(40);
      const grown = await render(<TextArea label="Notes" autoGrow rows={1} maxRows={20} defaultValue={long} />);
      const fixed = await render(<TextArea label="Notes" rows={2} defaultValue={long} />);
      grown.host.style.width = "900px";
      fixed.host.style.width = "900px";
      await frames(4);
      expect(fixed.textarea.style.height).toBe("");
      if (supportsFieldSizing()) expect(grown.textarea.style.height).toBe("");
    });
  });

  it("renders its bounds with it, so the browser grows it with no inline height, and caps only with maxRows", async () => {
    const grown = await render(<TextArea label="Notes" autoGrow rows={2} />);
    expect(grown.textarea.style.minHeight).toBe("calc(2lh + var(--ouro-text-area-frame))");
    expect(grown.textarea.style.maxHeight).toBe("");
    const capped = await render(<TextArea label="Notes" autoGrow rows={2} maxRows={5} style={{ minHeight: "1px" }} />);
    // The app's own style wins.
    expect(capped.textarea.style.minHeight).toBe("1px");
    expect(capped.textarea.style.maxHeight).toBe("calc(5lh + var(--ouro-text-area-frame))");
    if (supportsFieldSizing()) {
      expect(getComputedStyle(grown.textarea).getPropertyValue("field-sizing")).toBe("content");
      expect(grown.textarea.style.height).toBe("");
      expect(grown.textarea.style.overflowY).toBe("");
    }
    const fixed = await render(<TextArea label="Notes" rows={2} />);
    expect(fixed.textarea.style.minHeight).toBe("");
    expect(getComputedStyle(fixed.textarea).getPropertyValue("field-sizing")).not.toBe("content");
  });

  it("refits when rows, maxRows or size change", async () => {
    const { textarea, rerender } = await render(<TextArea label="Notes" autoGrow rows={1} maxRows={4} defaultValue="one" />);
    await rerender(<TextArea label="Notes" autoGrow rows={3} maxRows={4} defaultValue="one" />);
    expect(height(textarea)).toBeCloseTo(linesHeight(textarea, 3), 0);
    await rerender(<TextArea label="Notes" autoGrow rows={3} maxRows={4} size="lg" defaultValue="one" />);
    expect(height(textarea)).toBeCloseTo(linesHeight(textarea, 3), 0);
  });

  it("refits when its width changes and the text rewraps", async () => {
    const { host, textarea } = await render(<TextArea label="Notes" autoGrow rows={1} defaultValue={"word ".repeat(30).trim()} />);
    const wide = height(textarea);
    host.style.width = "200px";
    await expect.poll(() => height(textarea)).toBeGreaterThan(wide);
  });

  it("refits after a width change without a ResizeObserver loop error reaching the window", async () => {
    // A resize done inside the observer's own callback leaves an observation the browser cannot
    // deliver in that frame, which it reports as an error event on the window: error trackers
    // record it, and a test run that allows no console output fails on it.
    const loops: string[] = [];
    const onError = (event: ErrorEvent) => {
      if (/ResizeObserver loop/.test(event.message)) loops.push(event.message);
    };
    window.addEventListener("error", onError);
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    try {
      const { host, textarea } = await render(<TextArea label="Notes" autoGrow rows={1} defaultValue={"word ".repeat(30).trim()} />);
      const wide = height(textarea);
      host.style.width = "200px";
      await expect.poll(() => height(textarea)).toBeGreaterThan(wide);
      const narrow = height(textarea);
      host.style.width = "360px";
      await expect.poll(() => height(textarea)).toBeLessThan(narrow);
      // The browser reports a loop as it finishes the frame that had one.
      await frame();
      await frame();
      expect(loops).toEqual([]);
    } finally {
      window.removeEventListener("error", onError);
    }
  });

  it("never caps below rows", async () => {
    const { textarea } = await render(<TextArea label="Notes" autoGrow rows={3} maxRows={2} defaultValue={"1\n2\n3\n4\n5"} />);
    expect(height(textarea)).toBeCloseTo(linesHeight(textarea, 3), 0);
  });

  it("grows with its text when autoGrow turns on after the user dragged its height", async () => {
    const value = "1\n2\n3\n4\n5";
    const { rerender, textarea } = await render(<TextArea label="Notes" defaultValue={value} />);
    textarea.style.height = "200px";
    await rerender(<TextArea label="Notes" autoGrow defaultValue={value} />);
    expect(height(textarea)).toBeCloseTo(linesHeight(textarea, 5), 0);
  });

  it("keeps an app's own inline height when it does not grow", async () => {
    const { textarea } = await render(<TextArea label="Notes" style={{ height: "120px" }} />);
    expect(textarea.style.height).toBe("120px");
    expect(height(textarea)).toBe(120);
  });

  it("keeps a height the user dragged as a controlled value changes, after autoGrow turned off and when it never grew", async () => {
    const field = (value: string, autoGrow: boolean) => <TextArea label="Notes" autoGrow={autoGrow} value={value} onChange={() => {}} />;
    const never = await render(field("one", false));
    never.textarea.style.height = "200px";
    await never.rerender(field("one\ntwo", false));
    expect(never.textarea.style.height).toBe("200px");
    const { rerender, textarea } = await render(field("one", true));
    await rerender(field("one", false));
    textarea.style.height = "200px";
    await rerender(field("one\ntwo", false));
    expect(textarea.style.height).toBe("200px");
  });

  it("goes back to rows and a resize handle when autoGrow turns off", async () => {
    const value = "1\n2\n3\n4\n5";
    const { rerender, textarea } = await render(<TextArea label="Notes" autoGrow defaultValue={value} />);
    expect(height(textarea)).toBeCloseTo(linesHeight(textarea, 5), 0);
    await rerender(<TextArea label="Notes" defaultValue={value} />);
    expect(textarea.style.height).toBe("");
    expect(height(textarea)).toBeCloseTo(linesHeight(textarea, 3), 0);
    expect(getComputedStyle(textarea).resize).toBe("vertical");
  });
});

describe("TextArea autoGrow first frame", () => {
  // The first frame the browser paints after a commit has run no animation frame yet: with frames held, what the
  // textarea measures right after the commit is what that frame shows. It must already be the height the field settles at.
  async function firstFrame(node: ReactNode) {
    const host = document.createElement("div");
    host.style.padding = "24px";
    host.style.width = "360px";
    document.body.append(host);
    mounted.push(host);
    const root = createRoot(host);
    roots.push(root);
    const textarea = () => host.querySelector("textarea")!;
    const commit = async (next: ReactNode) => {
      const frames = holdFrames();
      await act(async () => root.render(next));
      const first = { height: height(textarea()), scrolls: textarea().scrollHeight > textarea().clientHeight };
      frames.release();
      await frame();
      return first;
    };
    const first = await commit(node);
    return { first, textarea: textarea(), commit };
  }

  it("is its settled height on its first frame, with a defaultValue of several lines", async () => {
    const { first, textarea } = await firstFrame(<TextArea label="Notes" autoGrow rows={2} defaultValue={"1\n2\n3\n4\n5"} />);
    expect(first.height).toBeCloseTo(linesHeight(textarea, 5), 0);
    expect(height(textarea)).toBe(first.height);
  });

  it("is capped at maxRows and scrolls on its first frame, with a controlled value", async () => {
    const { first, textarea } = await firstFrame(<TextArea label="Notes" autoGrow rows={2} maxRows={4} value={"1\n2\n3\n4\n5\n6"} onChange={() => {}} />);
    expect(first.height).toBeCloseTo(linesHeight(textarea, 4), 0);
    expect(first.scrolls).toBe(true);
    expect(height(textarea)).toBe(first.height);
  });

  it("shows rows lines on its first frame when the text is shorter, in each variant and size", async () => {
    const outline = await firstFrame(<TextArea label="Notes" autoGrow rows={3} />);
    expect(outline.first.height).toBeCloseTo(linesHeight(outline.textarea, 3), 0);
    expect(height(outline.textarea)).toBe(outline.first.height);
    const plain = await firstFrame(<TextArea label="Notes" variant="plain" size="lg" autoGrow rows={1} maxRows={8} defaultValue={"a\nb\nc"} />);
    expect(plain.first.height).toBeCloseTo(linesHeight(plain.textarea, 3), 0);
    expect(height(plain.textarea)).toBe(plain.first.height);
  });

  it("is its new height on the first frame after its value changes", async () => {
    const field = (value: string) => <TextArea label="Notes" autoGrow rows={1} maxRows={6} value={value} onChange={() => {}} />;
    const { commit, textarea } = await firstFrame(field("one"));
    expect(height(textarea)).toBeCloseTo(linesHeight(textarea, 1), 0);
    const first = await commit(field("1\n2\n3\n4"));
    expect(first.height).toBeCloseTo(linesHeight(textarea, 4), 0);
    expect(height(textarea)).toBe(first.height);
  });
});

describe("TextArea variant and size", () => {
  it("draws no frame of its own with variant plain, and still outlines on keyboard focus", async () => {
    const { textarea } = await render(<TextArea label="Message" hideLabel variant="plain" autoGrow rows={1} />);
    const box = getComputedStyle(textarea);
    expect(textarea.dataset.variant).toBe("plain");
    expect(box.borderTopWidth).toBe("0px");
    expect(box.paddingLeft).toBe("0px");
    expect(box.paddingTop).toBe("0px");
    expect(box.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(textarea.getBoundingClientRect().height).toBe(parseFloat(box.lineHeight));
    textarea.focus();
    await expect.poll(() => getComputedStyle(textarea).outlineStyle).toBe("solid");
    expect(warn).not.toHaveBeenCalled();
  });

  it("sets 20px text on 28px lines with size lg, at phone and desktop widths", async () => {
    await page.viewport(390, 844);
    const { textarea } = await render(<TextArea label="Message" size="lg" />);
    expect(textarea.dataset.size).toBe("lg");
    expect(getComputedStyle(textarea).fontSize).toBe("20px");
    expect(getComputedStyle(textarea).lineHeight).toBe("28px");
    await page.viewport(1280, 800);
    await expect.poll(() => getComputedStyle(textarea).fontSize).toBe("20px");
  });

  it("is outlined at the medium size by default", async () => {
    const { textarea } = await render(<TextArea label="Notes" />);
    expect(textarea.dataset.variant).toBe("outline");
    expect(textarea.dataset.size).toBe("md");
  });

  it.each([
    ["a filled variant", { variant: "filled" }, 'variant="filled" is not a variant; use "outline" or "plain"', '<TextArea variant="outline">'],
    ["a borderless variant", { variant: "borderless" }, 'variant="borderless" is not a variant; use "outline" or "plain"', '<TextArea variant="plain">'],
    ["an unknown size", { size: "sm" }, 'size="sm" is not a size; use "md" or "lg"', '<TextArea size="md">'],
  ] as const)("renders the default and names the fix for %s", async (_name, wrong, problem, fix) => {
    const props = { label: "Notes", ...wrong } as unknown as TextAreaProps;
    const { textarea } = await render(<TextArea {...props} />);
    expect(textarea.dataset.variant).toBe("outline");
    expect(textarea.dataset.size).toBe("md");
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] TextArea: ${problem}. Fix: ${fix}.`);
  });
});

describe("TextArea development messages", () => {
  it.each([
    ["errorMessage", { errorMessage: "Required." }, "errorMessage is not a prop", '<TextArea error="Required.">'],
    ["helperText", { helperText: "Hint" }, "helperText is not a prop", '<TextArea description="Hint">'],
    ["isInvalid", { isInvalid: true }, "isInvalid is not a prop", '<TextArea error="What is wrong">'],
    ["invalid", { invalid: true }, "invalid is not a prop", '<TextArea error="What is wrong">'],
    ["isRequired", { isRequired: true }, "isRequired is not a prop", "<TextArea required>"],
    ["isDisabled", { isDisabled: true }, "isDisabled is not a prop", "<TextArea disabled>"],
    ["minRows", { minRows: 2 }, "minRows is not a prop; rows is the minimum", "<TextArea autoGrow rows={2} maxRows={8}>"],
    ["autoResize", { autoResize: true }, "autoResize is not a prop", "<TextArea autoGrow>"],
    ["autosize", { autosize: true }, "autosize is not a prop", "<TextArea autoGrow>"],
  ])("warns for %s with the fix", async (name, extra, problem, fix) => {
    const props = { label: "Notes", ...extra } as unknown as TextAreaProps;
    const { host } = await render(<TextArea {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] TextArea: ${problem}. Fix: ${fix}.`);
    for (const element of host.querySelectorAll("*")) expect(element.hasAttribute(name.toLowerCase())).toBe(false);
  });

  it("warns that maxRows needs autoGrow", async () => {
    await render(<TextArea label="Notes" maxRows={6} />);
    expect(warn).toHaveBeenCalledWith("[ouro-ui] TextArea: maxRows only applies with autoGrow. Fix: <TextArea autoGrow maxRows={6}>.");
  });

  it("names TextArea in Field's messages", async () => {
    await render(<TextArea label="Notes" className="shadow-lg" />);
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] TextArea: "shadow-lg" sets appearance, and className is for layout only. Fix: style fields in your theme (--input, --ring, --radius).',
    );
  });

  it("warns that a py class leaves autoGrow's bounds out of step, and not for the padding variable", async () => {
    const message =
      "[ouro-ui] TextArea: a class sets the textarea's vertical padding, so autoGrow's rows and maxRows leave it out. " +
      'Fix: set its variable instead: <TextArea autoGrow className="[&_textarea]:[--ouro-text-area-py:12px]">.';
    const variable = await render(<TextArea label="Notes" autoGrow rows={2} className="[&_textarea]:[--ouro-text-area-py:calc(var(--spacing)*4)]" />);
    expect(warn).not.toHaveBeenCalledWith(message);
    expect(height(variable.textarea)).toBeCloseTo(linesHeight(variable.textarea, 2), 0);
    // An app that sets its own min-height has taken the bounds over.
    await render(<TextArea label="Notes" autoGrow rows={2} className="[&_textarea]:py-4" style={{ minHeight: "1px" }} />);
    expect(warn).not.toHaveBeenCalledWith(message);
    await render(<TextArea label="Notes" autoGrow rows={2} className="[&_textarea]:py-4" />);
    expect(warn).toHaveBeenCalledWith(message);
  });

  it("says nothing for a full, valid field", async () => {
    await render(
      <TextArea label="Notes" name="notes" required description="Optional." error="Too long." autoGrow rows={2} maxRows={6} hideLabel className="mt-2" />,
    );
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("TextArea server rendering", () => {
  const node = (
    <div>
      <TextArea label="Notes" name="notes" description="Only you see these." error="Too long." required autoGrow rows={2} defaultValue="Salt" />
    </div>
  );

  it("renders the label, description and error ids on the server", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const doc = new DOMParser().parseFromString(renderToString(node), "text/html");
    const textarea = doc.querySelector("textarea")!;
    expect(doc.querySelector(`label[for="${textarea.id}"]`)!.textContent).toContain("Notes");
    expect(describedBy(textarea).map((id) => doc.getElementById(id)!.textContent)).toEqual(["Only you see these.", "Too long."]);
    expect(textarea.rows).toBe(2);
    expect(error).not.toHaveBeenCalled();
  });

  it("hydrates with the same ids and no hydration warning", async () => {
    const host = document.createElement("div");
    host.innerHTML = renderToString(node);
    document.body.append(host);
    mounted.push(host);
    const snapshot = () => [...host.querySelectorAll("*")].map((el) => [el.tagName, el.id, el.getAttribute("for"), el.getAttribute("aria-describedby")]);
    const before = snapshot();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const recoverable = vi.fn();
    let root!: Root;
    await act(async () => {
      root = hydrateRoot(host, node, { onRecoverableError: recoverable });
    });
    roots.push(root);
    expect(snapshot()).toEqual(before);
    expect(recoverable).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

describe("TextArea under a parent's spacing", () => {
  it("keeps the 16px that space-y-4 puts between the TextArea and the button below it", async () => {
    // The parent's rule has zero specificity, so a margin class on the root would beat it.
    const { host } = await render(
      <div className="space-y-4">
        <TextArea label="Notes" />
        <Button>Save</Button>
      </div>,
    );
    const root = host.querySelector<HTMLElement>('[data-ouro="text-area"]')!;
    const button = host.querySelector<HTMLElement>('[data-ouro="button"]')!;
    expect(getComputedStyle(root).marginBottom).toBe("16px");
    expect(Math.abs(button.getBoundingClientRect().top - root.getBoundingClientRect().bottom - 16)).toBeLessThanOrEqual(1);
  });
});
