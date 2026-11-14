import { useState, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { TextArea, type TextAreaHighlight, type TextAreaProps } from "~/components/ouro/text-field/text-area";
import { describeHighlights, highlightRuns, highlightWarnings, moveHighlights, normalizeHighlights } from "~/components/ouro/text-field/text-area-styles";
import { act } from "~/lib/ouro/testing/act";

const roots: Root[] = [];
let mounted: HTMLElement[] = [];

async function render(node: ReactNode, width = 360) {
  const host = document.createElement("div");
  host.style.padding = "24px";
  host.style.width = `${width}px`;
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return {
    host,
    rerender: (next: ReactNode) => act(async () => root.render(next)),
    get textarea() {
      return host.querySelector<HTMLTextAreaElement>("textarea")!;
    },
    get layer() {
      return host.querySelector<HTMLElement>("[data-ouro-highlights-layer]")!;
    },
    get marks() {
      return [...host.querySelectorAll<HTMLElement>("[data-ouro-highlight]")].map((mark) => mark.textContent);
    },
  };
}

/** The texts of the elements `aria-describedby` names, in order. */
const descriptions = (element: Element) =>
  (element.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent);

/** Types at a place in the text, as a person does: the caret there, then the keys. */
async function typeAt(textarea: HTMLTextAreaElement, at: number, keys: string, end = at) {
  textarea.focus();
  textarea.setSelectionRange(at, end);
  await userEvent.keyboard(keys);
}

/** A controlled TextArea whose highlights the app stores from onHighlightsChange. */
function Stored({ text, highlights, onHighlightsChange, ...props }: { text: string; highlights: TextAreaHighlight[]; onHighlightsChange?: (highlights: TextAreaHighlight[]) => void } & Partial<TextAreaProps>) {
  const [value, setValue] = useState(text);
  const [marks, setMarks] = useState(highlights);
  return (
    <TextArea
      label="Reply"
      {...props}
      value={value}
      onValueChange={setValue}
      highlights={marks}
      onHighlightsChange={(next) => {
        setMarks(next);
        onHighlightsChange?.(next);
      }}
    />
  );
}

const suggested = "Suggested by your assistant";

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
});

describe("TextArea highlights", () => {
  it("marks each range over its words, in a layer with the textarea's box and type, and lets the pointer through", async () => {
    const { textarea, layer, marks } = await render(
      <TextArea label="Reply" defaultValue="Thanks for the notes. See you Saturday." highlights={[{ start: 0, end: 21, label: suggested }]} />,
    );
    expect(marks).toEqual(["Thanks for the notes."]);
    expect(layer.getAttribute("aria-hidden")).toBe("true");
    expect(layer.textContent).toBe(`${textarea.value}\n\u200b`);
    const area = getComputedStyle(textarea);
    const drawn = getComputedStyle(layer);
    for (const name of ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderLeftWidth", "fontFamily", "fontSize", "lineHeight", "letterSpacing"] as const) {
      expect(drawn[name], name).toBe(area[name]);
    }
    expect(drawn.visibility).toBe("visible");
    expect(drawn.pointerEvents).toBe("none");
    expect(drawn.webkitTextFillColor).toBe("rgba(0, 0, 0, 0)");
    expect(drawn.color).toBe(area.color);
    const box = textarea.getBoundingClientRect();
    const over = layer.getBoundingClientRect();
    expect([over.left, over.top, over.width, over.height]).toEqual([box.left, box.top, box.width, box.height]);
    const mark = layer.querySelector<HTMLElement>("[data-ouro-highlight]")!.getBoundingClientRect();
    expect(mark.top).toBeGreaterThanOrEqual(box.top);
    expect(mark.left).toBeGreaterThanOrEqual(box.left);
  });

  it("wraps a mark with its words onto the next line", async () => {
    const text = "One two three four five six seven eight nine ten eleven twelve thirteen fourteen";
    const { layer } = await render(<TextArea label="Reply" defaultValue={text} autoGrow highlights={[{ start: 0, end: text.length, label: suggested }]} />, 240);
    expect(layer.querySelector("[data-ouro-highlight]")!.getClientRects().length).toBeGreaterThan(1);
  });

  it.each([
    ["primary", "dotted", "--primary", true],
    ["secondary", "dotted", "--muted-foreground", true],
    ["success", "dotted", "--success", true],
    ["destructive", "wavy", "--destructive", false],
    ["warning", "wavy", "--warning", false],
  ] as const)("draws a %s mark as a %s underline in its tone", async (tone, style, token, tinted) => {
    const { host } = await render(
      <>
        <span data-probe="" style={{ color: `var(${token})` }} />
        <TextArea label="Reply" defaultValue="A word" highlights={[{ start: 2, end: 6, label: "Marked", tone }]} />
      </>,
    );
    const mark = host.querySelector<HTMLElement>("[data-ouro-highlight]")!;
    expect(mark.getAttribute("data-ouro-highlight")).toBe(tone);
    const look = getComputedStyle(mark);
    expect(look.textDecorationLine).toBe("underline");
    expect(look.textDecorationStyle).toBe(style);
    expect(look.textDecorationColor).toBe(getComputedStyle(host.querySelector("[data-probe]")!).color);
    expect(look.backgroundColor === "rgba(0, 0, 0, 0)").toBe(!tinted);
  });

  it("draws a mark with no tone in primary", async () => {
    const { host } = await render(<TextArea label="Reply" defaultValue="A word" highlights={[{ start: 2, end: 6, label: "Marked" }]} />);
    expect(host.querySelector("[data-ouro-highlight]")!.getAttribute("data-ouro-highlight")).toBe("primary");
  });

  it("underlines in the system's text colour under forced colours, and keeps the layer's text transparent", async () => {
    await commands.emulateMedia({ forcedColors: "active" });
    try {
      const { host, layer } = await render(
        <>
          <span data-probe="" style={{ color: "CanvasText" }} />
          <TextArea label="Reply" defaultValue="A word" highlights={[{ start: 2, end: 6, label: "Marked" }]} />
        </>,
      );
      expect(getComputedStyle(host.querySelector("[data-ouro-highlight]")!).textDecorationColor).toBe(getComputedStyle(host.querySelector("[data-probe]")!).color);
      expect(getComputedStyle(layer).webkitTextFillColor).toBe("rgba(0, 0, 0, 0)");
    } finally {
      await commands.emulateMedia({ forcedColors: "none" });
    }
  });

  it("shows the later mark where two overlap", async () => {
    const { host, marks } = await render(
      <TextArea label="Reply" defaultValue="abcdef" highlights={[{ start: 0, end: 4, label: "First" }, { start: 2, end: 6, label: "Second", tone: "warning" }]} />,
    );
    expect(marks).toEqual(["ab", "cdef"]);
    expect(host.querySelectorAll("[data-ouro-highlight]")).toHaveLength(2);
    expect([...host.querySelectorAll("[data-ouro-highlight]")].map((mark) => mark.getAttribute("data-ouro-highlight"))).toEqual(["primary", "warning"]);
  });

  it("clamps marks to the text and leaves out those that mark nothing", async () => {
    const { marks } = await render(
      <TextArea
        label="Reply"
        defaultValue="Hello there"
        highlights={[
          { start: -3, end: 2, label: "Before" },
          { start: 6, end: 40, label: "After" },
          { start: 4, end: 4, label: "Empty" },
          { start: 5, end: 3, label: "Backwards" },
          { start: Number.NaN, end: 3, label: "Not a number" },
          { start: 1.6, end: 3.2, label: "Fractional" },
        ]}
      />,
    );
    expect(marks).toEqual(["H", "el", "there"]);
  });

  it("describes the marks after the field's own description: each label once, with the words it marks", async () => {
    const text = "Thanks for the notes. I can bring the sourdough starter and a jar of honey from the market on Saturday. See you tehn.";
    const { textarea } = await render(
      <TextArea
        label="Reply"
        description="Only you see this."
        aria-describedby="outside"
        defaultValue={text}
        highlights={[
          { start: 0, end: 21, label: suggested },
          { start: 21, end: 22, label: "Blank" },
          { start: 112, end: 116, label: "Possible spelling mistake", tone: "destructive" },
          { start: 28, end: 103, label: suggested },
        ]}
      />,
    );
    const describedBy = textarea.getAttribute("aria-describedby")!.split(" ");
    expect(describedBy[1]).toBe("outside");
    expect(descriptions(textarea).filter((text) => text !== undefined)).toEqual([
      "Only you see this.",
      `${suggested}: \u201cThanks for the notes.\u201d, \u201cbring the sourdough starter and a jar of\u2026\u201d. Possible spelling mistake: \u201ctehn\u201d.`,
    ]);
  });

  it("adds nothing to the description without marks, and keeps the app's description", async () => {
    const { textarea, layer } = await render(<TextArea label="Reply" aria-describedby="outside" defaultValue="Hi" highlights={[]} />);
    expect(textarea.getAttribute("aria-describedby")).toBe("outside");
    expect(layer).not.toBeNull();
  });

  it("renders no layer and no box around the textarea without highlights", async () => {
    const { host, textarea } = await render(<TextArea label="Reply" defaultValue="Hi" />);
    expect(host.querySelector("[data-ouro-highlights]")).toBeNull();
    expect(textarea.hasAttribute("aria-describedby")).toBe(false);
  });
});

describe("TextArea highlights as the person edits", () => {
  it("never marks what the person types, before, after or inside a mark, and splits a mark they type inside", async () => {
    const onHighlightsChange = vi.fn();
    const { textarea, marks } = await render(<Stored text="one two three" highlights={[{ start: 4, end: 7, label: suggested, id: "two" }]} onHighlightsChange={onHighlightsChange} />);
    expect(marks).toEqual(["two"]);
    await typeAt(textarea, 7, "!");
    expect(textarea.value).toBe("one two! three");
    expect(onHighlightsChange).not.toHaveBeenCalled();
    await typeAt(textarea, 4, "my ");
    expect(onHighlightsChange).toHaveBeenLastCalledWith([{ start: 7, end: 10, label: suggested, id: "two" }]);
    await typeAt(textarea, 8, "--");
    expect(textarea.value).toBe("one my t--wo! three");
    expect(onHighlightsChange).toHaveBeenLastCalledWith([
      { start: 7, end: 8, label: suggested, id: "two" },
      { start: 10, end: 12, label: suggested, id: "two" },
    ]);
    const { host } = { host: textarea.closest("div")! };
    expect([...host.querySelectorAll("[data-ouro-highlight]")].map((mark) => mark.textContent)).toEqual(["t", "wo"]);
  });

  it("drops a mark whose words the person deletes, and trims one they delete part of", async () => {
    const onHighlightsChange = vi.fn();
    const { textarea } = await render(
      <Stored text="one two three" highlights={[{ start: 0, end: 3, label: "A" }, { start: 4, end: 7, label: "B" }, { start: 8, end: 13, label: "C" }]} onHighlightsChange={onHighlightsChange} />,
    );
    await typeAt(textarea, 2, "{Backspace}", 9);
    expect(textarea.value).toBe("onhree");
    expect(onHighlightsChange).toHaveBeenLastCalledWith([
      { start: 0, end: 2, label: "A" },
      { start: 2, end: 6, label: "C" },
    ]);
  });

  it("places an edit where the person made it when the text around it reads the same", async () => {
    const onHighlightsChange = vi.fn();
    const { textarea } = await render(<Stored text="aa" highlights={[{ start: 1, end: 2, label: "Second" }]} onHighlightsChange={onHighlightsChange} />);
    await typeAt(textarea, 1, "a");
    expect(onHighlightsChange).toHaveBeenLastCalledWith([{ start: 2, end: 3, label: "Second" }]);
  });

  it("brings the marks back when the person undoes an edit, and takes them away again on redo", async () => {
    const onHighlightsChange = vi.fn();
    // The app adds the "!", so the text the undo returns to is one the field saw after it mounted.
    function Appended({ text }: { text: string }) {
      const [value, setValue] = useState(text);
      const [given, setGiven] = useState(text);
      const [marks, setMarks] = useState<TextAreaHighlight[]>([{ start: 4, end: 7, label: suggested }]);
      if (text !== given) {
        setGiven(text);
        setValue(text);
      }
      return (
        <TextArea
          label="Reply"
          value={value}
          onValueChange={setValue}
          highlights={marks}
          onHighlightsChange={(next) => {
            setMarks(next);
            onHighlightsChange(next);
          }}
        />
      );
    }
    const { textarea, host, rerender } = await render(<Appended text="one two three" />);
    await rerender(<Appended text="one two three!" />);
    const marks = () => [...host.querySelectorAll("[data-ouro-highlight]")].map((mark) => mark.textContent);
    expect(textarea.value).toBe("one two three!");
    await typeAt(textarea, 4, "{Backspace}", 7);
    expect(textarea.value).toBe("one  three!");
    expect(marks()).toEqual([]);
    await act(async () => void document.execCommand("undo"));
    expect(textarea.value).toBe("one two three!");
    expect(marks()).toEqual(["two"]);
    expect(onHighlightsChange).toHaveBeenLastCalledWith([{ start: 4, end: 7, label: suggested }]);
    await act(async () => void document.execCommand("redo"));
    expect(textarea.value).toBe("one  three!");
    expect(marks()).toEqual([]);
  });

  it("leaves a split mark split when the person deletes what they typed, which is not an undo", async () => {
    const { textarea, marks } = await render(<Stored text="one two three" highlights={[{ start: 4, end: 7, label: suggested }]} />);
    expect(marks).toEqual(["two"]);
    await typeAt(textarea, 5, "X");
    await userEvent.keyboard("{Backspace}");
    expect(textarea.value).toBe("one two three");
    expect([...document.querySelectorAll("[data-ouro-highlight]")].map((mark) => mark.textContent)).toEqual(["t", "wo"]);
  });

  it("moves the marks it shows by the person's edit when the app keeps passing the same highlights", async () => {
    function Fixed() {
      const [value, setValue] = useState("aa");
      return <TextArea label="Reply" value={value} onValueChange={setValue} highlights={[{ start: 1, end: 2, label: "Second" }]} />;
    }
    const { textarea, layer } = await render(<Fixed />);
    await typeAt(textarea, 1, "a");
    expect([...layer.firstElementChild!.childNodes].map((node) => node.textContent)).toEqual(["aa", "a", "\n\u200b"]);
  });

  it("moves the marks for an undo to a text it has not seen, as for any edit", async () => {
    const onHighlightsChange = vi.fn();
    const { textarea } = await render(<Stored text="one two" highlights={[{ start: 4, end: 7, label: "B" }]} onHighlightsChange={onHighlightsChange} />);
    textarea.focus();
    await act(async () => {
      setNativeValue(textarea, "zero one two");
      textarea.setSelectionRange(5, 5);
      textarea.dispatchEvent(new InputEvent("input", { inputType: "historyUndo", bubbles: true }));
    });
    expect(onHighlightsChange).toHaveBeenLastCalledWith([{ start: 9, end: 12, label: "B" }]);
  });

  it("moves the marks by comparing the texts when a change comes with no input event", async () => {
    const onHighlightsChange = vi.fn();
    const { textarea } = await render(<Stored text="one two" highlights={[{ start: 4, end: 7, label: "B" }]} onHighlightsChange={onHighlightsChange} />);
    await act(async () => {
      setNativeValue(textarea, "one, two");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onHighlightsChange).toHaveBeenLastCalledWith([{ start: 5, end: 8, label: "B" }]);
  });

  it("moves the marks of an uncontrolled field as the person types, with or without a starting text", async () => {
    const onHighlightsChange = vi.fn();
    const { host } = await render(
      <>
        <TextArea label="One" defaultValue="one two" highlights={[{ start: 4, end: 7, label: "B" }]} onHighlightsChange={onHighlightsChange} />
        <TextArea label="Two" highlights={[{ start: 0, end: 3, label: "Nothing yet" }]} />
        <TextArea label="Three" defaultValue="one two" highlights={[{ start: 4, end: 7, label: "C" }]} />
      </>,
    );
    const [one, two, three] = [...host.querySelectorAll("textarea")];
    const layers = [...host.querySelectorAll<HTMLElement>("[data-ouro-highlights-layer]")];
    expect(layers[1]!.textContent).toBe("\n\u200b");
    await typeAt(one!, 0, "zero ");
    expect(onHighlightsChange).toHaveBeenLastCalledWith([{ start: 9, end: 12, label: "B" }]);
    expect(layers[0]!.textContent).toBe(`${one!.value}\n\u200b`);
    expect(layers[0]!.querySelector("[data-ouro-highlight]")!.textContent).toBe("two");
    await typeAt(two!, 0, "abc");
    expect(two!.value).toBe("abc");
    expect(layers[1]!.querySelectorAll("[data-ouro-highlight]")).toHaveLength(0);
    await typeAt(three!, 0, "zero ");
    expect(layers[2]!.querySelector("[data-ouro-highlight]")!.textContent).toBe("two");
  });

  it("moves the marks with the text when the app changes the value, and keeps them for the same highlights in a new array", async () => {
    const view = (value: string) => <TextArea label="Reply" value={value} onValueChange={() => {}} highlights={[{ start: 4, end: 7, label: "B" }]} />;
    const { rerender, host } = await render(view("one two three"));
    await rerender(view("zero one two three"));
    expect(host.querySelector("[data-ouro-highlight]")!.textContent).toBe("two");
  });

  it("takes new highlights as they are given", async () => {
    const view = (highlights: TextAreaHighlight[]) => <TextArea label="Reply" value="one two three" onValueChange={() => {}} highlights={highlights} />;
    const { rerender, marks } = await render(view([{ start: 4, end: 7, label: "B" }]));
    expect(marks).toEqual(["two"]);
    await rerender(view([{ start: 8, end: 13, label: "C" }]));
    expect([...document.querySelectorAll("[data-ouro-highlight]")].map((mark) => mark.textContent)).toEqual(["three"]);
  });

  it.each([
    [99, true],
    [100, false],
  ])("remembers a hundred texts for undo: after %i more, the first is remembered: %s", async (more, remembered) => {
    const onHighlightsChange = vi.fn();
    const view = (value: string, highlights: TextAreaHighlight[]) => <TextArea label="Reply" value={value} onValueChange={() => {}} highlights={highlights} onHighlightsChange={onHighlightsChange} />;
    const { rerender, textarea } = await render(view("one two", [{ start: 4, end: 7, label: "B" }]));
    for (let count = 1; count <= more; count++) await rerender(view(`text ${count}`, []));
    await act(async () => {
      setNativeValue(textarea, "one two");
      textarea.dispatchEvent(new InputEvent("input", { inputType: "historyUndo", bubbles: true }));
    });
    expect(onHighlightsChange.mock.calls.length > 0).toBe(remembered);
  });
});

describe("TextArea highlights' edit placement", () => {
  const mark = { start: 0, end: 1, label: "A" };
  const at = (start: number, end: number, label = "A") => ({ start, end, label });

  it("keeps a mark before an edit, moves one after it, splits one around it and drops one inside it", () => {
    // "one two three four" -> "one TWO! three four": "two" replaced by "TWO!".
    const before = "one two three four";
    const after = "one TWO! three four";
    expect(moveHighlights([at(0, 3), at(8, 13), at(4, 7), at(2, 9), at(4, 5)], before, after, null)).toEqual([at(0, 3), at(9, 14), at(2, 4), at(8, 10)]);
  });

  it("splits a mark around text inserted inside it, and leaves marks that end or start at the insertion whole", () => {
    expect(moveHighlights([at(1, 3), at(0, 2), at(2, 3)], "aab", "aaab", null)).toEqual([at(1, 2), at(3, 4), at(0, 2), at(3, 4)]);
  });

  it("places an edit by the selection, with no selection, and when the change could be in more than one place", () => {
    expect(moveHighlights([at(1, 2)], "aa", "aaa", { before: { start: 1, end: 1 }, caret: 2 })).toEqual([at(2, 3)]);
    expect(moveHighlights([at(1, 2)], "aa", "aaa", null)).toEqual([at(1, 2)]);
    expect(moveHighlights([at(0, 4)], "abab", "ab", { before: { start: 0, end: 2 }, caret: 0 })).toEqual([at(0, 2)]);
    expect(moveHighlights([at(0, 2)], "abab", "ab", { before: { start: 0, end: 2 }, caret: 0 })).toEqual([]);
    expect(moveHighlights([at(2, 3)], "xaay", "xaaay", { before: { start: 2, end: 2 }, caret: 3 })).toEqual([at(3, 4)]);
    // A caret past the inserted text would place a larger edit than the texts show: the texts decide.
    expect(moveHighlights([at(0, 1)], "a", "aa", { before: { start: 0, end: 0 }, caret: 2 })).toEqual([at(0, 1)]);
  });

  it("places an edit by comparing the texts when the selection does not fit the text before it", () => {
    // A caret after "b" in "ba" cannot come from an edit after "a" in "a": the texts decide, and "b" was typed before the mark.
    expect(moveHighlights([mark], "a", "ba", { before: { start: 1, end: 1 }, caret: 2 })).toEqual([{ ...mark, start: 1, end: 2 }]);
  });

  it("places an edit by comparing the texts when the selection does not fit the text after it", () => {
    expect(moveHighlights([{ ...mark, start: 2, end: 3 }], "abc", "abXc", { before: { start: 0, end: 0 }, caret: 1 })).toEqual([{ ...mark, start: 3, end: 4 }]);
  });
});

describe("TextArea highlights' helpers", () => {
  const at = (start: number, end: number, label = "A") => ({ start, end, label });

  it("clamps highlights into the text and leaves out the empty ones and those that are not numbers", () => {
    expect(normalizeHighlights([at(-2, 3), at(5, 99), at(4, 4), at(3, 2), at(Number.NaN, 2), at(1.7, 2.9)], 8)).toEqual([at(0, 3), at(5, 8), at(1, 2)]);
    expect(normalizeHighlights(undefined, 8)).toEqual([]);
  });

  it("cuts the text into runs where marks start and end, one run per stretch of the same mark", () => {
    expect(highlightRuns("0123456789", [at(1, 2), at(4, 6, "Y"), at(3, 8, "X")])).toEqual([
      { text: "0", mark: undefined },
      { text: "1", mark: 0 },
      { text: "2", mark: undefined },
      { text: "34567", mark: 2 },
      { text: "89", mark: undefined },
    ]);
    expect(highlightRuns("abc", [])).toEqual([{ text: "abc", mark: undefined }]);
    expect(highlightRuns("abc", [at(0, 3)])).toEqual([{ text: "abc", mark: 0 }]);
  });

  it("quotes up to eight words of a mark, with spaces folded, and shortens a longer one", () => {
    const text = "  one   two\nthree four five six seven eight  | one two three four five six seven eight nine";
    expect(describeHighlights(text, [at(0, 45), at(46, text.length, "B")])).toBe(
      "A: \u201cone two three four five six seven eight\u201d. B: \u201cone two three four five six seven eight\u2026\u201d.",
    );
  });

  it("finds the first unlabelled mark, counting a label of spaces, and says nothing for marks with no tone", () => {
    expect(highlightWarnings([at(0, 2), at(0, 2, "  ")])[0]).toEqual([
      "highlights[1] has no label, so screen readers cannot say what it marks",
      '<TextArea highlights={[{ start: 0, end: 5, label: "Suggested by your assistant" }]}>',
    ]);
    expect(highlightWarnings([at(0, 2)]).filter(Boolean)).toEqual([]);
    expect(highlightWarnings(undefined).filter(Boolean)).toEqual([]);
  });
});

/** Sets a textarea's value as the browser does, past React's tracker, so the next input event reads as a change. */
function setNativeValue(textarea: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, value);
}

describe("TextArea highlights' cost", () => {
  /**
   * How many times the textarea's style was read since this was called: each copy onto the layer
   * reads it, and lays out the page. It starts once the frame after mount has run, where the
   * layer's ResizeObserver delivers its first observation, as every observer does once.
   */
  const reads = async (textarea: HTMLTextAreaElement) => {
    await act(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const spy = vi.spyOn(window, "getComputedStyle");
    const of = () => spy.mock.calls.filter(([element]) => element === textarea).length;
    const before = of();
    return () => of() - before;
  };
  const busy = (tick: number, highlights: TextAreaHighlight[], props: Partial<TextAreaProps> = {}) => (
    <TextArea label="Reply" defaultValue="A few words" highlights={highlights} data-tick={tick} {...props} />
  );

  it("copies nothing and draws no text with no marks, as the person types or the parent renders, and stays hidden", async () => {
    const { textarea, layer, rerender } = await render(busy(0, []));
    const count = await reads(textarea);
    await typeAt(textarea, 11, " more");
    await rerender(busy(1, []));
    expect(count()).toBe(0);
    expect(layer.textContent).toBe("\n\u200b");
    expect(getComputedStyle(layer).visibility).toBe("hidden");
  });

  it("copies the textarea's box and type when marks appear and when a prop that styles it changes, not as the person types or the parent renders", async () => {
    const mark = [{ start: 0, end: 5, label: "A" }];
    const { textarea, layer, rerender } = await render(busy(0, []));
    await rerender(busy(0, mark));
    expect(getComputedStyle(layer).visibility).toBe("visible");
    expect(layer.style.fontSize).toBe(getComputedStyle(textarea).fontSize);
    const count = await reads(textarea);
    await typeAt(textarea, 11, " more");
    await rerender(busy(1, mark));
    expect(count()).toBe(0);
    // The layer's text follows the textarea's in the same box, so the marks stay over their words.
    expect(layer.textContent).toBe(`${textarea.value}\n\u200b`);
    // A prop that styles the textarea is copied in the same commit, before the frame is painted.
    await rerender(busy(1, mark, { size: "lg" }));
    expect(layer.style.fontSize).toBe("20px");
    await rerender(busy(1, mark, { size: "lg", variant: "plain" }));
    expect([layer.style.paddingLeft, layer.style.borderLeftWidth]).toEqual([getComputedStyle(textarea).paddingLeft, getComputedStyle(textarea).borderLeftWidth]);
    await rerender(busy(1, [], { size: "lg", variant: "plain" }));
    expect(getComputedStyle(layer).visibility).toBe("hidden");
    // With no marks again, a scroll or a change of size copies nothing.
    const after = await reads(textarea);
    textarea.dispatchEvent(new Event("scroll"));
    await rerender(busy(2, [], { size: "md", variant: "plain" }));
    await act(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(after()).toBe(0);
  });
});

describe("TextArea highlights layout", () => {
  it("scrolls the marks with the text once autoGrow stops at maxRows", async () => {
    const text = Array.from({ length: 12 }, (_, line) => `line ${line}`).join("\n");
    const { textarea, layer } = await render(<TextArea label="Reply" defaultValue={text} autoGrow rows={1} maxRows={3} highlights={[{ start: text.length - 7, end: text.length, label: "Last" }]} />);
    textarea.scrollTop = 60;
    await expect.poll(() => (layer.firstElementChild as HTMLElement).style.transform).toBe(`translateY(-${textarea.scrollTop}px)`);
  });

  it("copies the textarea's type again when the window crosses a breakpoint that changes it", async () => {
    await page.viewport(414, 896);
    try {
      const { textarea, layer } = await render(<TextArea label="Reply" defaultValue="A few words" highlights={[{ start: 0, end: 5, label: "A" }]} />);
      expect(layer.style.fontSize).toBe("16px");
      await page.viewport(1024, 768);
      expect(getComputedStyle(textarea).fontSize).toBe("14px");
      await expect.poll(() => layer.style.fontSize).toBe("14px");
    } finally {
      await page.viewport(414, 896);
    }
  });

  it("follows the textarea when its width changes", async () => {
    const { host, textarea, layer } = await render(<TextArea label="Reply" defaultValue="A few words to wrap" autoGrow highlights={[{ start: 0, end: 5, label: "A" }]} />);
    host.style.width = "200px";
    await expect.poll(() => layer.getBoundingClientRect().width).toBe(textarea.getBoundingClientRect().width);
  });

  it.each([
    ["ltr", "paddingRight", "paddingLeft"],
    ["rtl", "paddingLeft", "paddingRight"],
  ] as const)("leaves room for a classic scrollbar at the inline end, %s", async (dir, end, start) => {
    // Headless browsers draw overlay scrollbars, which take no width; this textarea reports a classic one, 12px wide.
    const text = Array.from({ length: 12 }, (_, line) => `line ${line}`).join("\n");
    const { textarea, layer } = await render(
      <div dir={dir}>
        <TextArea label="Reply" defaultValue={text} rows={2} highlights={[{ start: 0, end: 4, label: "A" }]} />
      </div>,
    );
    const style = getComputedStyle(textarea);
    const borders = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
    Object.defineProperty(textarea, "clientWidth", { configurable: true, get: () => textarea.offsetWidth - borders - 12 });
    textarea.dispatchEvent(new Event("scroll"));
    expect(parseFloat(layer.style[end])).toBeCloseTo(parseFloat(style[end]) + 12, 1);
    expect(layer.style[start]).toBe(style[start]);
  });
});

describe("TextArea highlights development messages", () => {
  it.each([
    [[{ start: 0, end: 2, label: "" }], "highlights[0] has no label, so screen readers cannot say what it marks", '<TextArea highlights={[{ start: 0, end: 5, label: "Suggested by your assistant" }]}>'],
    [[{ start: 0, end: 2, label: "A" }, { start: 0, end: 2 }], "highlights[1] has no label, so screen readers cannot say what it marks", '<TextArea highlights={[{ start: 0, end: 5, label: "Suggested by your assistant" }]}>'],
    [[{ start: 3, end: 3, label: "A" }], "highlights[0] ends where it starts or before, so it marks nothing", "<TextArea highlights={[{ start: 0, end: 5, label }]}> with end after start"],
    [[{ start: 0, end: 2, label: "A", tone: "danger" }], 'highlights[0] has tone="danger", which is not a tone', '<TextArea highlights={[{ start: 0, end: 5, label: "Possible spelling mistake", tone: "destructive" }]}>'],
    [[{ start: 0, end: 2, label: "A" }, { start: 0, end: 2, label: "B", tone: "red" }], 'highlights[1] has tone="red", which is not a tone; use "primary", "secondary", "success", "destructive", "warning"', '<TextArea highlights={[{ start: 0, end: 5, label: "Possible spelling mistake", tone: "destructive" }]}>'],
  ])("says what is wrong with %j", async (highlights, problem, fix) => {
    await render(<TextArea label="Reply" defaultValue="Hello" highlights={highlights as TextAreaHighlight[]} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] TextArea: ${problem}. Fix: ${fix}.`);
  });

  it("renders a mark whose tone is not one in primary", async () => {
    const { host } = await render(<TextArea label="Reply" defaultValue="Hello" highlights={[{ start: 0, end: 2, label: "A", tone: "red" } as unknown as TextAreaHighlight]} />);
    expect(host.querySelector("[data-ouro-highlight]")!.getAttribute("data-ouro-highlight")).toBe("primary");
  });

  it("points marks to highlights", async () => {
    const props = { label: "Reply", marks: [] } as unknown as TextAreaProps;
    const { textarea } = await render(<TextArea {...props} />);
    expect(warn).toHaveBeenCalledWith('[ouro-ui] TextArea: marks is not a prop. Fix: <TextArea highlights={[{ start: 0, end: 5, label: "Suggested" }]}>.');
    expect(textarea.hasAttribute("marks")).toBe(false);
  });

  it("says nothing for valid highlights", async () => {
    await render(<TextArea label="Reply" defaultValue="Hello there" highlights={[{ start: 0, end: 5, label: "A", tone: "warning", id: "a" }]} />);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("TextArea highlights server rendering", () => {
  const node = (
    <div>
      <TextArea label="Reply" defaultValue="Thanks for the notes." highlights={[{ start: 0, end: 6, label: suggested }]} />
    </div>
  );

  it("writes the marks' description and a hidden layer on the server", () => {
    const doc = new DOMParser().parseFromString(renderToString(node), "text/html");
    const textarea = doc.querySelector("textarea")!;
    expect(textarea.getAttribute("aria-describedby")!.split(" ").map((id) => doc.getElementById(id)!.textContent)).toEqual([`${suggested}: \u201cThanks\u201d.`]);
    expect(doc.querySelector("[data-ouro-highlights-layer]")!.className).toContain("invisible");
  });

  it("hydrates with no hydration error, then shows the marks", async () => {
    const host = document.createElement("div");
    host.innerHTML = renderToString(node);
    document.body.append(host);
    mounted.push(host);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const recoverable = vi.fn();
    let root!: Root;
    await act(async () => {
      root = hydrateRoot(host, node, { onRecoverableError: recoverable });
    });
    roots.push(root);
    expect(recoverable).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(getComputedStyle(host.querySelector("[data-ouro-highlights-layer]")!).visibility).toBe("visible");
  });
});
