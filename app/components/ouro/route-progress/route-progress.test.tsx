import { type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page } from "vitest/browser";
import { RouteProgress } from "~/components/ouro/route-progress/route-progress";
import { act } from "~/lib/ouro/testing/act";
import { watchAnnouncements } from "~/lib/ouro/testing/announcements";
import { expectMotion, expectNoMotion, parseDuration } from "~/lib/ouro/testing/motion";

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
    root,
    get region() {
      return host.querySelector<HTMLElement>('[data-ouro="route-progress"]')!;
    },
    get bar() {
      return host.querySelector<HTMLElement>('[data-ouro-part="bar"]')!;
    },
    get indicator() {
      return host.querySelector<HTMLElement>('[data-ouro-part="indicator"]')!;
    },
  };
}

const token = (name: string) => parseDuration(getComputedStyle(document.documentElement).getPropertyValue(name));

/** Takes over the component's timers (its delay and its trickle), not animation frames or polling. */
const fakeTimers = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });

/** How far the bar is filled: the fraction of the width the indicator is heading to. */
const progress = (indicator: HTMLElement) => Number(indicator.style.getPropertyValue("--ouro-route-progress"));

/** Runs `check` the moment `attribute` appears on `element`, in the microtask after React sets it, before its transition has run. */
function when(element: Element, attribute: string, check: () => Promise<unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      if (!element.hasAttribute(attribute)) return;
      observer.disconnect();
      check().then(resolve, reject);
    });
    observer.observe(element, { attributes: true, attributeFilter: [attribute] });
  });
}

/** Resolves once nothing runs on the element: its transitions have ended. */
const still = (element: Element) => expect.poll(() => element.getAnimations().length).toBe(0);

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
  await commands.emulateMedia({ reducedMotion: "no-preference" });
});

describe("RouteProgress", () => {
  it("is a 2px bar fixed across the top of the screen in the primary color, which no click reaches", async () => {
    const { region, bar, indicator } = await render(<RouteProgress active />);
    expect(getComputedStyle(region).position).toBe("fixed");
    const rect = region.getBoundingClientRect();
    expect(rect.top).toBe(0);
    expect(rect.left).toBe(0);
    expect(rect.width).toBe(innerWidth);
    expect(rect.height).toBe(2);
    expect(getComputedStyle(region).pointerEvents).toBe("none");
    expect(bar.getAttribute("aria-hidden")).toBe("true");
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--primary)";
    document.body.append(probe);
    mounted.push(probe);
    expect(getComputedStyle(indicator).backgroundColor).toBe(getComputedStyle(probe).backgroundColor);
    await expect.poll(() => getComputedStyle(bar).opacity).toBe("1");
  });

  it("is a status region that is empty while idle and says the label once the bar shows", async () => {
    const { root, region } = await render(<RouteProgress active={false} />);
    expect(region.getAttribute("role")).toBe("status");
    expect(region.textContent).toBe("");
    await act(async () => root.render(<RouteProgress active />));
    await expect.element(page.getByRole("status")).toHaveTextContent("Loading");
    await act(async () => root.render(<RouteProgress active label="Opening the recipe" />));
    expect(region.textContent).toBe("Opening the recipe");
  });

  it("is heard once when a navigation starts, and not again while it runs", async () => {
    const { root } = await render(<RouteProgress active={false} />);
    const announcements = watchAnnouncements();
    try {
      await act(async () => root.render(<RouteProgress active />));
      await act(async () => root.render(<RouteProgress active />));
      await expect.poll(() => announcements.count("Loading")).toBe(1);
      await act(async () => root.render(<RouteProgress active={false} />));
      await act(async () => root.render(<RouteProgress active />));
      await expect.poll(() => announcements.count("Loading")).toBe(2);
      expect(announcements.matching("Loading")[0]!.region.getAttribute("data-ouro")).toBe("route-progress");
    } finally {
      announcements.stop();
    }
  });

  it("waits 150ms before it shows or speaks, so a fast navigation shows and says nothing", async () => {
    const { root, region, bar } = await render(<RouteProgress active={false} />);
    const announcements = watchAnnouncements();
    fakeTimers();
    try {
      await act(async () => root.render(<RouteProgress active />));
      await act(async () => vi.advanceTimersByTime(149));
      expect(bar.hasAttribute("data-closed")).toBe(true);
      expect(region.textContent).toBe("");
      await act(async () => root.render(<RouteProgress active={false} />));
      await act(async () => vi.advanceTimersByTime(5000));
      expect(bar.hasAttribute("data-closed")).toBe(true);
      expect(getComputedStyle(bar).opacity).toBe("0");
      expect(announcements.changes).toEqual([]);
      // A slower one shows at 150ms and is heard once, however long it runs.
      await act(async () => root.render(<RouteProgress active />));
      await act(async () => vi.advanceTimersByTime(149));
      expect(bar.hasAttribute("data-open")).toBe(false);
      await act(async () => vi.advanceTimersByTime(1));
      expect(bar.hasAttribute("data-open")).toBe(true);
      await expect.poll(() => announcements.count("Loading")).toBe(1);
      await act(async () => vi.advanceTimersByTime(10_000));
      expect(announcements.changes).toHaveLength(1);
    } finally {
      announcements.stop();
    }
  });

  it("trickles toward 90%, more slowly the nearer it gets, and never reaches it", async () => {
    const { root, indicator } = await render(<RouteProgress active={false} />);
    fakeTimers();
    await act(async () => root.render(<RouteProgress active />));
    expect(progress(indicator)).toBe(0);
    await act(async () => vi.advanceTimersByTime(150));
    const values = [progress(indicator)];
    expect(values[0]).toBeGreaterThan(0);
    // Every two seconds for a minute.
    for (let sample = 0; sample < 30; sample++) {
      await act(async () => vi.advanceTimersByTime(2000));
      values.push(progress(indicator));
    }
    const steps = values.slice(1).map((value, index) => value - values[index]!);
    for (const [index, step] of steps.entries()) {
      expect(step, `sample ${index + 1}`).toBeGreaterThan(0);
      if (index > 0) expect(step, `sample ${index + 1}`).toBeLessThan(steps[index - 1]!);
    }
    expect(values.at(-1)).toBeGreaterThan(0.85);
    expect(values.at(-1)).toBeLessThan(0.9);
    // The bar shows that much of the width once its step has run.
    vi.useRealTimers();
    await still(indicator);
    expect(indicator.getBoundingClientRect().width / innerWidth).toBeCloseTo(values.at(-1)!, 2);
  });

  it("fades in and grows when it shows, fills to the end and fades out when the navigation ends; with reduced motion it only fades", async () => {
    const { root, bar, indicator } = await render(<RouteProgress active={false} />);
    expect(getComputedStyle(bar).opacity).toBe("0");
    fakeTimers();
    for (const reduced of [false, true]) {
      await commands.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
      const opacity = token(reduced ? "--ouro-duration-fast" : "--ouro-duration-base");
      const scale = token("--ouro-duration-slow");
      await act(async () => root.render(<RouteProgress active />));
      flushSync(() => vi.advanceTimersByTime(150));
      await Promise.all([
        expectMotion(bar, { stem: "route-progress", state: "data-open", properties: { opacity }, reduced }),
        reduced
          ? expectNoMotion(indicator, { stem: "route-progress", state: "data-open", reduced })
          : expectMotion(indicator, { stem: "route-progress", state: "data-open", properties: { scale }, reduced }),
      ]);
      expect(getComputedStyle(bar).opacity).toBe("1");
      // With reduced motion the bar is whole and still from the start.
      if (reduced) expect(indicator.getBoundingClientRect().width).toBe(innerWidth);
      const closed = when(bar, "data-closed", () => {
        // Full, it holds still while the bar fades.
        expect(indicator.getAnimations()).toEqual([]);
        return expectMotion(bar, { stem: "route-progress", state: "data-closed", properties: { opacity }, reduced });
      });
      flushSync(() => root.render(<RouteProgress active={false} />));
      if (reduced) {
        await expectNoMotion(indicator, { stem: "route-progress", state: "data-open", reduced });
      } else {
        await expectMotion(indicator, { stem: "route-progress", state: "data-open", properties: { scale }, reduced });
        expect(indicator.getBoundingClientRect().width).toBe(innerWidth);
      }
      await closed;
      expect(getComputedStyle(bar).opacity).toBe("0");
      // Hidden, it empties for the next navigation.
      await expect.poll(() => progress(indicator)).toBe(0);
    }
  });

  it("carries on at once when a navigation starts while the last one finishes", async () => {
    const { root, region, bar, indicator } = await render(<RouteProgress active={false} />);
    fakeTimers();
    await act(async () => root.render(<RouteProgress active />));
    await act(async () => vi.advanceTimersByTime(150));
    const start = progress(indicator);
    // While it fills to the end.
    await act(async () => root.render(<RouteProgress active={false} />));
    expect(progress(indicator)).toBe(1);
    expect(region.textContent).toBe("");
    await act(async () => root.render(<RouteProgress active />));
    expect(bar.hasAttribute("data-open")).toBe(true);
    expect(region.textContent).toBe("Loading");
    expect(progress(indicator)).toBe(start);
    // The fill it started never ends it.
    await still(indicator);
    expect(bar.hasAttribute("data-open")).toBe(true);
    // While it fades out.
    const faded = new Promise<void>((resolve) => void when(bar, "data-closed", async () => resolve()));
    await act(async () => root.render(<RouteProgress active={false} />));
    await faded;
    await act(async () => root.render(<RouteProgress active />));
    expect(bar.hasAttribute("data-open")).toBe(true);
    expect(region.textContent).toBe("Loading");
    await still(bar);
    expect(bar.hasAttribute("data-open")).toBe(true);
    expect(getComputedStyle(bar).opacity).toBe("1");
    await act(async () => vi.advanceTimersByTime(400));
    expect(progress(indicator)).toBeGreaterThan(start);
  });

  it("fills from the start edge in either direction", async () => {
    fakeTimers();
    for (const dir of ["ltr", "rtl"] as const) {
      const { host, root, indicator } = await render(<RouteProgress active={false} />);
      host.dir = dir;
      await act(async () => root.render(<RouteProgress active />));
      await act(async () => vi.advanceTimersByTime(150));
      await still(indicator);
      const rect = indicator.getBoundingClientRect();
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.width).toBeLessThan(innerWidth / 2);
      if (dir === "ltr") expect(rect.left).toBe(0);
      else expect(rect.right).toBe(innerWidth);
    }
  });

  it("clears its timers when it unmounts, while it waits and while it trickles", async () => {
    fakeTimers();
    const waiting = await render(<RouteProgress active />);
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => waiting.root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    const trickling = await render(<RouteProgress active />);
    await act(async () => vi.advanceTimersByTime(150));
    expect(trickling.bar.hasAttribute("data-open")).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => trickling.root.unmount());
    expect(vi.getTimerCount()).toBe(0);
  });

  it("forwards a ref and lets app layout classes win", async () => {
    let element: HTMLDivElement | null = null;
    const { region } = await render(<RouteProgress active className="top-14" ref={(node) => void (element = node)} />);
    expect(element).toBe(region);
    expect(region.getBoundingClientRect().top).toBe(56);
  });

  it("does not print", async () => {
    const { region } = await render(<RouteProgress active />);
    expect(region.className).toContain("print:hidden");
  });
});

describe("RouteProgress development messages", () => {
  const fix = '<RouteProgress active={navigation.state !== "idle"} />';
  it.each([
    ["loading", { loading: true }, "loading is not a prop", fix],
    ["isLoading", { isLoading: true }, "isLoading is not a prop", fix],
    ["value", { active: true, value: 50 }, "RouteProgress has no amount", "<Progress value={50}>"],
  ])("names the fix for %s", async (_name, extra, problem, message) => {
    const props = { ...extra } as unknown as Parameters<typeof RouteProgress>[0];
    const { region } = await render(<RouteProgress {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] RouteProgress: ${problem}. Fix: ${message}.`);
    for (const attribute of ["loading", "isloading", "value"]) expect(region.hasAttribute(attribute)).toBe(false);
  });

  it("names a missing active", async () => {
    const props = {} as unknown as Parameters<typeof RouteProgress>[0];
    await render(<RouteProgress {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] RouteProgress: active is required; pass whether a navigation is under way. Fix: ${fix}.`);
  });

  it.each([
    ["bg-red-500", 'remove "bg-red-500"; RouteProgress takes the theme\'s --primary color'],
    ["top-14", ""],
  ])("checks the className %s", async (className, message) => {
    await render(<RouteProgress active className={className} />);
    if (message) {
      expect(warn).toHaveBeenCalledWith(`[ouro-ui] RouteProgress: "${className}" sets appearance, and className is for layout only. Fix: ${message}.`);
    } else {
      expect(warn).not.toHaveBeenCalled();
    }
  });

  it("renders to a string without messages", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(<RouteProgress active className="bg-red-500" />);
    expect(html).toContain('data-ouro="route-progress"');
    expect(html).toContain('role="status"');
    // Hidden and silent: the bar waits on the client before it shows.
    expect(html).toContain("data-closed");
    expect(html).not.toContain("Loading");
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
