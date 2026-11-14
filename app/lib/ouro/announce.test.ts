import { afterEach, describe, expect, it, vi } from "vitest";
import { announce } from "~/lib/ouro/announce";

const regions = () => document.querySelectorAll<HTMLElement>("[data-ouro-announcer]");

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

  it("waits 100ms after creating the region before writing the first message (Safari)", () => {
    // The page's own timers are faked, so a slow frame on a busy runner cannot move the delay.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    announce("Loading");
    const region = regions()[0]!;
    // A frame is not enough: Safari drops messages added to a brand-new region that soon.
    vi.advanceTimersByTime(16);
    expect(region.textContent).toBe("");
    vi.advanceTimersByTime(84);
    expect(region.textContent).toBe("Loading");
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

  it("waits the longer delay a caller asks for, never less than 100ms", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    announce("All done", { delayMs: 1500 });
    const region = regions()[0]!;
    vi.advanceTimersByTime(1499);
    expect(region.textContent).toBe("");
    vi.advanceTimersByTime(1);
    expect(region.textContent).toBe("All done");
    announce("Saved", { delayMs: 10 });
    vi.advanceTimersByTime(99);
    expect(region.textContent).toBe("");
    vi.advanceTimersByTime(1);
    expect(region.textContent).toBe("Saved");
  });

  it("reuses the region across calls, keeping only the last message", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    announce("One");
    announce("Two");
    expect(regions()).toHaveLength(1);
    vi.advanceTimersByTime(100);
    expect(regions()[0]!.textContent).toBe("Two");
  });

  it("can cancel a pending message without cancelling a later caller's message", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const cancel = announce("Obsolete", { delayMs: 1500 });
    expect(cancel).toBeTypeOf("function");
    cancel!();
    vi.advanceTimersByTime(1500);
    expect(regions()[0]!.textContent).toBe("");
    announce("Another caller");
    cancel!();
    vi.advanceTimersByTime(100);
    expect(regions()[0]!.textContent).toBe("Another caller");
  });

  it("ignores an older cancellation after another message takes its place or finishes", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const cancel = announce("Old");
    expect(cancel).toBeTypeOf("function");
    announce("Latest");
    cancel!();
    vi.advanceTimersByTime(100);
    expect(regions()[0]!.textContent).toBe("Latest");
    cancel!();
    expect(regions()[0]!.textContent).toBe("Latest");
  });

  it("lets a later message replace the current one after an older cancellation", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const cancel = announce("Old");
    announce("Replaced");
    cancel!();
    announce("Latest", { delayMs: 500 });
    vi.advanceTimersByTime(100);
    expect(regions()[0]!.textContent).toBe("");
    vi.advanceTimersByTime(400);
    expect(regions()[0]!.textContent).toBe("Latest");
  });

  it("notifies the caller only after its message is written, not when cancelled or superseded", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const written: (string | null)[] = [];
    const options = { delayMs: 1500, onWrite: () => { written.push(regions()[0]!.textContent); } };
    announce("Saved", options);
    vi.advanceTimersByTime(1499);
    expect(written).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(written).toEqual(["Saved"]);
    const cancel = announce("Cancelled", options);
    cancel!();
    vi.advanceTimersByTime(1500);
    expect(written).toEqual(["Saved"]);
    announce("Superseded", options);
    announce("Another caller");
    vi.advanceTimersByTime(1500);
    expect(regions()[0]!.textContent).toBe("Another caller");
    expect(written).toEqual(["Saved"]);
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
