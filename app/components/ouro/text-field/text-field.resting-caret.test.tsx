import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { TextField } from "~/components/ouro/text-field/text-field";
import { act } from "~/lib/ouro/testing/act";
import { useRestingCaret } from "~/lib/ouro/use-resting-caret";

let root: Root;
let host: HTMLDivElement;
let wake: () => void;
const policy = { enabled: true, onHeld: vi.fn(), subscribeWake: (listener: () => void) => { wake = listener; return vi.fn(); } };
function Draft({ readOnly }: { readOnly: boolean }) {
  const [box, setBox] = useState<HTMLInputElement | null>(null);
  useRestingCaret(box, policy, readOnly, false);
  return <TextField ref={setBox} label="Title" defaultValue="hello" readOnly={readOnly} />;
}
async function render(readOnly = false) {
  if (!host?.isConnected) {
    host = document.createElement("div");
    host.style.width = "320px";
    document.body.append(host);
    root = createRoot(host);
  }
  await act(() => root.render(<Draft readOnly={readOnly} />));
  return host.querySelector("input")!;
}
afterEach(async () => {
  vi.useRealTimers();
  await act(() => root.unmount());
  host.remove();
});

describe("TextField resting caret", () => {
  it("keeps a backward selection and accepts the first character after a host wake", async () => {
    const box = await render();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    box.focus();
    box.setSelectionRange(1, 4, "backward");
    wake();
    await act(() => vi.advanceTimersByTime(30_000));
    const native = CSS.supports("caret-animation", "manual");
    expect(box.readOnly).toBe(!native);
    expect([box.selectionStart, box.selectionEnd, box.selectionDirection]).toEqual([1, 4, "backward"]);
    const caret = host.querySelector<HTMLElement>("[data-ouro-steady-caret]");
    if (native) expect(caret).toBeNull();
    else expect(caret!.hidden).toBe(true);
    wake();
    vi.useRealTimers();
    await userEvent.keyboard("x");
    expect(box.value).toBe("hxo");
  });

  it("honours readOnly arriving while held instead of making the field editable", async () => {
    const box = await render();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    box.focus();
    wake();
    await act(() => vi.advanceTimersByTime(30_000));
    await render(true);
    expect(box.readOnly).toBe(true);
  });
});
