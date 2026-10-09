import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Smart Placement runs the Worker near D1 when most of a request's time is spent on
// D1 round trips. Static assets are still served from the edge. It is free and is
// turned off by deleting the key.
describe("Worker placement", () => {
  it("uses Smart Placement in production and QA", () => {
    const wrangler = JSON.parse(readFileSync("wrangler.json", "utf8")) as {
      placement?: { mode?: string };
      env: { qa: { placement?: { mode?: string } } };
    };
    expect(wrangler.placement).toEqual({ mode: "smart" });
    expect(wrangler.env.qa.placement).toEqual({ mode: "smart" });
  });
});
