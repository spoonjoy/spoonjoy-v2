import { useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { act } from "~/lib/ouro/testing/act";
import { useKeyboardScrollable } from "~/lib/ouro/use-keyboard-scrollable";

const roots: Root[] = [];
const hosts: HTMLElement[] = [];

afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const host of hosts.splice(0)) host.remove();
});

async function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return {
    host,
    rerender: (next: ReactNode) => act(async () => root.render(next)),
  };
}

const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

function Scroller({ lines, enabled = true }: { lines: number; enabled?: boolean }) {
  const ref = useKeyboardScrollable<HTMLDivElement>(enabled);
  return (
    <div ref={ref} data-scroller="" style={{ height: 100, overflowY: "auto" }}>
      {Array.from({ length: lines }, (_, index) => (
        <p key={index} style={{ height: 40, margin: 0 }}>
          Line {index + 1}
        </p>
      ))}
    </div>
  );
}

const scroller = (host: HTMLElement) => host.querySelector<HTMLElement>("[data-scroller]")!;

it("makes an overflowing scroll container a tab stop, so a keyboard can scroll it", async () => {
  const { host } = await render(<Scroller lines={10} />);
  expect(scroller(host).getAttribute("tabindex")).toBe("0");
});

it("adds no tab stop while the content fits", async () => {
  const { host } = await render(<Scroller lines={2} />);
  expect(scroller(host).hasAttribute("tabindex")).toBe(false);
});

it("follows the content as it grows and shrinks", async () => {
  const { host, rerender } = await render(<Scroller lines={2} />);
  await rerender(<Scroller lines={10} />);
  await frames();
  expect(scroller(host).getAttribute("tabindex")).toBe("0");
  await rerender(<Scroller lines={1} />);
  await frames();
  expect(scroller(host).hasAttribute("tabindex")).toBe(false);
});

it("follows a lone text child as its text grows (React sets nodeValue)", async () => {
  function TextScroller({ words }: { words: number }) {
    const ref = useKeyboardScrollable<HTMLDivElement>(true);
    return (
      <div ref={ref} data-scroller="" style={{ height: 100, width: 200, overflowY: "auto", scrollbarWidth: "none" }}>
        {"word ".repeat(words)}
      </div>
    );
  }
  const { host, rerender } = await render(<TextScroller words={1} />);
  // Let the ResizeObserver deliver its first notification, so only the text change remains.
  await frames();
  expect(scroller(host).hasAttribute("tabindex")).toBe(false);
  await rerender(<TextScroller words={200} />);
  await frames();
  expect(scroller(host).getAttribute("tabindex")).toBe("0");
});

it("reads the sizes after the browser's layout, not when the content changes", async () => {
  const { host } = await render(<Scroller lines={2} />);
  await frames();
  const read = vi.spyOn(Element.prototype, "scrollHeight", "get");
  scroller(host).insertAdjacentHTML("beforeend", '<p style="height: 400px; margin: 0">Long</p>');
  // The mutation's callback has run (a microtask), and read nothing: a read there forces a layout.
  await Promise.resolve();
  expect(read).not.toHaveBeenCalled();
  await frames();
  expect(read).toHaveBeenCalled();
  expect(scroller(host).getAttribute("tabindex")).toBe("0");
  read.mockRestore();
});

it("keeps the tab stop while the body has focus, and drops it on blur once the content fits", async () => {
  const { host, rerender } = await render(<Scroller lines={10} />);
  scroller(host).focus();
  expect(document.activeElement).toBe(scroller(host));
  await rerender(<Scroller lines={1} />);
  await frames();
  expect(document.activeElement).toBe(scroller(host));
  expect(scroller(host).getAttribute("tabindex")).toBe("0");
  scroller(host).blur();
  expect(scroller(host).hasAttribute("tabindex")).toBe(false);
});

it("follows the container as it resizes", async () => {
  function Resizable() {
    const [tall, setTall] = useState(false);
    const ref = useKeyboardScrollable<HTMLDivElement>(true);
    return (
      <>
        <button onClick={() => setTall(true)}>Grow</button>
        <div ref={ref} data-scroller="" style={{ height: tall ? 1000 : 100, overflowY: "auto" }}>
          <p style={{ height: 400, margin: 0 }}>Body</p>
        </div>
      </>
    );
  }
  const { host } = await render(<Resizable />);
  expect(scroller(host).getAttribute("tabindex")).toBe("0");
  await act(async () => host.querySelector("button")!.click());
  await frames();
  expect(scroller(host).hasAttribute("tabindex")).toBe(false);
});

it("leaves the element alone when disabled (the app set its own tabIndex)", async () => {
  const { host } = await render(<Scroller lines={10} enabled={false} />);
  expect(scroller(host).hasAttribute("tabindex")).toBe(false);
});
