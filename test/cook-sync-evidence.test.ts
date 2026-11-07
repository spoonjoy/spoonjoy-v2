// @vitest-environment node
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { Page, Request, Response } from "@playwright/test";
import { recordCookSyncRequests } from "../e2e/journeys/support/cook-sync-evidence";

function request(url = "https://example.test/api/cook-sessions/recipe-1?secret=not-for-evidence") {
  return { url: () => url, method: () => "GET" } as Request;
}

function recorder() {
  const page = new EventEmitter();
  const recording = recordCookSyncRequests(page as unknown as Page, () => 1234);
  return { page, recording };
}

describe("cook-sync request phase evidence", () => {
  it("records request, headers and body completion without headers, query or bodies", () => {
    const { page, recording } = recorder();
    const read = request();
    page.emit("request", read);
    page.emit("response", { request: () => read, status: () => 200 } as Response);
    page.emit("requestfinished", read);

    expect(recording.snapshot()).toEqual({
      events: [
        { request: 1, phase: "request", at: 1234, method: "GET", path: "/api/cook-sessions/recipe-1" },
        { request: 1, phase: "response", at: 1234, method: "GET", path: "/api/cook-sessions/recipe-1", status: 200 },
        { request: 1, phase: "finished", at: 1234, method: "GET", path: "/api/cook-sessions/recipe-1" },
      ],
      dropped: 0,
    });
    expect(JSON.stringify(recording.snapshot())).not.toContain("secret");
    recording.stop();
  });

  it("distinguishes cancellation from a body that has not finished", () => {
    const { page, recording } = recorder();
    const read = request();
    page.emit("request", read);
    page.emit("requestfailed", read);

    expect(recording.snapshot().events.map(({ phase }) => phase)).toEqual(["request", "failed"]);
    recording.stop();
  });

  it("ignores unrelated traffic and stops recording after cleanup", () => {
    const { page, recording } = recorder();
    page.emit("request", request("https://example.test/account/settings?secret=not-for-evidence"));
    page.emit("request", request("https://example.test/api/cook-sessions-other/recipe-1"));
    recording.stop();
    page.emit("request", request());

    expect(recording.snapshot()).toEqual({ events: [], dropped: 0 });
  });

  it("bounds retained events and reports discarded observations", () => {
    const { page, recording } = recorder();
    const read = request();
    for (let index = 0; index < 65; index += 1) page.emit("request", read);

    expect(recording.snapshot().events).toHaveLength(64);
    expect(recording.snapshot().dropped).toBe(1);
    recording.stop();
  });
});
