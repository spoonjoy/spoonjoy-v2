import { expect, it } from "vitest";
import { commands } from "vitest/browser";

// Paired with reset-order.leaves-state.test.ts (run first, same worker, by
// scripts/reset-order.test.mjs). Before the kit's own cross-file reset (commands.resetViewport() in
// setup.ts's beforeAll, alongside its existing commands.resetMedia()), the other file's resize and
// emulation would still be on the page here: this asserts neither followed it in
// (ourostack/ouro-ui#3300, #3319).
it("starts with neither the viewport resize nor the media emulation the file before it left", async () => {
  expect(await commands.viewportState()).not.toEqual({ width: 555, height: 444 });
  expect(matchMedia("(prefers-color-scheme: dark)").matches).toBe(false);
  expect(matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(false);
});
