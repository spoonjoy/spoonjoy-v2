import { type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, server, userEvent } from "vitest/browser";
import { CodeBlock } from "~/components/ouro/code-block/code-block";
import { parseAnsi, type AnsiStyle } from "~/components/ouro/code-block/code-block-styles";
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
    const rule = block.querySelector<HTMLElement>('[data-slot="rule"]')!;
    expect(getComputedStyle(rule).borderTopColor).toBe(probe("borderColor", "var(--border)"));
    // The code's own top border stays, transparent, so the code keeps its place under the rule.
    expect(getComputedStyle(pre).borderTopWidth).toBe("1px");
    expect(getComputedStyle(pre).borderTopColor).toBe(probe("borderColor", "transparent"));
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

  it("does not clip its frame: under a bar, the code area rounds its bottom corners to the frame's radius less its border", async () => {
    const { block, pre } = await render(<CodeBlock language="bash" code={long} />);
    const outer = parseFloat(getComputedStyle(block).borderBottomLeftRadius);
    expect(outer).toBeGreaterThan(1);
    expect(getComputedStyle(block).overflow).toBe("visible");
    expect(parseFloat(getComputedStyle(pre).borderBottomLeftRadius)).toBeCloseTo(outer - 1, 2);
    expect(parseFloat(getComputedStyle(pre).borderBottomRightRadius)).toBeCloseTo(outer - 1, 2);
    expect(getComputedStyle(pre).borderTopLeftRadius).toBe("0px");
    // The code area is the scroller, so it stays a clipping box for its own long lines.
    expect(getComputedStyle(pre).overflowX).toBe("auto");
  });

  it("without a bar, the code area rounds all four corners to the frame's radius less its border", async () => {
    const { block, pre } = await render(<CodeBlock code={long} copy={false} />);
    const outer = parseFloat(getComputedStyle(block).borderTopLeftRadius);
    expect(getComputedStyle(block).overflow).toBe("visible");
    expect(parseFloat(getComputedStyle(pre).borderTopLeftRadius)).toBeCloseTo(outer - 1, 2);
    expect(parseFloat(getComputedStyle(pre).borderBottomRightRadius)).toBeCloseTo(outer - 1, 2);
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

  it("scrolls sideways where a long line goes on, with its focus ring on the block", async () => {
    const { block, pre } = await render(
      <div style={{ width: 320 }}>
        <CodeBlock code={long} language="ts" />
      </div>,
    );
    await expect.poll(() => pre.hasAttribute("tabindex")).toBe(true);
    expect(getComputedStyle(pre).maskImage).toBe("none");
    expect(getComputedStyle(block).outlineStyle).toBe("none");
    await pressTab();
    await pressTab();
    expect(document.activeElement).toBe(pre);
    expect(getComputedStyle(pre).outlineStyle).toBe("none");
    expect(getComputedStyle(block).outlineStyle).toBe("solid");
    expect(getComputedStyle(block).outlineWidth).toBe("2px");
    // WebKit under Playwright scrolls a focused box with no arrow key, so it scrolls by script there.
    if (server.browser === "chromium") await userEvent.keyboard("{ArrowRight}");
    else pre.scrollLeft = 40;
    await expect.poll(() => pre.scrollLeft).toBeGreaterThan(0);
    // Short code and wrapped code fit.
    for (const node of [<CodeBlock key="short" code="short" />, <CodeBlock key="wrap" code={long} wrap />]) {
      const { pre: plain } = await render(<div style={{ width: 320 }}>{node}</div>);
      await act(async () => new Promise(requestAnimationFrame));
      expect(plain.scrollWidth).toBeLessThanOrEqual(plain.clientWidth);
    }
  });

  it("draws the hairline under its bar from border to border, when a line overflows", async () => {
    const { block, pre } = await render(
      <div style={{ width: 320 }}>
        <CodeBlock code={long} language="ts" />
      </div>,
    );
    await expect.poll(() => pre.scrollWidth > pre.clientWidth).toBe(true);
    const rule = block.querySelector<HTMLElement>('[data-slot="rule"]')!;
    expect(pre.contains(rule)).toBe(false);
    expect(getComputedStyle(rule).maskImage).toBe("none");
    const figure = block.getBoundingClientRect();
    const style = getComputedStyle(block);
    const box = rule.getBoundingClientRect();
    const near = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.5);
    near(box.left, figure.left + parseFloat(style.borderLeftWidth));
    near(box.right, figure.right - parseFloat(style.borderRightWidth));
    near(box.top, pre.getBoundingClientRect().top);
    near(box.height, 1);
  });

  it("draws no hairline without a bar", async () => {
    const { block } = await render(<CodeBlock code="ok" copy={false} />);
    expect(block.querySelector('[data-slot="rule"]')).toBeNull();
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
    await expect.poll(() => [...host.querySelectorAll("pre")].filter((pre) => pre.scrollWidth > pre.clientWidth).length).toBe(35);
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
    ["escape codes outside ansi", { code: "\x1b[2mthinking\x1b[0m", language: "text" }, "the code holds terminal escape codes, which show as raw characters", '<CodeBlock language="ansi" code={output} />'],
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

describe("CodeBlock terminal output", () => {
  const esc = "\x1b";
  /** A CSS color as sRGB channels from 0 to 255, read back from a canvas pixel. */
  function rgb(color: string): [number, number, number] {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return [r!, g!, b!];
  }
  function luminance(color: string): number {
    const [r, g, b] = rgb(color).map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  }
  function contrast(a: string, b: string): number {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light! + 0.05) / (dark! + 0.05);
  }
  const span = (host: HTMLElement, text: string) => [...host.querySelectorAll<HTMLElement>("[data-ouro-ansi]")].find((element) => element.textContent === text)!;

  it("styles bold, dim, italic, underline, strikethrough and the basic and bright colors from SGR codes, and drops the codes", async () => {
    const code =
      `${esc}[;1mbold${esc}[22m plain ${esc}[2mdim${esc}[0m ${esc}[3mitalic${esc}[23m ${esc}[4munder${esc}[24m ${esc}[9mstruck${esc}[29m ` +
      `${esc}[31mred${esc}[39m ${esc}[91mbright${esc}[0m ${esc}[1;32mboldgreen${esc}[m ${esc}[38;5;2mtable${esc}[0m ` +
      `${esc}[38;5;200mfar${esc}[0m ${esc}[38;2;255;0;0mtrue${esc}[0m ${esc}[42;48;5;1;48;2;1;2;3;38;7mback${esc}[0m ${esc}[K${esc}]8;;https://example.com${esc}\\link${esc}]8;;${esc}\\ ${esc}=${esc}(Bend${esc}P1$r${esc}\\${esc}`;
    const { host, pre, block } = await render(<CodeBlock language="ansi" code={code} />);
    const text = "bold plain dim italic under struck red bright boldgreen table far true back link end";
    expect(pre.querySelector("code")!.textContent).toBe(text);
    expect(block.getAttribute("data-language")).toBe("ansi");
    const foreground = getComputedStyle(pre).color;
    const style = (name: string) => getComputedStyle(span(host, name));
    expect(style("bold").fontWeight).toBe("700");
    expect(style("dim").color).not.toBe(foreground);
    expect(style("italic").fontStyle).toBe("italic");
    expect(style("under").textDecorationLine).toBe("underline");
    expect(style("struck").textDecorationLine).toBe("line-through");
    expect(style("red").color).not.toBe(foreground);
    expect(style("bright").color).not.toBe(style("red").color);
    expect(style("boldgreen").fontWeight).toBe("700");
    // 38;5 with one of the table's first 16 is that basic color; any other keeps the theme's own.
    expect(style("table").color).toBe(style("boldgreen").color);
    // Plain text and the colors that keep the theme's own are no span at all.
    expect([...host.querySelectorAll("[data-ouro-ansi]")].map((element) => element.textContent)).toEqual(["bold", "dim", "italic", "under", "struck", "red", "bright", "boldgreen", "table"]);
  });

  it("keeps every color and dim at 4.5:1 on the block in light and dark, with dim text muted beside the rest", async () => {
    const colors = [...Array.from({ length: 8 }, (_, index) => 30 + index), ...Array.from({ length: 8 }, (_, index) => 90 + index)];
    const code = ["plain", `${esc}[2mdim${esc}[0m`, ...colors.flatMap((color) => [`${esc}[${color}mc${color}${esc}[0m`, `${esc}[2;${color}md${color}${esc}[0m`])].join("\n");
    const { host, pre, block } = await render(<CodeBlock language="ansi" code={code} />);
    const root = document.documentElement;
    // Ouro's light and dark, and a dark theme whose muted text is nearly as bright as its plain text (Spoonjoy's:
    // plain at 11.3:1, muted at 7.3:1), where dim is still the theme's muted text and so still below plain.
    const bright = { "--foreground": "#f2eee6", "--muted-foreground": "#c8c0b4", "--muted": "#34302b" };
    const schemes = [
      { name: "light", dark: false, tokens: {} },
      { name: "dark", dark: true, tokens: {} },
      { name: "bright dark", dark: true, tokens: bright },
    ];
    try {
      for (const scheme of schemes) {
        root.classList.toggle("dark", scheme.dark);
        for (const [token, value] of Object.entries(scheme.tokens)) root.style.setProperty(token, value);
        const surface = getComputedStyle(block).backgroundColor;
        const plain = contrast(getComputedStyle(pre).color, surface);
        const mutedText = block.appendChild(document.createElement("span"));
        mutedText.style.color = "var(--muted-foreground)";
        const muted = contrast(getComputedStyle(mutedText).color, surface);
        mutedText.remove();
        const dim = contrast(getComputedStyle(span(host, "dim")).color, surface);
        expect(dim, `${scheme.name} dim`).toBeGreaterThanOrEqual(4.5);
        // Muted as the theme mutes text: no brighter than its muted text nudged toward plain, and below plain.
        expect(dim, `${scheme.name} dim beside plain at ${plain.toFixed(2)}:1`).toBeLessThan(plain);
        expect(dim, `${scheme.name} dim beside muted text at ${muted.toFixed(2)}:1`).toBeGreaterThanOrEqual(muted);
        for (const color of colors) {
          for (const name of [`c${color}`, `d${color}`]) {
            expect(contrast(getComputedStyle(span(host, name)).color, surface), `${scheme.name} ${name}`).toBeGreaterThanOrEqual(4.5);
          }
        }
        for (const token of Object.keys(scheme.tokens)) root.style.removeProperty(token);
      }
    } finally {
      root.classList.remove("dark");
      for (const token of Object.keys(bright)) root.style.removeProperty(token);
    }
  });

  it("copies the output without its escape codes", async () => {
    // As in the copy test above: the page's timers stand still, so Copied cannot end before the check.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await render(<CodeBlock language="ansi" code={`${esc}[2mthinking${esc}[0m\n${esc}[1;97mreply${esc}[0m${esc}[K`} />);
      await userEvent.click(page.getByRole("button", { name: "Copy code" }));
      const deadline = performance.now() + 5000;
      while (clipboard.length === 0 && performance.now() < deadline) await new Promise((resolve) => requestAnimationFrame(resolve));
      expect(clipboard).toEqual(["thinking\nreply"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders the styled output to a string, with no escape codes in it", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(<CodeBlock language="ansi" code={`${esc}[2mthinking${esc}[0m reply`} />);
    expect(html).not.toContain(esc);
    expect(html).toMatch(/<span data-ouro-ansi="" class="[^"]*muted-foreground[^"]*">thinking<\/span> reply/);
    expect(error).not.toHaveBeenCalled();
  });

  it("reads colon sub-parameters as tmux writes them, and draws underline and strikethrough together", async () => {
    const code =
      `${esc}[4:3mcurly${esc}[4:0m after ${esc}[38:5:1mtable${esc}[0m ${esc}[38:2::10:20:1mtrue${esc}[0m ${esc}[38;5mbare${esc}[0m ` +
      `${esc}[58;2;0;1;2mline${esc}[0m ${esc}[48:5:4;5:3mskip${esc}[0m ${esc}[4;9mboth${esc}[0m ${esc}[31mred${esc}[0m`;
    const { host, pre } = await render(<CodeBlock language="ansi" code={code} />);
    expect(pre.querySelector("code")!.textContent).toBe("curly after table true bare line skip both red");
    const style = (name: string) => getComputedStyle(span(host, name));
    expect(style("curly").textDecorationLine).toBe("underline");
    expect(style("curly").fontStyle).toBe("normal");
    expect(style("table").color).toBe(style("red").color);
    // Only the styled runs are spans: 4:0, 38:2, 58 and the colon background leave the rest plain.
    expect([...host.querySelectorAll("[data-ouro-ansi]")].map((element) => element.textContent)).toEqual(["curly", "table", "both", "red"]);
    expect(style("both").textDecorationLine).toBe("underline line-through");
  });

  it("gives a run with no color of its own no color class, and an ansi block holding escape codes no development message", async () => {
    const { host } = await render(<CodeBlock language="ansi" code={`${esc}[1mbold${esc}[0m ${esc}[3mitalic${esc}[0m`} />);
    expect(span(host, "bold").className).toBe("font-bold");
    expect(span(host, "italic").className).toBe("italic");
    expect(warn).not.toHaveBeenCalled();
  });

  it("draws a dim color apart from both the color and plain dim text", async () => {
    const { host } = await render(<CodeBlock language="ansi" code={`${esc}[31mred${esc}[0m ${esc}[2;31mdimred${esc}[0m ${esc}[2mdim${esc}[0m`} />);
    const color = (name: string) => getComputedStyle(span(host, name)).color;
    expect(new Set([color("red"), color("dimred"), color("dim")]).size).toBe(3);
  });

  it("draws a catalogue's emoji inside styled output", async () => {
    const catalogue: EmojiCatalogue = {
      categories: [{ id: "symbols", label: "Symbols", items: [{ id: "rocket", name: "Rocket", text: "🚀", src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E" }] }],
    };
    const { host, pre } = await render(<CodeBlock language="ansi" catalogue={catalogue} code={`${esc}[32mshipped 🚀${esc}[0m and 🚀`} />);
    expect(pre.querySelector("code")!.textContent).toBe("shipped 🚀 and 🚀");
    expect(span(host, "shipped 🚀").querySelector("[data-ouro-code-emoji]")).not.toBeNull();
    expect(host.querySelectorAll("[data-ouro-code-emoji]")).toHaveLength(2);
  });

  it("leaves code in any other language as given, escape codes and all", async () => {
    const code = `${esc}[2mthinking${esc}[0m`;
    const { pre, host } = await render(<CodeBlock language="text" code={code} />);
    expect(pre.querySelector("code")!.textContent).toBe(code);
    expect(host.querySelector("[data-ouro-ansi]")).toBeNull();
  });
});

describe("parseAnsi", () => {
  const esc = "\x1b";
  const plain: AnsiStyle = { bold: false, dim: false, italic: false, underline: false, strike: false, color: null };
  const run = (text: string, style: Partial<AnsiStyle> | null = null) => ({ text, style: style && { ...plain, ...style } });

  it("maps each basic and bright color code to its color, and 39 back to none", () => {
    const code = Array.from({ length: 8 }, (_, index) => `${esc}[${30 + index}m${index}${esc}[${90 + index}m${index + 8}`).join("") + `${esc}[39mend`;
    expect(parseAnsi(code)).toEqual([...Array.from({ length: 8 }, (_, index) => [run(String(index), { color: index }), run(String(index + 8), { color: index + 8 })]).flat(), run("end")]);
    expect(parseAnsi(`${esc}[97mwhite`)).toEqual([run("white", { color: 15 })]);
  });

  it("joins text of one style across codes into one run, and leaves no empty run", () => {
    expect(parseAnsi(`${esc}[1ma${esc}[1mb${esc}[0m${esc}[0mc${esc}[K`)).toEqual([run("ab", { bold: true }), run("c")]);
    expect(parseAnsi(`${esc}[mx`)).toEqual([run("x")]);
  });

  it("turns each attribute on and off, and 22 clears bold and dim together", () => {
    expect(parseAnsi(`${esc}[1;2;3;4;9ma${esc}[22mb${esc}[23mc${esc}[24md${esc}[29me`)).toEqual([
      run("a", { bold: true, dim: true, italic: true, underline: true, strike: true }),
      run("b", { italic: true, underline: true, strike: true }),
      run("c", { underline: true, strike: true }),
      run("d", { strike: true }),
      run("e"),
    ]);
  });

  it("reads an extended color's parameters and skips them, keeping only a foreground from the table's first 16", () => {
    expect(parseAnsi(`${esc}[38;5;15ma${esc}[38;5;16mb${esc}[48;5;1mc${esc}[38;7;3md${esc}[0;38;2;1;2;3;4me${esc}[0;5;9mf`)).toEqual([
      run("a", { color: 15 }),
      run("bc"),
      run("d", { italic: true }),
      run("e", { underline: true }),
      run("f", { strike: true }),
    ]);
    expect(parseAnsi(`${esc}[48:5:1ma${esc}[38:5:3mb${esc}[38:5mc`)).toEqual([run("a"), run("b", { color: 3 }), run("c")]);
  });

  it("ignores the codes it does not draw: blink, backgrounds and the rest", () => {
    expect(parseAnsi(`${esc}[5ma${esc}[42mb${esc}[49;100;7;8mc`)).toEqual([run("abc")]);
  });

  it("styles only from SGR, dropping every other sequence whole", () => {
    expect(parseAnsi(`${esc}[2Ka${esc}[1 mb${esc}]0;a window title${esc}\\c${esc}]8;;https://example.com${esc}[1md`)).toEqual([run("abc")]);
  });
});
