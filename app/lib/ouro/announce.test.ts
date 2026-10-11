import { afterEach, describe, expect, it, vi } from "vitest";
import { announce } from "~/lib/ouro/announce";

const regions = () => document.querySelectorAll<HTMLElement>("[data-ouro-announcer]");
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

afterEach(() => {
  vi.useRealTimers();
  for (const region of regions()) region.remove();
});

describe("announce", () => {
  it("creates one polite, visually hidden status region at the end of body", async () => {
    expect(regions()).toHaveLength(0);
    announce("Loading");
    const [region] = regions();
    expect(region!.getAttribute("role")).toBe("status");
    expect(region!.getAttribute("aria-live")).toBe("polite");
    expect(region!.getAttribute("aria-atomic")).toBe("true");
    expect(document.body.lastElementChild).toBe(region);
    const rect = region!.getBoundingClientRect();
    expect(rect.width).toBeLessThanOrEqual(1);
    expect(rect.height).toBeLessThanOrEqual(1);
    await expect.poll(() => region!.textContent).toBe("Loading");
  });

  it("waits 100ms after creating the region before writing the first message (Safari)", async () => {
    announce("Loading");
    const region = regions()[0]!;
    // A frame is not enough: Safari drops messages added to a brand-new region that soon.
    await nextFrame();
    expect(region.textContent).toBe("");
    await expect.poll(() => region.textContent).toBe("Loading");
  });

  it("uses timers, not animation frames, so a background tab still announces", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const raf = vi.spyOn(window, "requestAnimationFrame");
    announce("Loading");
    const region = regions()[0]!;
    vi.advanceTimersByTime(99);
    expect(region.textContent).toBe("");
    vi.advanceTimersByTime(1);
    expect(region.textContent).toBe("Loading");
    expect(raf).not.toHaveBeenCalled();
  });

  it("reuses the region across calls, keeping only the last message", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    announce("One");
    announce("Two");
    expect(regions()).toHaveLength(1);
    vi.advanceTimersByTime(100);
    expect(regions()[0]!.textContent).toBe("Two");
  });

  it("clears and re-sets a repeated message about 100ms later so it is spoken again", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    announce("Loading");
    vi.advanceTimersByTime(100);
    const region = regions()[0]!;
    expect(region.textContent).toBe("Loading");
    announce("Loading");
    expect(region.textContent).toBe("");
    vi.advanceTimersByTime(99);
    expect(region.textContent).toBe("");
    vi.advanceTimersByTime(1);
    expect(region.textContent).toBe("Loading");
  });

  it("recreates the region if the page removed it", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    announce("First");
    regions()[0]!.remove();
    announce("Second");
    expect(regions()).toHaveLength(1);
    vi.advanceTimersByTime(100);
    expect(regions()[0]!.textContent).toBe("Second");
  });
});
