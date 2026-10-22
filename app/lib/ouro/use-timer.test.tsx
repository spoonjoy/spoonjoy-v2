import { type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "~/lib/ouro/testing/act";
import { formatDuration, useTimer, type TimerControls, type TimerDoneEvent, type TimerOptions } from "~/lib/ouro/use-timer";

const roots: Root[] = [];
let mounted: Element[] = [];

function Probe({ options, report }: { options: TimerOptions; report: (timer: TimerControls) => void }): ReactNode {
  report(useTimer(options));
  return null;
}

/** Renders a hook and returns the latest value it returned. */
async function renderTimer(options: TimerOptions) {
  const host = document.createElement("div");
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  const state: { current: TimerControls; renders: number } = { current: undefined as unknown as TimerControls, renders: 0 };
  const report = (timer: TimerControls) => {
    state.current = timer;
    state.renders += 1;
  };
  await act(async () => root.render(<Probe options={options} report={report} />));
  return { state, root, rerender: (next: TimerOptions) => act(async () => root.render(<Probe options={next} report={report} />)) };
}

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

beforeEach(() => {
  localStorage.clear();
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

describe("useTimer", () => {
  it("waits at the full duration until it starts, then counts down by the clock", async () => {
    const { state } = await renderTimer({ duration: 90 });
    expect(state.current).toMatchObject({ status: "idle", remaining: 90, duration: 90, endedAt: null });
    await act(async () => state.current.start());
    expect(state.current).toMatchObject({ status: "running", remaining: 90 });
    await advance(1000);
    expect(state.current.remaining).toBe(89);
    await advance(30_250);
    expect(state.current.remaining).toBe(59);
  });

  it("stops where it is when paused and carries on when resumed", async () => {
    const { state } = await renderTimer({ duration: 60 });
    await act(async () => state.current.start());
    await advance(10_000);
    await act(async () => state.current.pause());
    expect(state.current).toMatchObject({ status: "paused", remaining: 50 });
    const renders = state.renders;
    await advance(20_000);
    expect(state.current.remaining).toBe(50);
    expect(state.renders).toBe(renders);
    await act(async () => state.current.resume());
    await advance(5000);
    expect(state.current).toMatchObject({ status: "running", remaining: 45 });
  });

  it("ignores pause unless running and resume unless paused", async () => {
    const { state } = await renderTimer({ duration: 60 });
    await act(async () => state.current.pause());
    await act(async () => state.current.resume());
    expect(state.current.status).toBe("idle");
    await act(async () => state.current.start());
    await act(async () => state.current.resume());
    expect(state.current.status).toBe("running");
  });

  it("finishes at zero and calls onDone once, then resets to idle", async () => {
    const onDone = vi.fn();
    const { state } = await renderTimer({ duration: 5, onDone });
    await act(async () => state.current.start());
    await advance(4999);
    expect(state.current.status).toBe("running");
    expect(onDone).not.toHaveBeenCalled();
    await advance(1);
    expect(state.current).toMatchObject({ status: "done", remaining: 0, endedAt: Date.now() });
    expect(onDone).toHaveBeenCalledExactlyOnceWith({ endedAt: Date.now(), first: true });
    await advance(10_000);
    expect(onDone).toHaveBeenCalledOnce();
    await act(async () => state.current.reset());
    expect(state.current).toMatchObject({ status: "idle", remaining: 5, endedAt: null });
  });

  it("starts again from the full duration from any status", async () => {
    const { state } = await renderTimer({ duration: 3 });
    await act(async () => state.current.start());
    await advance(3000);
    expect(state.current.status).toBe("done");
    await act(async () => state.current.start());
    expect(state.current).toMatchObject({ status: "running", remaining: 3 });
  });

  it("keeps a timer with a timerId in localStorage and shares it with every hook that has the timerId", async () => {
    const first = vi.fn<(event: TimerDoneEvent) => void>();
    const second = vi.fn<(event: TimerDoneEvent) => void>();
    const a = await renderTimer({ duration: 10, timerId: "tea", onDone: first });
    const b = await renderTimer({ duration: 10, timerId: "tea", onDone: second });
    await act(async () => a.state.current.start());
    expect(b.state.current.status).toBe("running");
    expect(JSON.parse(localStorage.getItem("ouro-timer:tea")!)).toEqual({ status: "running", duration: 10, endsAt: Date.now() + 10_000 });
    await act(async () => b.state.current.pause());
    expect(a.state.current.status).toBe("paused");
    await act(async () => a.state.current.resume());
    await advance(10_000);
    expect(first).toHaveBeenCalledExactlyOnceWith({ endedAt: Date.now(), first: true });
    expect(second).toHaveBeenCalledExactlyOnceWith({ endedAt: Date.now(), first: false });
    await act(async () => b.state.current.reset());
    expect(localStorage.getItem("ouro-timer:tea")).toBeNull();
    expect(a.state.current.status).toBe("idle");
  });

  it("gives first to a hook without fallback, whichever mounted first, and to the first fallback when only fallbacks watch", async () => {
    const watcher = vi.fn<(event: TimerDoneEvent) => void>();
    const owner = vi.fn<(event: TimerDoneEvent) => void>();
    const a = await renderTimer({ duration: 1, timerId: "eggs", fallback: true, onDone: watcher });
    await renderTimer({ duration: 1, timerId: "eggs", onDone: owner });
    await act(async () => a.state.current.start());
    await advance(1000);
    expect(owner).toHaveBeenCalledExactlyOnceWith({ endedAt: Date.now(), first: true });
    expect(watcher).toHaveBeenCalledExactlyOnceWith({ endedAt: Date.now(), first: false });
    const lone = vi.fn<(event: TimerDoneEvent) => void>();
    const other = vi.fn<(event: TimerDoneEvent) => void>();
    const b = await renderTimer({ duration: 1, timerId: "toast", fallback: true, onDone: lone });
    await renderTimer({ duration: 1, timerId: "toast", fallback: true, onDone: other });
    await act(async () => b.state.current.start());
    await advance(1000);
    expect(lone).toHaveBeenCalledExactlyOnceWith({ endedAt: Date.now(), first: true });
    expect(other).toHaveBeenCalledExactlyOnceWith({ endedAt: Date.now(), first: false });
  });

  it("carries a stored timer on after a reload, and finishes one that ended while the page was closed", async () => {
    localStorage.setItem("ouro-timer:oven", JSON.stringify({ status: "running", duration: 600, endsAt: Date.now() + 120_000 }));
    localStorage.setItem("ouro-timer:rice", JSON.stringify({ status: "running", duration: 600, endsAt: Date.now() - 30_000 }));
    const onDone = vi.fn();
    const oven = await renderTimer({ duration: 300, timerId: "oven" });
    const rice = await renderTimer({ duration: 600, timerId: "rice", onDone });
    expect(oven.state.current).toMatchObject({ status: "running", remaining: 120, duration: 600 });
    expect(rice.state.current).toMatchObject({ status: "done", endedAt: Date.now() - 30_000 });
    expect(onDone).toHaveBeenCalledExactlyOnceWith({ endedAt: Date.now() - 30_000, first: true });
  });

  it("reads a paused or finished stored timer as it was", async () => {
    localStorage.setItem("ouro-timer:a", JSON.stringify({ status: "paused", duration: 60, remainingMs: 15_500 }));
    localStorage.setItem("ouro-timer:b", JSON.stringify({ status: "done", duration: 60, endedAt: 5 }));
    const a = await renderTimer({ duration: 60, timerId: "a" });
    const b = await renderTimer({ duration: 60, timerId: "b" });
    expect(a.state.current).toMatchObject({ status: "paused", remaining: 16 });
    expect(b.state.current).toMatchObject({ status: "done", remaining: 0, endedAt: 5 });
  });

  it.each([
    ["not JSON", "{"],
    ["not an object", "3"],
    ["null", "null"],
    ["no duration", JSON.stringify({ status: "running", endsAt: 1 })],
    ["a zero duration", JSON.stringify({ status: "running", duration: 0, endsAt: 1 })],
    ["an unknown status", JSON.stringify({ status: "ringing", duration: 5 })],
    ["a running timer with no end", JSON.stringify({ status: "running", duration: 5 })],
    ["a paused timer with no time left", JSON.stringify({ status: "paused", duration: 5 })],
    ["a paused timer with negative time", JSON.stringify({ status: "paused", duration: 5, remainingMs: -1 })],
    ["a finished timer with no end", JSON.stringify({ status: "done", duration: 5 })],
  ])("treats %s in storage as no timer", async (_what, raw) => {
    localStorage.setItem("ouro-timer:bad", raw);
    const { state } = await renderTimer({ duration: 5, timerId: "bad" });
    expect(state.current.status).toBe("idle");
  });

  it("follows a timer another tab changes, without its alert", async () => {
    const onDone = vi.fn();
    const { state } = await renderTimer({ duration: 60, timerId: "shared", onDone });
    const send = (value: unknown, key = "ouro-timer:shared") =>
      act(async () => void window.dispatchEvent(new StorageEvent("storage", { key, newValue: value === null ? null : JSON.stringify(value) })));
    await send({ status: "running", duration: 60, endsAt: Date.now() + 30_000 });
    expect(state.current).toMatchObject({ status: "running", remaining: 30 });
    await send({ status: "running", duration: 60, endsAt: Date.now() - 1 });
    expect(state.current.status).toBe("done");
    expect(onDone).not.toHaveBeenCalled();
    await send(null);
    expect(state.current.status).toBe("idle");
    // Other keys, other apps' storage and a cleared store change nothing.
    await send({ status: "running", duration: 60, endsAt: Date.now() + 1000 }, "ouro-timer:elsewhere");
    await send({ status: "running", duration: 60, endsAt: Date.now() + 1000 }, "theme");
    await act(async () => void window.dispatchEvent(new StorageEvent("storage", { key: null })));
    expect(state.current.status).toBe("idle");
  });

  it("still runs when storage refuses to read or write", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    const { state } = await renderTimer({ duration: 2, timerId: "private" });
    expect(state.current.status).toBe("idle");
    await act(async () => state.current.start());
    await advance(2000);
    expect(state.current.status).toBe("done");
  });

  it("leaves a stored timer alone when its only component goes before the timer is first settled", async () => {
    localStorage.setItem("ouro-timer:gone", JSON.stringify({ status: "running", duration: 60, endsAt: Date.now() - 1000 }));
    const onDone = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    mounted.push(host);
    const root = createRoot(host);
    // Mounted and unmounted in one task: the settle deferred past the commit finds the timer gone.
    flushSync(() => root.render(<Probe options={{ duration: 60, timerId: "gone", onDone }} report={() => {}} />));
    root.unmount();
    await act(async () => {});
    expect(onDone).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("ouro-timer:gone")!)).toMatchObject({ status: "running" });
  });

  it("forgets a timer without a timerId when its component goes, and stops its clock", async () => {
    const onDone = vi.fn();
    const { state, root } = await renderTimer({ duration: 5, onDone });
    await act(async () => state.current.start());
    await act(async () => root.unmount());
    roots.splice(roots.indexOf(root), 1);
    await advance(10_000);
    expect(onDone).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the latest onDone", async () => {
    const before = vi.fn();
    const after = vi.fn();
    const { state, rerender } = await renderTimer({ duration: 1, onDone: before });
    await act(async () => state.current.start());
    await rerender({ duration: 1, onDone: after });
    await advance(1000);
    expect(before).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledOnce();
  });

  it("is idle at the full duration on the server", () => {
    let seen: TimerControls | undefined;
    renderToString(<Probe options={{ duration: 30, timerId: "server" }} report={(timer) => void (seen = timer)} />);
    expect(seen).toMatchObject({ status: "idle", remaining: 30 });
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0:00"],
    [5, "0:05"],
    [59.2, "1:00"],
    [545, "9:05"],
    [3600, "1:00:00"],
    [3723, "1:02:03"],
    [-4, "0:00"],
  ])("reads %s seconds as %s", (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text);
  });
});
