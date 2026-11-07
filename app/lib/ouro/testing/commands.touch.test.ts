import { afterEach, expect, test, vi } from "vitest";
import { commands } from "vitest/browser";
import { rotate } from "~/lib/ouro/testing/rotate";

test("the touch project reports a coarse pointer at 390x844", () => {
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);
  expect(innerWidth).toBe(390);
});

test("rotate names the test that had the page zoomed", async () => {
  await commands.setPageZoom(2);
  expect(await commands.pageZoom()).toBeCloseTo(2);
  try {
    // Touch commands find their events on a zoomed page too.
    await commands.touchStep({ type: "touchStart", x: 100, y: 100 });
    await commands.touchStep({ type: "touchEnd" });
    await expect(rotate(844, 390)).rejects.toThrow(
      '"rotate names the test that had the page zoomed" had the page zoomed to 2.00 when rotate(844, 390) ran',
    );
  } finally {
    await commands.resetPageZoom();
  }
  expect(await commands.pageZoom()).toBe(1);
  await rotate(844, 390);
  expect(innerWidth).toBe(844);
  await rotate(390, 844);
});

const nodes: Element[] = [];
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  for (const node of nodes.splice(0)) node.remove();
});

/** A 300px horizontal scroller with 900px of content, at the top left of the page. */
function scroller(): HTMLElement {
  const element = document.createElement("div");
  Object.assign(element.style, { position: "absolute", top: "0", left: "0", width: "300px", height: "200px", overflowX: "auto" });
  const content = document.createElement("div");
  Object.assign(content.style, { width: "900px", height: "200px" });
  element.append(content);
  document.body.append(element);
  nodes.push(element);
  return element;
}

/** Swipes left across the scroller with `touchDrag`. */
const swipe = () => commands.touchDrag({ from: [260, 100], to: [40, 100], steps: 10 });

/**
 * Counts the touchstart and pointerdown events the page sees. While a finger is still
 * down, Chromium swallows the next gesture's start, so a swipe handler that starts on
 * pointerdown (a toast's) never sees it.
 */
function watchStarts(): () => string[] {
  const seen: string[] = [];
  const listener = (event: Event) => seen.push(event.type);
  for (const type of ["touchstart", "pointerdown"]) addEventListener(type, listener, true);
  return () => {
    for (const type of ["touchstart", "pointerdown"]) removeEventListener(type, listener, true);
    return seen;
  };
}

test("lifts the finger in finally when a step throws mid-gesture, so the next touch works", async () => {
  const element = scroller();
  await expect(
    (async () => {
      try {
        await commands.touchStep({ type: "touchStart", x: 260, y: 100 });
        await commands.touchStep({ type: "touchMove", x: 200, y: 100 });
        throw new Error("an assertion failed mid-gesture");
      } finally {
        await commands.touchStep({ type: "touchEnd" });
      }
    })(),
  ).rejects.toThrow("mid-gesture");
  const before = element.scrollLeft;
  const starts = watchStarts();
  await swipe();
  await expect.poll(() => element.scrollLeft).toBeGreaterThan(before + 100);
  expect(starts()).toEqual(["pointerdown", "touchstart"]);
});

test("lifts a finger a test left down before the next gesture starts", async () => {
  const element = scroller();
  // A test that failed without lifting its finger.
  await commands.touchStep({ type: "touchStart", x: 260, y: 100 });
  await commands.touchStep({ type: "touchMove", x: 250, y: 100 });
  let starts = watchStarts();
  await swipe();
  expect(starts()).toEqual(["pointerdown", "touchstart"]);
  // And a new touchStep gesture starts clean too.
  await commands.touchStep({ type: "touchStart", x: 260, y: 100 });
  starts = watchStarts();
  await commands.touchStep({ type: "touchStart", x: 260, y: 100 });
  for (const x of [200, 140, 80]) await commands.touchStep({ type: "touchMove", x, y: 100 });
  await commands.touchStep({ type: "touchEnd" });
  expect(starts()).toEqual(["pointerdown", "touchstart"]);
  expect(element.scrollLeft).toBeGreaterThan(0);
});

/** Records each touchmove and touchend the page handles, as its type and the finger's x. */
function watchTouches(): string[] {
  const seen: string[] = [];
  const listener = (event: TouchEvent) => seen.push(`${event.type} ${Math.round(event.changedTouches[0]!.clientX)}`);
  for (const type of ["touchmove", "touchend"] as const) addEventListener(type, listener, true);
  cleanups.push(() => {
    for (const type of ["touchmove", "touchend"] as const) removeEventListener(type, listener, true);
  });
  return seen;
}

test("touchStep resolves once the page has handled its event, also a move during a scroll", async () => {
  scroller();
  const seen = watchTouches();
  await commands.touchStep({ type: "touchStart", x: 260, y: 100 });
  try {
    // Within Chromium's slop distance of the touchstart: Chromium keeps these from the page.
    await commands.touchStep({ type: "touchMove", x: 256, y: 100 });
    await commands.touchStep({ type: "touchMove", x: 256, y: 100 });
    expect(seen).toEqual([]);
    // The first of these starts the scroll. Chromium then hands the page at most one
    // touchmove every 200ms, so each later one is still queued when CDP resolves.
    for (const x of [200, 180, 160, 140]) {
      await commands.touchStep({ type: "touchMove", x, y: 100 });
      expect(seen.at(-1)).toBe(`touchmove ${x}`);
    }
  } finally {
    await commands.touchStep({ type: "touchEnd" });
  }
  expect(seen.at(-1)).toBe("touchend 140");
});

test("touchDrag resolves when the gesture removes its target, whose touchend never reaches window", async () => {
  const element = scroller();
  element.style.overflowX = "hidden";
  element.addEventListener("touchmove", () => element.remove(), { once: true });
  const seen = watchTouches();
  await commands.touchDrag({ from: [260, 100], to: [40, 100], steps: 10 });
  expect(seen.filter((entry) => entry.startsWith("touchend"))).toEqual([]);
  // The next gesture starts clean.
  const next = scroller();
  await swipe();
  await expect.poll(() => next.scrollLeft).toBeGreaterThan(100);
});

/** An iframe at the top left of the page, 300x100 at `top`, showing `text`, appended to `parent`. */
async function frameAt(parent: Node, top: number, source: { srcdoc: string } | { src: string }): Promise<HTMLIFrameElement> {
  const frame = document.createElement("iframe");
  Object.assign(frame.style, { position: "absolute", top: `${top}px`, left: "0", width: "300px", height: "100px", border: "0" });
  Object.assign(frame, source);
  const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
  parent.appendChild(frame);
  nodes.push(frame);
  if ("srcdoc" in source) await loaded;
  return frame;
}

/** A host element whose shadow root, open or closed, holds an iframe at `top`. */
async function shadowFrame(mode: ShadowRootMode, top: number): Promise<HTMLIFrameElement> {
  const host = document.createElement("div");
  document.body.append(host);
  nodes.push(host);
  return frameAt(host.attachShadow({ mode }), top, { srcdoc: "<body style='margin:0'><div style='height:100px'></div></body>" });
}

/** Taps at (x, y) and returns the touch events `target` saw. */
async function tapAt(target: EventTarget, x: number, y: number): Promise<string[]> {
  const seen: string[] = [];
  const listener = (event: Event) => seen.push(event.type);
  for (const type of ["touchstart", "touchend"]) target.addEventListener(type, listener);
  try {
    await commands.touchStep({ type: "touchStart", x, y });
    await commands.touchStep({ type: "touchEnd" });
  } finally {
    for (const type of ["touchstart", "touchend"]) target.removeEventListener(type, listener);
  }
  return seen;
}

/**
 * A srcdoc iframe at `top` that the kit can never watch: its window drops `__ouroTouch`, so the
 * kit's watcher never sticks there. `body` is the frame's body markup.
 */
function unwatchableFrame(top: number, body = "<div style='height:100px'></div>"): Promise<HTMLIFrameElement> {
  const keepOut = "<script>Object.defineProperty(window, '__ouroTouch', { get() { return undefined; }, set() {} });</script>";
  return frameAt(document.body, top, { srcdoc: `${keepOut}<body style='margin:0'>${body}</body>` });
}

const refused = (x: number, y: number) =>
  `touchStep: could not watch the frame at (${x}, ${y}) within 5000ms, so the touchStart was not sent. The frame there is about:srcdoc, and it has no watcher.`;

test("a touchstart into a frame the kit cannot watch is refused after the time limit, and the next touch works", async () => {
  await unwatchableFrame(300);
  const started = performance.now();
  await expect(commands.touchStep({ type: "touchStart", x: 100, y: 350 })).rejects.toThrow(refused(100, 350));
  expect(performance.now() - started).toBeGreaterThanOrEqual(5000);
  // A refused touchstart leaves no finger down.
  expect(await tapAt(window, 100, 50)).toEqual(["touchstart", "touchend"]);
});

test("the kit waits for the frame under a pointer-events: none overlay, where the touch lands", async () => {
  await unwatchableFrame(300);
  const overlay = document.createElement("div");
  Object.assign(overlay.style, { position: "absolute", top: "300px", left: "0", width: "300px", height: "100px", pointerEvents: "none" });
  document.body.append(overlay);
  nodes.push(overlay);
  await expect(commands.touchStep({ type: "touchStart", x: 100, y: 350 })).rejects.toThrow(refused(100, 350));
});

// The kit can never watch this frame, so a kit that waited for it would refuse the touch.
test("the kit does not wait for a pointer-events: none iframe, which the touch passes through", async () => {
  const frame = await unwatchableFrame(300);
  frame.style.pointerEvents = "none";
  expect(await tapAt(window, 100, 350)).toEqual(["touchstart", "touchend"]);
});

test("on a page zoomed and panned by touch, the kit waits for the frame where the touch lands", async () => {
  await commands.setPageZoom(2);
  try {
    // At zoom 2 the page can't scroll, so a drag pans the visual viewport across it.
    const runner = window.top!;
    const viewport = runner.visualViewport!;
    let finger: number | undefined;
    let lifted = false;
    let settled = false;
    const panEvents: string[] = [];
    const started = (event: TouchEvent) => {
      if (event.isTrusted && finger === undefined) {
        finger = event.changedTouches[0]!.identifier;
        panEvents.push("touchstart");
      }
    };
    const ended = (event: TouchEvent) => {
      if (event.isTrusted && !lifted && Array.from(event.changedTouches).some((touch) => touch.identifier === finger)) {
        lifted = true;
        panEvents.push("touchend");
      }
    };
    const scrolled = (event: Event) => {
      if (event.isTrusted && lifted && !settled) {
        settled = true;
        panEvents.push("scrollend");
      }
    };
    addEventListener("touchstart", started, true);
    addEventListener("touchend", ended, true);
    viewport.addEventListener("scrollend", scrolled);
    try {
      await commands.touchDrag({ from: [300, 700], to: [50, 200], steps: 10, durationMs: 2000 });
      await expect.poll(() => settled).toBe(true);
      expect(panEvents).toEqual(["touchstart", "touchend", "scrollend"]);
    } finally {
      removeEventListener("touchstart", started, true);
      removeEventListener("touchend", ended, true);
      viewport.removeEventListener("scrollend", scrolled);
    }
    /** Where a touch at (x, y) lands on this page. */
    const landed = async (x: number, y: number) => {
      expect(runner.document.elementFromPoint(viewport.offsetLeft + x, viewport.offsetTop + y)).toBe(window.frameElement);
      const point = new Promise<[number, number]>((resolve) =>
        addEventListener("touchstart", (event) => resolve([event.touches[0]!.clientX, event.touches[0]!.clientY]), { once: true }),
      );
      await commands.touchStep({ type: "touchStart", x, y });
      await commands.touchStep({ type: "touchEnd" });
      return point;
    };
    const [left, top] = await landed(0, 0);
    expect(await landed(100, 100)).toEqual([left + 100, top + 100]);
    // Panned far enough that a hit test at the unpanned point would miss the frame.
    expect(Math.min(left, top)).toBeGreaterThan(150);
    const clippedPoint = (frame: HTMLIFrameElement): [number, number] => {
      const rect = frame.getBoundingClientRect();
      const clipLeft = Math.max(rect.left, left);
      const clipRight = Math.min(rect.right, innerWidth);
      const clipTop = Math.max(rect.top, top);
      const clipBottom = Math.min(rect.bottom, innerHeight);
      expect(clipRight).toBeGreaterThan(clipLeft);
      expect(clipBottom).toBeGreaterThan(clipTop);
      const x = Math.floor((clipLeft + clipRight) / 2 - left);
      const y = Math.floor((clipTop + clipBottom) / 2 - top);
      expect(left + x).toBeGreaterThan(clipLeft);
      expect(left + x).toBeLessThan(clipRight);
      expect(top + y).toBeGreaterThan(clipTop);
      expect(top + y).toBeLessThan(clipBottom);
      expect(document.elementFromPoint(left + x, top + y)).toBe(frame);
      expect(document.elementFromPoint(x, y)).not.toBe(frame);
      return [x, y];
    };
    const positive = await frameAt(document.body, Math.round(top) + 20, {
      srcdoc: "<body style='margin:0'><div style='height:100px'></div></body>",
    });
    positive.style.left = `${Math.round(left) + 20}px`;
    const point = clippedPoint(positive);
    const delivered: Array<{ type: string; trusted: boolean }> = [];
    const record = (event: Event) => delivered.push({ type: event.type, trusted: event.isTrusted });
    const target = positive.contentWindow!;
    for (const type of ["touchstart", "touchend"]) target.addEventListener(type, record);
    try {
      expect(await tapAt(target, ...point)).toEqual(["touchstart", "touchend"]);
      expect(delivered).toEqual([
        { type: "touchstart", trusted: true },
        { type: "touchend", trusted: true },
      ]);
    } finally {
      for (const type of ["touchstart", "touchend"]) target.removeEventListener(type, record);
      positive.remove();
    }
    const frame = await unwatchableFrame(Math.round(top) + 20);
    frame.style.left = `${Math.round(left) + 20}px`;
    const [x, y] = clippedPoint(frame);
    expect([x, y]).toEqual(point);
    delivered.length = 0;
    const unwatchable = frame.contentWindow!;
    for (const type of ["touchstart", "touchend"]) unwatchable.addEventListener(type, record);
    try {
      const started = performance.now();
      await expect(commands.touchStep({ type: "touchStart", x, y })).rejects.toThrow(refused(x, y));
      expect(performance.now() - started).toBeGreaterThanOrEqual(5000);
      expect(delivered).toEqual([]);
    } finally {
      for (const type of ["touchstart", "touchend"]) unwatchable.removeEventListener(type, record);
    }
    // Beside it, the touch reaches the page.
    expect(await tapAt(window, 10, y)).toEqual(["touchstart", "touchend"]);
  } finally {
    try {
      await commands.touchStep({ type: "touchEnd" });
    } finally {
      await commands.resetPageZoom();
    }
  }
});

test("a touch on a ::before box inside a frame waits for that frame", async () => {
  await unwatchableFrame(
    300,
    "<style>div::before { content: ''; position: absolute; top: 0; left: 0; width: 300px; height: 100px; }</style><div></div>",
  );
  await expect(commands.touchStep({ type: "touchStart", x: 100, y: 350 })).rejects.toThrow(refused(100, 350));
});

test("a touch on a ::before box is handled", async () => {
  const element = document.createElement("div");
  element.className = "ouro-touch-kit-pseudo";
  const style = document.createElement("style");
  style.textContent = ".ouro-touch-kit-pseudo::before { content: ''; position: absolute; top: 0; left: 0; width: 300px; height: 100px; }";
  document.head.append(style);
  document.body.append(element);
  nodes.push(element, style);
  expect(await tapAt(window, 100, 50)).toEqual(["touchstart", "touchend"]);
});

test.each(["open", "closed"] as const)("touches reach an iframe in a %s shadow root, and the page around it", async (mode) => {
  const frame = await shadowFrame(mode, 300);
  expect(await tapAt(frame.contentWindow!, 100, 350)).toEqual(["touchstart", "touchend"]);
  expect(await tapAt(window, 100, 50)).toEqual(["touchstart", "touchend"]);
});

// That a frame like this holds up no touch elsewhere is checked without a browser, where a wall
// clock times the kit alone (scripts/touch-kit-frames.test.mjs): here, Vitest's Node process runs
// other test files' work, which can stall it for seconds (a slow touch's log says how late it ran).
test("touches reach a cross-origin iframe, and the page around it", async () => {
  // A sandboxed frame has an opaque origin, cross-origin to this page, and the touch project runs it
  // in a process of its own (--site-per-process). Its document runs no script. Nothing is fetched
  // from the server either, where an app's Vite would answer another path with its own index.html
  // and its code.
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  Object.assign(frame.style, { position: "absolute", top: "300px", left: "0", width: "300px", height: "100px", border: "0" });
  frame.srcdoc = "<body style='margin:0'><div style='height:100px'></div></body>";
  const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
  document.body.append(frame);
  nodes.push(frame);
  await loaded;
  expect(() => frame.contentWindow!.document).toThrow();
  expect(await tapAt(window, 100, 50)).toEqual(["touchstart", "touchend"]);
  // Inside it, no listener of this page can see the touch; the kit's own watcher must.
  await commands.touchStep({ type: "touchStart", x: 100, y: 350 });
  await commands.touchStep({ type: "touchEnd" });
});

/**
 * A sandboxed frame at `top`: an opaque origin, cross-origin to this page, which the touch project
 * runs in a process of its own (`--site-per-process`). `busy(ms)` keeps its thread busy for that
 * long. `report()` resolves with what the frame saw of the kit and of the touch: when the kit's
 * watcher was set on its window, and the timestamp of each touchstart (when it was sent), both on
 * the frame's own clock.
 */
async function busyFrame(top: number) {
  const script = `
    let watcher, armed = [];
    Object.defineProperty(window, "__ouroTouch", { configurable: true, get: () => watcher, set: (value) => { watcher = value; armed.push(performance.now()); } });
    const sent = [];
    addEventListener("touchstart", (event) => sent.push(event.timeStamp), true);
    onmessage = (event) => {
      if (event.data === "report") parent.postMessage({ armed, sent }, "*");
      else { const end = performance.now() + event.data; while (performance.now() < end); }
    };`;
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  Object.assign(frame.style, { position: "absolute", top: `${top}px`, left: "0", width: "300px", height: "100px", border: "0" });
  frame.srcdoc = `<body style='margin:0'><div style='height:100px'></div><script>${script}</script></body>`;
  const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
  document.body.append(frame);
  nodes.push(frame);
  await loaded;
  const busy = (ms: number) => frame.contentWindow!.postMessage(ms, "*");
  const report = () =>
    new Promise<{ armed: number[]; sent: number[] }>((resolve) => {
      const listener = (event: MessageEvent) => {
        if (event.source !== frame.contentWindow) return;
        removeEventListener("message", listener);
        resolve(event.data as { armed: number[]; sent: number[] });
      };
      addEventListener("message", listener);
      frame.contentWindow!.postMessage("report", "*");
    });
  return { frame, busy, report };
}

// The time a busy frame could add is checked without a browser (scripts/touch-kit-frames.test.mjs).
test("a touch elsewhere is handled while a cross-origin frame is busy, also while the kit tidies up after it", async () => {
  const { busy } = await busyFrame(300);
  // Busy from the moment the touch arrives, after its watch has started there, for longer than the
  // kit's 1-second limit for tidying a frame up.
  addEventListener("touchstart", () => busy(1500), { once: true, capture: true });
  expect(await tapAt(window, 100, 50)).toEqual(["touchstart", "touchend"]);
  expect(await tapAt(window, 100, 50)).toEqual(["touchstart", "touchend"]);
});

test("a touchstart into a busy cross-origin frame is sent only once that frame's watcher is armed for it", async () => {
  const { busy, report } = await busyFrame(300);
  busy(1500);
  await commands.touchStep({ type: "touchStart", x: 100, y: 350 });
  await commands.touchStep({ type: "touchEnd" });
  const { armed, sent } = await report();
  expect(sent).toHaveLength(1);
  // The kit armed a watcher in the frame before it sent the touch, not only the page's around it.
  expect(armed.length).toBeGreaterThan(0);
  expect(armed[0]!).toBeLessThanOrEqual(sent[0]!);
});

// A check that the command never hangs, not of what it does: whether the frame's empty document
// gets the watcher depends on timing and the network, so either outcome passes.
test("a touch into an iframe that never loads does not hang", async () => {
  // A non-routable address: the connection hangs, so the frame keeps its first, empty document,
  // which Playwright cannot evaluate in. Where the network refuses it at once, the frame shows an
  // error page instead; either way the touch must end within the bound.
  await frameAt(document.body, 300, { src: "http://10.255.255.1/" });
  const started = performance.now();
  const outcome = await tapAt(window, 100, 350).then(
    () => "handled",
    (error: Error) => error.message,
  );
  expect(performance.now() - started).toBeLessThan(2 * 5000 + 2000);
  if (outcome !== "handled") expect(outcome).toMatch(/^touchStep: could not watch the frame at \(100, 350\) within 5000ms, so the touchStart was not sent\. The frame there is /);
  // A touch elsewhere is not held up by it.
  expect(await tapAt(window, 100, 50)).toEqual(["touchstart", "touchend"]);
});

// A smoke test, not a control: Playwright lists a new frame late only now and then, mostly in a
// full suite on a busy runner (CI probe run 38385210551). The race itself is in that run's log.
test("a touch into an iframe added just before it is handled", async () => {
  for (let index = 0; index < 10; index++) {
    const frame = document.createElement("iframe");
    Object.assign(frame.style, { position: "absolute", top: "0", left: "0", width: "300px", height: "200px", border: "0" });
    frame.srcdoc = "<body style='margin:0'><div style='height:200px'></div></body>";
    const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
    document.body.append(frame);
    nodes.push(frame);
    await loaded;
    const seen: string[] = [];
    frame.contentWindow!.addEventListener("touchstart", (event) => seen.push(event.type));
    await commands.touchStep({ type: "touchStart", x: 100, y: 100 });
    await commands.touchStep({ type: "touchEnd" });
    expect(seen).toEqual(["touchstart"]);
    frame.remove();
  }
});

// The same smoke test for a frame in another process, where only that frame's own watcher can
// say it is armed: the touch must wait until Playwright lists the frame, not go out while only the
// test's own frame is watched (scripts/touch-kit-frames.test.mjs checks that case exactly).
test("a touch into a cross-origin iframe added just before it is handled", async () => {
  for (let index = 0; index < 10; index++) {
    const { frame, report } = await busyFrame(300);
    await commands.touchStep({ type: "touchStart", x: 100, y: 350 });
    await commands.touchStep({ type: "touchEnd" });
    const { armed, sent } = await report();
    expect(sent).toHaveLength(1);
    expect(armed[0]!).toBeLessThanOrEqual(sent[0]!);
    frame.remove();
  }
});

test("a lift into a frame that has gone is sent all the same, and throws naming the frame", async () => {
  const frame = document.createElement("iframe");
  Object.assign(frame.style, { position: "absolute", top: "0", left: "0", width: "300px", height: "200px", border: "0" });
  frame.srcdoc = "<body style='margin:0'><div style='height:200px'></div></body>";
  const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
  document.body.append(frame);
  nodes.push(frame);
  await loaded;
  await commands.touchStep({ type: "touchStart", x: 100, y: 100 });
  // The finger's target goes away with its frame, so no page gets the touchend.
  frame.remove();
  await expect(commands.touchStep({ type: "touchEnd" })).rejects.toThrow(
    "touchStep: could not watch about:srcdoc, the frame the gesture's touchstart went to: frame.evaluate: Frame was detached. The touchEnd was sent, but nothing could see it.",
  );
  // The next gesture starts clean.
  const element = scroller();
  await swipe();
  await expect.poll(() => element.scrollLeft).toBeGreaterThan(100);
});

test("a missing touch event remains bounded while the page clock is frozen", async () => {
  const element = scroller();
  const suppress = (event: TouchEvent) => event.stopImmediatePropagation();
  addEventListener("touchend", suppress, { capture: true });
  cleanups.push(() => removeEventListener("touchend", suppress, { capture: true }));
  await commands.touchStep({ type: "touchStart", x: 260, y: 100 });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    await expect(commands.touchStep({ type: "touchEnd" })).rejects.toThrow(
      "touchStep: the page did not handle the touchEnd at (260, 100) within 5000ms.",
    );
  } finally {
    vi.useRealTimers();
    removeEventListener("touchend", suppress, { capture: true });
  }
  await swipe();
  await expect.poll(() => element.scrollLeft).toBeGreaterThan(100);
});

test("a missing later touchmove rejects while the page clock is frozen", async () => {
  const element = scroller();
  let seenMoves = 0;
  let suppress = false;
  const listener = (event: TouchEvent) => {
    if (suppress) event.stopImmediatePropagation();
    else seenMoves++;
  };
  addEventListener("touchmove", listener, { capture: true });
  cleanups.push(() => removeEventListener("touchmove", listener, { capture: true }));
  try {
    await commands.touchStep({ type: "touchStart", x: 260, y: 100 });
    await commands.touchStep({ type: "touchMove", x: 200, y: 100 });
    await expect.poll(() => seenMoves).toBeGreaterThan(0);
    suppress = true;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await expect(commands.touchStep({ type: "touchMove", x: 160, y: 100 })).rejects.toThrow(
      "touchStep: the page did not handle the touchMove at (160, 100) within 5000ms.",
    );
  } finally {
    vi.useRealTimers();
    suppress = false;
    removeEventListener("touchmove", listener, { capture: true });
    await commands.touchStep({ type: "touchEnd" });
  }
  await swipe();
  await expect.poll(() => element.scrollLeft).toBeGreaterThan(100);
});

test("a restarted watcher cannot acknowledge first-move slop without the gesture's touchstart", async () => {
  const element = scroller();
  await commands.touchStep({ type: "touchStart", x: 260, y: 100 });
  const view = window as Window & { __ouroTouch?: { seen: boolean; saw: string[]; remove(): void } };
  expect(view.__ouroTouch?.seen).toBe(true);
  expect(view.__ouroTouch?.saw.some((event) => event.startsWith("touchstart"))).toBe(true);
  view.__ouroTouch!.remove();
  const suppress = (event: TouchEvent) => event.stopImmediatePropagation();
  addEventListener("touchmove", suppress, { capture: true });
  cleanups.push(() => removeEventListener("touchmove", suppress, { capture: true }));
  try {
    await expect(commands.touchStep({ type: "touchMove", x: 259, y: 100 })).rejects.toThrow(
      "The target document did not report an active touchstart.",
    );
  } finally {
    removeEventListener("touchmove", suppress, { capture: true });
    await commands.touchStep({ type: "touchEnd" });
  }
  await swipe();
  await expect.poll(() => element.scrollLeft).toBeGreaterThan(100);
});

test("touchDrag with durationMs spans exactly that long in the page's event timestamps", async () => {
  scroller();
  const stamps: Record<string, number> = {};
  const listener = (event: Event) => (stamps[event.type] = event.timeStamp);
  for (const type of ["touchstart", "touchend"]) addEventListener(type, listener, true);
  try {
    // No wait: touchDrag resolves once the page has handled the touchend.
    await commands.touchDrag({ from: [260, 100], to: [40, 100], steps: 10, durationMs: 300 });
  } finally {
    for (const type of ["touchstart", "touchend"]) removeEventListener(type, listener, true);
  }
  expect(stamps["touchend"]! - stamps["touchstart"]!).toBeCloseTo(300, 0);
});
