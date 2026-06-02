import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("API v1 route coverage config", () => {
  it("covers TypeScript route modules in coverage reports", () => {
    const config = readFileSync(resolve(__dirname, "..", "..", "vitest.config.ts"), "utf8");

    expect(config).toMatch(/["']app\/routes\/\*\*\/\*\.ts["']/);
  });
});
