import { createRef, useState, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { Button } from "~/components/ouro/button/button";
import { TextArea, type TextAreaProps } from "~/components/ouro/text-field/text-area";
import { canFieldSize, fitHeightNative, supportsFieldSizing } from "~/components/ouro/text-field/text-area-styles";
import { act } from "~/lib/ouro/testing/act";
import { watchLayoutReads } from "~/lib/ouro/testing/layout-reads";

const roots: Root[] = [];
let mounted: HTMLElement[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  host.style.padding = "24px";
  host.style.width = "360px";
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return {
    host,
    rerender: (next: ReactNode) => act(async () => root.render(next)),
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

  it("measures with fitHeight when the user agent is Safari, clearing what the native path set, and back again", async () => {
    const safari = "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
    const agent = vi.spyOn(navigator, "userAgent", "get").mockReturnValue(safari);
    const { textarea, rerender } = await render(<TextArea label="Notes" autoGrow rows={1} maxRows={4} defaultValue={"a\nb\nc"} />);
    expect(textarea.style.getPropertyValue("field-sizing")).toBe("");
    expect(textarea.style.minHeight).toBe("");
    expect(textarea.style.maxHeight).toBe("");
    expect(textarea.style.height).not.toBe("");
    expect(height(textarea)).toBeCloseTo(linesHeight(textarea, 3), 0);
    agent.mockRestore();
    await rerender(<TextArea label="Notes" autoGrow rows={1} maxRows={4} defaultValue={"a\nb\nc"} />);
    if (supportsFieldSizing()) expect(textarea.style.getPropertyValue("field-sizing")).toBe("content");
    await rerender(<TextArea label="Notes" rows={2} defaultValue={"a\nb\nc"} />);
    expect(textarea.style.height).toBe("");
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

  it("hands the height to the browser: it clears the inline height and overflow, and caps only with maxRows", async () => {
    const { textarea } = await render(<TextArea label="Notes" rows={2} />);
    textarea.style.height = "99px";
    textarea.style.overflowY = "hidden";
    textarea.style.maxHeight = "50px";
    fitHeightNative(textarea, 2, undefined);
    expect(textarea.style.getPropertyValue("field-sizing")).toBe("content");
    expect(textarea.style.height).toBe("");
    expect(textarea.style.overflowY).toBe("");
    expect(textarea.style.maxHeight).toBe("");
    expect(textarea.style.minHeight).toMatch(/^calc\(2lh \+ /);
    fitHeightNative(textarea, 2, 5);
    expect(textarea.style.maxHeight).toMatch(/^calc\(5lh \+ /);
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
