import { afterEach, expect, it } from "vitest";
import { holdFrames, type HeldFrames } from "~/lib/ouro/testing/frames";

let frames: HeldFrames | undefined;
afterEach(() => frames?.release());

const browser = { request: window.requestAnimationFrame, cancel: window.cancelAnimationFrame, now: performance.now };

it("runs a frame only when the test steps, at the time the test says", () => {
  frames = holdFrames();
  const start = performance.now();
  const seen: number[] = [];
  const loop = (now: number) => {
    seen.push(now - start);
    if (seen.length < 3) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  expect(seen).toEqual([]);
  expect(performance.now()).toBe(start);
  frames.step(16);
  // One frame per step: the frame it asked for waits for the next one.
  expect(seen).toEqual([16]);
  expect(performance.now()).toBe(start + 16);
  frames.step(100);
  frames.step();
  expect(seen).toEqual([16, 116, 132]);
  frames.step();
  expect(seen.length).toBe(3);
});

it("does not run a cancelled frame, one cancelled by an earlier frame of the same step included", () => {
  frames = holdFrames();
  const ran: string[] = [];
  const first = requestAnimationFrame(() => ran.push("first"));
  requestAnimationFrame(() => {
    ran.push("second");
    cancelAnimationFrame(third);
  });
  const third = requestAnimationFrame(() => ran.push("third"));
  cancelAnimationFrame(first);
  frames.step();
  expect(ran).toEqual(["second"]);
});

it("still cancels a frame the browser was asked for before the hold", async () => {
  let ran = false;
  const before = requestAnimationFrame(() => (ran = true));
  frames = holdFrames();
  cancelAnimationFrame(before);
  frames.release();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  expect(ran).toBe(false);
});

it("steps until a condition holds, and gives up when it never does", () => {
  frames = holdFrames();
  let count = 0;
  const loop = () => {
    count++;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  frames.until(() => count === 5);
  expect(count).toBe(5);
  frames.until(() => true);
  expect(count).toBe(5);
  expect(() => frames!.until(() => false, 1)).toThrow("still not done after 2000 steps of 1ms");
});

it("gives frames and the clock back, and the waiting frames to the browser", async () => {
  const request = window.requestAnimationFrame;
  const now = performance.now;
  frames = holdFrames();
  expect(window.requestAnimationFrame).not.toBe(request);
  let ran = false;
  requestAnimationFrame(() => (ran = true));
  frames.release();
  expect(window.requestAnimationFrame).toBe(request);
  expect(performance.now).toBe(now);
  expect(ran).toBe(false);
  await expect.poll(() => ran).toBe(true);
  // Released twice is released; stepping after that is a mistake.
  frames.release();
  expect(() => frames!.step()).toThrow("were released");
});

it("still cancels, by the id it gave, a frame it handed to the browser on release", async () => {
  frames = holdFrames();
  const ran: string[] = [];
  const first = requestAnimationFrame(() => ran.push("first"));
  requestAnimationFrame(() => ran.push("second"));
  frames.release();
  // A component's cleanup cancels with the id it was given while frames were held.
  cancelAnimationFrame(first);
  await expect.poll(() => ran).toEqual(["second"]);
  // Once the last of them has run, cancelling is the browser's own again.
  expect(window.cancelAnimationFrame).toBe(browser.cancel);
  let later = false;
  const id = requestAnimationFrame(() => (later = true));
  cancelAnimationFrame(id);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  expect(later).toBe(false);
});

it("passes a cancel for a frame it never held on to the browser while released frames wait", async () => {
  let ran = false;
  frames = holdFrames();
  requestAnimationFrame(() => {});
  frames.release();
  const own = requestAnimationFrame(() => (ran = true));
  cancelAnimationFrame(own);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  expect(ran).toBe(false);
  expect(window.cancelAnimationFrame).toBe(browser.cancel);
});

it("is left holding frames by a test that forgets to release them", () => {
  holdFrames();
  expect(window.requestAnimationFrame).not.toBe(browser.request);
});

it("gave them back when that test finished", () => {
  expect(window.requestAnimationFrame).toBe(browser.request);
  expect(window.cancelAnimationFrame).toBe(browser.cancel);
  expect(performance.now).toBe(browser.now);
});
