import { beforeEach } from "vitest";
import { commands } from "vitest/browser";

// Every Ouro browser test with a mouse starts with it off the test frame (park-pointer.ts).
beforeEach(async () => {
  await commands.parkPointer();
});

declare module "vitest/browser" {
  interface BrowserCommands {
    parkPointer: () => Promise<void>;
  }
}
