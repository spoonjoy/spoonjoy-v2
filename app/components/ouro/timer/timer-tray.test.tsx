import { createRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Timer } from "~/components/ouro/timer/timer";
import { TimerTray, type TimerTrayItem } from "~/components/ouro/timer/timer-tray";
import { act } from "~/lib/ouro/testing/act";
import { watchAnnouncements } from "~/lib/ouro/testing/announcements";

const roots: Root[] = [];
let mounted: Element[] = [];
let tones = 0;

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

const timers: TimerTrayItem[] = [
  { timerId: "pasta", label: "Pasta", duration: 600, href: "#step-2" },
  { timerId: "sauce", label: "Sauce", duration: 900 },
];

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
    tray: () => host.querySelector<HTMLElement>('[data-ouro="timer-tray"]')!,
    rows: () => [...host.querySelectorAll<HTMLElement>('[data-ouro="timer-tray"] li')],
  };
}

const store = (id: string, value: unknown) => localStorage.setItem(`ouro-timer:${id}`, JSON.stringify(value));
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  localStorage.clear();
  tones = 0;
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"], now: new Date("2026-01-01T12:00:00Z") });
});
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("TimerTray", () => {
  it("hides itself while no timer is running", async () => {
    const { tray, rows } = await render(<TimerTray timers={timers} />);
    expect(rows()).toHaveLength(0);
    expect(getComputedStyle(tray()).display).toBe("none");
  });

  it("is a region listing the running, paused and finished timers with their time, and hides idle ones", async () => {
    store("pasta", { status: "running", duration: 600, endsAt: Date.now() + 125_000 });
    store("sauce", { status: "paused", duration: 900, remainingMs: 61_000 });
    const { tray, rows } = await render(<TimerTray timers={[...timers, { timerId: "idle", label: "Idle", duration: 60 }]} label="Kitchen timers" />);
    expect(tray().tagName).toBe("SECTION");
    expect(tray().getAttribute("aria-label")).toBe("Kitchen timers");
    expect(getComputedStyle(tray()).display).not.toBe("none");
    expect(rows().map((row) => row.querySelector('[role="timer"]')!.textContent)).toEqual(["2:05", "1:01Paused"]);
    await advance(5000);
    expect(rows()[0]!.querySelector('[role="timer"]')!.textContent).toBe("2:00");
  });

  it("links to a timer's screen and cancels it, each control named with the timer", async () => {
    store("pasta", { status: "running", duration: 600, endsAt: Date.now() + 60_000 });
    const { rows, tray } = await render(<TimerTray timers={timers} />);
    const link = rows()[0]!.querySelector<HTMLAnchorElement>('[data-ouro-part="go-to"]')!;
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("#step-2");
    expect(link.textContent).toBe("Go to Pasta");
    const stop = rows()[0]!.querySelector<HTMLButtonElement>('[data-ouro-part="stop"]')!;
    expect(stop.textContent).toBe("Cancel Pasta");
    await act(async () => stop.click());
    expect(localStorage.getItem("ouro-timer:pasta")).toBeNull();
    expect(getComputedStyle(tray()).display).toBe("none");
  });

  it("follows the Timer on the page, and alerts once at zero even when both show it", async () => {
    const announced = watchAnnouncements();
    try {
      const page = await render(<Timer label="Pasta" duration={2} timerId="pasta" />);
      const { rows } = await render(<TimerTray timers={[{ timerId: "pasta", label: "Pasta", duration: 2 }]} />);
      await act(async () => page.host.querySelector<HTMLButtonElement>('[data-ouro-part="primary"]')!.click());
      expect(rows()).toHaveLength(1);
      await advance(2000);
      await advance(200);
      expect(rows()[0]!.querySelector('[role="timer"]')!.textContent).toBe("Time's up");
      expect(rows()[0]!.getAttribute("data-status")).toBe("done");
      expect(announced.count("Pasta: Time's up")).toBe(1);
      expect(tones).toBe(3);
      const dismiss = rows()[0]!.querySelector<HTMLButtonElement>('[data-ouro-part="stop"]')!;
      expect(dismiss.textContent).toBe("Dismiss Pasta");
      await act(async () => dismiss.click());
      expect(page.host.querySelector('[data-ouro="timer"]')!.getAttribute("data-status")).toBe("idle");
    } finally {
      announced.stop();
    }
  });

  it.each([
    ["the tray first", "tray"],
    ["the Timer first", "timer"],
  ] as const)("lets the Timer's silent decide the alert when both show a timer, with %s", async (_order, firstMounted) => {
    const cases = [
      { id: "loud-timer", timerSilent: false, traySilent: true, chimes: true },
      { id: "quiet-timer", timerSilent: true, traySilent: false, chimes: false },
    ];
    const announced = watchAnnouncements();
    try {
      for (const { id, timerSilent, traySilent, chimes } of cases) {
        tones = 0;
        const timer = <Timer label="Pasta" duration={1} timerId={id} silent={timerSilent} />;
        const tray = <TimerTray timers={[{ timerId: id, label: "Pasta", duration: 1 }]} silent={traySilent} />;
        const page = await render(firstMounted === "timer" ? timer : tray);
        const other = await render(firstMounted === "timer" ? tray : timer);
        const host = firstMounted === "timer" ? page.host : other.host;
        await act(async () => host.querySelector<HTMLButtonElement>('[data-ouro-part="primary"]')!.click());
        await advance(1000);
        await advance(200);
        expect(tones).toBe(chimes ? 3 : 0);
      }
      expect(announced.count("Pasta: Time's up")).toBe(2);
    } finally {
      announced.stop();
    }
  });

  it("lets the Timer's silent decide the alert for a timer that ended just before a reload, with both mounted in one commit", async () => {
    const cases = [
      { id: "reload-loud", timerSilent: false, traySilent: true, chimes: true },
      { id: "reload-quiet", timerSilent: true, traySilent: false, chimes: false },
    ];
    const announced = watchAnnouncements();
    try {
      for (const { id, timerSilent, traySilent, chimes } of cases) {
        tones = 0;
        store(id, { status: "running", duration: 60, endsAt: Date.now() - 1000 });
        await render(
          <>
            <TimerTray timers={[{ timerId: id, label: "Pasta", duration: 60 }]} silent={traySilent} />
            <Timer label="Pasta" duration={60} timerId={id} silent={timerSilent} />
          </>,
        );
        await advance(200);
        expect(tones).toBe(chimes ? 3 : 0);
      }
      expect(announced.count("Pasta: Time's up")).toBe(2);
    } finally {
      announced.stop();
    }
  });

  it("alerts on its own when the timer's screen is gone, unless silent", async () => {
    store("tea", { status: "running", duration: 60, endsAt: Date.now() + 1000 });
    store("rest", { status: "running", duration: 60, endsAt: Date.now() + 2000 });
    const announced = watchAnnouncements();
    try {
      await render(<TimerTray timers={[{ timerId: "tea", label: "Tea", duration: 60 }]} labels={{ done: "Ready", cancel: undefined }} />);
      await render(<TimerTray timers={[{ timerId: "rest", label: "Rest", duration: 60 }]} silent />);
      await advance(1000);
      await advance(200);
      expect(announced.count("Tea: Ready")).toBe(1);
      expect(tones).toBe(3);
      await advance(1000);
      expect(announced.count("Rest: Ready")).toBe(0);
      expect(announced.count("Rest: Time's up")).toBe(1);
      expect(tones).toBe(3);
    } finally {
      announced.stop();
    }
  });

  it("moves focus to the next timer's stop button when one is stopped, else the previous, else the tray", async () => {
    for (const id of ["one", "two", "three"]) store(id, { status: "running", duration: 600, endsAt: Date.now() + 60_000 });
    const { tray, rows } = await render(
      <TimerTray timers={["one", "two", "three"].map((id) => ({ timerId: id, label: id, duration: 600 }))} />,
    );
    const stopOf = (index: number) => rows()[index]!.querySelector<HTMLButtonElement>('[data-ouro-part="stop"]')!;
    const stop = async (button: HTMLButtonElement) => {
      button.focus();
      await act(async () => button.click());
    };
    await stop(stopOf(1));
    expect(rows()).toHaveLength(2);
    expect(document.activeElement).toBe(stopOf(1));
    expect(stopOf(1).textContent).toBe("Cancel three");
    await stop(stopOf(1));
    expect(rows()).toHaveLength(1);
    expect(document.activeElement).toBe(stopOf(0));
    await stop(stopOf(0));
    expect(rows()).toHaveLength(0);
    expect(document.activeElement).toBe(tray());
    expect(tray().tabIndex).toBe(-1);
    expect(getComputedStyle(tray()).display).not.toBe("none");
    await act(async () => tray().blur());
    expect(getComputedStyle(tray()).display).toBe("none");
  });

  it("moves focus to finalFocus when the last timer is stopped", async () => {
    store("pasta", { status: "running", duration: 600, endsAt: Date.now() + 60_000 });
    const heading = createRef<HTMLHeadingElement>();
    const { tray, rows } = await render(
      <>
        <h2 ref={heading} tabIndex={-1}>
          Steps
        </h2>
        <TimerTray timers={timers} finalFocus={heading} />
      </>,
    );
    const stop = rows()[0]!.querySelector<HTMLButtonElement>('[data-ouro-part="stop"]')!;
    stop.focus();
    await act(async () => stop.click());
    expect(document.activeElement).toBe(heading.current);
    expect(getComputedStyle(tray()).display).toBe("none");
  });

  it("forwards a ref, passes attributes through, and lets layout classes win", async () => {
    store("pasta", { status: "running", duration: 600, endsAt: Date.now() + 60_000 });
    let element: HTMLElement | null = null;
    const { tray } = await render(<TimerTray timers={timers} className="mt-4" data-area="top" ref={(node) => void (element = node)} />);
    expect(element).toBe(tray());
    expect(tray().getAttribute("data-area")).toBe("top");
    expect(getComputedStyle(tray()).marginTop).toBe("16px");
  });
});

describe("TimerTray development messages", () => {
  it.each([
    ["items", { items: [] }, "items is not a prop", "<TimerTray timers={[{ timerId, label, duration }]} />"],
    ["a timer's id", { timers: [{ id: "pasta", label: "Pasta", duration: 600 }] }, "id is not a key of a timer in timers", '<TimerTray timers={[{ timerId: "pasta", label, duration }]} />'],
    ["hidden", { hidden: true }, "hidden is not a prop; the tray hides itself while no timer is running", "<TimerTray timers={timers} />"],
  ])("explains %s with the fix", async (_name, extra, problem, fix) => {
    const props = { timers: [], ...extra } as unknown as Parameters<typeof TimerTray>[0];
    const { tray } = await render(<TimerTray {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] TimerTray: ${problem}. Fix: ${fix}.`);
    expect(tray().hasAttribute("items")).toBe(false);
    expect(tray().hasAttribute("hidden")).toBe(false);
  });

  it.each([
    ["bg-card", 'remove "bg-card"; TimerTray sets its own look from the theme'],
    ["sticky", ""],
  ])("checks the className %s", async (className, fix) => {
    await render(<TimerTray timers={[]} className={className} />);
    if (fix) expect(warn).toHaveBeenCalledWith(`[ouro-ui] TimerTray: "${className}" sets appearance, and className is for layout only. Fix: ${fix}.`);
    else expect(warn).not.toHaveBeenCalled();
  });

  it("renders to a string, empty", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(<TimerTray timers={timers} />);
    expect(html).toContain('data-ouro="timer-tray"');
    expect(html).not.toContain("<li");
    expect(error).not.toHaveBeenCalled();
  });
});
