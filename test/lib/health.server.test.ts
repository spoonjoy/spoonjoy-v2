// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildHealthStatus } from "~/lib/health.server";

describe("health.server", () => {
  it("reports an ok status for the spoonjoy service", () => {
    expect(buildHealthStatus()).toEqual({ status: "ok", service: "spoonjoy" });
  });
});
