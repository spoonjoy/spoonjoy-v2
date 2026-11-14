import { type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, server, userEvent } from "vitest/browser";
import { CodeBlock } from "~/components/ouro/code-block/code-block";
import type { EmojiCatalogue } from "~/components/ouro/emoji/emoji";
import { act } from "~/lib/ouro/testing/act";
import { audit, describeFindings } from "~/lib/ouro/testing/axe";
import { pressTab } from "~/lib/ouro/testing/tab";

const roots: Root[] = [];
let mounted: Element[] = [];
let clipboard: string[] = [];

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
    get block() {
      return host.querySelector<HTMLElement>('[data-ouro="code-block"]')!;
    },
    get caption() {
      return host.querySelector<HTMLElement>('[data-slot="caption"]');
    },
    get pre() {
      return host.querySelector<HTMLPreElement>('[data-ouro-part="code"]')!;
    },
  };
}

function probe(property: "color" | "backgroundColor" | "borderColor", value: string) {
  const element = document.createElement("span");
  element.style[property] = value;
  document.body.append(element);
  mounted.push(element);
  return getComputedStyle(element)[property];
}

const long = `const message = "${"a long line of code that runs past the edge of the block ".repeat(6)}";`;

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  clipboard = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    get: () => ({ writeText: (text: string) => (clipboard.push(text), Promise.resolve()) }),
  });
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  delete (navigator as { clipboard?: unknown }).clipboard;
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
});

describe("CodeBlock", () => {
  it("shows the code as given on the muted surface in the monospace font, under a caption naming its language", async () => {
    const code = "npm install\n  --save-dev vitest";
    const { block, caption, pre } = await render(<CodeBlock language="bash" code={code} />);
    expect(block.tagName).toBe("FIGURE");
    expect(block.getAttribute("data-language")).toBe("bash");
    expect(pre.querySelector("code")!.textContent).toBe(code);
    expect(caption!.tagName).toBe("FIGCAPTION");
    expect(caption!.textContent).toBe("bash");
    const style = getComputedStyle(block);
    expect(style.backgroundColor).toBe(probe("backgroundColor", "var(--muted)"));
    expect(style.borderTopColor).toBe(probe("borderColor", "var(--border)"));
    expect(getComputedStyle(pre).color).toBe(probe("color", "var(--foreground)"));
    expect(getComputedStyle(pre).whiteSpace).toBe("pre");
    const mono = document.createElement("span");
    mono.className = "font-mono";
    document.body.append(mono);
    mounted.push(mono);
    expect(getComputedStyle(pre.querySelector("code")!).fontFamily).toBe(getComputedStyle(mono).fontFamily);
    await expect.element(page.getByRole("figure")).toBeVisible();
  });

  it("captions with the title rather than the language", async () => {
    const { caption, block } = await render(<CodeBlock title="vite.config.ts" language="ts" code="export default {};" />);
    expect(caption!.textContent).toBe("vite.config.ts");
    expect(block.getAttribute("data-language")).toBe("ts");
  });

  it("is a figure named by its caption alone, never by its copy button", async () => {
    const { host } = await render(
      <>
        <CodeBlock title="vite.config.ts" code="export default {};" />
        <CodeBlock language="bash" code="npm test" />
        <CodeBlock code="ok" />
      </>,
    );
    const figures = page.getByRole("figure");
    await expect.element(figures.nth(0)).toHaveAccessibleName("vite.config.ts");
    await expect.element(figures.nth(1)).toHaveAccessibleName("bash");
    await expect.element(figures.nth(2)).toHaveAccessibleName("");
    for (const caption of host.querySelectorAll("figcaption")) expect(caption.querySelector("button")).toBeNull();
    // The figure's own name stands when the app gives one.
    await act(async () => roots.at(-1)!.render(<CodeBlock title="vite.config.ts" code="x" aria-label="Vite config" />));
    await expect.element(page.getByRole("figure")).toHaveAccessibleName("Vite config");
  });

  it("has no caption when it has no title, no language and no copy button", async () => {
    const { caption, block } = await render(<CodeBlock code="ok" copy={false} />);
    expect(caption).toBeNull();
    expect(block.hasAttribute("data-language")).toBe(false);
  });

  it("shows the copy button in the bar above the code without a caption, and no copy button with copy={false}", async () => {
    const { host } = await render(
      <>
        <CodeBlock code="a" />
        <CodeBlock code="b" language="txt" copy={false} />
      </>,
    );
    const [first, second] = host.querySelectorAll('[data-ouro="code-block"]');
    expect(first!.querySelector("figcaption")).toBeNull();
    const button = first!.querySelector("button")!.getBoundingClientRect();
    const code = first!.querySelector("pre")!.getBoundingClientRect();
    expect(button.bottom).toBeLessThanOrEqual(code.top);
    expect(code.top - first!.getBoundingClientRect().top).toBeGreaterThanOrEqual(44);
    expect(second!.querySelector("figcaption")!.textContent).toBe("txt");
    expect(first!.querySelector('[data-ouro-control="code-block"][data-ouro-part="copy"]')).not.toBeNull();
    expect(second!.querySelector("button")).toBeNull();
  });

  it("copies the code exactly with its copy button", async () => {
    // The page's timers stand still, so the two-second Copied cannot end before the check on a
    // loaded runner; the wait is on real frames, since expect.poll would move the timers on.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const code = "line one\n\tline two  ";
      await render(<CodeBlock code={code} copyLabel="Copy the command" />);
      const button = page.getByRole("button", { name: "Copy the command" });
      await userEvent.click(button);
      // The button is CodeBlock's own control, marked as its copy part rather than a CopyButton's trigger.
      const copied = document.querySelector("button")!;
      const deadline = performance.now() + 5000;
      while (copied.getAttribute("aria-label") !== "Copied" && performance.now() < deadline) await new Promise((resolve) => requestAnimationFrame(resolve));
      expect(copied.getAttribute("aria-label")).toBe("Copied");
      expect(clipboard).toEqual([code]);
      expect(copied.getAttribute("data-ouro-control")).toBe("code-block");
      expect(copied.getAttribute("data-ouro-part")).toBe("copy");
    } finally {
      vi.useRealTimers();
    }
  });

  it("scrolls a long line sideways and becomes a tab stop only while it overflows", async () => {
    const { root, pre } = await render(
      <div style={{ width: 320 }}>
        <CodeBlock code="short" />
      </div>,
    );
    expect(pre.hasAttribute("tabindex")).toBe(false);
    await act(async () =>
      root.render(
        <div style={{ width: 320 }}>
          <CodeBlock code={long} />
        </div>,
      ),
    );
    await expect.poll(() => pre.getAttribute("tabindex")).toBe("0");
    expect(pre.scrollWidth).toBeGreaterThan(pre.clientWidth);
    pre.focus();
    expect(document.activeElement).toBe(pre);
    // The focused block keeps its tab stop when it stops overflowing, so focus stays where it is.
    await act(async () =>
      root.render(
        <div style={{ width: 320 }}>
          <CodeBlock code="short" />
        </div>,
      ),
    );
    await act(async () => new Promise(requestAnimationFrame));
    expect(pre.getAttribute("tabindex")).toBe("0");
    // Once focus leaves, the tab stop goes without waiting for a resize.
    pre.blur();
    await act(async () => new Promise(requestAnimationFrame));
    expect(pre.hasAttribute("tabindex")).toBe(false);
  });

  it("fades out at the side where a long line goes on, with its focus ring outside the fade", async () => {
    const { block, pre } = await render(
      <div style={{ width: 320 }}>
        <CodeBlock code={long} language="ts" />
      </div>,
    );
    await expect.poll(() => pre.hasAttribute("data-ouro-scroll-fade")).toBe(true);
    expect(getComputedStyle(pre).maskImage).toContain("linear-gradient");
    expect(pre.style.getPropertyValue("--ouro-scroll-fade-left")).toBe("0px");
    // The ring is the block's own outline, outside the box the fade masks.
    expect(getComputedStyle(block).maskImage).toBe("none");
    expect(getComputedStyle(block).outlineStyle).toBe("none");
    await pressTab();
    await pressTab();
    expect(document.activeElement).toBe(pre);
    expect(getComputedStyle(pre).outlineStyle).toBe("none");
    expect(getComputedStyle(block).outlineStyle).toBe("solid");
    expect(getComputedStyle(block).outlineWidth).toBe("2px");
    // WebKit under Playwright scrolls a focused box with no arrow key, masked or not, so it scrolls by script there.
    if (server.browser === "chromium") await userEvent.keyboard("{ArrowRight}");
    else pre.scrollLeft = 40;
    await expect.poll(() => pre.style.getPropertyValue("--ouro-scroll-fade-left")).not.toBe("0px");
    // Short code and wrapped code don't fade.
    for (const node of [<CodeBlock key="short" code="short" />, <CodeBlock key="wrap" code={long} wrap />]) {
      const { pre: plain } = await render(<div style={{ width: 320 }}>{node}</div>);
      await act(async () => new Promise(requestAnimationFrame));
      expect(plain.hasAttribute("data-ouro-scroll-fade")).toBe(false);
      expect(getComputedStyle(plain).maskImage).toBe("none");
    }
  });

  it("audits a page of many overflowing code blocks without screenshotting their code, within a time budget", async () => {
    const { host } = await render(
      <div>
        {Array.from({ length: 35 }, (_, index) => (
          <div key={index} style={{ width: 320, marginBottom: 12 }}>
            <CodeBlock code={`// ${index}\n${long}`} language="ts" />
          </div>
        ))}
      </div>,
    );
    await expect.poll(() => host.querySelectorAll("[data-ouro-scroll-fade]").length).toBe(35);
    const screenshot = vi.spyOn(page, "screenshot");
    try {
      const started = performance.now();
      const findings = await audit({ include: [host] });
      expect(describeFindings(findings)).toBe("");
      expect(screenshot).not.toHaveBeenCalled();
      expect(performance.now() - started).toBeLessThan(10_000);
    } finally {
      screenshot.mockRestore();
    }
  });

  it("stops listening for focus leaving when it unmounts", async () => {
    const { root, pre } = await render(<CodeBlock code="x" />);
    const removed = vi.spyOn(pre, "removeEventListener");
    await act(async () => root.unmount());
    expect(removed).toHaveBeenCalledWith("blur", expect.any(Function));
  });

  it("wraps long lines with wrap, so nothing scrolls sideways", async () => {
    const { pre } = await render(
      <div style={{ width: 320 }}>
        <CodeBlock code={long} wrap />
      </div>,
    );
    expect(getComputedStyle(pre).whiteSpace).toBe("pre-wrap");
    expect(pre.scrollWidth).toBeLessThanOrEqual(pre.clientWidth);
    expect(pre.hasAttribute("tabindex")).toBe(false);
  });

  it("scrolls tall code within a maximum height the app sets, as a tab stop", async () => {
    const { pre, block } = await render(<CodeBlock code={Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n")} className="max-h-40" />);
    expect(block.getBoundingClientRect().height).toBeLessThanOrEqual(160);
    await expect.poll(() => pre.getAttribute("tabindex")).toBe("0");
  });

  it("forwards a ref and passes attributes through, and its margin is the app's", async () => {
    let element: HTMLElement | null = null;
    const { block } = await render(
      <div className="space-y-4">
        <p>Run:</p>
        <CodeBlock code="x" id="install" ref={(node) => void (element = node)} />
        <p>Then:</p>
      </div>,
    );
    expect(element).toBe(block);
    expect(block.id).toBe("install");
    expect(getComputedStyle(block).marginBottom).toBe("16px");
    expect(getComputedStyle(block).marginInlineStart).toBe("0px");
  });
});

describe("CodeBlock development messages", () => {
  it.each([
    ["children", { children: "x" }, "CodeBlock takes its code as code, a string", "<CodeBlock code={source} />"],
    ["lang", { lang: "bash" }, "lang is not a prop", '<CodeBlock language="bash" />'],
    ["lang", { lang: 1 }, "lang is not a prop", '<CodeBlock language="tsx" />'],
    ["filename", { filename: "a.ts" }, "filename is not a prop", '<CodeBlock title="a.ts" />'],
    ["filename", { filename: true }, "filename is not a prop", '<CodeBlock title="app.tsx" />'],
    ["showCopyButton", { showCopyButton: true }, "showCopyButton is not a prop; the copy button shows by default", "<CodeBlock code={source} copy={false} />"],
  ])("explains %s with the fix", async (_name, extra, problem, fix) => {
    const props = { code: "x", ...extra } as unknown as Parameters<typeof CodeBlock>[0];
    const { block } = await render(<CodeBlock {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] CodeBlock: ${problem}. Fix: ${fix}.`);
    for (const name of ["lang", "filename", "showcopybutton"]) expect(block.hasAttribute(name)).toBe(false);
  });

  it.each([
    ["bg-black", 'remove "bg-black"; CodeBlock sets its own look from the theme'],
    ["max-h-80", ""],
  ])("checks the className %s", async (className, fix) => {
    await render(<CodeBlock code="x" className={className} />);
    if (fix) expect(warn).toHaveBeenCalledWith(`[ouro-ui] CodeBlock: "${className}" sets appearance, and className is for layout only. Fix: ${fix}.`);
    else expect(warn).not.toHaveBeenCalled();
  });

  it("renders to a string", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(<CodeBlock code="a < b" language="ts" />);
    expect(html).toContain('data-ouro="code-block"');
    expect(html).toContain("a &lt; b");
    expect(error).not.toHaveBeenCalled();
  });
});

describe("CodeBlock emoji", () => {
  /** A blank image whose address names it. */
  const image = (name: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><title>${name}</title></svg>`)}`;
  const catalogue: EmojiCatalogue = {
    categories: [
      {
        id: "symbols",
        label: "Symbols",
        items: [
          { id: "party", name: "Party popper", shortcodes: ["party"], text: "🎉", src: image("party"), animatedSrc: image("party moving") },
          { id: "rocket", name: "Rocket", text: "🚀", src: image("rocket") },
        ],
      },
    ],
  };
  const source = 'const cheer = "🎉 shipped";\n// :party: stays as typed 🚀\nlet next = "🚀🎉";';

  it("draws the catalogue's emoji as 1em pictures over the code's own characters, without moving a line", async () => {
    const { host } = await render(
      <>
        <CodeBlock code={source} copy={false} />
        <CodeBlock code={source} copy={false} catalogue={catalogue} />
        <CodeBlock code={source} copy={false} catalogue={catalogue} wrap className="w-48" />
        <CodeBlock code={source} copy={false} wrap className="w-48" />
      </>,
    );
    const [plain, drawn, drawnWrapped, plainWrapped] = [...host.querySelectorAll("code")];
    const size = (element: Element) => {
      const { width, height } = element.getBoundingClientRect();
      return [width, height];
    };
    expect(size(drawn!)).toEqual(size(plain!));
    expect(size(drawnWrapped!)).toEqual(size(plainWrapped!));
    const emoji = [...drawn!.querySelectorAll<HTMLElement>("[data-ouro-code-emoji]")];
    expect(emoji.map((element) => element.textContent)).toEqual(["🎉", "🚀", "🚀", "🎉"]);
    for (const element of emoji) {
      const characters = element.firstElementChild!;
      expect(getComputedStyle(characters).color).toBe("rgba(0, 0, 0, 0)");
      const picture = element.querySelector<HTMLImageElement>('[data-ouro="emoji"]')!;
      expect(picture.closest('[aria-hidden="true"]')).not.toBeNull();
      expect(picture.getBoundingClientRect().width).toBe(parseFloat(getComputedStyle(drawn!).fontSize));
      // Centered over the characters it stands for.
      const box = characters.getBoundingClientRect();
      const drawnBox = picture.getBoundingClientRect();
      expect(Math.abs(drawnBox.left + drawnBox.width / 2 - (box.left + box.width / 2))).toBeLessThan(1);
    }
    // Code stays still: an animated emoji shows its still picture.
    expect(emoji[0]!.querySelector("img")!.getAttribute("src")).toBe(image("party"));
  });

  it("copies and selects the code's own characters, and leaves shortcode text as it is", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { pre } = await render(<CodeBlock code={source} catalogue={catalogue} />);
      expect(pre.textContent).toBe(source);
      expect(pre.querySelectorAll("[data-ouro-code-emoji]")).toHaveLength(4);
      const range = document.createRange();
      range.selectNodeContents(pre);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      expect(selection.toString()).toBe(source);
      selection.removeAllRanges();
      await userEvent.click(page.getByRole("button", { name: "Copy code" }));
      expect(clipboard).toEqual([source]);
    } finally {
      vi.useRealTimers();
    }
  });
});
