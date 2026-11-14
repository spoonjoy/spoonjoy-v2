import { commands, server } from "vitest/browser";
import { expect, test, vi } from "vitest";

test("emulateMedia switches reduced motion and color scheme", async () => {
  await commands.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  expect(matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(true);
  expect(matchMedia("(prefers-color-scheme: dark)").matches).toBe(true);
  await commands.emulateMedia({ reducedMotion: "no-preference", colorScheme: "light" });
  expect(matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(false);
});

test("emulateMedia returns once the frame matches the preference, so the next line reads its styles", async () => {
  // Read on the very next line, with no await between: a frame that has not re-evaluated its media
  // queries still gives the old value here, which is the race this test guards.
  const style = document.createElement("style");
  style.textContent = ".media-probe{transition-property:height}@media (prefers-reduced-motion: reduce){.media-probe{transition-property:opacity}}.scheme-probe{transition-property:height}@media (prefers-color-scheme: dark){.scheme-probe{transition-property:color}}";
  const motion = document.createElement("div");
  motion.className = "media-probe";
  const scheme = document.createElement("div");
  scheme.className = "scheme-probe";
  document.head.append(style);
  document.body.append(motion, scheme);
  try {
    await commands.emulateMedia({ reducedMotion: "reduce" });
    expect(getComputedStyle(motion).transitionProperty).toBe("opacity");
    await commands.emulateMedia({ reducedMotion: "no-preference" });
    expect(getComputedStyle(motion).transitionProperty).toBe("height");
    await commands.emulateMedia({ colorScheme: "dark" });
    expect(getComputedStyle(scheme).transitionProperty).toBe("color");
    await commands.emulateMedia({ colorScheme: "light" });
    expect(getComputedStyle(scheme).transitionProperty).toBe("height");
  } finally {
    motion.remove();
    scheme.remove();
    style.remove();
  }
});

test("emulateMedia throws, naming the query, when the frame never matches it", async () => {
  // Stub the frame's matchMedia so the reduced-motion query never matches, whatever the page emulates.
  const real = window.matchMedia;
  window.matchMedia = ((query: string) => (query === "(prefers-reduced-motion: reduce)" ? { matches: false } : real.call(window, query))) as typeof window.matchMedia;
  try {
    await expect(commands.emulateMedia({ reducedMotion: "reduce" })).rejects.toThrow("does not match (prefers-reduced-motion: reduce)");
  } finally {
    window.matchMedia = real;
    await commands.emulateMedia({ reducedMotion: "no-preference" });
  }
}, 20_000);

test("emulateMedia names the query the frame never matched, even when its last read does not answer", async () => {
  // The query never matches, and the first read after 6 s holds the frame until 14 s after the start, as a loaded runner
  // can: past the 10 s wait and the 3 s a read may take, however late in the wait that read began.
  const real = window.matchMedia;
  const start = performance.now();
  let stalled = false;
  window.matchMedia = ((query: string) => {
    if (query !== "(prefers-reduced-motion: reduce)") return real.call(window, query);
    if (!stalled && performance.now() - start > 6000) {
      stalled = true;
      while (performance.now() < start + 14_000);
    }
    return { matches: false };
  }) as typeof window.matchMedia;
  try {
    await expect(commands.emulateMedia({ reducedMotion: "reduce" })).rejects.toThrow("does not match (prefers-reduced-motion: reduce)");
    expect(stalled).toBe(true);
  } finally {
    window.matchMedia = real;
    await commands.emulateMedia({ reducedMotion: "no-preference" });
  }
}, 30_000);

test("emulateMedia returns while the test's fake timers are on", async () => {
  // The frame's timers are faked, so a wait that relied on them would never end.
  vi.useFakeTimers();
  try {
    await commands.emulateMedia({ reducedMotion: "reduce" });
    expect(matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(true);
  } finally {
    vi.useRealTimers();
    await commands.emulateMedia({ reducedMotion: "no-preference" });
  }
});

test.skipIf(server.browser !== "chromium")("emulateMedia returns once forced colours have settled, past any transition the switch started", async () => {
  // A fill with a transition (the `press` utility's) eases to the forced value: read at once,
  // it is a colour between the two, which no rule set.
  const style = document.createElement("style");
  style.textContent = ".settle-box{width:40px;height:40px;background-color:rgb(255,0,0);transition:background-color 300ms linear}@media (forced-colors:active){.settle-box{background-color:Highlight}}";
  const box = document.createElement("div");
  box.className = "settle-box";
  document.head.append(style);
  document.body.append(box);
  try {
    expect(getComputedStyle(box).backgroundColor).toBe("rgb(255, 0, 0)");
    await commands.emulateMedia({ forcedColors: "active" });
    expect(document.getAnimations().filter((animation) => animation.playState === "running")).toHaveLength(0);
  } finally {
    await commands.emulateMedia({ forcedColors: "none" });
    box.remove();
    style.remove();
  }
});

test.skipIf(server.browser !== "chromium")("drag command sends mouse down, moves and up", async () => {
  // Chromium only: WebKit drag is covered by the video feel check (plan Task 5).
  const events: string[] = [];
  const target = document.createElement("div");
  target.style.cssText = "position:fixed;inset:0;";
  document.body.append(target);
  for (const type of ["mousedown", "mousemove", "mouseup"]) {
    target.addEventListener(type, () => events.push(type));
  }
  await commands.drag({ from: [10, 10], to: [10, 100], steps: 4, durationMs: 40 });
  target.remove();
  const down = events.indexOf("mousedown");
  expect(down).toBeGreaterThanOrEqual(0);
  expect(events.slice(down).filter((e) => e === "mousemove").length).toBeGreaterThanOrEqual(4);
  expect(events.at(-1)).toBe("mouseup");
});

test.skipIf(server.browser !== "chromium")("drag with hold keeps the button down until pointerPress up", async () => {
  const events: string[] = [];
  const target = document.createElement("div");
  target.style.cssText = "position:fixed;inset:0;";
  document.body.append(target);
  for (const type of ["mousedown", "mouseup"]) target.addEventListener(type, () => events.push(type));
  await commands.drag({ from: [10, 10], to: [10, 60], steps: 2, durationMs: 20, hold: true });
  expect(events).toEqual(["mousedown"]);
  await commands.pointerPress({ action: "up" });
  target.remove();
  expect(events).toEqual(["mousedown", "mouseup"]);
});

test("pointerPress click presses and releases in one command, leaving the page's scroll alone", async () => {
  // userEvent.click scrolls its target into view first, and a page with scroll-padding counts a
  // target under a sticky header as out of view.
  const events: string[] = [];
  const page = document.createElement("div");
  page.style.cssText = "height:5000px;";
  page.innerHTML = '<header style="position:sticky;top:0;height:100px"><button data-click-here style="height:40px">Press</button></header>';
  document.body.append(page);
  window.scrollTo({ top: 2000, behavior: "instant" });
  document.documentElement.style.scrollPaddingTop = "120px";
  const target = page.querySelector("button")!;
  for (const type of ["mousedown", "mouseup", "click"]) target.addEventListener(type, () => events.push(type));
  try {
    await commands.pointerPress({ selector: "[data-click-here]", action: "click" });
    expect(events).toEqual(["mousedown", "mouseup", "click"]);
    expect(window.scrollY).toBe(2000);
  } finally {
    document.documentElement.style.removeProperty("scroll-padding-top");
    window.scrollTo({ top: 0, behavior: "instant" });
    page.remove();
  }
});

test.skipIf(server.browser !== "chromium")("compositedLayers lists a layer for an element only while it has will-change: transform", async () => {
  const box = document.createElement("div");
  box.dataset.ouro = "layer-probe";
  box.style.cssText = "width:40px;height:30px;background:rgb(255,0,0)";
  document.body.append(box);
  try {
    const own = (layers: { element: string | null }[]) => layers.filter((layer) => layer.element === 'DIV[data-ouro="layer-probe"]');
    const before = await commands.compositedLayers();
    expect(own(before)).toEqual([]);
    box.style.willChange = "transform";
    const layered = await commands.compositedLayers();
    expect(own(layered)).toEqual([{ element: 'DIV[data-ouro="layer-probe"]', width: 40, height: 30 }]);
    expect(layered).toHaveLength(before.length + 1);
    box.style.willChange = "";
    expect(await commands.compositedLayers()).toHaveLength(before.length);
    // A page that holds still draws no frame of its own; the count still comes, the same each time.
    expect(await commands.compositedLayers()).toHaveLength(before.length);
  } finally {
    box.remove();
  }
});

test.skipIf(server.browser === "chromium")("compositedLayers throws outside Chromium", async () => {
  await expect(commands.compositedLayers()).rejects.toThrow("compositedLayers: CDP is Chromium only");
});
