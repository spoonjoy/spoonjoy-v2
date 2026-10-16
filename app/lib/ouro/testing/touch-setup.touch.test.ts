import { afterEach, expect, test } from "vitest";
import { commands, page } from "vitest/browser";

// Chromium drops a page's touch emulation after a screenshot that reaches beyond the viewport,
// which is what Vitest takes when a test fails on a tall page. The `ouro-touch` setup
// (testing/touch-setup.ts) calls `restoreTouch` before every test, so one failure does not fail
// every later test that needs a coarse pointer.

const nodes: Element[] = [];
afterEach(() => {
  for (const node of nodes.splice(0)) node.remove();
});

const phone = () => ({
  coarse: matchMedia("(pointer: coarse)").matches,
  hover: matchMedia("(any-hover: hover)").matches,
  touchPoints: navigator.maxTouchPoints,
});

test("restoreTouch turns touch emulation back on after a screenshot taller than the phone", async () => {
  expect(phone()).toEqual({ coarse: true, hover: false, touchPoints: 1 });
  const tall = document.createElement("div");
  tall.style.height = "2500px";
  document.body.append(tall);
  nodes.push(tall);
  // Chromium versions differ in whether this drops the emulation, so only the result is checked.
  await page.screenshot({ save: false });
  await commands.restoreTouch();
  expect(phone()).toEqual({ coarse: true, hover: false, touchPoints: 1 });
});

// The setup's hook, which runs it for every test. These two prove something only in this order,
// which Vitest keeps for the tests of one file unless shuffled.
test("a test leaves the page after a screenshot taller than the phone", async () => {
  const tall = document.createElement("div");
  tall.style.height = "2500px";
  document.body.append(tall);
  nodes.push(tall);
  await page.screenshot({ save: false });
});

test("the next test starts as a touch phone again", () => {
  expect(phone()).toEqual({ coarse: true, hover: false, touchPoints: 1 });
});
