import { type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Kbd } from "~/components/ouro/kbd/kbd";
import { act } from "~/lib/ouro/testing/act";

const roots: Root[] = [];
let mounted: Element[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return {
    host,
    get kbd() {
      return host.querySelector<HTMLElement>('[data-ouro="kbd"]')!;
    },
  };
}

/** Pretends the browser runs on `platform`, through both the modern and the legacy API. */
function onPlatform(platform: "macOS" | "iOS" | "Windows" | "Linux" | "Chrome OS", legacy = true) {
  const legacyName = { macOS: "MacIntel", iOS: "iPhone", Windows: "Win32", Linux: "Linux x86_64", "Chrome OS": "Linux x86_64" }[platform];
  Object.defineProperty(navigator, "userAgentData", { configurable: true, value: legacy ? undefined : { platform } });
  Object.defineProperty(navigator, "platform", { configurable: true, value: legacyName });
}

/** The visible text: glyphs and separators, without the screen-reader names. */
function visible(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll(".sr-only").forEach((node) => node.remove());
  return clone.textContent!;
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
  // Back to the browser's own values.
  delete (navigator as { userAgentData?: unknown }).userAgentData;
  delete (navigator as { platform?: unknown }).platform;
});

describe("Kbd", () => {
  it.each([
    ["macOS", true],
    ["macOS", false],
    ["iOS", true],
  ] as const)("shows Apple glyphs on %s (legacy API: %s)", async (platform, legacy) => {
    onPlatform(platform, legacy);
    const { kbd } = await render(<Kbd keys={["mod", "shift", "k"]} />);
    expect(kbd.tagName).toBe("KBD");
    expect(kbd.getAttribute("data-platform")).toBe("apple");
    expect(visible(kbd)).toBe("⇧⌘K");
    expect(kbd.querySelectorAll(":scope > kbd")).toHaveLength(3);
  });

  it.each([
    ["Windows", true],
    ["Linux", false],
  ] as const)("shows key names joined by + on %s (legacy API: %s)", async (platform, legacy) => {
    onPlatform(platform, legacy);
    const { kbd } = await render(<Kbd keys={["mod", "shift", "k"]} />);
    expect(kbd.getAttribute("data-platform")).toBe("other");
    expect(visible(kbd)).toBe("Ctrl+Shift+K");
  });

  it("names Apple glyphs for screen readers", async () => {
    onPlatform("macOS");
    const { kbd } = await render(<Kbd keys={["mod", "alt", "ctrl", "enter"]} />);
    expect(kbd.textContent).toBe("⌃Control⌥Option⌘Command↩Return");
    for (const glyph of kbd.querySelectorAll("[data-glyph]")) expect(glyph.getAttribute("aria-hidden")).toBe("true");
  });

  it.each([
    [["mod"], "⌘", "Ctrl"],
    [["cmd"], "⌘", "Win"],
    [["meta"], "⌘", "Win"],
    [["command"], "⌘", "Win"],
    [["ctrl", "k"], "⌃K", "Ctrl+K"],
    [["ctrl"], "⌃", "Ctrl"],
    [["control"], "⌃", "Ctrl"],
    [["alt"], "⌥", "Alt"],
    [["option"], "⌥", "Alt"],
    [["shift"], "⇧", "Shift"],
    [["enter"], "↩", "Enter"],
    [["return"], "↩", "Enter"],
    [["escape"], "Esc", "Esc"],
    [["esc"], "Esc", "Esc"],
    [["tab"], "⇥", "Tab"],
    [["backspace"], "⌫", "Backspace"],
    [["delete"], "⌦", "Del"],
    [["space"], "Space", "Space"],
    [["up"], "↑", "↑"],
    [["ArrowDown"], "↓", "↓"],
    [["left"], "←", "←"],
    [["right"], "→", "→"],
    [["k"], "K", "K"],
    [["/"], "/", "/"],
    [["F5"], "F5", "F5"],
    [["PageUp"], "PageUp", "PageUp"],
  ])("renders %j as %s on Apple and %s elsewhere", async (keys, apple, other) => {
    onPlatform("macOS");
    const mac = await render(<Kbd keys={keys} />);
    expect(visible(mac.kbd)).toBe(apple);
    onPlatform("Windows");
    const windows = await render(<Kbd keys={keys} />);
    expect(visible(windows.kbd)).toBe(other);
  });

  it.each([
    ["Linux", false],
    ["Linux", true],
    ["Chrome OS", false],
  ] as const)("shows cmd as Ctrl on %s (legacy API: %s), where there is no Windows key", async (platform, legacy) => {
    onPlatform(platform, legacy);
    const { kbd } = await render(<Kbd keys={["cmd", "k"]} />);
    expect(visible(kbd)).toBe("Ctrl+K");
  });

  it("puts Apple modifiers in Apple's order, Control, Option, Shift, Command, before the key", async () => {
    onPlatform("macOS");
    const { kbd } = await render(<Kbd keys={["k", "mod", "shift", "alt", "ctrl"]} />);
    expect(visible(kbd)).toBe("⌃⌥⇧⌘K");
  });

  it("puts other modifiers in Win, Ctrl, Alt, Shift order, before the key", async () => {
    onPlatform("Windows");
    const { kbd } = await render(<Kbd keys={["k", "shift", "alt", "mod", "cmd"]} />);
    expect(visible(kbd)).toBe("Win+Ctrl+Alt+Shift+K");
  });

  it("renders the neutral form on the server and corrects it after hydration without a warning", async () => {
    onPlatform("macOS");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const node = <Kbd keys={["mod", "k"]} />;
    const html = renderToString(node);
    expect(html).toContain('data-platform="unknown"');
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    mounted.push(host);
    const kbd = host.querySelector('[data-ouro="kbd"]')!;
    expect(visible(kbd)).toBe("Ctrl+K");
    const recoverable = vi.fn();
    let root!: Root;
    await act(async () => {
      root = hydrateRoot(host, node, { onRecoverableError: recoverable });
    });
    roots.push(root);
    expect(host.querySelector('[data-ouro="kbd"]')).toBe(kbd);
    expect(kbd.getAttribute("data-platform")).toBe("apple");
    expect(visible(kbd)).toBe("⌘K");
    expect(recoverable).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("sits in running text at the text's size", async () => {
    const { kbd } = await render(
      <p style={{ fontSize: 20 }}>
        Press <Kbd keys={["mod", "k"]} /> to search
      </p>,
    );
    expect(getComputedStyle(kbd).display).toBe("inline-flex");
    expect(parseFloat(getComputedStyle(kbd).fontSize)).toBeLessThan(20);
    expect(parseFloat(getComputedStyle(kbd).fontSize)).toBeGreaterThan(14);
  });

  it("forwards a ref and lets app layout classes win", async () => {
    let element: HTMLElement | null = null;
    const { kbd } = await render(<Kbd keys={["k"]} className="ms-2" ref={(node) => void (element = node)} />);
    expect(element).toBe(kbd);
    expect(getComputedStyle(kbd).marginInlineStart).toBe("8px");
  });
});

describe("Kbd development messages", () => {
  it.each([
    ["a string of keys", { keys: "mod+k" }, 'keys="mod+k" is a string; keys takes an array', '<Kbd keys={["mod", "k"]} />'],
    ["children", { keys: undefined, children: "⌘K" }, "Kbd takes keys, not children", '<Kbd keys={["mod", "k"]} />'],
    ["no keys", { keys: [] }, "keys is empty", '<Kbd keys={["mod", "k"]} />'],
    ["a shortcut prop", { keys: ["k"], shortcut: "mod+k" }, "shortcut is not a prop", '<Kbd keys={["mod", "k"]} />'],
  ])("warns for %s with the fix", async (_name, extra, problem, fix) => {
    onPlatform("Windows");
    const props = { ...extra } as unknown as Parameters<typeof Kbd>[0];
    const { kbd } = await render(<Kbd {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] Kbd: ${problem}. Fix: ${fix}.`);
    expect(kbd.hasAttribute("shortcut")).toBe(false);
  });

  it("splits a string of keys on +", async () => {
    onPlatform("Windows");
    const props = { keys: "mod+k" } as unknown as Parameters<typeof Kbd>[0];
    const { kbd } = await render(<Kbd {...props} />);
    expect(visible(kbd)).toBe("Ctrl+K");
  });

  it("ignores children", async () => {
    onPlatform("Windows");
    const props = { children: "⌘K" } as unknown as Parameters<typeof Kbd>[0];
    const { kbd } = await render(<Kbd {...props} />);
    expect(kbd.textContent).toBe("");
  });

  it.each([
    ["bg-muted", 'remove "bg-muted"; Kbd matches the theme'],
    ["text-xs", 'remove "text-xs"; Kbd sizes itself to the surrounding text'],
    ["ms-1", ""],
  ])("checks the className %s", async (className, fix) => {
    await render(<Kbd keys={["k"]} className={className} />);
    if (fix) {
      expect(warn).toHaveBeenCalledWith(`[ouro-ui] Kbd: "${className}" sets appearance, and className is for layout only. Fix: ${fix}.`);
    } else {
      expect(warn).not.toHaveBeenCalled();
    }
  });

  it("renders to a string without warnings", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(<Kbd keys={["mod", "k"]} className="bg-muted" />);
    expect(html).toContain('data-ouro="kbd"');
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
