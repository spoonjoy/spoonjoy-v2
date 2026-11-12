import { afterAll, beforeAll, test, vi } from "vitest";
import { expectConsoleError } from "./warning-policy";
test("sentinel", () => { expectConsoleError("expected"); console.error("expected"); console.error("unexpected"); });
