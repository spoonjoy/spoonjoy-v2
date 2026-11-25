import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands } from "vitest/browser";
import { Avatar } from "~/components/ouro/avatar/avatar";
import { Card } from "~/components/ouro/card/card";
import { Item } from "~/components/ouro/item/item";
import { breathMs, correctAnimationClock, joinWave, stillMs } from "~/components/ouro/skeleton/skeleton-styles";
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

/** Milliseconds into the wave: the animation's time less its delay, so a placeholder joined mid-breath reads where it is, and one still waiting reads below zero. */
function animationPhase(el: Element): number {
  const effect = el.getAnimations()[0]!.effect!;
  return Number(effect.getComputedTiming().localTime) - Number(effect.getTiming().delay);
}

/**
 * Once its animation's own clock is pegged to a real frame, a placeholder corrects it to the
 * join a fresh clock read would have given it, so a hold between the layout effect's read and
 * that frame no longer leaves the two apart by the hold's own length. Held right after mounting
 * for 300ms or 2000ms, the two later tests below land the join within a few milliseconds, on
 * Chromium and on WebKit, and fail at this same bound without that correction (a host held
 * 2000ms then landed 310-400ms apart, run local to this change). This bound keeps headroom past
 * that measured join while still catching a desync within a slice of a breath (2400ms).
 */
const phaseGapMs = 150;

/** How far apart two phases are on the wave's circle: a phase a hair under one whole breath (2400ms) away is close, not far, so this takes the shorter way around. */
function phaseGap(a: number, b: number): number {
  const d = Math.abs(a - b) % breathMs;
  return Math.min(d, breathMs - d);
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
  await commands.resetMedia();
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

  it("keeps its fixed sizes at a compact --spacing: the block, a row's media and each avatar box", async () => {
    const host = document.createElement("div");
    host.style.width = "300px";
    document.body.append(host);
    mounted.push(host);
    const root = createRoot(host);
    roots.push(root);
    const sizes = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl"] as const;
    await act(async () =>
      root.render(
        <>
          <Skeleton />
          <Skeleton shape="row" />
          {sizes.map((size) => (
            <Skeleton key={size} shape="circle" size={size} />
          ))}
        </>,
      ),
    );
    const boxes = () => {
      const [block, row, ...circles] = [...host.querySelectorAll<HTMLElement>('[data-ouro="skeleton"]')];
      const media = row!.firstElementChild!.getBoundingClientRect();
      return [
        block!.getBoundingClientRect().height,
        [media.width, media.height],
        circles.map((circle) => circle.getBoundingClientRect().width),
      ];
    };
    expect(boxes()).toEqual([16, [40, 40], [24, 32, 40, 48, 64, 72, 112]]);
    host.style.setProperty("--spacing", "0.2rem");
    expect(boxes()).toEqual([16, [40, 40], [24, 32, 40, 48, 64, 72, 112]]);
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

  it("holds still for a second, then breathes by opacity only, and holds still with reduced motion", async () => {
    const skeleton = await render(<Skeleton />);
    const style = getComputedStyle(skeleton);
    expect(style.animationName).toBe("ouro-skeleton-breathe");
    // At most the first second: a placeholder that joins a wave begun a moment ago waits only for what remains of it.
    expect(parseFloat(style.animationDelay)).toBeLessThanOrEqual(1);
    expect(style.animationTimingFunction).toBe("ease-in-out");
    expect(style.animationIterationCount).toBe("infinite");
    const effect = skeleton.getAnimations()[0]!.effect as KeyframeEffect;
    const frames = effect.getKeyframes();
    expect([...new Set(frames.flatMap((frame) => Object.keys(frame)))].filter((key) => !["offset", "computedOffset", "easing", "composite"].includes(key))).toEqual(["opacity"]);
    // Ends where it starts, so the loop has no seam.
    expect(frames.at(0)!["opacity"]).toBe(frames.at(-1)!["opacity"]);
    await commands.emulateMedia({ reducedMotion: "reduce" });
    // WebKit hasn't always applied the emulated media by the next statement (#3518): poll instead of reading once.
    await expect.poll(() => getComputedStyle(skeleton).animationName).toBe("none");
    // The media change cancels the animation on its own frame, a frame that can land after this
    // read, as it does elsewhere in the suite: polls past that lag instead of assuming it is done.
    await expect.poll(() => skeleton.getAnimations({ subtree: true }).length).toBe(0);
  });

  it("joins one shared phase: a placeholder mounted mid-breath, or remounted, is where the others are, and reduced motion draws none", async () => {
    const phase = animationPhase;
    const first = await render(<Skeleton />);
    const root = roots.at(-1)!;
    await expect.poll(() => phase(first)).toBeGreaterThan(1300);
    const late = await render(<Skeleton />);
    // Both are read in one task, so they share close to a frame's time.
    const [a, b] = [phase(first), phase(late)];
    expect(phaseGap(a, b)).toBeLessThan(phaseGapMs);
    // A remount (a new key) while the others breathe keeps the phase.
    await act(async () => root.render(<Skeleton key="again" />));
    const again = mounted.at(-2)!.querySelector<HTMLElement>('[data-ouro="skeleton"]')!;
    expect(phaseGap(phase(again), phase(late))).toBeLessThan(phaseGapMs);
    await commands.emulateMedia({ reducedMotion: "reduce" });
    // WebKit hasn't always applied the emulated media by the next statement (#3518): poll instead of reading once.
    await expect.poll(() => getComputedStyle(late).animationName).toBe("none");
    // See the test above: polls past the cancellation's own frame lag.
    await expect.poll(() => late.getAnimations().length).toBe(0);
  });

  it("joins the shared phase past a host held right after it mounts, before its first frame can peg its own clock", async () => {
    const phase = animationPhase;
    const first = await render(<Skeleton />);
    // Holds the main thread right after mounting, while the animation is still pending (its own clock, its
    // startTime, not yet pegged to a real frame): the moment this placeholder's delay assumed was now.
    const holdUntil = performance.now() + 300;
    while (performance.now() < holdUntil) { /* holds the main thread, no yield */ }
    const late = await render(<Skeleton />);
    // Each animation's own clock is pegged, and the correction that follows it lands, on its own
    // promise-and-frame chain (readiness commits on whatever frame a loaded host gets to it): a fixed
    // frame count races that chain, so this polls the gap itself until it settles or the poll times out.
    await expect.poll(() => phaseGap(phase(first), phase(late))).toBeLessThan(phaseGapMs);
  });

  it("joins the shared phase past a host held for longer than the mount itself takes", async () => {
    const phase = animationPhase;
    const first = await render(<Skeleton />);
    // A hold well past the bound's comment checks the join still tracks the clock, not the hold.
    const holdUntil = performance.now() + 2000;
    while (performance.now() < holdUntil) { /* holds the main thread, no yield */ }
    const late = await render(<Skeleton />);
    // See above: polls past the correction's own promise-and-frame chain rather than assuming it settles in two frames.
    await expect.poll(() => phaseGap(phase(first), phase(late))).toBeLessThan(phaseGapMs);
  });

  it("joins the shared phase on a row's and a card's own Bar, past a host held right after mounting", async () => {
    // registerNode's node is the outer row/card span, not the Bar the animation plays on: the
    // correction below must read each registered node's whole subtree to reach it.
    for (const shape of ["row", "card"] as const) {
      const host = (await render(<Skeleton shape={shape} />)).parentElement!;
      const holdUntil = performance.now() + 300;
      while (performance.now() < holdUntil) { /* holds the main thread, no yield */ }
      const late = (await render(<Skeleton shape={shape} />)).parentElement!;
      const firstAnimation = host.getAnimations({ subtree: true })[0]!;
      const lateAnimation = late.getAnimations({ subtree: true })[0]!;
      const localTime = (animation: Animation) => Number(animation.effect!.getComputedTiming().localTime) - Number(animation.effect!.getTiming().delay);
      // See the host-held test above: polls past the correction's own promise-and-frame chain rather than
      // assuming it settles in two frames.
      await expect
        .poll(() => phaseGap(localTime(firstAnimation), localTime(lateAnimation)), { message: shape })
        .toBeLessThan(phaseGapMs);
    }
  });

  it("drops a row's node from the correction map once it unmounts, so a frame already pending for it does not read a removed node", async () => {
    // Holds the mount's own correction frame instead of letting it run: by the time a real one would
    // fire, this test harness has already settled the render below it, which would otherwise race it.
    let pendingFrame: FrameRequestCallback | undefined;
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      pendingFrame = callback;
      return 0;
    });
    await render(<Skeleton shape="row" count={3} />);
    const root = roots.at(-1)!;
    raf.mockRestore();
    const spy = vi.spyOn(Element.prototype, "getAnimations");
    // Shrinks while the mount's correction frame is still held: the two dropped rows' nodes must leave the map themselves.
    await act(async () => root.render(<Skeleton shape="row" count={1} />));
    pendingFrame!(performance.now());
    // The map should hold just the surviving row's node: one call, on that node alone.
    expect(spy.mock.instances).toHaveLength(1);
  });

  it("runs its correction frame without throwing where the DOM has no getAnimations, as in jsdom", async () => {
    // jsdom, which apps' own component tests often run in, has no Element.getAnimations: the frame that corrects
    // the wave's phase must skip the correction there rather than throw from a requestAnimationFrame callback.
    let pendingFrame: FrameRequestCallback | undefined;
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      pendingFrame = callback;
      return 0;
    });
    await render(<Skeleton shape="row" />);
    raf.mockRestore();
    const own = Object.getOwnPropertyDescriptor(Element.prototype, "getAnimations")!;
    // @ts-expect-error -- removed on purpose, to stand for a DOM that never had it.
    delete Element.prototype.getAnimations;
    // jsdom has no CSSAnimation either, so the frame must not reach the instanceof check at all.
    vi.stubGlobal("CSSAnimation", undefined);
    try {
      expect(() => pendingFrame!(performance.now())).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
      Object.defineProperty(Element.prototype, "getAnimations", own);
    }
  });

  it("keeps each index's ref callback across renders, so a render that only changes a prop does not detach and reattach the node", async () => {
    let attaches = 0;
    let detaches = 0;
    const track = (node: HTMLElement | null) => {
      if (node) attaches++;
      else detaches++;
    };
    await render(<Skeleton ref={track} />);
    const root = roots.at(-1)!;
    await act(async () => root.render(<Skeleton ref={track} className="extra" />));
    expect(attaches).toBe(1);
    expect(detaches).toBe(0);
  });

  it("cancels its pending correction frame on unmount, so an already-stale frame never reads a gone node", async () => {
    const spy = vi.spyOn(window, "cancelAnimationFrame");
    await render(<Skeleton />);
    const root = roots.pop()!;
    await act(async () => root.unmount());
    expect(spy).toHaveBeenCalled();
  });

  it("re-measures its place when shimmer toggles on the same instance, without remounting", async () => {
    const breathes = (el: Element) => getComputedStyle(el).animationName === "ouro-skeleton-breathe";
    const el = await render(<Skeleton shimmer={false} />);
    const root = roots.at(-1)!;
    expect(breathes(el)).toBe(false);
    await act(async () => root.render(<Skeleton shimmer />));
    expect(breathes(el)).toBe(true);
  });

  it("places a placeholder in the wave: a new wave after a quiet gap of more than a second, else the running one", () => {
    expect(joinWave(5000, 0, 3999, 100)).toEqual({ start: 5000, delay: "1000ms" });
    expect(joinWave(5000, 0, 4000, 100)).toEqual({ start: 100, delay: `${-((4900 - stillMs) % breathMs)}ms` });
    expect(joinWave(5000, 1, Number.NEGATIVE_INFINITY, 4001)).toEqual({ start: 4001, delay: "1ms" });
    expect(joinWave(5000, 1, 0, 4000).delay).toBe("0ms");
    expect(joinWave(5000, 1, 0, 3999).delay).toBe("-1ms");
    expect(joinWave(9000, 2, 0, 1000).delay).toBe(`${-((8000 - stillMs) % breathMs)}ms`);
  });

  it("does not revive an animation that went idle between its ready settling and the clock correction's write", () => {
    // A real race here depends on frame timing this suite cannot hold still (reduced motion cancelling the
    // animation in the gap between its ready resolving and this write running), so this drives the exact
    // ordering directly with a plain object standing in for the animation: playState already idle, as a
    // cancel would leave it, by the time the write would run.
    const animation = { playState: "idle", currentTime: null as number | null };
    correctAnimationClock(animation, 5000, 4000, 1000);
    expect(animation.currentTime).toBeNull();
  });

  it("writes the fresh clock when the animation is still running", () => {
    const animation = { playState: "running", currentTime: null as number | null };
    correctAnimationClock(animation, 5000, 4000, 1000);
    expect(animation.currentTime).toBe(1000 - Number.parseFloat(joinWave(5000, 1, 0, 4000).delay));
  });

  it("measures a phase gap the short way around the circle, so a near-whole-breath difference reads as close", () => {
    // 5 and 2395 sit 10ms apart going the other way around a 2400ms breath, not 2390ms apart.
    expect(phaseGap(5, 2395)).toBe(10);
    expect(phaseGap(2395, 5)).toBe(10);
    expect(phaseGap(100, 100)).toBe(0);
    expect(phaseGap(0, 1200)).toBe(1200);
  });

  it("keeps the app's own style beside the wave's phase, on every shape", async () => {
    const own = { marginTop: "7px" };
    const shapes = [
      await render(<Skeleton style={own} />),
      await render(<Skeleton shape="text" style={own} />),
      (await render(<Skeleton shape="row" style={own} />)),
      (await render(<Skeleton shape="card" style={own} />)),
    ];
    for (const shape of shapes) {
      const holder = [shape, ...shape.querySelectorAll<HTMLElement>("[style]")].find((el) => el.style.marginTop === "7px");
      expect(holder, "the app's style survives").toBeDefined();
    }
  });

  it("starts a new wave, still for its first second, once none has been mounted for a second", async () => {
    const first = await render(<Skeleton />);
    await expect.poll(() => animationPhase(first)).toBeGreaterThan(1300);
    await act(async () => roots.splice(0).forEach((root) => root.unmount()));
    // real clock: the wave's own one-second gap, which no state in the page reports.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const fresh = await render(<Skeleton />);
    expect(animationPhase(fresh)).toBeLessThan(500);
  });

  it("breathes only the first 24 of a long list, and a later list finds the places taken", async () => {
    const list = (count: number) => (
      <div>
        {Array.from({ length: count }, (_, index) => (
          <Skeleton key={index} />
        ))}
      </div>
    );
    const host = (await render(list(131))).parentElement!;
    const animated = () => [...host.querySelectorAll("[data-ouro=skeleton]")].filter((el) => getComputedStyle(el).animationName === "ouro-skeleton-breathe").length;
    expect(animated()).toBe(24);
    const phased = [...host.querySelectorAll<HTMLElement>("[data-ouro=skeleton]")].filter((el) => el.style.getPropertyValue("--ouro-skeleton-delay") !== "").length;
    expect(phased, "only the placeholders that breathe join the wave").toBe(24);
    const again = (await render(list(5))).parentElement!;
    expect(animated()).toBe(24);
    expect([...again.querySelectorAll("[data-ouro=skeleton]")].filter((el) => getComputedStyle(el).animationName === "ouro-skeleton-breathe")).toHaveLength(0);
  });

  it("takes no place for a still placeholder, and claims one when it starts to breathe", async () => {
    const breathes = (el: Element) => getComputedStyle(el).animationName === "ouro-skeleton-breathe";
    const still = await render(
      <div>
        {Array.from({ length: 30 }, (_, index) => (
          <Skeleton key={index} shimmer={false} />
        ))}
      </div>,
    );
    const stillHost = still.parentElement!;
    const stillRoot = roots.at(-1)!;
    const first = await render(
      <div>
        {Array.from({ length: 24 }, (_, index) => (
          <Skeleton key={index} />
        ))}
      </div>,
    );
    expect([...first.parentElement!.querySelectorAll("[data-ouro=skeleton]")].every(breathes)).toBe(true);
    await act(async () => stillRoot.render(<Skeleton shimmer />));
    expect(breathes(stillHost.querySelector("[data-ouro=skeleton]")!)).toBe(false);
  });

  it("hands its place on when a breathing placeholder turns still", async () => {
    const breathes = (el: Element) => getComputedStyle(el).animationName === "ouro-skeleton-breathe";
    const list = (stillFirst: boolean) => (
      <div>
        {Array.from({ length: 24 }, (_, index) => (
          <Skeleton key={index} shimmer={index === 0 ? !stillFirst : true} />
        ))}
      </div>
    );
    const first = await render(list(false));
    const root = roots.at(-1)!;
    await act(async () => root.render(list(true)));
    const late = await render(<Skeleton />);
    expect(breathes(late)).toBe(true);
    expect(first).toBeTruthy();
  });

  it("renders the first pass breathing, so the server's HTML and the client's agree", () => {
    expect(renderToString(<Skeleton />)).toContain("ouro-skeleton-breathe");
  });

  it("draws every shape still with shimmer={false}: no animation on the placeholder or anything inside it", async () => {
    await render(
      <>
        <Skeleton shimmer={false} />
        <Skeleton shape="text" lines={2} shimmer={false} />
        <Skeleton shape="circle" shimmer={false} />
        <Skeleton shape="row" count={2} shimmer={false} />
        <Skeleton shape="card" shimmer={false} />
      </>,
    );
    const host = mounted.at(-1)!;
    expect(host.getAnimations({ subtree: true })).toEqual([]);
    const nodes = [...host.querySelectorAll<HTMLElement>('[data-ouro="skeleton"], [data-ouro="skeleton"] *')];
    expect(nodes.length).toBeGreaterThan(5);
    for (const node of [...nodes, host]) expect(getComputedStyle(node).animationName).toBe("none");
  });

  it("breathes every shape, each loop one animation on the placeholder itself", async () => {
    await render(
      <>
        <Skeleton />
        <Skeleton shape="text" lines={2} />
        <Skeleton shape="circle" />
        <Skeleton shape="row" count={2} />
        <Skeleton shape="card" />
      </>,
    );
    const animations = mounted.at(-1)!.getAnimations({ subtree: true });
    expect(animations.length).toBeGreaterThan(5);
    for (const animation of animations) {
      const effect = animation.effect as KeyframeEffect;
      expect(effect.pseudoElement).toBeNull();
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
      "[ouro-ui] Skeleton: animation is not a prop; Skeleton breathes, and holds still with reduced motion. Fix: <Skeleton>.",
      '[ouro-ui] Skeleton: width is not a prop. Fix: <Skeleton className="w-[120px]">.',
      '[ouro-ui] Skeleton: height is not a prop. Fix: <Skeleton className="h-[20px]">.',
    ]);
  });

  it("maps each MUI variant and other appearance classes to the fix", async () => {
    for (const variant of ["text", "rectangular", "rounded", "wave"]) {
      await render(<Skeleton {...({ variant } as unknown as SkeletonProps)} />);
    }
    await render(<Skeleton className="rounded-ouro-md" />);
    await render(<Skeleton className="bg-muted" />);
    await render(<Skeleton {...({ width: "50%", height: "2rem" } as unknown as SkeletonProps)} />);
    expect(warnings()).toEqual([
      '[ouro-ui] Skeleton: variant is not a prop. Fix: <Skeleton shape="text">.',
      '[ouro-ui] Skeleton: variant is not a prop. Fix: <Skeleton shape="rect">.',
      '[ouro-ui] Skeleton: variant is not a prop. Fix: <Skeleton shape="rect">.',
      '[ouro-ui] Skeleton: variant is not a prop. Fix: <Skeleton shape="rect">.',
      '[ouro-ui] Skeleton: "rounded-ouro-md" sets appearance, and className is for layout only. Fix: shape="rect".',
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
