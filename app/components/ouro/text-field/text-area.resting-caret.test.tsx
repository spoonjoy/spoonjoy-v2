import { useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { TextArea as TextAreaControl, type TextAreaProps } from "~/components/ouro/text-field/text-area";
import { useRestingCaret, type RestingCaretOptions } from "~/lib/ouro/use-resting-caret";
import { act } from "~/lib/ouro/testing/act";

let root: Root;
let host: HTMLDivElement;
let wake: () => void;
const onHeld = vi.fn();
const subscribeWake = (listener: () => void) => {
  wake = listener;
  return vi.fn();
};
const policy = { enabled: true, onHeld, subscribeWake };
const resting = (box: HTMLTextAreaElement) => box.readOnly || box.style.getPropertyValue("caret-animation") === "manual";

function TextArea({ restingCaret, ...props }: TextAreaProps & { restingCaret: RestingCaretOptions }) {
  const [box, setBox] = useState<HTMLTextAreaElement | null>(null);
  useRestingCaret(box, restingCaret, props.readOnly === true, props.disabled === true);
  return <TextAreaControl {...props} ref={setBox} />;
}

async function render(node: ReactNode) {
  host ??= document.createElement("div");
  if (!host.isConnected) {
    host.style.cssText = "width: 320px; padding: 24px";
    document.body.append(host);
    root = createRoot(host);
  }
  await act(() => root.render(node));
  return host.querySelector("textarea")!;
}

afterEach(async () => {
  vi.useRealTimers();
  await act(() => root.unmount());
  host.remove();
  onHeld.mockClear();
});

async function idle(box: HTMLTextAreaElement) {
  box.blur();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  box.focus();
  wake();
  await act(() => vi.advanceTimersByTime(30_000));
}

describe("TextArea resting caret", () => {
  it("rests after thirty seconds, keeps focus and selection, and inserts the first waking character", async () => {
    const box = await render(<TextArea label="Draft" defaultValue="hello" restingCaret={policy} />);
    box.focus();
    box.setSelectionRange(2, 2);
    await idle(box);
    expect(resting(box)).toBe(true);
    expect(document.activeElement).toBe(box);
    expect([box.selectionStart, box.selectionEnd]).toEqual([2, 2]);
    expect(box.dataset.caretRest).toBe("idle");
    const caret = host.querySelector<HTMLElement>("[data-ouro-steady-caret]");
    if (CSS.supports("caret-animation", "manual")) expect(caret).toBeNull();
    else {
      expect(caret!.getAttribute("aria-hidden")).toBe("true");
      expect(caret!.getBoundingClientRect().height).toBeGreaterThan(0);
    }
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
    await userEvent.keyboard("x");
    expect(box.value).toBe("hexllo");
    expect(resting(box)).toBe(false);
    expect(onHeld.mock.calls.map(([held]) => held)).toEqual([true, false]);
  });

  it("leaves caller readOnly alone and releases a hold when host safety changes", async () => {
    const box = await render(<TextArea label="Draft" defaultValue="hello" restingCaret={policy} />);
    await idle(box);
    await render(<TextArea label="Draft" defaultValue="hello" restingCaret={{ ...policy, enabled: false }} />);
    expect(resting(box)).toBe(false);
    expect(host.querySelector("[data-ouro-steady-caret]")).toBeNull();
    await render(<TextArea label="Draft" defaultValue="hello" readOnly restingCaret={policy} />);
    wake();
    await act(() => vi.advanceTimersByTime(60_000));
    expect(box.readOnly).toBe(true);
    expect(onHeld).toHaveBeenCalledTimes(2);
  });

  it("does not undo a caller's readOnly change made while held", async () => {
    const box = await render(<TextArea label="Draft" defaultValue="hello" restingCaret={policy} />);
    await idle(box);
    await render(<TextArea label="Draft" defaultValue="hello" readOnly restingCaret={policy} />);
    expect(box.readOnly).toBe(true);
    expect(host.querySelector("[data-ouro-steady-caret]")).toBeNull();
    wake();
    expect(box.readOnly).toBe(true);
  });

  it("wakes for host input and composition, but not reading with the pointer or wheel", async () => {
    const box = await render(<TextArea label="Draft" defaultValue="hello" restingCaret={policy} />);
    await idle(box);
    box.dispatchEvent(new Event("pointermove", { bubbles: true }));
    box.dispatchEvent(new Event("wheel", { bubbles: true }));
    expect(resting(box)).toBe(true);
    wake();
    expect(resting(box)).toBe(false);
    box.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    await act(() => vi.advanceTimersByTime(60_000));
    expect(resting(box)).toBe(false);
    box.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    await act(() => vi.advanceTimersByTime(30_000));
    expect(resting(box)).toBe(true);
    box.dispatchEvent(new Event("paste", { bubbles: true }));
    expect(resting(box)).toBe(false);
  });
});
