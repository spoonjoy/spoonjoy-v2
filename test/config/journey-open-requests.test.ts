import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const fixtureState = vi.hoisted(() => ({ extension: undefined as unknown }));
vi.mock("@playwright/test", () => ({
  test: { extend: (extension: unknown) => { fixtureState.extension = extension; return {}; } },
  expect: () => undefined,
}));

const { watchRequests } = await import("../../e2e/journeys/support/journey");

type FakeRequest = { method(): string; resourceType(): string; url(): string };
type Attachment = { body: string; contentType: string };
type TestInfo = { status: string; expectedStatus: string; attach: (name: string, attachment: Attachment) => Promise<void> };
const fixtures = fixtureState.extension as {
  openRequests: [(context: { page: EventEmitter }, use: () => Promise<void>, testInfo: TestInfo) => Promise<void>, { auto: boolean }];
};

function request(url: string, resourceType = "font", method = "GET"): FakeRequest {
  return { method: () => method, resourceType: () => resourceType, url: () => url };
}

describe("the open requests of a journey", () => {
  it("lists the requests that never finished or failed, oldest first, with redacted URLs", () => {
    const page = new EventEmitter();
    let now = 1_000;
    const watcher = watchRequests(page as never, () => now);
    const document = request("https://qa.example.test/login?redirectTo=%2Frecipes", "document");
    const font = request("https://fonts.gstatic.com/s/fraunces/v1.woff2?token=secret");
    const image = request("https://qa.example.test/logos/sj_black.svg", "image");
    const script = request("https://qa.example.test/assets/root.js", "script");
    page.emit("request", document);
    now = 1_200;
    page.emit("request", font);
    page.emit("request", image);
    page.emit("request", script);
    page.emit("requestfinished", document);
    page.emit("requestfailed", image);
    now = 61_000;

    expect(watcher.open()).toEqual([
      { method: "GET", resourceType: "font", url: "https://fonts.gstatic.com/s/fraunces/v1.woff2", openMs: 59_800 },
      { method: "GET", resourceType: "script", url: "https://qa.example.test/assets/root.js", openMs: 59_800 },
    ]);
    watcher.dispose();
    for (const event of ["request", "requestfinished", "requestfailed"]) expect(page.listenerCount(event)).toBe(0);
  });

  it("attaches them to a failed test only", async () => {
    expect(fixtures.openRequests[1]).toEqual({ auto: true });
    for (const [status, attached] of [["timedOut", 1], ["passed", 0]] as const) {
      const page = new EventEmitter();
      const attach = vi.fn(async () => undefined);
      await fixtures.openRequests[0]({ page }, async () => {
        page.emit("request", request("https://qa.example.test/assets/stuck.css", "stylesheet"));
      }, { status, expectedStatus: "passed", attach });

      expect(attach).toHaveBeenCalledTimes(attached);
      expect(page.listenerCount("request")).toBe(0);
      if (attached) {
        const [name, attachment] = attach.mock.calls[0] as unknown as [string, Attachment];
        expect(name).toBe("open-requests.json");
        expect(attachment.contentType).toBe("application/json");
        expect(JSON.parse(attachment.body)).toEqual([
          expect.objectContaining({ resourceType: "stylesheet", url: "https://qa.example.test/assets/stuck.css" }),
        ]);
      }
    }
  });
});
