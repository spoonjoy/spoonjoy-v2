import { commands, server } from "vitest/browser";
import { expect, test } from "vitest";

test("emulateMedia switches reduced motion and color scheme", async () => {
  await commands.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  expect(matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(true);
  expect(matchMedia("(prefers-color-scheme: dark)").matches).toBe(true);
  await commands.emulateMedia({ reducedMotion: "no-preference", colorScheme: "light" });
  expect(matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(false);
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
