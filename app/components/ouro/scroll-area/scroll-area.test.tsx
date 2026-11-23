import { type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, server, userEvent } from "vitest/browser";
import { Button } from "~/components/ouro/button/button";
import { ScrollArea } from "~/components/ouro/scroll-area/scroll-area";
import { watchLayoutReads } from "~/lib/ouro/testing/layout-reads";
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

  it("draws a thin native scrollbar in the theme's muted color, and scrolls only the way it is asked to", async () => {
    const { viewport } = await render(<ScrollArea className="h-40">{tall}</ScrollArea>);
    expect(getComputedStyle(viewport).overflowY).toBe("auto");
    expect(getComputedStyle(viewport).overflowX).toBe("hidden");
    expect(getComputedStyle(viewport).scrollbarWidth).toBe("thin");
    expect(getComputedStyle(viewport).scrollbarColor).not.toBe("auto");
    const { viewport: row } = await render(<ScrollArea orientation="horizontal">{wide}</ScrollArea>);
    expect(getComputedStyle(row).overflowX).toBe("auto");
    expect(getComputedStyle(row).overflowY).toBe("hidden");
    const { viewport: both } = await render(<ScrollArea orientation="both">{wide}</ScrollArea>);
    expect(getComputedStyle(both).overflowX).toBe("auto");
    expect(getComputedStyle(both).overflowY).toBe("auto");
  });

  it("reads no layout while mounting, so the commit forces none", async () => {
    await render(<ScrollArea className="h-40">{tall}</ScrollArea>);
    const host = document.createElement("div");
    document.body.append(host);
    mounted.push(host);
    const root = createRoot(host);
    roots.push(root);
    const watch = watchLayoutReads();
    // Stops as soon as the commit is done: the browser's resize report comes later, after layout, so it forces none.
    flushSync(() => root.render(<ScrollArea className="h-40" label="Method">{tall}</ScrollArea>));
    watch.stop();
    expect(watch.names()).toEqual([]);
  });

  it("keeps a vertical area's content to the viewport's width, so a child that cannot wrap does not widen the text beside it", async () => {
    const unbroken = "a".repeat(300);
    const { area, viewport } = await render(
      <ScrollArea className="h-40 w-[380px]" label="Method">
        <div>
          <p>Stir the sauce until it thickens, then pour it over the rice.</p>
          <Button>{unbroken}</Button>
        </div>
      </ScrollArea>,
    );
    expect(area.getBoundingClientRect().width).toBe(380);
    const content = viewport.firstElementChild as HTMLElement;
    const paragraph = content.querySelector("p")!;
    await expect.poll(() => paragraph.getBoundingClientRect().height).toBeGreaterThan(20);
    expect(content.getBoundingClientRect().width).toBe(viewport.clientWidth);
    expect(paragraph.getBoundingClientRect().width).toBeLessThanOrEqual(380);
  });

  it("lets a horizontal or both area's content grow wider than the viewport", async () => {
    const { viewport } = await render(
      <ScrollArea orientation="horizontal" className="w-[380px]">
        <div style={{ width: 900 }}>{tall}</div>
      </ScrollArea>,
    );
    const content = viewport.firstElementChild as HTMLElement;
    expect(content.getBoundingClientRect().width).toBe(900);
    const { viewport: both } = await render(
      <ScrollArea orientation="both" className="h-40 w-[380px]">
        <div style={{ width: 900 }}>{tall}</div>
      </ScrollArea>,
    );
    expect((both.firstElementChild as HTMLElement).getBoundingClientRect().width).toBe(900);
  });

  it("scrolls horizontally with orientation=horizontal", async () => {
    const { viewport } = await render(<ScrollArea orientation="horizontal">{wide}</ScrollArea>);
    expect(viewport.scrollWidth).toBe(900);
    await expect.poll(() => viewport.tabIndex).toBe(0);
  });

  it("fades out at the side that hides more, drawing its focus ring over the fade, and keeps keyboard scrolling", async () => {
    const { area, viewport } = await render(
      <ScrollArea orientation="horizontal" label="Tags">
        {wide}
      </ScrollArea>,
    );
    await expect.poll(() => viewport.hasAttribute("data-ouro-scroll-fade")).toBe(true);
    expect(viewport.style.getPropertyValue("--ouro-scroll-fade-right")).toBe(`${900 - viewport.clientWidth}px`);
    expect(getComputedStyle(viewport).maskImage).toContain("linear-gradient");
    await expect.poll(() => viewport.tabIndex).toBe(0);
    const ring = area.querySelector<HTMLElement>("[data-scroll-focus-ring]")!;
    expect(getComputedStyle(ring).outlineStyle).toBe("none");
    viewport.focus();
    expect(getComputedStyle(viewport).outlineStyle).toBe("none");
    expect(getComputedStyle(ring).outlineStyle).toBe("solid");
    expect(getComputedStyle(ring).outlineWidth).toBe("2px");
    // WebKit under Playwright scrolls a focused box with no arrow key, masked or not, so it scrolls by script there.
    if (server.browser === "chromium") await userEvent.keyboard("{ArrowRight}");
    else viewport.scrollLeft = 40;
    await expect.poll(() => viewport.scrollLeft).toBeGreaterThan(0);
    // The arrow key may scroll smoothly, so the fade catches up with each frame of it.
    await expect.poll(() => viewport.style.getPropertyValue("--ouro-scroll-fade-left") === `${viewport.scrollLeft}px`).toBe(true);
    // Content that fits adds no fade.
    const { viewport: clipped } = await render(<ScrollArea className="h-40" orientation="horizontal">{tall}</ScrollArea>);
    await act(async () => new Promise(requestAnimationFrame));
    expect(clipped.hasAttribute("data-ouro-scroll-fade-y")).toBe(false);
    const { viewport: fits } = await render(<ScrollArea className="h-80">{<div style={{ height: 20 }} />}</ScrollArea>);
    await act(async () => new Promise(requestAnimationFrame));
    expect(fits.hasAttribute("data-ouro-scroll-fade")).toBe(false);
    expect(getComputedStyle(fits).maskImage).toBe("none");
  });

  it("draws its focus ring whole over content that sticks to an edge, and leaves the pointer to the content", async () => {
    const { area, viewport } = await render(
      <ScrollArea className="h-40" label="Chats">
        <div style={{ position: "sticky", top: 0, zIndex: 10, height: 40, background: "var(--background)" }}>Chats</div>
        {tall}
      </ScrollArea>,
    );
    await expect.poll(() => viewport.tabIndex).toBe(0);
    // At rest nothing lies over the content, so a contrast check sees the text's own background.
    const overlay = area.querySelector<HTMLElement>("[data-scroll-focus-ring]")!;
    expect(getComputedStyle(overlay).display).toBe("none");
    viewport.focus();
    expect(getComputedStyle(overlay).display).toBe("block");
    await act(async () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    // The ring's colour as pixels, and the area's pixels as the screen shows them.
    const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    probe.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--ring");
    probe.fillRect(0, 0, 1, 1);
    const ring = [...probe.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    const image = new Image();
    image.src = `data:image/png;base64,${await page.screenshot({ save: false, element: area, animations: "disabled" })}`;
    await image.decode();
    const shot = document.createElement("canvas");
    shot.width = image.naturalWidth;
    shot.height = image.naturalHeight;
    const context = shot.getContext("2d", { willReadFrequently: true })!;
    context.drawImage(image, 0, 0);
    const scale = image.naturalWidth / area.getBoundingClientRect().width;
    const { width, height } = area.getBoundingClientRect();
    // One pixel in from the middle of each edge, inside the 2px ring.
    const edges = { top: [width / 2, 1], bottom: [width / 2, height - 1], start: [1, height / 2], end: [width - 1, height / 2] };
    const shown = Object.fromEntries(
      Object.entries(edges).map(([edge, [x, y]]) => {
        const pixel = [...context.getImageData(Math.floor(x! * scale), Math.floor(y! * scale), 1, 1).data.slice(0, 3)];
        return [edge, pixel.every((value, index) => Math.abs(value - ring[index]!) <= 24)];
      }),
    );
    expect(shown).toEqual({ top: true, bottom: true, start: true, end: true });
    // The ring takes no pointer: a press on the sticky header lands on the header.
    const header = viewport.querySelector<HTMLElement>("[style*='sticky']")!;
    const box = header.getBoundingClientRect();
    expect(document.elementFromPoint(box.left + box.width / 2, box.top + 1)).toBe(header);
  });

  it("fades the top and bottom edge that hides more, and says how far it is scrolled, from the scroll event", async () => {
    const { viewport } = await render(<ScrollArea className="h-40">{tall}</ScrollArea>);
    const hidden = () => viewport.scrollHeight - viewport.clientHeight;
    await expect.poll(() => viewport.hasAttribute("data-overflow-y-end")).toBe(true);
    expect(viewport.hasAttribute("data-overflow-y-start")).toBe(false);
    expect(viewport.style.getPropertyValue("--scroll-area-overflow-y-start")).toBe("0px");
    expect(viewport.style.getPropertyValue("--scroll-area-overflow-y-end")).toBe(`${hidden()}px`);
    expect(getComputedStyle(viewport).maskImage).toContain("linear-gradient");
    viewport.scrollTop = 40;
    await expect.poll(() => viewport.hasAttribute("data-overflow-y-start")).toBe(true);
    expect(viewport.style.getPropertyValue("--scroll-area-overflow-y-start")).toBe(`${viewport.scrollTop}px`);
    viewport.scrollTop = hidden();
    await expect.poll(() => viewport.hasAttribute("data-overflow-y-end")).toBe(false);
    // A row that scrolls sideways, or content that fits, has no vertical fade.
    const { viewport: row } = await render(<ScrollArea orientation="horizontal">{wide}</ScrollArea>);
    await act(async () => new Promise(requestAnimationFrame));
    expect(row.hasAttribute("data-overflow-y-start") || row.hasAttribute("data-ouro-scroll-fade-y")).toBe(false);
    const { viewport: fits } = await render(<ScrollArea className="h-80">{<div style={{ height: 20 }} />}</ScrollArea>);
    await act(async () => new Promise(requestAnimationFrame));
    expect(fits.hasAttribute("data-ouro-scroll-fade-y")).toBe(false);
    expect(fits.style.getPropertyValue("--scroll-area-overflow-y-end")).toBe("0px");
  });

  it("is a keyboard-scrollable region named by label", async () => {
    const { area, viewport } = await render(
      <ScrollArea className="h-40" label="Method">
        {tall}
      </ScrollArea>,
    );
    const region = page.getByRole("region", { name: "Method" });
    await expect.element(region).toBeVisible();
    expect(region.element()).toBe(viewport);
    await expect.poll(() => viewport.tabIndex).toBe(0);
    viewport.focus();
    expect(getComputedStyle(area.querySelector("[data-scroll-focus-ring]")!).outlineStyle).toBe("solid");
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

  it("follows the content: a tab stop once it overflows, none again once it fits", async () => {
    const { host, viewport } = await render(<ScrollArea className="h-40" label="Method"><p>Short</p></ScrollArea>);
    await expect.poll(() => viewport.tabIndex).toBe(-1);
    const content = viewport.firstElementChild as HTMLElement;
    content.style.height = "600px";
    await expect.poll(() => viewport.tabIndex).toBe(0);
    content.style.height = "10px";
    await expect.poll(() => viewport.tabIndex).toBe(-1);
    expect(host.contains(viewport)).toBe(true);
  });

  it("gives no extra tab stop to a scrolling area whose content holds buttons, but keeps one for plain text", async () => {
    const { viewport: withButtons } = await render(
      <ScrollArea className="h-40">
        {lines.map((line) => (
          <Button key={line}>{line}</Button>
        ))}
      </ScrollArea>,
    );
    await expect.poll(() => withButtons.scrollHeight).toBeGreaterThan(withButtons.clientHeight);
    expect(withButtons.tabIndex).toBe(-1);
    const { viewport: plainText } = await render(<ScrollArea className="h-40">{tall}</ScrollArea>);
    await expect.poll(() => plainText.tabIndex).toBe(0);
  });

  it("drops the tab stop once a button is added to content that scrolled with none", async () => {
    const { viewport, area } = await render(<ScrollArea className="h-40">{tall}</ScrollArea>);
    await expect.poll(() => viewport.tabIndex).toBe(0);
    await act(async () => {
      viewport.prepend(area.ownerDocument.createElement("button"));
    });
    await expect.poll(() => viewport.tabIndex).toBe(-1);
  });

  it("follows a disabled button turning enabled, with no resize", async () => {
    const { viewport, area } = await render(
      <ScrollArea className="h-40">
        <button disabled>Go</button>
        {tall}
      </ScrollArea>,
    );
    await expect.poll(() => viewport.tabIndex).toBe(0);
    const button = area.querySelector("button")!;
    await act(async () => {
      button.disabled = false;
    });
    await expect.poll(() => viewport.tabIndex).toBe(-1);
    await act(async () => {
      button.disabled = true;
    });
    await expect.poll(() => viewport.tabIndex).toBe(0);
  });

  it("follows a link gaining or losing its href, with no resize", async () => {
    const { viewport, area } = await render(
      <ScrollArea className="h-40">
        <a>Go</a>
        {tall}
      </ScrollArea>,
    );
    await expect.poll(() => viewport.tabIndex).toBe(0);
    const link = area.querySelector("a")!;
    await act(async () => {
      link.setAttribute("href", "#top");
    });
    await expect.poll(() => viewport.tabIndex).toBe(-1);
    await act(async () => {
      link.removeAttribute("href");
    });
    await expect.poll(() => viewport.tabIndex).toBe(0);
  });

  it("follows a tabindex added to or removed from plain content, with no resize", async () => {
    const { viewport, area } = await render(
      <ScrollArea className="h-40">
        <div data-testid="probe" tabIndex={-1}>
          Go
        </div>
        {tall}
      </ScrollArea>,
    );
    await expect.poll(() => viewport.tabIndex).toBe(0);
    const div = area.querySelector('[data-testid="probe"]')!;
    await act(async () => {
      div.setAttribute("tabindex", "0");
    });
    await expect.poll(() => viewport.tabIndex).toBe(-1);
    await act(async () => {
      div.setAttribute("tabindex", "-1");
    });
    await expect.poll(() => viewport.tabIndex).toBe(0);
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
    ["type", { type: "always" }, "type is not a prop; the scrollbar is the browser's own", "<ScrollArea>"],
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
    // A focusable child can already take focus and scroll the viewport to it, so the viewport
    // itself needs no tab stop of its own, and so no name either.
    ["a focusable child", -1, <ScrollArea className="h-40"><a href="#top">Top</a>{tall}</ScrollArea>],
    ["content that fits", -1, <ScrollArea className="h-40"><p>Short</p></ScrollArea>],
  ] as const)("does not ask for a name with %s", async (_name, tabIndex, node) => {
    const { viewport } = await render(node);
    await expect.poll(() => viewport.tabIndex).toBe(tabIndex);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(warn).not.toHaveBeenCalled();
  });

  it("scrolls vertically for an unknown orientation", async () => {
    const { viewport } = await render(<ScrollArea {...({ children: tall, className: "h-40", orientation: "x" } as unknown as Parameters<typeof ScrollArea>[0])} />);
    expect(getComputedStyle(viewport).overflowY).toBe("auto");
  });

  it("checks the className", async () => {
    await render(
      <ScrollArea className="h-40 rounded-ouro-md border">
        {tall}
      </ScrollArea>,
    );
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] ScrollArea: "rounded-ouro-md" sets appearance, and className is for layout only. Fix: put the ScrollArea inside a <Card> for a frame.',
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
