import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands } from "vitest/browser";
import { Avatar } from "~/components/ouro/avatar/avatar";
import { Card } from "~/components/ouro/card/card";
import { Item } from "~/components/ouro/item/item";
import { Skeleton, type SkeletonProps } from "~/components/ouro/skeleton/skeleton";
import { Text } from "~/components/ouro/text/text";
import { act } from "~/lib/ouro/testing/act";

const roots: Root[] = [];
let mounted: Element[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  host.style.width = "300px";
  host.style.fontSize = "16px";
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return host.querySelector<HTMLElement>('[data-ouro="skeleton"]')!;
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
  await commands.emulateMedia({ reducedMotion: "no-preference" });
});

const warnings = () => warn.mock.calls.map((call: unknown[]) => String(call[0]));

describe("Skeleton", () => {
  it("is a decorative placeholder screen readers skip", async () => {
    const skeleton = await render(<Skeleton />);
    expect(skeleton.getAttribute("aria-hidden")).toBe("true");
    expect(skeleton.textContent).toBe("");
  });

  it("is a full-width rounded block by default", async () => {
    const skeleton = await render(<Skeleton />);
    const rect = skeleton.getBoundingClientRect();
    expect(skeleton.getAttribute("data-shape")).toBe("rect");
    expect(rect.width).toBe(300);
    expect(rect.height).toBe(16);
    expect(getComputedStyle(skeleton).borderTopLeftRadius).not.toBe("0px");
  });

  it("is one line box of text with shape text, a bar the letters' height inside it, and a circle with shape circle", async () => {
    const text = await render(<Skeleton shape="text" />);
    const lineHeight = Number.parseFloat(getComputedStyle(text).lineHeight);
    expect(text.getBoundingClientRect().height).toBeCloseTo(lineHeight, 1);
    expect(text.querySelector(":scope > span > span")!.getBoundingClientRect().height).toBeCloseTo(16 * 0.75, 0);
    const circle = await render(<Skeleton shape="circle" />);
    const rect = circle.getBoundingClientRect();
    expect(rect.width).toBe(40);
    expect(rect.height).toBe(40);
    expect(Number.parseFloat(getComputedStyle(circle).borderTopLeftRadius)).toBeGreaterThanOrEqual(20);
  });

  it("takes the space of the text it stands in for at each of Text's sizes, the last of several lines shorter", async () => {
    for (const size of ["sm", "md", "lg"] as const) {
      for (const lines of [1, 3]) {
        const host = document.createElement("div");
        host.style.width = "300px";
        document.body.append(host);
        mounted.push(host);
        const root = createRoot(host);
        roots.push(root);
        await act(async () =>
          root.render(
            <>
              <Text size={size}>{Array.from({ length: lines }, (_, index) => (index ? [<br key={index} />, "Line"] : "Line"))}</Text>
              <Skeleton shape="text" size={size} lines={lines} />
            </>,
          ),
        );
        const [content, skeleton] = [host.firstElementChild!, host.querySelector('[data-ouro="skeleton"]')!];
        expect(skeleton.getBoundingClientRect().height).toBeCloseTo(content.getBoundingClientRect().height, 1);
        const bars = [...skeleton.querySelectorAll(":scope > span > span")].map((bar) => bar.getBoundingClientRect().width);
        expect(bars).toHaveLength(lines);
        if (lines > 1) expect(bars.at(-1)).toBeLessThan(bars[0]!);
        else expect(bars[0]).toBe(skeleton.getBoundingClientRect().width);
      }
    }
  });

  it("is the exact box of an Avatar at each of its sizes", async () => {
    for (const size of ["xs", "sm", "md", "lg", "xl", "2xl", "3xl"] as const) {
      const skeleton = (await render(<Skeleton shape="circle" size={size} />)).getBoundingClientRect();
      await render(<Avatar name="Ana Lee" size={size} />);
      const avatar = mounted.at(-1)!.querySelector('[data-ouro="avatar"]')!.getBoundingClientRect();
      expect([skeleton.width, skeleton.height]).toEqual([avatar.width, avatar.height]);
    }
  });

  it("is the exact height of an Item row and an outline Card, at each size, so nothing moves when they arrive", async () => {
    for (const size of ["sm", "md"] as const) {
      const host = document.createElement("div");
      host.style.width = "360px";
      document.body.append(host);
      mounted.push(host);
      const root = createRoot(host);
      roots.push(root);
      await act(async () =>
        root.render(
          <>
            <div data-real="row">
              <Item size={size} title="Ana Lee" description="Shared the menu" media={<img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" />} />
              <Item size={size} title="Ben Ito" description="Asked about Friday" media={<img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" />} />
            </div>
            <div data-skeleton="row">
              <Skeleton shape="row" size={size} count={2} />
            </div>
            <div data-real="card">
              <Card size={size} title="Spring menu" description="Updated today">
                <Text size="sm">
                  Line
                  <br />
                  Line
                </Text>
              </Card>
            </div>
            <div data-skeleton="card">
              <Skeleton shape="card" size={size} />
            </div>
          </>,
        ),
      );
      // Every bar shows, row after row.
      for (const bar of host.querySelectorAll('[data-skeleton] [data-ouro="skeleton"] span:empty')) expect(bar.getBoundingClientRect().width).toBeGreaterThan(0);
      for (const shape of ["row", "card"]) {
        const real = host.querySelector(`[data-real="${shape}"]`)!.getBoundingClientRect().height;
        expect(host.querySelector(`[data-skeleton="${shape}"]`)!.getBoundingClientRect().height).toBeCloseTo(real, 1);
      }
    }
  });

  it("repeats rows and cards count times, each its own element, with the ref and the id on the first", async () => {
    const ref = { current: null as HTMLSpanElement | null };
    const first = await render(<Skeleton shape="row" count={3} id="loading" data-testid="row" ref={ref} />);
    const rows = mounted.at(-1)!.querySelectorAll('[data-ouro="skeleton"]');
    expect(rows).toHaveLength(3);
    expect([...rows].map((row) => [row.id, row.getAttribute("data-testid")])).toEqual([["loading", "row"], ["", "row"], ["", "row"]]);
    expect(ref.current).toBe(first);
    expect(renderToString(<Skeleton shape="card" count={2} />).match(/data-shape="card"/g)).toHaveLength(2);
    // A count that is not a whole number of at least one shows one.
    await render(<Skeleton shape="card" count={0} />);
    expect(mounted.at(-1)!.querySelectorAll('[data-ouro="skeleton"]')).toHaveLength(1);
    await render(<Skeleton shape="text" lines={2.5} />);
    expect(mounted.at(-1)!.querySelectorAll('[data-ouro="skeleton"] > span > span')).toHaveLength(1);
  });

  it("takes its size from layout classes, and a circle stays round", async () => {
    expect((await render(<Skeleton className="h-24 w-32" />)).getBoundingClientRect()).toMatchObject({ width: 128, height: 96 });
    expect((await render(<Skeleton shape="circle" className="size-12" />)).getBoundingClientRect()).toMatchObject({ width: 48, height: 48 });
    expect((await render(<Skeleton shape="circle" className="w-16" />)).getBoundingClientRect()).toMatchObject({ width: 64, height: 64 });
    expect(warnings()).toEqual([]);
  });

  it("keeps each shape's edge in forced colours, where the fill becomes the page's own colour", async () => {
    await commands.emulateMedia({ forcedColors: "active" });
    try {
      const shapes = [
        await render(<Skeleton />),
        await render(<Skeleton shape="circle" />),
        (await render(<Skeleton shape="text" lines={2} />)).querySelector<HTMLElement>(":scope > span > span")!,
        (await render(<Skeleton shape="row" />)).querySelector<HTMLElement>(":scope > span")!,
        (await render(<Skeleton shape="card" />)).querySelector<HTMLElement>(":scope > span > span > span")!,
      ];
      for (const shape of shapes) {
        const style = getComputedStyle(shape);
        expect(style.outlineStyle).toBe("solid");
        expect(style.outlineWidth).toBe("1px");
        expect(style.outlineColor).not.toBe(style.backgroundColor);
      }
    } finally {
      await commands.emulateMedia({ forcedColors: "none" });
    }
  });

  it("shimmers a band that moves by translate only, and holds it still in the middle with reduced motion", async () => {
    const skeleton = await render(<Skeleton />);
    expect(getComputedStyle(skeleton, "::before").animationName).toBe("ouro-shimmer-band");
    expect(getComputedStyle(skeleton, "::before").backgroundImage).toContain("gradient");
    await commands.emulateMedia({ reducedMotion: "reduce" });
    expect(getComputedStyle(skeleton, "::before").animationName).toBe("none");
    // The band stays, still, in the middle.
    expect(getComputedStyle(skeleton, "::before").translate).toBe("none");
    expect(getComputedStyle(skeleton, "::before").backgroundImage).toContain("gradient");
    expect(skeleton.getAnimations({ subtree: true })).toEqual([]);
  });

  it("animates only translate on each band, never the background, so a page with skeletons rests between frames", async () => {
    await render(
      <>
        <Skeleton />
        <Skeleton shape="text" lines={2} />
        <Skeleton shape="circle" />
        <Skeleton shape="row" count={2} />
        <Skeleton shape="card" />
      </>,
    );
    const host = mounted.at(-1)!;
    const animations = host.getAnimations({ subtree: true });
    expect(animations.length).toBeGreaterThan(0);
    for (const animation of animations) {
      const effect = animation.effect as KeyframeEffect;
      const properties = [...new Set(effect.getKeyframes().flatMap((frame) => Object.keys(frame)))].filter((key) => !["offset", "computedOffset", "easing", "composite"].includes(key));
      expect(properties).toEqual(["translate"]);
      expect(effect.pseudoElement).toBe("::before");
      expect(effect.getTiming().iterations).toBe(Infinity);
    }
  });


  it("passes attributes through and renders on the server", async () => {
    const skeleton = await render(<Skeleton id="avatar" data-testid="avatar" />);
    expect(skeleton.id).toBe("avatar");
    expect(renderToString(<Skeleton shape="circle" />)).toContain('data-shape="circle"');
  });

  it("warns, once each, for guessed props, an unknown shape and appearance classes, and renders the defaults", async () => {
    const props = { shape: "square", variant: "circular", animation: false, width: 120, height: 20 } as unknown as SkeletonProps;
    const skeleton = await render(<Skeleton {...props} className="rounded-full bg-gray-200" />);
    expect(skeleton.getAttribute("data-shape")).toBe("rect");
    expect(warnings()).toEqual([
      '[ouro-ui] Skeleton: "rounded-full" sets appearance, and className is for layout only. Fix: shape="circle".',
      '[ouro-ui] Skeleton: shape="square" is not a shape; use "rect", "text", "circle", "row", "card". Fix: <Skeleton shape="rect">.',
      '[ouro-ui] Skeleton: variant is not a prop. Fix: <Skeleton shape="circle">.',
      "[ouro-ui] Skeleton: animation is not a prop; Skeleton shimmers, and holds still with reduced motion. Fix: <Skeleton>.",
      '[ouro-ui] Skeleton: width is not a prop. Fix: <Skeleton className="w-[120px]">.',
      '[ouro-ui] Skeleton: height is not a prop. Fix: <Skeleton className="h-[20px]">.',
    ]);
  });

  it("maps each MUI variant and other appearance classes to the fix", async () => {
    for (const variant of ["text", "rectangular", "rounded", "wave"]) {
      await render(<Skeleton {...({ variant } as unknown as SkeletonProps)} />);
    }
    await render(<Skeleton className="rounded-md" />);
    await render(<Skeleton className="bg-muted" />);
    await render(<Skeleton {...({ width: "50%", height: "2rem" } as unknown as SkeletonProps)} />);
    expect(warnings()).toEqual([
      '[ouro-ui] Skeleton: variant is not a prop. Fix: <Skeleton shape="text">.',
      '[ouro-ui] Skeleton: variant is not a prop. Fix: <Skeleton shape="rect">.',
      '[ouro-ui] Skeleton: variant is not a prop. Fix: <Skeleton shape="rect">.',
      '[ouro-ui] Skeleton: variant is not a prop. Fix: <Skeleton shape="rect">.',
      '[ouro-ui] Skeleton: "rounded-md" sets appearance, and className is for layout only. Fix: shape="rect".',
      '[ouro-ui] Skeleton: "bg-muted" sets appearance, and className is for layout only. Fix: remove it; Skeleton takes its color from the theme\'s --muted.',
      '[ouro-ui] Skeleton: width is not a prop. Fix: <Skeleton className="w-[50%]">.',
      '[ouro-ui] Skeleton: height is not a prop. Fix: <Skeleton className="h-[2rem]">.',
    ]);
  });

  it("warns for an avatar shape and a size its shape does not have, and renders the defaults", async () => {
    const avatar = await render(<Skeleton {...({ shape: "avatar" } as unknown as SkeletonProps)} />);
    expect(avatar.getAttribute("data-shape")).toBe("rect");
    const circle = await render(<Skeleton {...({ shape: "circle", size: "huge" } as unknown as SkeletonProps)} />);
    expect(circle.getBoundingClientRect().width).toBe(40);
    await render(<Skeleton {...({ size: "md" } as unknown as SkeletonProps)} />);
    await render(<Skeleton {...({ shape: "row", size: "lg" } as unknown as SkeletonProps)} />);
    // An avatar with one of Avatar's sizes keeps it in the fix, and its size says nothing more.
    await render(<Skeleton {...({ shape: "avatar", size: "lg" } as unknown as SkeletonProps)} />);
    expect(warnings()).toEqual([
      '[ouro-ui] Skeleton: shape="avatar" is not a shape; use "rect", "text", "circle", "row", "card". Fix: <Skeleton shape="circle">.',
      '[ouro-ui] Skeleton: size="huge" is not a size for shape="circle"; use "xs", "sm", "md", "lg", "xl", "2xl", "3xl". Fix: <Skeleton shape="circle" size="xs">.',
      '[ouro-ui] Skeleton: size="md" is not a size for shape="rect"; use a layout class. Fix: <Skeleton className="h-32">.',
      '[ouro-ui] Skeleton: size="lg" is not a size for shape="row"; use "md", "sm". Fix: <Skeleton shape="row" size="md">.',
      '[ouro-ui] Skeleton: shape="avatar" is not a shape; use "rect", "text", "circle", "row", "card". Fix: <Skeleton shape="circle" size="lg">.',
    ]);
  });
});
