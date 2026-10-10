import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Worker observability", () => {
  const wrangler = JSON.parse(readFileSync("wrangler.json", "utf8")) as {
    observability?: { enabled?: boolean; head_sampling_rate?: number };
    env: { qa: { observability?: { enabled?: boolean; head_sampling_rate?: number } } };
  };

  it("keeps Workers Logs on for production and QA so incidents leave a trail", () => {
    expect(wrangler.observability).toEqual({ enabled: true, head_sampling_rate: 1 });
    expect(wrangler.env.qa.observability).toEqual({ enabled: true, head_sampling_rate: 1 });
  });
});
