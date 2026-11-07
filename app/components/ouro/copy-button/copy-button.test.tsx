import { type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { CopyButton } from "~/components/ouro/copy-button/copy-button";
import { act } from "~/lib/ouro/testing/act";
import { watchAnnouncements } from "~/lib/ouro/testing/announcements";

const roots: Root[] = [];
let mounted: Element[] = [];
let clipboard: string[] = [];

/** Puts a Clipboard API in place that records what it is given, or refuses. */
function stubClipboard(behaviour: "write" | "refuse" | "absent") {
  const value =
    behaviour === "absent"
      ? undefined
      : {
          writeText: (text: string) => {
            if (behaviour === "refuse") return Promise.reject(new DOMException("Denied", "NotAllowedError"));
            clipboard.push(text);
            return Promise.resolve();
          },
        };
  Object.defineProperty(navigator, "clipboard", { configurable: true, get: () => value });
}

async function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return {
    host,
    root,
    get wrapper() {
      return host.querySelector<HTMLElement>('[data-ouro="copy-button"]')!;
    },
    get button() {
      return host.querySelector<HTMLButtonElement>('[data-ouro-control="copy-button"]')!;
    },
  };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  clipboard = [];
  stubClipboard("write");
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  delete (navigator as { clipboard?: unknown }).clipboard;
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
});

describe("CopyButton", () => {
  // The page's timers stand still until a test moves them on (`wait`): announce()'s delay and the
  // two-second confirmation. On a loaded runner more than two seconds can pass between two steps,
  // and the confirmation would end in between: a click finds the button by its accessible name,
  // which the confirmation sets, so a click on "Copied" waited for a button that said "Copy" again.
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
  afterEach(() => vi.useRealTimers());
  /** Moves the page's timers on by `ms`. */
  const wait = (ms: number) => act(async () => vi.advanceTimersByTime(ms));
  /** Waits on real frames until `read()` is `expected`: expect.poll moves the page's timers on at each retry. */
  async function until<T>(read: () => T, expected: T) {
    const deadline = performance.now() + 5000;
    while (read() !== expected && performance.now() < deadline) await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(read()).toBe(expected);
  }

  it("is a small outline button that says Copy beside a copy icon, marked as the copy-button control", async () => {
    const { wrapper, button } = await render(<CopyButton value="sk-123" />);
    expect(wrapper.getAttribute("data-status")).toBe("idle");
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("data-ouro-part")).toBe("trigger");
    expect(button.textContent).toBe("Copy");
    expect(button.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    await expect.element(page.getByRole("button", { name: "Copy" })).toBeVisible();
    expect(getComputedStyle(button).borderTopStyle).toBe("solid");
  });

  it("puts the value on the clipboard, says Copied once, calls onCopy and reads Copy again after two seconds", async () => {
    const announced = watchAnnouncements();
    const onCopy = vi.fn();
    try {
      const { wrapper, button } = await render(<CopyButton value="sk-123" label="Copy key" copiedLabel="Key copied" onCopy={onCopy} />);
      await userEvent.click(button);
      await until(() => button.textContent, "Key copied");
      expect(clipboard).toEqual(["sk-123"]);
      expect(onCopy).toHaveBeenCalledExactlyOnceWith("sk-123");
      expect(wrapper.getAttribute("data-status")).toBe("copied");
      expect(document.activeElement).toBe(button);
      await wait(100);
      expect(announced.count("Key copied")).toBe(1);
      await wait(1899);
      expect(button.textContent).toBe("Key copied");
      await wait(1);
      expect(button.textContent).toBe("Copy key");
      expect(wrapper.getAttribute("data-status")).toBe("idle");
      expect(announced.count("Key copied")).toBe(1);
    } finally {
      announced.stop();
    }
  });

  it("says Copied again on a second click while it still shows the first", async () => {
    const announced = watchAnnouncements();
    try {
      const { button } = await render(<CopyButton value="a" />);
      await userEvent.click(button);
      await until(() => button.textContent, "Copied");
      await wait(100);
      expect(announced.count("Copied")).toBe(1);
      await userEvent.click(button);
      await until(() => clipboard.length, 2);
      await wait(100);
      expect(announced.count("Copied")).toBe(2);
      expect(clipboard).toEqual(["a", "a"]);
      // The second click, 100ms in, starts the two seconds again: the first click's would end here.
      await wait(1800);
      expect(button.textContent).toBe("Copied");
      await wait(100);
      expect(button.textContent).toBe("Copy");
    } finally {
      announced.stop();
    }
  });

  it("shows only the icon with hideLabel, its label still the button's name, and squares the button", async () => {
    const { button } = await render(<CopyButton value="x" label="Copy link" hideLabel variant="plain" />);
    expect(button.getAttribute("aria-label")).toBe("Copy link");
    expect(button.textContent).toBe("");
    const rect = button.getBoundingClientRect();
    expect(Math.round(rect.width)).toBe(Math.round(rect.height));
    await userEvent.click(button);
    await until(() => button.getAttribute("aria-label"), "Copied");
  });

  it("copies through a selection when the page has no Clipboard API, and keeps focus on the button", async () => {
    stubClipboard("absent");
    const exec = vi.spyOn(document, "execCommand").mockImplementation((command) => {
      clipboard.push(`${command}:${String(document.getSelection())}`);
      return true;
    });
    const { button } = await render(<CopyButton value="npm i" />);
    await userEvent.click(button);
    await until(() => button.textContent, "Copied");
    expect(exec).toHaveBeenCalledOnce();
    expect(clipboard[0]!.startsWith("copy:")).toBe(true);
    expect(document.activeElement).toBe(button);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("falls back to a selection when the Clipboard API refuses", async () => {
    stubClipboard("refuse");
    vi.spyOn(document, "execCommand").mockReturnValue(true);
    const { button } = await render(<CopyButton value="x" />);
    await userEvent.click(button);
    await until(() => button.textContent, "Copied");
  });

  it.each([
    ["returns false", () => false],
    [
      "throws",
      () => {
        throw new Error("blocked");
      },
    ],
  ])("says Couldn't copy, once, when the browser refuses and the selection %s", async (_how, exec) => {
    stubClipboard("refuse");
    vi.spyOn(document, "execCommand").mockImplementation(exec);
    const announced = watchAnnouncements();
    const onCopy = vi.fn();
    try {
      const { wrapper, button } = await render(<CopyButton value="x" failedLabel="Copy blocked" onCopy={onCopy} />);
      await userEvent.click(button);
      await until(() => button.textContent, "Copy blocked");
      expect(wrapper.getAttribute("data-status")).toBe("failed");
      await wait(100);
      expect(announced.count("Copy blocked")).toBe(1);
      expect(onCopy).not.toHaveBeenCalled();
    } finally {
      announced.stop();
    }
  });

  it("does nothing while disabled", async () => {
    const { button } = await render(<CopyButton value="x" disabled />);
    expect(button.disabled).toBe(true);
    button.click();
    await act(async () => {});
    expect(clipboard).toEqual([]);
  });

  it("forwards a ref, takes button attributes, and lets app layout classes win", async () => {
    let element: HTMLButtonElement | null = null;
    const { wrapper, button } = await render(
      <CopyButton value="x" size="md" variant="solid" className="ms-4" title="Copy the key" ref={(node) => void (element = node)} />,
    );
    expect(element).toBe(button);
    expect(button.title).toBe("Copy the key");
    expect(getComputedStyle(wrapper).marginInlineStart).toBe("16px");
  });

  it("stops its timer when it unmounts before the confirmation ends", async () => {
    const schedule = vi.spyOn(globalThis, "setTimeout");
    const clear = vi.spyOn(globalThis, "clearTimeout");
    const { root, button } = await render(<CopyButton value="x" />);
    await userEvent.click(button);
    await until(() => button.textContent, "Copied");
    const confirmation = schedule.mock.calls.findIndex(([, delay]) => delay === 2000);
    expect(confirmation).toBeGreaterThanOrEqual(0);
    const timer = schedule.mock.results[confirmation]!.value as ReturnType<typeof setTimeout>;
    clear.mockClear();
    await act(async () => root.unmount());
    expect(clear).toHaveBeenCalledWith(timer);
  });

  it("neither says Copied nor starts a timer when it unmounts while the clipboard is still writing", async () => {
    let finish!: () => void;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      get: () => ({ writeText: (text: string) => new Promise<void>((resolve) => (finish = () => (clipboard.push(text), resolve()))) }),
    });
    // Let an announcement an earlier test started land before watching.
    await wait(300);
    const announced = watchAnnouncements();
    const onCopy = vi.fn();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { root, button } = await render(<CopyButton value="sk-123" onCopy={onCopy} />);
      await userEvent.click(button);
      await until(() => typeof finish, "function");
      await act(async () => root.unmount());
      const schedule = vi.spyOn(globalThis, "setTimeout");
      await act(async () => finish());
      // Longer than announce() waits before it speaks.
      await wait(300);
      expect(clipboard).toEqual(["sk-123"]);
      // The text is on the clipboard, so the app still hears that it was copied.
      expect(onCopy).toHaveBeenCalledExactlyOnceWith("sk-123");
      expect(announced.count("Copied")).toBe(0);
      expect(schedule.mock.calls.filter(([, delay]) => delay === 2000)).toEqual([]);
      expect(error).not.toHaveBeenCalled();
    } finally {
      announced.stop();
    }
  });
});

describe("CopyButton development messages", () => {
  it.each([
    ["variant", { variant: "ghost" }, 'variant="ghost" is not a variant; use "solid", "soft", "outline" or "plain"', '<CopyButton value={text} variant="plain" />'],
    ["size", { size: "icon" }, 'size="icon" is not a size; use "sm", "md" or "lg"', '<CopyButton value={text} size="sm" />'],
    ["text", { text: "x" }, "text is not a prop", "<CopyButton value={text} />"],
    ["content", { content: "x" }, "content is not a prop", "<CopyButton value={text} />"],
    ["children", { children: "Copy link" }, "CopyButton takes no children; its label is label", '<CopyButton value={text} label="Copy link" />'],
    ["children", { children: <b>Copy</b> }, "CopyButton takes no children; its label is label", '<CopyButton value={text} label="Copy" />'],
    ["timeout", { timeout: 1000 }, "timeout is not a prop; the confirmation shows for two seconds", '<CopyButton value={text} copiedLabel="Copied" />'],
    ["onClick", { onClick: () => {} }, "onClick is not a prop; CopyButton copies on click itself", "<CopyButton value={text} onCopy={(value) => {}} />"],
  ])("explains %s with the fix", async (_name, extra, problem, fix) => {
    const props = { value: "x", ...extra } as unknown as Parameters<typeof CopyButton>[0];
    const { button } = await render(<CopyButton {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] CopyButton: ${problem}. Fix: ${fix}.`);
    for (const name of ["text", "content", "timeout"]) expect(button.hasAttribute(name)).toBe(false);
  });

  it("renders the defaults for an unknown variant and size", async () => {
    const props = { value: "x", variant: "ghost", size: "icon" } as unknown as Parameters<typeof CopyButton>[0];
    const { button } = await render(<CopyButton {...props} />);
    const { button: outline } = await render(<CopyButton value="x" />);
    expect(button.className).toBe(outline.className);
  });

  it.each([
    ["bg-primary", 'remove "bg-primary"; use variant="plain" or size="md"'],
    ["ms-auto", ""],
  ])("checks the className %s", async (className, fix) => {
    await render(<CopyButton value="x" className={className} />);
    if (fix) expect(warn).toHaveBeenCalledWith(`[ouro-ui] CopyButton: "${className}" sets appearance, and className is for layout only. Fix: ${fix}.`);
    else expect(warn).not.toHaveBeenCalled();
  });

  it("renders to a string", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(<CopyButton value="x" hideLabel />);
    expect(html).toContain('data-ouro="copy-button"');
    expect(html).toContain('aria-label="Copy"');
    expect(error).not.toHaveBeenCalled();
  });
});
