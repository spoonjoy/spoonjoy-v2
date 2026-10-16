import { type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { ScrollArea } from "~/components/ouro/scroll-area/scroll-area";
import { act } from "~/lib/ouro/testing/act";

const roots: Root[] = [];
let mounted: Element[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  host.style.width = "300px";
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  const area = host.querySelector<HTMLElement>('[data-ouro="scroll-area"]')!;
  return { host, area, viewport: area.firstElementChild as HTMLElement };
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
});

const lines = Array.from({ length: 40 }, (_, index) => `Step ${index + 1}: stir.`);
const tall = (
  <div>
    {lines.map((line) => (
      <p key={line} style={{ margin: 0, height: 20, lineHeight: "20px" }}>
        {line}
      </p>
    ))}
  </div>
);
const wide = <div style={{ width: 900, height: 40 }}>A long row of tags</div>;

describe("ScrollArea", () => {
  it("scrolls its content inside the height the app gives it", async () => {
    const { area, viewport } = await render(<ScrollArea className="h-40">{tall}</ScrollArea>);
    expect(area.getBoundingClientRect().height).toBe(160);
    expect(viewport.clientHeight).toBe(160);
    expect(viewport.scrollHeight).toBe(800);
    viewport.scrollTop = 200;
    expect(viewport.scrollTop).toBe(200);
  });

  it("grows with its content up to a max height", async () => {
    const { area } = await render(<ScrollArea className="max-h-40">{tall}</ScrollArea>);
    expect(area.getBoundingClientRect().height).toBe(160);
    const { area: short } = await render(
      <ScrollArea className="max-h-40">
        <p style={{ margin: 0, height: 40 }}>Short</p>
      </ScrollArea>,
    );
    expect(short.getBoundingClientRect().height).toBe(40);
  });

  it("hides the native scrollbar and draws a vertical one when the content overflows", async () => {
    const { area, viewport } = await render(<ScrollArea className="h-40">{tall}</ScrollArea>);
    expect(viewport.offsetWidth - viewport.clientWidth).toBe(0);
    await expect.poll(() => area.querySelector('[data-orientation="vertical"]')).not.toBeNull();
    expect(area.querySelector('[data-orientation="horizontal"]')).toBeNull();
  });

  it("shows the scrollbar while hovered or scrolled, and keeps it in the corner", async () => {
    const { area, viewport } = await render(<ScrollArea className="h-40">{tall}</ScrollArea>);
    await expect.poll(() => area.querySelector('[data-orientation="vertical"]')).not.toBeNull();
    const scrollbar = area.querySelector<HTMLElement>('[data-orientation="vertical"]')!;
    // The pointer may still rest where an earlier test's element was, which is where this
    // area renders, so move it to a spot well away from the area first.
    const away = document.createElement("div");
    away.style.cssText = "position:fixed;right:0;bottom:0;width:20px;height:20px";
    document.body.append(away);
    mounted.push(away);
    await userEvent.hover(away);
    await expect.poll(() => getComputedStyle(scrollbar).opacity).toBe("0");
    await userEvent.hover(viewport);
    await expect.poll(() => getComputedStyle(scrollbar).opacity).toBe("1");
    const bar = scrollbar.getBoundingClientRect();
    expect(Math.round(bar.right)).toBe(Math.round(area.getBoundingClientRect().right));
    expect(bar.width).toBe(10);
    // A fine pointer can drag the thumb.
    expect(getComputedStyle(scrollbar).pointerEvents).toBe("auto");
  });

  it("scrolls horizontally with orientation=horizontal, and both ways with both", async () => {
    const { area, viewport } = await render(<ScrollArea orientation="horizontal">{wide}</ScrollArea>);
    expect(viewport.scrollWidth).toBe(900);
    await expect.poll(() => area.querySelector('[data-orientation="horizontal"]')).not.toBeNull();
    expect(area.querySelector('[data-orientation="vertical"]')).toBeNull();
    const { area: both } = await render(
      <ScrollArea orientation="both" className="h-40">
        <div style={{ width: 900 }}>{tall}</div>
      </ScrollArea>,
    );
    await expect.poll(() => both.querySelectorAll(":scope > [data-orientation]").length).toBe(2);
  });

  it("is a keyboard-scrollable region named by label", async () => {
    const { viewport } = await render(
      <ScrollArea className="h-40" label="Method">
        {tall}
      </ScrollArea>,
    );
    const region = page.getByRole("region", { name: "Method" });
    await expect.element(region).toBeVisible();
    expect(region.element()).toBe(viewport);
    await expect.poll(() => viewport.tabIndex).toBe(0);
    viewport.focus();
    expect(getComputedStyle(viewport).outlineStyle).toBe("solid");
    await userEvent.keyboard("{PageDown}");
    await expect.poll(() => viewport.scrollTop).toBeGreaterThan(0);
  });

  it("adds no tab stop when the content fits", async () => {
    const { viewport } = await render(
      <ScrollArea className="h-40">
        <p>Short</p>
      </ScrollArea>,
    );
    await expect.poll(() => viewport.tabIndex).toBe(-1);
  });

  it("lets the page scroll on once the area reaches its end, unless contain is set", async () => {
    const { viewport } = await render(
      <ScrollArea className="h-40" label="Method">
        {tall}
      </ScrollArea>,
    );
    expect(getComputedStyle(viewport).overscrollBehaviorY).toBe("auto");
    const { viewport: contained } = await render(
      <ScrollArea className="h-40" label="Chat" contain>
        {tall}
      </ScrollArea>,
    );
    expect(getComputedStyle(contained).overscrollBehaviorY).toBe("contain");
    expect(getComputedStyle(contained).overscrollBehaviorX).toBe("contain");
  });

  it("passes attributes and a ref to the root, and lets layout classes win", async () => {
    let node: HTMLDivElement | null = null;
    const { area } = await render(
      <ScrollArea id="method" label="Method" className="mt-4 h-20 w-40" ref={(element) => void (node = element)}>
        {tall}
      </ScrollArea>,
    );
    expect(area.id).toBe("method");
    expect(node).toBe(area);
    expect(getComputedStyle(area).marginTop).toBe("16px");
    expect(area.getBoundingClientRect().width).toBe(160);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("ScrollArea development messages", () => {
  it.each([
    ["type", { type: "always" }, "type is not a prop; the scrollbar shows while you hover or scroll", "<ScrollArea>"],
    ["maxHeight", { maxHeight: 320 }, "maxHeight is not a prop", '<ScrollArea className="max-h-80">'],
    ["height", { height: "200px" }, "height is not a prop", '<ScrollArea className="h-72">'],
    ["orientation", { orientation: "x" }, 'orientation="x" is not an orientation; use "vertical", "horizontal", "both"', '<ScrollArea orientation="horizontal">'],
    ["orientation y", { orientation: "y" }, 'orientation="y" is not an orientation; use "vertical", "horizontal", "both"', '<ScrollArea orientation="vertical">'],
  ])("warns for %s with the fix", async (_name, extra, problem, fix) => {
    const { area } = await render(<ScrollArea {...({ children: tall, className: "h-40", ...extra } as unknown as Parameters<typeof ScrollArea>[0])} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] ScrollArea: ${problem}. Fix: ${fix}.`);
    for (const attribute of ["type", "maxheight", "height"]) expect(area.hasAttribute(attribute)).toBe(false);
  });

  it("warns when the area takes keyboard focus to scroll but has no name", async () => {
    const { viewport } = await render(<ScrollArea className="h-40">{tall}</ScrollArea>);
    await expect.poll(() => viewport.tabIndex).toBe(0);
    await expect
      .poll(() => warn.mock.calls.map((call: unknown[]) => call[0]))
      .toContain('[ouro-ui] ScrollArea: the area takes keyboard focus to scroll, and has no name. Fix: <ScrollArea label="Method">.');
  });

  it.each([
    ["a label", 0, <ScrollArea className="h-40" label="Method">{tall}</ScrollArea>],
    ["a focusable child", 0, <ScrollArea className="h-40"><a href="#top">Top</a>{tall}</ScrollArea>],
    ["content that fits", -1, <ScrollArea className="h-40"><p>Short</p></ScrollArea>],
  ] as const)("does not ask for a name with %s", async (_name, tabIndex, node) => {
    const { viewport } = await render(node);
    await expect.poll(() => viewport.tabIndex).toBe(tabIndex);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(warn).not.toHaveBeenCalled();
  });

  it("scrolls vertically for an unknown orientation", async () => {
    const { area } = await render(<ScrollArea {...({ children: tall, className: "h-40", orientation: "x" } as unknown as Parameters<typeof ScrollArea>[0])} />);
    await expect.poll(() => area.querySelector('[data-orientation="vertical"]')).not.toBeNull();
  });

  it("checks the className", async () => {
    await render(
      <ScrollArea className="h-40 rounded-md border">
        {tall}
      </ScrollArea>,
    );
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] ScrollArea: "rounded-md" sets appearance, and className is for layout only. Fix: put the ScrollArea inside a <Card> for a frame.',
    );
  });

  it("renders to a string without warnings", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(
      <ScrollArea className="h-40 bg-muted" label="Method">
        {tall}
      </ScrollArea>,
    );
    expect(html).toContain('data-ouro="scroll-area"');
    expect(html).toContain('aria-label="Method"');
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
