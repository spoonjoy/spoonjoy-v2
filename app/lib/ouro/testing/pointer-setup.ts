import { beforeEach } from "vitest";
import { commands } from "vitest/browser";

// Vitest setup for the mouse projects (`ouro-chromium`, `ouro-webkit`), not `ouro-touch`: the mouse
// is moved off the test frame before every test, so no test inherits a hover from an earlier one.
beforeEach(() => commands.parkPointer());
