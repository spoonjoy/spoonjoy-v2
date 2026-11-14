import { useRef, type CSSProperties, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commands, server, userEvent } from "vitest/browser";
import { cn } from "~/lib/ouro/cn";
import { scrollFadeClass, scrollFadeStaticClass, useScrollFade } from "~/lib/ouro/scroll-fade";
import { act } from "~/lib/ouro/testing/act";

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
  await act(frames);
  return {
    root,
    box: host.querySelector<HTMLElement>("[data-box]")!,
    rerender: async (next: ReactNode) => {
      await act(async () => root.render(next));
      await act(frames);
    },
  };
}

// WebKit delivers ResizeObserver after the frame's animation callbacks, so wait two frames.
const frames = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

function Box({ width = 200, content = 600, style, tabIndex, className }: { width?: number; content?: number; style?: CSSProperties; tabIndex?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useScrollFade(ref);
  return (
    <div ref={ref} data-box="" tabIndex={tabIndex} className={cn("overflow-x-auto", scrollFadeClass, className)} style={{ width, ...style }}>
      <div style={{ width: content, height: 20 }}>Waiting on the final copy of the brief</div>
    </div>
  );
}

const fade = (box: HTMLElement) => [box.style.getPropertyValue("--ouro-scroll-fade-left"), box.style.getPropertyValue("--ouro-scroll-fade-right")];

const scrollTo = async (box: HTMLElement, left: number) => {
  box.scrollLeft = left;
  await act(frames);
};

describe("useScrollFade", () => {
  it("fades the side that hides more, as far as it hides, and follows the scroll", async () => {
    const { box } = await render(<Box />);
    expect(box.getAttribute("data-ouro-scroll-fade")).toBe("");
    expect(fade(box)).toEqual(["0px", "400px"]);
    expect(getComputedStyle(box).maskImage).toContain("linear-gradient");
    await scrollTo(box, 150);
    expect(fade(box)).toEqual(["150px", "250px"]);
    await scrollTo(box, 400);
    expect(fade(box)).toEqual(["400px", "0px"]);
  });

  it("fades the left in a right-to-left box", async () => {
    const { box } = await render(<Box style={{ direction: "rtl" }} />);
    expect(fade(box)).toEqual(["400px", "0px"]);
    await scrollTo(box, -100);
    expect(fade(box)).toEqual(["300px", "100px"]);
  });

  it("adds nothing while the content fits, or when the box clips instead of scrolling", async () => {
    for (const node of [<Box key="fits" content={200} />, <Box key="pixel" content={201} />, <Box key="clips" style={{ overflowX: "hidden" }} />]) {
      const { box } = await render(node);
      expect(box.hasAttribute("data-ouro-scroll-fade")).toBe(false);
      expect(fade(box)).toEqual(["", ""]);
      expect(getComputedStyle(box).maskImage).toBe("none");
    }
    const { box } = await render(<Box content={202} style={{ overflowX: "scroll" }} />);
    expect(fade(box)).toEqual(["0px", "2px"]);
  });

  it("keeps the same mask in dark and forced colors, since the mask carries no color", async () => {
    const { box } = await render(<Box />);
    const light = getComputedStyle(box).maskImage;
    try {
      document.documentElement.classList.add("dark");
      expect(getComputedStyle(box).maskImage).toBe(light);
      await commands.emulateMedia({ forcedColors: "active" });
      expect(matchMedia("(forced-colors: active)").matches).toBe(true);
      expect(getComputedStyle(box).maskImage).toBe(light);
    } finally {
      document.documentElement.classList.remove("dark");
      await commands.emulateMedia({ forcedColors: "none" });
    }
  });

  it("stands the no-script fade down once it runs, so a hydrated box has no scroll-driven animation to wait on", async () => {
    for (const content of [200, 600]) {
      const { box } = await render(<Box content={content} className={scrollFadeStaticClass} />);
      expect(box.hasAttribute("data-ouro-scroll-fade-js")).toBe(true);
      expect(box.getAnimations()).toEqual([]);
    }
  });

  it("follows the box's size and its content's, and stops when it unmounts", async () => {
    const { box, root, rerender } = await render(<Box />);
    await rerender(<Box width={600} />);
    expect(box.hasAttribute("data-ouro-scroll-fade")).toBe(false);
    expect(fade(box)).toEqual(["", ""]);
    await rerender(<Box width={600} content={900} />);
    expect(fade(box)).toEqual(["0px", "300px"]);
    const removed = vi.spyOn(box, "removeEventListener");
    const disconnected = vi.spyOn(ResizeObserver.prototype, "disconnect");
    await act(async () => root.unmount());
    expect(removed).toHaveBeenCalledWith("scroll", expect.any(Function));
    expect(disconnected).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  // WebKit under Playwright scrolls a focused box with no arrow key, masked or not.
  it.skipIf(server.browser !== "chromium")("leaves keyboard scrolling to the box", async () => {
    const { box } = await render(<Box tabIndex={0} />);
    box.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.poll(() => box.scrollLeft).toBeGreaterThan(0);
    // The arrow key may scroll smoothly, so the fade catches up with each frame of it.
    await expect.poll(() => fade(box)[0] === `${box.scrollLeft}px`).toBe(true);
  });
});
