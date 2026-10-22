// The journeys' console gate does not count a lost request the page sent again and got an answer to
// (e2e/journeys/support/recovered-requests.ts), and still counts everything else.
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { RequestLedger, isTransportFailureLog } from "../e2e/journeys/support/recovered-requests";

const fixtureState = vi.hoisted(() => ({ extension: undefined as unknown }));
vi.mock("@playwright/test", () => ({
  test: { extend: (extension: unknown) => { fixtureState.extension = extension; return {}; } },
  expect: () => undefined,
}));

await import("../e2e/journeys/support/journey");

const fixtures = fixtureState.extension as {
  consoleGate: [(context: { page: EventEmitter; consoleExpectations: unknown[] }, use: () => Promise<void>) => Promise<void>];
};

const RENAME = "https://spoonjoy-v2-qa-run-39838941793-1.mendelow-studio.workers.dev/cookbooks/3c09f8ae-2e09-740c-a510-9ace7212d12a.data";
// WebKit's log for the rename in Journeys run 39838941793.
const RESET = "Failed to load resource: Peer failed to perform TLS handshake: Error receiving data: Connection reset by peer";
const request = (method: string, url: string) => ({ method: () => method, url: () => url });

type Event =
  | { failed: [string, string] }
  | { answered: [string, string] }
  | { log: string; url?: string };

async function gate(events: Event[]) {
  const page = new EventEmitter();
  await fixtures.consoleGate[0]({ page, consoleExpectations: [] }, async () => {
    for (const event of events) {
      if ("failed" in event) page.emit("requestfailed", request(...event.failed));
      else if ("answered" in event) page.emit("requestfinished", request(...event.answered));
      else page.emit("console", { type: () => "error", text: () => event.log, location: () => ({ url: event.url ?? "" }) });
    }
  });
  for (const name of ["console", "pageerror", "requestfailed", "requestfinished"]) {
    expect(page.listenerCount(name), name).toBe(0);
  }
}

describe("isTransportFailureLog", () => {
  it("is a load failure without an HTTP answer", () => {
    expect(isTransportFailureLog(RESET)).toBe(true);
    expect(isTransportFailureLog("Failed to load resource: net::ERR_CONNECTION_RESET")).toBe(true);
  });

  it("is never an answer or another error", () => {
    expect(isTransportFailureLog("Failed to load resource: the server responded with a status of 400 (Bad Request)")).toBe(false);
    expect(isTransportFailureLog("Unexpected app error")).toBe(false);
  });
});

describe("RequestLedger", () => {
  it("calls a request recovered only when the same method and URL were answered after it failed", () => {
    const ledger = new RequestLedger();
    ledger.answered(request("POST", RENAME));
    ledger.failed(request("POST", RENAME));
    expect(ledger.recovered(RENAME)).toBe(false);
    ledger.answered(request("GET", RENAME));
    expect(ledger.recovered(RENAME)).toBe(false);
    ledger.answered(request("POST", `${RENAME}?index`));
    expect(ledger.recovered(RENAME)).toBe(false);
    ledger.answered(request("POST", RENAME));
    expect(ledger.recovered(RENAME)).toBe(true);
    expect(ledger.recovered(`${RENAME}?index`)).toBe(false);
  });
});

describe("the console gate and lost requests", () => {
  it("passes when the page sent the lost request again and got an answer", async () => {
    await expect(gate([
      { failed: ["POST", RENAME] },
      { log: RESET, url: RENAME },
      { answered: ["POST", RENAME] },
    ])).resolves.toBeUndefined();
  });

  it.each([
    ["never sent again", [{ failed: ["POST", RENAME] }, { log: RESET, url: RENAME }]],
    ["sent again without an answer", [{ failed: ["POST", RENAME] }, { log: RESET, url: RENAME }, { failed: ["POST", RENAME] }]],
    ["answered only before it was lost", [{ answered: ["POST", RENAME] }, { failed: ["POST", RENAME] }, { log: RESET, url: RENAME }]],
    ["followed by another request", [{ failed: ["POST", RENAME] }, { log: RESET, url: RENAME }, { answered: ["GET", RENAME] }]],
    ["logged without a URL", [{ failed: ["POST", RENAME] }, { log: RESET }, { answered: ["POST", RENAME] }]],
    ["an HTTP error, which is an answer", [
      { failed: ["POST", RENAME] },
      { log: "Failed to load resource: the server responded with a status of 500 (Internal Server Error)", url: RENAME },
      { answered: ["POST", RENAME] },
    ]],
  ] as Array<[string, Event[]]>)("still fails a lost request %s", async (_case, events) => {
    await expect(gate(events)).rejects.toThrow("Console errors during test:");
  });
});
