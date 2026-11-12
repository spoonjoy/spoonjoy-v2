import { beforeEach, expect } from "vitest";
import { commands } from "vitest/browser";

// Test files whose tests start with the mouse off the test frame (park-pointer.ts). Only these:
// parking the mouse before every test broke later clicks in menu sheets (the color-scheme toggle's
// second choice was lost in Chromium), so it stays opt-in until HX's kit parks the mouse itself
// (ourostack/ouro-ui#867).
// - button.test.tsx reads a fresh button's colour, which a mouse left on its spot turns :hover
//   (spoonjoy-v2#678).
export const PARKED_FILES = ["app/components/ouro/button/button.test.tsx", "test/ouro/park-pointer.test.tsx"];

beforeEach(async () => {
  const path = expect.getState().testPath ?? "";
  if (PARKED_FILES.some((file) => path.endsWith(`/${file}`))) await commands.parkPointer();
});

declare module "vitest/browser" {
  interface BrowserCommands {
    parkPointer: () => Promise<void>;
  }
}
