import { expect, it } from "vitest";
import { commands } from "vitest/browser";

// Paired with reset-order.starts-clean.test.ts (scripts/reset-order.test.mjs runs the two files
// together, in this order, on one worker, the shape a shard gives two files that land beside each
// other). This file leaves the page's real viewport resized and its media emulated, the way a
// file's own cleanup bug once could (ourostack/ouro-ui#3300, #3319): the next file must not see it.
it("leaves the viewport resized and media emulated for the file after it", async () => {
  await commands.setViewport({ width: 555, height: 444 });
  await commands.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  expect(await commands.viewportState()).toEqual({ width: 555, height: 444 });
  expect(matchMedia("(prefers-color-scheme: dark)").matches).toBe(true);
});
