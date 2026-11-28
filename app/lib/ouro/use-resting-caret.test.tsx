import { useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { useRestingCaret, type RestingCaretOptions } from "~/lib/ouro/use-resting-caret";
import { act } from "~/lib/ouro/testing/act";

type Kind = "textarea" | "input" | "rich" | "none";
type Props = { kind?: Kind; policy?: RestingCaretOptions | undefined; readOnly?: boolean; disabled?: boolean; empty?: boolean; type?: string; rtl?: boolean; tabIndex?: number | null };
let host: HTMLDivElement;
let root: Root;
let wake: () => void;
const unsubscribe = vi.fn();
const onHeld = vi.fn();
const subscribeWake = vi.fn((listener: () => void) => { wake = listener; return unsubscribe; });
const policy = { enabled: true, subscribeWake, onHeld };

function Harness({ kind = "textarea", policy: permission, readOnly = false, disabled = false, empty = false, type = "text", rtl = false, tabIndex = 3 }: Props) {
  const [box, setBox] = useState<HTMLInputElement | HTMLTextAreaElement | HTMLDivElement | null>(null);
  useRestingCaret(box, permission, readOnly, disabled, type);
  const text = empty ? "" : "A good idea deserves a little room.\nAnd a quiet moment.";
  let control: ReactNode;
  if (kind === "none") control = null;
  else if (kind === "rich") control = <div ref={setBox} data-test-harness tabIndex={tabIndex ?? (readOnly && !disabled ? 0 : undefined)} contentEditable={!readOnly && !disabled} suppressContentEditableWarning>{empty ? <p><br /></p> : <p>{text}</p>}</div>;
  else if (kind === "input") control = <input ref={setBox} data-test-harness type={type} readOnly={readOnly} disabled={disabled} defaultValue={text} />;
  else control = <textarea ref={setBox} data-test-harness readOnly={readOnly} disabled={disabled} defaultValue={text} />;
  return <div dir={rtl ? "rtl" : "ltr"} style={{ position: "relative", border: "2px solid", padding: 8, width: 240, font: "16px/24px monospace" }}>{control}</div>;
}

async function render(props: Props = {}) {
  await act(() => root.render(<Harness policy={policy} {...props} />));
  return host.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLDivElement>("[data-test-harness]")!;
}
async function rest(box: HTMLElement) {
  box.focus();
  await act(() => vi.advanceTimersByTime(30_000));
}
const caret = () => host.querySelector<HTMLElement>("[data-ouro-steady-caret]");

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.spyOn(CSS, "supports").mockReturnValue(false);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  onHeld.mockClear();
  subscribeWake.mockClear();
  unsubscribe.mockClear();
});

describe("resting caret host contract", () => {
  it.each([
    ["MacIntel", "Apple Computer, Inc.", 2, -1],
    ["MacIntel", "Google Inc.", 1, 0],
    ["Linux x86_64", "Apple Computer, Inc.", 1, 0],
  ] as const)("draws the host's caret width, colour and glyph position on fractional padding for %s / %s", async (platform, vendor, width, offset) => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
    vi.spyOn(navigator, "vendor", "get").mockReturnValue(vendor);
    const box = await render() as HTMLTextAreaElement;
    box.style.cssText = "font:20px/28px monospace;letter-spacing:0.13px;width:240px;height:80px;padding:4.5px 8.875px;border:1px solid;box-sizing:border-box;caret-color:rgb(18,52,86);left:40px";
    box.value = "MMMMMMMM";
    const reference = document.createElement("div");
    reference.style.cssText = "font:20px/28px monospace;letter-spacing:0.13px";
    const glyphs = document.createElement("span");
    glyphs.textContent = "M";
    reference.append(glyphs);
    host.append(reference);
    const advance = glyphs.getBoundingClientRect().width;
    const padding = 8.875 - advance % 1;
    box.style.paddingInline = `${padding}px`;
    const field = box.getBoundingClientRect();
    const edge = field.left + 1 + padding + advance;
    box.setSelectionRange(1, 1);
    await rest(box);
    const steady = caret()!;
    const before = steady.getBoundingClientRect();
    expect(before.width).toBe(width);
    expect(before.height).toBe(Math.round(glyphs.getBoundingClientRect().height));
    expect(before.left).toBe(Math.round(edge) + offset);
    expect(before.top).toBeGreaterThan(field.top);
    expect(before.bottom).toBeLessThan(field.bottom);
    expect(steady.getAttribute("aria-hidden")).toBe("true");
    expect(getComputedStyle(steady).backgroundColor).toBe("rgb(18, 52, 86)");
    host.style.marginInlineStart = "24px";
    window.dispatchEvent(new Event("resize"));
    expect(steady.getBoundingClientRect().left - before.left).toBe(24);
  });

  it("uses the engine's steady caret when supported and restores the caller's animation", async () => {
    vi.mocked(CSS.supports).mockRestore();
    const native = CSS.supports("caret-animation", "manual");
    const box = await render() as HTMLTextAreaElement;
    for (const original of ["", "auto"]) {
      box.style.setProperty("caret-animation", original, "important");
      const before = box.style.getPropertyValue("caret-animation");
      await rest(box);
      expect(box.readOnly).toBe(!native);
      expect(box.style.getPropertyValue("caret-animation")).toBe(native ? "manual" : before);
      expect(caret() === null).toBe(native);
      expect(vi.getTimerCount()).toBe(0);
      wake();
      expect(box.style.getPropertyValue("caret-animation")).toBe(before);
      expect(box.style.getPropertyPriority("caret-animation")).toBe(before ? "important" : "");
    }
    await rest(box);
    box.style.setProperty("caret-animation", "auto");
    const changed = box.style.getPropertyValue("caret-animation");
    wake();
    expect(box.style.getPropertyValue("caret-animation")).toBe(changed);
  });

  it("positions decoration against the actual containing block without changing the field's layout", async () => {
    const box = await render() as HTMLTextAreaElement;
    box.parentElement!.style.position = "static";
    host.style.marginInlineStart = "32px";
    box.style.height = "120px";
    box.value = "Readable text";
    box.setSelectionRange(2, 2);
    const before = box.getBoundingClientRect();
    await rest(box);
    const decoration = caret()!.getBoundingClientRect();
    expect(decoration.left).toBeGreaterThan(before.left);
    expect(decoration.right).toBeLessThan(before.right);
    expect(decoration.top).toBeGreaterThan(before.top);
    expect(decoration.bottom).toBeLessThan(before.bottom);
    expect(box.getBoundingClientRect().toJSON()).toEqual(before.toJSON());
    expect(box.parentElement!.style.position).toBe("static");
  });

  it("stays inert without host permission", async () => {
    let box = await render({ policy: undefined });
    await rest(box);
    expect(box.dataset.caretRest).toBeUndefined();
    box = await render({ policy: { ...policy, enabled: false } });
    await rest(box);
    expect(subscribeWake).not.toHaveBeenCalled();
    expect(onHeld).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await render({ kind: "none" });
  });

  it("keeps one deadline while typing and leaves no timer while resting, covered or unfocused", async () => {
    const box = await render();
    box.focus();
    expect(vi.getTimerCount()).toBe(1);
    await act(() => vi.advanceTimersByTime(20_000));
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    await act(() => vi.advanceTimersByTime(10_000));
    expect(box.dataset.caretRest).toBe("blinks");
    expect(vi.getTimerCount()).toBe(1);
    await act(() => vi.advanceTimersByTime(20_000));
    expect(box.dataset.caretRest).toBe("idle");
    expect(vi.getTimerCount()).toBe(0);
    box.blur();
    expect(caret()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("holds a covered editor, wakes before its own handler, and ignores input elsewhere", async () => {
    const box = await render({ policy: { ...policy, occluded: true } });
    box.focus();
    expect(box.dataset.caretRest).toBe("covered");
    expect(vi.getTimerCount()).toBe(0);
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(onHeld).toHaveBeenLastCalledWith(true);
    const editableAtInput: boolean[] = [];
    box.addEventListener("keydown", () => editableAtInput.push(!(box as HTMLTextAreaElement).readOnly));
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(editableAtInput).toEqual([true]);
    expect(box.dataset.caretRest).toBe("blinks");
    await render({ policy: { ...policy, occluded: false } });
    expect(vi.getTimerCount()).toBe(1);
  });

  it("keeps an existing steady caret through a cover change and hides it for a text selection", async () => {
    const box = await render() as HTMLTextAreaElement;
    box.value = "Readable text";
    box.style.height = "120px";
    box.setSelectionRange(1, 1);
    await rest(box);
    const steady = caret();
    expect(steady!.hidden).toBe(false);
    await render({ policy: { ...policy, occluded: true } });
    expect(caret()).toBe(steady);
    expect(onHeld).toHaveBeenCalledOnce();
    box.setSelectionRange(1, 4, "backward");
    document.dispatchEvent(new Event("selectionchange"));
    expect(caret()!.hidden).toBe(true);
    expect(box.selectionDirection).toBe("backward");
  });

  it("does not leave a replacement caret when the host wakes synchronously from onHeld", async () => {
    const box = await render({ policy: { ...policy, onHeld: (held) => { if (held) wake(); } } });
    await rest(box);
    expect((box as HTMLTextAreaElement).readOnly).toBe(false);
    expect(caret()).toBeNull();
    expect(vi.getTimerCount()).toBe(1);
  });

  it("does not rearm after a synchronous host revocation during wake", async () => {
    const permission = { ...policy, onHeld: (held: boolean) => {
      if (!held) flushSync(() => root.render(<Harness policy={{ ...policy, enabled: false }} />));
    } };
    const box = await render({ policy: permission });
    await rest(box);
    await act(() => wake());
    await act(() => vi.advanceTimersByTime(30_000));
    expect((box as HTMLTextAreaElement).readOnly).toBe(false);
    expect(caret()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("hides the steady caret with the page and lets the engine handle an unfocused window", async () => {
    const box = await render();
    box.focus();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(box.dataset.caretRest).toBe("hidden");
    expect((box as HTMLTextAreaElement).readOnly).toBe(true);
    expect(caret()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect((box as HTMLTextAreaElement).readOnly).toBe(false);
    await rest(box);
    const focus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    window.dispatchEvent(new Event("blur"));
    expect(box.dataset.caretRest).toBe("background");
    expect(caret()).toBeNull();
    expect((box as HTMLTextAreaElement).readOnly).toBe(false);
    focus.mockReturnValue(true);
    window.dispatchEvent(new Event("focus"));
    expect(box.dataset.caretRest).toBe("blinks");
  });

  it("wakes for paste, drag, pointer and input-method events without resting mid-word", async () => {
    const box = await render();
    for (const type of ["paste", "dragenter", "dragover", "drop", "pointerdown", "beforeinput", "input", "compositionupdate", "compositionstart"]) {
      await rest(box);
      box.dispatchEvent(new Event(type));
      expect((box as HTMLTextAreaElement).readOnly, type).toBe(false);
    }
    await act(() => vi.advanceTimersByTime(60_000));
    expect((box as HTMLTextAreaElement).readOnly).toBe(false);
    box.dispatchEvent(new Event("compositionend"));
    await act(() => vi.advanceTimersByTime(30_000));
    expect((box as HTMLTextAreaElement).readOnly).toBe(true);
  });

  it("preserves empty input focus and disables a held field without changing its readOnly prop", async () => {
    const box = await render({ kind: "input", empty: true });
    await rest(box);
    expect(document.activeElement).toBe(box);
    expect(caret()!.getBoundingClientRect().height).toBeGreaterThan(0);
    await render({ kind: "input", empty: true, disabled: true });
    expect((box as HTMLInputElement).readOnly).toBe(false);
    expect(caret()).toBeNull();
    wake();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves native input types without a text selection editable", async () => {
    const box = await render({ kind: "input", type: "email", empty: true });
    await rest(box);
    expect(box.dataset.caretRest).toBeUndefined();
    expect((box as HTMLInputElement).readOnly).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    const text = await render({ kind: "input", empty: true });
    await rest(text);
    expect((text as HTMLInputElement).readOnly).toBe(true);
    await render({ kind: "input", type: "email", empty: true });
    expect((text as HTMLInputElement).readOnly).toBe(false);
  });

  it("restores rich editability without leaving a temporary tabindex or a late host wake", async () => {
    const box = await render({ kind: "rich", tabIndex: null });
    await rest(box);
    expect(box.getAttribute("tabindex")).toBe("0");
    wake();
    expect(box.hasAttribute("tabindex")).toBe(false);
    await rest(box);
    await render({ kind: "rich", tabIndex: null, readOnly: true });
    expect(box.contentEditable).toBe("false");
    await render({ kind: "rich", tabIndex: null });
    await rest(box);
    await render({ kind: "rich", tabIndex: null, disabled: true });
    expect(box.contentEditable).toBe("false");
    expect(box.hasAttribute("tabindex")).toBe(false);
    wake();
    expect(box.contentEditable).toBe("false");
  });

  it("does not claim a caller's externally read-only editor", async () => {
    const box = await render();
    (box as HTMLTextAreaElement).readOnly = true;
    await rest(box);
    expect(onHeld).not.toHaveBeenCalled();
    await render({ kind: "rich" });
    const rich = host.querySelector<HTMLDivElement>("[data-test-harness]")!;
    rich.tabIndex = 0;
    rich.contentEditable = "false";
    await rest(rich);
    expect(onHeld).not.toHaveBeenCalled();
  });

  it("keeps rich text selection, restores tabindex, and releases on host disable", async () => {
    const box = await render({ kind: "rich" });
    box.focus();
    const text = box.querySelector("p")!.firstChild!;
    document.getSelection()!.setBaseAndExtent(text, 4, text, 4);
    const insertion = document.getSelection()!.getRangeAt(0).getBoundingClientRect();
    await rest(box);
    expect(box.contentEditable).toBe("false");
    expect(caret()!.hidden).toBe(false);
    expect(Math.abs(caret()!.getBoundingClientRect().left - insertion.left)).toBeLessThanOrEqual(1);
    expect(document.getSelection()!.anchorOffset).toBe(4);
    wake();
    expect(box.contentEditable).toBe("true");
    expect(box.getAttribute("tabindex")).toBe("3");
    await rest(box);
    await render({ kind: "rich", policy: { ...policy, enabled: false } });
    expect(box.contentEditable).toBe("true");
    expect(caret()).toBeNull();
    expect(unsubscribe).toHaveBeenCalledOnce();
    wake();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("hides rich decoration when the document has no selection", async () => {
    const box = await render({ kind: "rich" });
    box.focus();
    document.getSelection()!.collapse(box.querySelector("p")!.firstChild!, 4);
    await rest(box);
    expect(caret()!.hidden).toBe(false);
    vi.spyOn(document, "getSelection").mockReturnValue(null);
    await render({ kind: "rich" });
    expect(caret()!.hidden).toBe(true);
  });

  it("refreshes native caret rendering while preserving selection, scroll and focus", async () => {
    const box = await render() as HTMLTextAreaElement;
    box.setSelectionRange(2, 2);
    const direction = box.selectionDirection;
    const selections = vi.spyOn(box, "setSelectionRange");
    await rest(box);
    expect(selections.mock.calls).toEqual([[1, 1], [2, 2, direction]]);
    expect(document.activeElement).toBe(box);
    expect([box.selectionStart, box.selectionEnd]).toEqual([2, 2]);
  });

  it("does not paint over a rich selection or a selection outside the editor", async () => {
    const box = await render({ kind: "rich" });
    box.focus();
    const text = box.querySelector("p")!.firstChild!;
    document.getSelection()!.setBaseAndExtent(text, 1, text, 4);
    await rest(box);
    expect(caret()!.hidden).toBe(true);
    document.getSelection()!.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
    expect(caret()!.hidden).toBe(true);
    wake();
    await render({ kind: "rich", empty: true });
    box.focus();
    document.getSelection()!.collapse(box.firstChild!, 0);
    await rest(box);
    expect(caret()!.getBoundingClientRect().height).toBeGreaterThan(0);
    document.getSelection()!.collapse(box.firstChild!, 1);
    document.dispatchEvent(new Event("selectionchange"));
    expect(caret()!.hidden).toBe(false);
    const emptyText = document.createTextNode("");
    box.style.minHeight = "24px";
    box.replaceChildren(emptyText);
    document.getSelection()!.collapse(emptyText, 0);
    document.dispatchEvent(new Event("selectionchange"));
    expect(caret()!.hidden).toBe(false);
    box.replaceChildren();
    document.getSelection()!.collapse(box, 0);
    document.dispatchEvent(new Event("selectionchange"));
    expect(caret()!.hidden).toBe(false);
  });

  it("follows selection and scrolling without a wake and hides a caret outside the text viewport", async () => {
    const box = await render({ rtl: true });
    const area = box as HTMLTextAreaElement;
    area.style.cssText = "width: 200px; height: 48px; font: 16px/24px monospace";
    await rest(box);
    area.setSelectionRange(area.value.length, area.value.length);
    document.dispatchEvent(new Event("selectionchange"));
    expect(caret()!.hidden).toBe(true);
    area.scrollTop = area.scrollHeight;
    area.dispatchEvent(new Event("scroll"));
    expect(caret()!.hidden).toBe(false);
    expect(area.readOnly).toBe(true);
    const before = caret()!.getBoundingClientRect();
    host.style.paddingTop = "24px";
    window.dispatchEvent(new Event("resize"));
    const after = caret()!.getBoundingClientRect();
    expect(after.top - before.top).toBe(24);
  });
});


describe("resting caret geometry fixtures", () => {
  let host: HTMLDivElement;
  let root: Root;
  let wake: () => void;
  const policy = { enabled: true, subscribeWake: (listener: () => void) => { wake = listener; return () => {}; }, onHeld: () => {} };

  function Editor({ kind = "textarea" }: { kind?: "textarea" | "input" | "rich" }) {
    const [box, setBox] = useState<HTMLInputElement | HTMLTextAreaElement | HTMLDivElement | null>(null);
    useRestingCaret(box, policy, false, false);
    if (kind === "rich") return <div ref={setBox} data-test-harness contentEditable suppressContentEditableWarning tabIndex={0} />;
    if (kind === "input") return <input ref={setBox} data-test-harness />;
    return <textarea ref={setBox} data-test-harness />;
  }

  async function editor(kind: "input"): Promise<HTMLInputElement>;
  async function editor(kind: "rich"): Promise<HTMLDivElement>;
  async function editor(kind?: "textarea"): Promise<HTMLTextAreaElement>;
  async function editor(kind?: "textarea" | "input" | "rich") {
    await act(() => root.render(<Editor {...(kind ? { kind } : {})} />));
    const box = host.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLDivElement>("[data-test-harness]")!;
    box.style.cssText = "font:20px/32px monospace;box-sizing:border-box;width:240px;height:120px;padding:4.5px 8.5px;border:1.5px solid;caret-color:rgb(18,52,86)";
    return box;
  }
  async function hold(box: HTMLElement) {
    box.focus();
    await act(() => vi.advanceTimersByTime(30_000));
    return host.querySelector<HTMLElement>("[data-ouro-steady-caret]")!;
  }
  const redraw = () => document.dispatchEvent(new Event("selectionchange"));
  const rectangles = (...values: DOMRect[]): DOMRectList => Object.assign(values, { item: (index: number) => values[index] ?? null });

  beforeEach(() => {
    host = document.createElement("div");
    host.style.cssText = "position:relative;margin:17.25px;padding:13.25px";
    document.body.append(host);
    root = createRoot(host);
    vi.spyOn(CSS, "supports").mockReturnValue(false);
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux");
    vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(2);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });
  afterEach(async () => {
    await act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("resting caret geometry", () => {
    it("uses the empty rich editor's padded text origin and follows blank paragraphs at either side of a break", async () => {
      const box = await editor("rich");
      const field = box.getBoundingClientRect();
      const style = getComputedStyle(box);
      box.focus();
      document.getSelection()!.collapse(box, 0);
      const caret = await hold(box);
      const before = caret.getBoundingClientRect();
      const contentLeft = field.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
      const contentTop = field.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop);
      expect(Math.abs(before.left - contentLeft)).toBeLessThanOrEqual(1);
      expect(before.top).toBe(Math.round(contentTop * 2) / 2);
      expect(before.height).toBe(20);
      box.innerHTML = "<p style='margin:0'>First line</p><p style='margin:0'><br></p>";
      const paragraph = box.lastChild!;
      const breakRange = document.createRange();
      breakRange.selectNode(paragraph.firstChild!);
      const line = breakRange.getBoundingClientRect();
      for (const offset of [0, 1]) {
        document.getSelection()!.collapse(paragraph, offset);
        redraw();
        expect(caret.hidden).toBe(false);
        expect(caret.getBoundingClientRect().height).toBe(Math.round(line.height));
        expect(Math.abs(caret.getBoundingClientRect().top - line.top)).toBeLessThanOrEqual(1);
      }
    });

    it("centres a native input's glyphs in its content height, including asymmetric padding", async () => {
      const box = await editor("input");
      box.style.paddingBottom = "12.5px";
      box.value = "A";
      box.setSelectionRange(0, 0);
      const caret = await hold(box);
      const before = caret.getBoundingClientRect();
      expect(caret.hidden).toBe(false);
      box.style.height = "160px";
      window.dispatchEvent(new Event("resize"));
      expect(caret.getBoundingClientRect().top - before.top).toBe(20);
      box.style.paddingTop = "12.5px";
      window.dispatchEvent(new Event("resize"));
      expect(caret.getBoundingClientRect().top - before.top).toBe(24);
      box.style.paddingBottom = "20.5px";
      window.dispatchEvent(new Event("resize"));
      expect(caret.getBoundingClientRect().top - before.top).toBe(20);
    });

    it("measures without leaking a visible, accessible or interactive mirror into the document", async () => {
      const box = await editor();
      box.style.transition = "color 1s";
      box.style.animationName = "consumer-decoration";
      const styles = document.createElement("style");
      styles.textContent = 'div[aria-hidden="true"] { transform:scale(2); transition:color 1s; animation-name:consumer-decoration; white-space:normal; overflow-wrap:normal }';
      host.append(styles);
      box.value = "A long unbroken word that wraps naturally";
      box.setSelectionRange(2, 2);
      const append = document.body.append.bind(document.body);
      const measurements: HTMLElement[] = [];
      vi.spyOn(document.body, "append").mockImplementation((...nodes) => {
        append(...nodes);
        for (const node of nodes) {
          if (node instanceof HTMLDivElement && node !== host) {
            measurements.push(node);
            const style = getComputedStyle(node);
            expect(style.visibility).toBe("hidden");
            expect(style.pointerEvents).toBe("none");
            expect(["absolute", "fixed"]).toContain(style.position);
            expect(style.transform).toBe("none");
            expect(style.transitionDuration).toBe("0s");
            expect(style.animationName).toBe("none");
            expect(style.whiteSpace).toBe("pre-wrap");
            expect(style.overflowWrap).toBe("break-word");
            expect(node.getAttribute("aria-hidden")).toBe("true");
          }
        }
      });
      await hold(box);
      expect(measurements.length).toBeGreaterThan(0);
      expect(measurements.every(node => !node.isConnected)).toBe(true);
      const before = host.querySelector<HTMLElement>("[data-ouro-steady-caret]")!.getBoundingClientRect();
      box.style.transform = "translate(16px, 24px)";
      window.dispatchEvent(new Event("resize"));
      const after = host.querySelector<HTMLElement>("[data-ouro-steady-caret]")!.getBoundingClientRect();
      expect(after.left - before.left).toBe(16);
      expect(after.top - before.top).toBe(24);
    });

    it("tracks horizontal scrolling in both writing directions and the end of an empty line", async () => {
      const box = await editor("input");
      box.style.width = "120px";
      box.value = "A long unbroken word that extends beyond the field";
      box.setSelectionRange(3, 3);
      let caret = await hold(box);
      const before = caret.getBoundingClientRect();
      box.scrollLeft = 8;
      box.dispatchEvent(new Event("scroll"));
      expect(caret.getBoundingClientRect().left - before.left).toBe(-8);
      wake();
      box.style.direction = "rtl";
      box.value = "שלום עולם";
      box.setSelectionRange(2, 2);
      box.scrollLeft = 0;
      caret = await hold(box);
      const rtl = caret.getBoundingClientRect();
      expect(caret.hidden).toBe(false);
      expect(rtl.left).toBeGreaterThan(box.getBoundingClientRect().left + 40);
      wake();
      box.value = "";
      box.setSelectionRange(0, 0);
      caret = await hold(box);
      expect(caret.hidden).toBe(false);
    });

    it("uses the rich selection's text box at viewport edges without painting outside it", async () => {
      const box = await editor("rich");
      box.textContent = "Draft";
      box.focus();
      document.getSelection()!.collapse(box.firstChild!, 2);
      const field = box.getBoundingClientRect();
      let rectangle = new DOMRect(field.left + 20, field.top + 16, 0, 20);
      vi.spyOn(Range.prototype, "getClientRects").mockImplementation(() => rectangles(rectangle));
      const caret = await hold(box);
      expect(caret.getBoundingClientRect().left).toBe(Math.round((field.left + 20) * 2) / 2);
      for (const [left, top, shown] of [
        [field.left + 20, field.top - 0.5, false],
        [field.left - 0.5, field.top + 16, false],
        [field.right + 0.5, field.top + 16, false],
        [field.right, field.top + 16, true],
        [field.left + 20, field.bottom - 19, true],
        [field.left + 20, field.bottom - 18.5, false],
      ] as const) {
        rectangle = new DOMRect(left, top, 0, 20);
        redraw();
        expect(caret.hidden, `${left}, ${top}`).toBe(!shown);
      }
      rectangle = new DOMRect(field.left, field.top + 16, 0, 20);
      redraw();
      const style = getComputedStyle(box);
      expect(caret.getBoundingClientRect().left).toBeGreaterThanOrEqual(
        field.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
      );
    });

    it("uses the selected text node when an engine supplies no collapsed range rectangle", async () => {
      const box = await editor("rich");
      box.textContent = "A blank line\n";
      box.focus();
      document.getSelection()!.collapse(box.firstChild!, 2);
      const original = Range.prototype.getClientRects;
      vi.spyOn(Range.prototype, "getClientRects").mockImplementation(function (this: Range) {
        return this.collapsed ? rectangles() : original.call(this);
      });
      const reference = document.createRange();
      reference.selectNode(box.firstChild!);
      const text = reference.getBoundingClientRect();
      const caret = await hold(box);
      expect(caret.getBoundingClientRect().height).toBe(Math.round(text.height));
      expect(Math.abs(caret.getBoundingClientRect().top - text.top)).toBeLessThanOrEqual(1);
    });

    it("snaps a fractional border and padding inset to the device's pixels", async () => {
      const box = await editor("rich");
      box.textContent = "Draft";
      box.focus();
      document.getSelection()!.collapse(box.firstChild!, 2);
      vi.spyOn(box, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 100, 240, 120));
      vi.spyOn(Range.prototype, "getClientRects").mockReturnValue(rectangles(new DOMRect(120, 116.25, 0, 20)));
      const computed = window.getComputedStyle.bind(window);
      vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
        const style = computed(element, pseudo);
        return element === box ? new Proxy(style, {
          get(target, key) {
            if (key === "borderTopWidth") return "1.3px";
            if (key === "paddingTop") return "4.25px";
            return Reflect.get(target, key, target);
          },
        }) : style;
      });
      const caret = await hold(box);
      expect(caret.getBoundingClientRect().top).toBe(115.5);
      expect(caret.getBoundingClientRect().left).toBe(120);
    });

    it("hides decoration when a native control loses its text selection API", async () => {
      const box = await editor("input");
      box.value = "Draft";
      box.setSelectionRange(2, 2);
      const caret = await hold(box);
      expect(caret.hidden).toBe(false);
      box.type = "email";
      redraw();
      expect(caret.hidden).toBe(true);
    });

    it("preserves runs of spaces in a single-line input", async () => {
      const box = await editor("input");
      box.value = "A    B";
      box.setSelectionRange(1, 1);
      const before = (await hold(box)).getBoundingClientRect().left;
      wake();
      box.setSelectionRange(5, 5);
      const after = (await hold(box)).getBoundingClientRect().left;
      const sample = document.createElement("span");
      sample.style.font = getComputedStyle(box).font;
      sample.textContent = "MMMM";
      host.append(sample);
      expect(Math.abs(after - before - sample.getBoundingClientRect().width)).toBeLessThanOrEqual(1);
    });

    it("matches the text's wrapping and preserved spaces rather than repeating the prefix after the caret", async () => {
      const box = await editor();
      box.style.width = "120px";
      box.style.height = "240px";
      box.value = "AA BBBBBBBBBBBBBBB CCCCCCC\n  DD";
      const reference = document.createElement("div");
      const style = getComputedStyle(box);
      reference.style.cssText = "white-space:pre-wrap;overflow-wrap:break-word";
      for (const property of ["font", "width", "padding", "border", "box-sizing"]) reference.style.setProperty(property, style.getPropertyValue(property));
      reference.textContent = box.value;
      host.append(reference);
      for (const position of [7, box.value.length]) {
        box.setSelectionRange(position, position);
        const range = document.createRange();
        range.setStart(reference.firstChild!, position);
        range.collapse(true);
        const glyph = range.getBoundingClientRect();
        const expected = glyph.top - reference.getBoundingClientRect().top;
        const caret = await hold(box);
        expect(caret.hidden).toBe(false);
        expect(Math.abs(caret.getBoundingClientRect().top - box.getBoundingClientRect().top - expected)).toBeLessThanOrEqual(1);
        expect(Math.abs(caret.getBoundingClientRect().left - box.getBoundingClientRect().left - glyph.left + reference.getBoundingClientRect().left)).toBeLessThanOrEqual(1);
        wake();
      }
    });

    it("places the caret with the next word when that word wraps beyond the preceding space", async () => {
      const box = await editor();
      box.style.width = "160px";
      box.value = `A ${"M".repeat(24)}`;
      box.setSelectionRange(2, 2);
      const reference = document.createElement("div");
      const style = getComputedStyle(box);
      reference.style.cssText = "white-space:pre-wrap;overflow-wrap:break-word";
      for (const property of ["font", "width", "padding", "border", "box-sizing"]) reference.style.setProperty(property, style.getPropertyValue(property));
      reference.textContent = box.value;
      host.append(reference);
      const range = document.createRange();
      range.setStart(reference.firstChild!, 2);
      range.setEnd(reference.firstChild!, 3);
      const glyph = range.getBoundingClientRect();
      const referenceBox = reference.getBoundingClientRect();
      const first = document.createRange();
      first.setStart(reference.firstChild!, 0);
      first.setEnd(reference.firstChild!, 1);
      // The fixture only proves anything when the word after the caret moves to the next line.
      expect(glyph.top - first.getBoundingClientRect().top).toBeGreaterThan(glyph.height / 2);
      const caret = (await hold(box)).getBoundingClientRect();
      const field = box.getBoundingClientRect();
      expect(Math.abs(caret.top - field.top - glyph.top + referenceBox.top)).toBeLessThanOrEqual(1);
      expect(Math.abs(caret.left - field.left - glyph.left + referenceBox.left)).toBeLessThanOrEqual(1);
    });
  });
});


describe("resting caret lifecycle fixtures", () => {
  type Box = HTMLTextAreaElement | HTMLDivElement;
  type Props = {
    box: Box;
    policy?: RestingCaretOptions | undefined;
    readOnly?: boolean;
    disabled?: boolean;
  };
  let host: HTMLDivElement;
  let mount: HTMLDivElement;
  let root: Root;
  let wakes: Array<() => void>;
  let policy: RestingCaretOptions;
  let onHeld: Mock<(held: boolean) => void>;
  let unsubscribe: Mock<() => void>;

  function Hook({ box, policy: permission, readOnly = false, disabled = false }: Props) {
    useRestingCaret(box, permission, readOnly, disabled);
    return null;
  }

  function OwnedEditor({ rich = false, readOnly = false, disabled = false, tabIndex }: {
    rich?: boolean;
    readOnly?: boolean;
    disabled?: boolean;
    tabIndex?: number | undefined;
  }) {
    const [box, setBox] = useState<Box | null>(null);
    useRestingCaret(box, policy, readOnly, disabled);
    return rich
      ? <div ref={setBox} data-test-harness contentEditable={!readOnly && !disabled} tabIndex={tabIndex ?? (readOnly && !disabled ? 0 : undefined)} suppressContentEditableWarning>Draft text</div>
      : <textarea ref={setBox} data-test-harness readOnly={readOnly} disabled={disabled} defaultValue="Draft text" />;
  }

  function editor(rich = false) {
    const box = document.createElement(rich ? "div" : "textarea");
    if (box instanceof HTMLTextAreaElement) box.value = "Draft text";
    else {
      box.contentEditable = "true";
      box.textContent = "Draft text";
    }
    host.append(box);
    return box;
  }

  async function render(box: Box, permission: RestingCaretOptions | undefined = policy) {
    await act(() => root.render(<Hook box={box} policy={permission} />));
  }

  async function advance(ms: number) {
    await act(() => vi.advanceTimersByTime(ms));
  }

  async function hold(box: Box) {
    box.focus();
    await advance(30_000);
  }

  const caret = () => host.querySelector<HTMLElement>("[data-ouro-steady-caret]");

  beforeEach(() => {
    host = document.createElement("div");
    host.style.cssText = "position:relative;font:16px/24px monospace";
    mount = document.createElement("div");
    host.append(mount);
    document.body.append(host);
    root = createRoot(mount);
    wakes = [];
    onHeld = vi.fn();
    unsubscribe = vi.fn();
    policy = { enabled: true, onHeld, subscribeWake: (wake) => { wakes.push(wake); return unsubscribe; } };
    vi.spyOn(CSS, "supports").mockReturnValue(false);
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });

  afterEach(async () => {
    await act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("resting caret lifecycle ownership", () => {
    it("rests exactly at the deadline, including the remaining interval after input", async () => {
      vi.setSystemTime(new Date("2026-11-27T12:00:00Z"));
      const box = editor() as HTMLTextAreaElement;
      await render(box);
      const deadlines = vi.spyOn(globalThis, "setTimeout");
      box.focus();
      expect(deadlines.mock.calls.map(([, delay]) => delay)).toEqual([30_000]);
      await advance(29_999);
      expect(box.readOnly).toBe(false);
      expect(box.dataset.caretRest).toBe("blinks");
      await advance(1);
      expect(box.readOnly).toBe(true);
      expect(onHeld.mock.calls).toEqual([[true]]);
      expect(vi.getTimerCount()).toBe(0);

      wakes[0]!();
      await advance(20_000);
      deadlines.mockClear();
      box.dispatchEvent(new Event("input"));
      box.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
      expect(deadlines).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(1);
      await advance(10_000);
      expect(box.readOnly).toBe(false);
      expect(vi.getTimerCount()).toBe(1);
      expect(deadlines.mock.calls.at(-1)?.[1]).toBe(20_000);
      await advance(19_999);
      expect(box.readOnly).toBe(false);
      await advance(1);
      expect(box.readOnly).toBe(true);
      expect(onHeld.mock.calls).toEqual([[true], [false], [true]]);
      expect(vi.getTimerCount()).toBe(0);
    });

    it.each(["keydown", "pointerdown", "beforeinput", "input", "paste", "dragenter", "dragover", "drop", "compositionstart", "compositionupdate", "compositionend"])(
      "releases the host hold before an earlier target bubbling %s handler can stop propagation",
      async (type) => {
        const box = editor() as HTMLTextAreaElement;
        const received: Array<{ readOnly: boolean; held: unknown }> = [];
        box.addEventListener(type, (event) => {
          received.push({ readOnly: box.readOnly, held: onHeld.mock.lastCall?.[0] });
          event.stopImmediatePropagation();
        });
        await render(box);
        await hold(box);
        box.dispatchEvent(new Event(type, { bubbles: true }));
        expect(received).toEqual([{ readOnly: false, held: false }]);
        expect(caret()).toBeNull();
      },
    );

    it("cancels the blink deadline throughout composition and starts a fresh one at its end", async () => {
      const box = editor() as HTMLTextAreaElement;
      await render(box);
      box.focus();
      await advance(20_000);
      box.dispatchEvent(new Event("compositionstart"));
      expect(box.dataset.caretRest).toBe("composing");
      expect(vi.getTimerCount()).toBe(0);
      await advance(60_000);
      box.dispatchEvent(new Event("compositionupdate"));
      expect(box.readOnly).toBe(false);
      expect(box.dataset.caretRest).toBe("composing");
      expect(onHeld).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      box.dispatchEvent(new Event("compositionend"));
      expect(box.dataset.caretRest).toBe("blinks");
      expect(vi.getTimerCount()).toBe(1);
      await advance(29_999);
      expect(box.readOnly).toBe(false);
      await advance(1);
      expect(box.readOnly).toBe(true);
    });

    it("releases every subscribed listener, observed element and pending deadline on revocation", async () => {
      const box = editor();
      const add = vi.spyOn(EventTarget.prototype, "addEventListener");
      const remove = vi.spyOn(EventTarget.prototype, "removeEventListener");
      const windowAdd = vi.spyOn(window, "addEventListener");
      const windowRemove = vi.spyOn(window, "removeEventListener");
      const observe = vi.spyOn(ResizeObserver.prototype, "observe");
      const disconnect = vi.spyOn(ResizeObserver.prototype, "disconnect");
      await render(box);
      box.focus();
      expect(vi.getTimerCount()).toBe(1);
      const registrations = add.mock.calls.flatMap((args, index) => {
        const target = add.mock.contexts[index];
        return target === box || target === document || target === window ? [{ target, args }] : [];
      });
      expect(registrations.length).toBeGreaterThan(0);
      expect(observe.mock.calls.map(([target]) => target)).toEqual([box, host]);
      const observer = observe.mock.contexts[0];
      expect(observe.mock.contexts[1]).toBe(observer);
      const windowRegistrations = windowAdd.mock.calls.filter(([type]) => ["focus", "blur", "resize", "scroll"].includes(type));
      expect(windowRegistrations.map(([type]) => type).sort()).toEqual(["blur", "focus", "resize", "scroll"]);
      await render(box, { ...policy, enabled: false });
      expect(unsubscribe).toHaveBeenCalledOnce();
      expect(disconnect.mock.contexts).toContain(observer);
      expect(vi.getTimerCount()).toBe(0);
      for (const { target, args } of registrations) {
        const capture = (options: boolean | AddEventListenerOptions | undefined) => typeof options === "boolean" ? options : options?.capture ?? false;
        expect(remove.mock.calls.some((removed, index) =>
          remove.mock.contexts[index] === target && removed[0] === args[0]
          && removed[1] === args[1] && capture(removed[2]) === capture(args[2]),
        ), `release ${args[0]} on ${target === box ? "editor" : target === document ? "document" : "window"}`).toBe(true);
      }
      for (const [type, listener, options] of windowRegistrations) {
        const capture = (value: boolean | EventListenerOptions | undefined) => typeof value === "boolean" ? value : value?.capture ?? false;
        expect(windowRemove.mock.calls.some(([removedType, removedListener, removedOptions]) =>
          removedType === type && removedListener === listener && capture(removedOptions) === capture(options),
        ), `release window ${type} with the registered capture phase`).toBe(true);
      }
      expect(box.dataset.caretRest).toBeUndefined();
    });

    it("ignores an old host wake without resetting a replacement subscription's deadline", async () => {
      const box = editor() as HTMLTextAreaElement;
      await render(box);
      box.focus();
      const stale = wakes[0]!;
      await render(box, { ...policy, subscribeWake: (wake) => { wakes.push(wake); return unsubscribe; } });
      await advance(20_000);
      stale();
      await advance(10_000);
      expect(box.readOnly).toBe(true);
      expect(onHeld.mock.calls).toEqual([[true]]);
      await render(box, { ...policy, enabled: false });
      expect(box.readOnly).toBe(false);
      expect(caret()).toBeNull();
      onHeld.mockClear();
      for (const wake of wakes) wake();
      await advance(60_000);
      expect(onHeld).not.toHaveBeenCalled();
      expect(box.dataset.caretRest).toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("keeps input held until the host bridge finishes disposing even if disposal flushes a pending wake", async () => {
      const box = editor() as HTMLTextAreaElement;
      let disposed = false;
      const duringDisposal: Array<{ readOnly: boolean; notifications: number }> = [];
      const releasedAfterDisposal: boolean[] = [];
      onHeld.mockImplementation((held) => {
        if (!held) releasedAfterDisposal.push(disposed);
      });
      const permission = {
        ...policy,
        subscribeWake: (wake: () => void) => () => {
          duringDisposal.push({ readOnly: box.readOnly, notifications: onHeld.mock.calls.length });
          wake();
          duringDisposal.push({ readOnly: box.readOnly, notifications: onHeld.mock.calls.length });
          disposed = true;
        },
      };
      await render(box, permission);
      await hold(box);
      expect(box.readOnly).toBe(true);
      await render(box, { ...permission, enabled: false });
      expect(duringDisposal).toEqual([
        { readOnly: true, notifications: 1 },
        { readOnly: true, notifications: 1 },
      ]);
      expect(releasedAfterDisposal).toEqual([true]);
      expect(onHeld.mock.calls).toEqual([[true], [false]]);
      expect(box.readOnly).toBe(false);
      expect(box.dataset.caretRest).toBeUndefined();
      expect(caret()).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("drops a held editor and its resources when the hook unmounts", async () => {
      const box = editor() as HTMLTextAreaElement;
      await render(box);
      await hold(box);
      expect(caret()).not.toBeNull();
      await act(() => root.render(null));
      expect(box.readOnly).toBe(false);
      expect(caret()).toBeNull();
      expect(box.dataset.caretRest).toBeUndefined();
      expect(onHeld.mock.calls).toEqual([[true], [false]]);
      expect(unsubscribe).toHaveBeenCalledOnce();
      wakes[0]!();
      box.dispatchEvent(new Event("input"));
      box.dispatchEvent(new Event("focus"));
      expect(vi.getTimerCount()).toBe(0);
      expect(box.dataset.caretRest).toBeUndefined();
    });

    it.each([false, true])("preserves newly committed caller readOnly while releasing a rich=%s hold", async (rich) => {
      await act(() => root.render(<OwnedEditor rich={rich} />));
      const box = mount.querySelector<Box>("[data-test-harness]")!;
      await hold(box);
      await act(() => root.render(<OwnedEditor rich={rich} readOnly />));
      if (box instanceof HTMLTextAreaElement) expect(box.readOnly).toBe(true);
      else {
        expect(box.contentEditable).toBe("false");
        expect(box.getAttribute("tabindex")).toBe("0");
      }
      expect(onHeld.mock.calls).toEqual([[true], [false]]);
      expect(caret()).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    });

    it.each([undefined, -1, 7])("returns a rich editor's caller tabindex %s on wake and on disable", async (tabIndex) => {
      await act(() => root.render(<OwnedEditor rich tabIndex={tabIndex} />));
      const box = mount.querySelector<HTMLDivElement>("[data-test-harness]")!;
      // An explicit negative tabindex is programmatically focusable, like contenteditable.
      await hold(box);
      expect(box.contentEditable).toBe("false");
      expect(box.getAttribute("tabindex")).toBe("0");
      wakes[0]!();
      expect(box.contentEditable).toBe("true");
      expect(box.getAttribute("tabindex")).toBe(tabIndex === undefined ? null : String(tabIndex));
      await hold(box);
      await act(() => root.render(<OwnedEditor rich disabled tabIndex={tabIndex} />));
      expect(box.contentEditable).toBe("false");
      expect(box.getAttribute("tabindex")).toBe(tabIndex === undefined ? null : String(tabIndex));
      expect(caret()).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("releases a text hold without turning a caller-disabled field read-only", async () => {
      await act(() => root.render(<OwnedEditor />));
      const box = mount.querySelector<HTMLTextAreaElement>("textarea")!;
      await hold(box);
      await act(() => root.render(<OwnedEditor disabled />));
      expect(box.disabled).toBe(true);
      expect(box.readOnly).toBe(false);
      wakes[0]!();
      expect(box.disabled).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("holds once across cover and visibility changes, without leaving a background decoration", async () => {
      const box = editor() as HTMLTextAreaElement;
      await render(box);
      box.focus();
      await render(box, { ...policy, occluded: true });
      expect(box.dataset.caretRest).toBe("covered");
      expect(box.readOnly).toBe(true);
      expect(caret()).not.toBeNull();
      const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      expect(box.dataset.caretRest).toBe("hidden");
      expect(caret()).toBeNull();
      expect(onHeld.mock.calls).toEqual([[true]]);
      expect(vi.getTimerCount()).toBe(0);
      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      expect(box.dataset.caretRest).toBe("covered");
      expect(caret()).not.toBeNull();
      expect(onHeld.mock.calls).toEqual([[true]]);
      wakes[0]!();
      expect(box.readOnly).toBe(false);
      expect(box.dataset.caretRest).toBe("blinks");
      expect(caret()).toBeNull();
      expect(onHeld.mock.calls).toEqual([[true], [false]]);
      expect(vi.getTimerCount()).toBe(1);
    });

    it("releases a hidden page's hold synchronously for host wake before holding it again", async () => {
      const box = editor() as HTMLTextAreaElement;
      await render(box);
      box.focus();
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      expect(box.readOnly).toBe(true);
      expect(box.dataset.caretRest).toBe("hidden");
      const editableAtRelease: boolean[] = [];
      onHeld.mockImplementation((held) => {
        if (!held) editableAtRelease.push(!box.readOnly);
      });
      wakes[0]!();
      expect(editableAtRelease).toEqual([true]);
      expect(onHeld.mock.calls).toEqual([[true], [false], [true]]);
      expect(box.readOnly).toBe(true);
      expect(box.dataset.caretRest).toBe("hidden");
      expect(caret()).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("draws the first fallback decoration in the hold task with its public empty state marker", async () => {
      const box = editor() as HTMLTextAreaElement;
      box.style.cssText = "width:240px;height:80px;font:16px/24px monospace;padding:4px;border:1px solid;caret-color:rgb(18,52,86)";
      box.setSelectionRange(2, 2);
      await render(box);
      box.focus();
      // Keep selectionchange and ResizeObserver delivery out of this task: the hold itself must draw.
      vi.advanceTimersByTime(30_000);
      const steady = caret()!;
      expect(steady).not.toBeNull();
      expect(steady.getAttribute("data-ouro-steady-caret")).toBe("");
      expect(steady.hidden).toBe(false);
      expect(steady.getBoundingClientRect().height).toBeGreaterThan(0);
      expect(getComputedStyle(steady).backgroundColor).toBe("rgb(18, 52, 86)");
      expect(box.readOnly).toBe(true);
    });

    it.each([0, 3])("restarts fallback blinking with the exact selection nudge from offset %s on hold and wake", async (start) => {
      const box = editor() as HTMLTextAreaElement;
      await render(box);
      box.focus();
      box.setSelectionRange(start, start + 2, "backward");
      const direction = box.selectionDirection;
      const selections = vi.spyOn(box, "setSelectionRange");
      const nudge = start === 0 ? 1 : start - 1;
      const expected = [[nudge, nudge], [start, start + 2, direction]];
      await advance(30_000);
      expect(selections.mock.calls).toEqual(expected);
      expect([box.selectionStart, box.selectionEnd, box.selectionDirection]).toEqual([start, start + 2, direction]);
      selections.mockClear();
      wakes[0]!();
      expect(selections.mock.calls).toEqual(expected);
      expect([box.selectionStart, box.selectionEnd, box.selectionDirection]).toEqual([start, start + 2, direction]);
      expect(document.activeElement).toBe(box);
    });

    it("holds and wakes an empty fallback control without a document selection or an out-of-range nudge", async () => {
      const box = editor() as HTMLTextAreaElement;
      box.value = "";
      await render(box);
      box.focus();
      const direction = box.selectionDirection;
      vi.spyOn(document, "getSelection").mockReturnValue(null);
      const selections = vi.spyOn(box, "setSelectionRange");
      await advance(30_000);
      expect(box.readOnly).toBe(true);
      expect(selections.mock.calls).toEqual([[0, 0, direction]]);
      selections.mockClear();
      wakes[0]!();
      expect(box.readOnly).toBe(false);
      expect(selections.mock.calls).toEqual([[0, 0, direction]]);
      expect(document.activeElement).toBe(box);
    });

    it("clears and restores the same directed rich selection on both hold and wake", async () => {
      const box = editor(true) as HTMLDivElement;
      await render(box);
      box.focus();
      const selection = document.getSelection()!;
      const text = box.firstChild!;
      selection.setBaseAndExtent(text, 6, text, 2);
      const restore = selection.setBaseAndExtent.bind(selection);
      const emptyBeforeRestore: boolean[] = [];
      const clear = vi.spyOn(selection, "removeAllRanges");
      const set = vi.spyOn(selection, "setBaseAndExtent").mockImplementation((...args) => {
        emptyBeforeRestore.push(selection.rangeCount === 0);
        restore(...args);
      });
      const expectSelection = () => {
        expect([selection.anchorNode, selection.anchorOffset, selection.focusNode, selection.focusOffset]).toEqual([text, 6, text, 2]);
        expect(document.activeElement).toBe(box);
      };
      await advance(30_000);
      expect(clear).toHaveBeenCalledOnce();
      expect(set.mock.calls).toEqual([[text, 6, text, 2]]);
      expect(emptyBeforeRestore).toEqual([true]);
      expectSelection();
      clear.mockClear();
      set.mockClear();
      wakes[0]!();
      expect(clear).toHaveBeenCalledOnce();
      expect(set.mock.calls).toEqual([[text, 6, text, 2]]);
      expect(emptyBeforeRestore).toEqual([true, true]);
      expectSelection();
    });

    it("reconsiders an already focused fallback editor on attachment, but not an unfocused one", async () => {
      const box = editor() as HTMLTextAreaElement;
      box.setSelectionRange(3, 5, "backward");
      const selection = [box.selectionStart, box.selectionEnd, box.selectionDirection];
      const selections = vi.spyOn(box, "setSelectionRange");
      await render(box);
      expect(selections).not.toHaveBeenCalled();
      box.focus();
      await render(box, { ...policy, enabled: false });
      selections.mockClear();
      await render(box);
      expect(selections).toHaveBeenCalled();
      expect([box.selectionStart, box.selectionEnd, box.selectionDirection]).toEqual(selection);
      expect(document.activeElement).toBe(box);
      expect(box.readOnly).toBe(false);
      expect(box.dataset.caretRest).toBe("blinks");
    });

    it("uses native animation without touching selection where supported and respects a caller animation override", async () => {
      vi.mocked(CSS.supports).mockRestore();
      const native = CSS.supports("caret-animation", "manual");
      const box = editor() as HTMLTextAreaElement;
      box.style.setProperty("caret-animation", "auto", "important");
      box.focus();
      const selections = vi.spyOn(box, "setSelectionRange");
      await render(box);
      expect(selections.mock.calls.length === 0).toBe(native);
      await advance(30_000);
      expect(box.style.getPropertyValue("caret-animation")).toBe(native ? "manual" : "");
      expect(box.readOnly).toBe(!native);
      expect(caret() === null).toBe(native);
      wakes[0]!();
      expect(box.style.getPropertyValue("caret-animation")).toBe(native ? "auto" : "");
      expect(box.style.getPropertyPriority("caret-animation")).toBe(native ? "important" : "");
      await advance(30_000);
      box.style.removeProperty("caret-animation");
      wakes[0]!();
      expect(box.style.getPropertyValue("caret-animation")).toBe("");
      expect(selections.mock.calls.length === 0).toBe(native);
      await advance(30_000);
      expect(box.style.getPropertyValue("caret-animation")).toBe(native ? "manual" : "");
      wakes[0]!();
      expect(box.style.getPropertyValue("caret-animation")).toBe("");
      expect(box.style.getPropertyPriority("caret-animation")).toBe("");
      expect(Array.from(box.style)).not.toContain("caret-animation");
      expect(box.readOnly).toBe(false);
    });

    it("keeps background and unfocused editors out of the host hold until a fresh foreground deadline", async () => {
      const box = editor() as HTMLTextAreaElement;
      const foreground = vi.mocked(document.hasFocus);
      foreground.mockReturnValue(false);
      await render(box);
      expect(box.dataset.caretRest).toBe("no-caret");
      box.focus();
      expect(box.dataset.caretRest).toBe("background");
      await advance(60_000);
      expect(box.readOnly).toBe(false);
      expect(onHeld).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      foreground.mockReturnValue(true);
      window.dispatchEvent(new Event("focus"));
      expect(box.dataset.caretRest).toBe("blinks");
      await advance(29_999);
      expect(box.readOnly).toBe(false);
      await advance(1);
      expect(box.readOnly).toBe(true);
      box.blur();
      expect(box.dataset.caretRest).toBe("no-caret");
      expect(box.readOnly).toBe(false);
      expect(caret()).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
