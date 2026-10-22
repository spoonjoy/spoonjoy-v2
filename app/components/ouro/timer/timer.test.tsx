import { type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Timer } from "~/components/ouro/timer/timer";
import { act } from "~/lib/ouro/testing/act";
import { watchAnnouncements } from "~/lib/ouro/testing/announcements";

const roots: Root[] = [];
let mounted: Element[] = [];
let tones = 0;
const vibrations: unknown[] = [];

// Every timer on the page shares one audio context, made on the first Start; this one counts tones.
const scope = globalThis as unknown as { AudioContext: unknown };
const realAudio = scope.AudioContext;
class FakeAudio {
  state = "running";
  currentTime = 0;
  destination = {};
  resume = async () => {};
  close = async () => {};
  createGain = () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} });
  createOscillator = () => {
    tones += 1;
    return { frequency: {}, connect() {}, start() {}, stop() {}, onended: null };
  };
}
beforeAll(() => {
  scope.AudioContext = FakeAudio;
});
afterAll(() => {
  scope.AudioContext = realAudio;
});

async function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  const timer = () => host.querySelector<HTMLElement>('[data-ouro="timer"]')!;
  return {
    host,
    root,
    timer,
    time: () => host.querySelector<HTMLElement>('[role="timer"]')!,
    caption: () => timer().querySelector<HTMLElement>("p")!,
    primary: () => host.querySelector<HTMLButtonElement>('[data-ouro-part="primary"]')!,
    secondary: () => host.querySelector<HTMLButtonElement>('[data-ouro-part="secondary"]'),
  };
}

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const press = (button: HTMLButtonElement) =>
  act(async () => {
    button.focus();
    button.click();
  });
const probe = (color: string) => {
  const element = document.createElement("span");
  element.style.color = color;
  document.body.append(element);
  mounted.push(element);
  return getComputedStyle(element).color;
};

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  localStorage.clear();
  tones = 0;
  vibrations.length = 0;
  Object.defineProperty(navigator, "vibrate", { configurable: true, value: (pattern: unknown) => (vibrations.push(pattern), true) });
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"], now: new Date("2026-01-01T12:00:00Z") });
});
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (navigator as { vibrate?: unknown }).vibrate;
  localStorage.clear();
});

describe("Timer", () => {
  it("is a group named by its label, with the length beside the label, the time as a timer region and Start", async () => {
    const { timer, time, caption, primary, secondary } = await render(<Timer label="Pasta" duration={600} />);
    expect(timer().getAttribute("role")).toBe("group");
    expect(timer().getAttribute("aria-label")).toBe("Pasta");
    expect(timer().getAttribute("data-status")).toBe("idle");
    expect(caption().textContent).toBe("Pasta · 10 min");
    expect(time().textContent).toBe("10:00");
    expect(getComputedStyle(time()).fontVariantNumeric).toBe("tabular-nums");
    expect(primary().textContent).toBe("Start");
    expect(primary().getAttribute("data-ouro-control")).toBe("timer");
    expect(secondary()).toBeNull();
    expect(getComputedStyle(caption()).color).toBe(probe("var(--muted-foreground)"));
  });

  it.each([
    [45, "45 s"],
    [60, "1 min"],
    [5400, "1 h 30 min"],
    [7200, "2 h"],
    [3569, "59 min"],
    [3570, "1 h"],
    [7170, "2 h"],
  ])("says a length of %s seconds as %s", async (duration, text) => {
    const { caption } = await render(<Timer label="Tea" duration={duration} />);
    expect(caption().textContent).toBe(`Tea · ${text}`);
  });

  it("starts, pauses, resumes and cancels with focus staying on its controls", async () => {
    const { time, primary, secondary, timer } = await render(<Timer label="Pasta" duration={600} />);
    await press(primary());
    expect(timer().getAttribute("data-status")).toBe("running");
    expect(document.activeElement).toBe(primary());
    expect(primary().textContent).toBe("Pause");
    expect(secondary()!.textContent).toBe("Cancel");
    await advance(61_000);
    expect(time().textContent).toBe("8:59");
    await press(primary());
    expect(primary().textContent).toBe("Resume");
    expect(time().textContent).toBe("8:59Paused");
    await advance(30_000);
    expect(time().textContent).toBe("8:59Paused");
    await press(primary());
    expect(primary().textContent).toBe("Pause");
    await press(secondary()!);
    expect(timer().getAttribute("data-status")).toBe("idle");
    expect(secondary()).toBeNull();
    expect(document.activeElement).toBe(primary());
    expect(time().textContent).toBe("10:00");
  });

  it("says, chimes and buzzes once at zero, shows Time's up, then dismisses or restarts", async () => {
    const announced = watchAnnouncements();
    const onDone = vi.fn();
    try {
      const { time, caption, primary, secondary, timer } = await render(<Timer label="Eggs" duration={3} onDone={onDone} />);
      await press(primary());
      await advance(3000);
      await advance(200);
      expect(timer().getAttribute("data-status")).toBe("done");
      expect(caption().textContent).toBe("Time's up");
      expect(time().textContent).toBe("0:00");
      const up = probe("color-mix(in oklab, var(--destructive) 80%, var(--foreground))");
      expect(getComputedStyle(caption()).color).toBe(up);
      expect(getComputedStyle(time()).color).toBe(up);
      expect(announced.count("Eggs: Time's up")).toBe(1);
      expect(tones).toBe(3);
      expect(vibrations).toHaveLength(1);
      expect(onDone).toHaveBeenCalledExactlyOnceWith({ endedAt: Date.now() - 200, first: true });
      expect(primary().textContent).toBe("Dismiss");
      expect(secondary()!.textContent).toBe("Restart");
      await press(secondary()!);
      expect(timer().getAttribute("data-status")).toBe("running");
      await advance(3000);
      await press(primary());
      expect(timer().getAttribute("data-status")).toBe("idle");
      expect(document.activeElement).toBe(primary());
    } finally {
      announced.stop();
    }
  });

  it("only says the time is up when silent", async () => {
    const announced = watchAnnouncements();
    try {
      const { primary, secondary } = await render(<Timer label="Quiet" duration={1} silent />);
      await press(primary());
      await advance(1000);
      await advance(200);
      expect(announced.count("Quiet: Time's up")).toBe(1);
      await press(secondary()!);
      await advance(1000);
      expect(tones).toBe(0);
      expect(vibrations).toHaveLength(0);
    } finally {
      announced.stop();
    }
  });

  it("keeps its time through a reload with a timerId, and stays quiet about a timer that ended long ago", async () => {
    localStorage.setItem("ouro-timer:bread", JSON.stringify({ status: "running", duration: 3600, endsAt: Date.now() - 5 * 60_000 }));
    localStorage.setItem("ouro-timer:soup", JSON.stringify({ status: "running", duration: 1200, endsAt: Date.now() + 90_000 }));
    const announced = watchAnnouncements();
    try {
      const bread = await render(<Timer label="Bread" duration={3600} timerId="bread" />);
      const soup = await render(<Timer label="Soup" duration={1200} timerId="soup" />);
      expect(bread.caption().textContent).toBe("Time's up");
      expect(soup.time().textContent).toBe("1:30");
      await advance(200);
      expect(announced.count("Bread: Time's up")).toBe(1);
      expect(tones).toBe(0);
    } finally {
      announced.stop();
    }
  });

  it("alerts once when two Timers show the same timer", async () => {
    const announced = watchAnnouncements();
    try {
      const a = await render(<Timer label="Rice" duration={2} timerId="rice" />);
      const b = await render(<Timer label="Rice" duration={2} timerId="rice" />);
      await press(a.primary());
      expect(b.primary().textContent).toBe("Pause");
      await advance(2000);
      await advance(200);
      expect(announced.count("Rice: Time's up")).toBe(1);
      expect(tones).toBe(3);
    } finally {
      announced.stop();
    }
  });

  it("passes id to the element, and keeps and shares the timer only by timerId", async () => {
    const { timer, primary } = await render(<Timer label="Tea" duration={60} id="tea-timer" />);
    expect(timer().id).toBe("tea-timer");
    await press(primary());
    expect(localStorage.length).toBe(0);
    const kept = await render(<Timer label="Tea" duration={60} id="tea-timer-2" timerId="tea" />);
    await press(kept.primary());
    expect(kept.timer().id).toBe("tea-timer-2");
    expect(JSON.parse(localStorage.getItem("ouro-timer:tea")!)).toMatchObject({ status: "running", duration: 60 });
  });

  it("takes the words the app gives and keeps the rest", async () => {
    const { primary, caption } = await render(<Timer label="Pâtes" duration={60} labels={{ start: "Démarrer", pause: undefined }} />);
    expect(primary().textContent).toBe("Démarrer");
    await press(primary());
    expect(primary().textContent).toBe("Pause");
    expect(caption().textContent).toBe("Pâtes · 1 min");
  });

  it("sets a larger time with size lg", async () => {
    const md = await render(<Timer label="A" duration={60} />);
    const lg = await render(<Timer label="B" duration={60} size="lg" />);
    expect(parseFloat(getComputedStyle(lg.time()).fontSize)).toBeGreaterThan(parseFloat(getComputedStyle(md.time()).fontSize));
  });

  it("forwards a ref, passes attributes through, and lets layout classes win", async () => {
    let element: HTMLDivElement | null = null;
    const { timer } = await render(<Timer label="R" duration={5} className="mt-6" data-step="2" ref={(node) => void (element = node)} />);
    expect(element).toBe(timer());
    expect(timer().getAttribute("data-step")).toBe("2");
    expect(getComputedStyle(timer()).marginTop).toBe("24px");
  });
});

describe("Timer development messages", () => {
  it.each([
    ["size", { size: "xl" }, 'size="xl" is not a size; use "md" or "lg"', '<Timer size="lg" />'],
    ["duration", { duration: 0 }, "duration={0} is not a length; it is in seconds and above 0", "<Timer duration={600} />"],
    ["duration", { duration: Number.NaN }, "duration={NaN} is not a length; it is in seconds and above 0", "<Timer duration={600} />"],
    ["seconds", { seconds: 90 }, "seconds is not a prop", "<Timer duration={90} />"],
    ["seconds", { seconds: "90" }, "seconds is not a prop", "<Timer duration={600} />"],
    ["minutes", { minutes: 5 }, "minutes is not a prop", "<Timer duration={5 * 60} />"],
    ["minutes", { minutes: "5" }, "minutes is not a prop", "<Timer duration={10 * 60} />"],
    ["onComplete", { onComplete: () => {} }, "onComplete is not a prop", "<Timer onDone={() => {}} />"],
    ["onEnd", { onEnd: () => {} }, "onEnd is not a prop", "<Timer onDone={() => {}} />"],
    ["sound", { sound: false }, "sound is not a prop", "<Timer silent />"],
    ["autoSaveId", { autoSaveId: "pasta" }, "autoSaveId is not a prop", '<Timer timerId="pasta" />'],
    ["storageKey", { storageKey: "pasta" }, "storageKey is not a prop", '<Timer timerId="pasta" />'],
  ])("explains %s with the fix", async (_name, extra, problem, fix) => {
    const props = { label: "T", duration: 60, ...extra } as unknown as Parameters<typeof Timer>[0];
    const { timer } = await render(<Timer {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] Timer: ${problem}. Fix: ${fix}.`);
    for (const name of ["seconds", "minutes", "sound", "autosaveid", "storagekey"]) expect(timer().hasAttribute(name)).toBe(false);
  });

  it.each([
    ["text-red-500", 'remove "text-red-500"; use size="lg" for a larger time'],
    ["mt-2", ""],
  ])("checks the className %s", async (className, fix) => {
    await render(<Timer label="T" duration={60} className={className} />);
    if (fix) expect(warn).toHaveBeenCalledWith(`[ouro-ui] Timer: "${className}" sets appearance, and className is for layout only. Fix: ${fix}.`);
    else expect(warn).not.toHaveBeenCalled();
  });

  it("renders to a string at the full duration", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(<Timer label="Pasta" duration={600} timerId="pasta" />);
    expect(html).toContain('data-ouro="timer"');
    expect(html).toContain("10:00");
    expect(error).not.toHaveBeenCalled();
  });
});
