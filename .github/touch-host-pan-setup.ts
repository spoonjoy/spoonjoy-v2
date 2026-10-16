import { afterEach, beforeEach } from "vitest";
import { commands } from "vitest/browser";
import type { touchHostPanAudit } from "./touch-host-probe";

declare module "vitest/browser" {
  interface BrowserCommands {
    touchHostPanAudit: (action: "start" | "stop") => ReturnType<typeof touchHostPanAudit>;
  }
}

const subject = "on a page zoomed and panned by touch, the kit waits for the frame where the touch lands";
beforeEach(async ({ task }) => {
  if (task.name === subject) await commands.touchHostPanAudit("start");
});
afterEach(async ({ task }) => {
  if (task.name === subject) console.info(`NATIVE_PAN_DIAGNOSTIC ${JSON.stringify(await commands.touchHostPanAudit("stop"))}`);
});
