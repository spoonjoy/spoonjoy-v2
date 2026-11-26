import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// The Move in stand-in (workers/move-in-stand-in), which each Journeys run deploys under its own name
// (scripts/qa-run-scope.mjs stand-in).
describe("the Move in stand-in's Worker config", () => {
  it("binds each kitchen's Durable Object, on SQLite storage, and serves only at workers.dev", () => {
    const config = JSON.parse(readFileSync("workers/move-in-stand-in/wrangler.json", "utf8"));
    expect(config.main).toBe("./index.ts");
    expect(config.workers_dev).toBe(true);
    expect(config.preview_urls).toBe(false);
    expect(config.durable_objects.bindings).toEqual([{ name: "KITCHENS", class_name: "StandInKitchen" }]);
    expect(config.migrations).toEqual([{ tag: "v1", new_sqlite_classes: ["StandInKitchen"] }]);
  });
});
