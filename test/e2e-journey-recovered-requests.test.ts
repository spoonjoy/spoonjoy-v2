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
const RENAME_BODY = "intent=updateTitle&title=++";
const DELETE_BODY = "intent=delete";
const request = (method: string, url: string, body: string | null = RENAME_BODY) =>
  ({ method: () => method, url: () => url, postData: () => body });

type Sent = [string, string] | [string, string, string | null];
type Event =
  | { failed: Sent }
  | { answered: Sent }
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
  it("counts a request recovered only when the same method, URL and body were answered after it failed", () => {
    const ledger = new RequestLedger();
    ledger.answered(request("POST", RENAME));
    ledger.failed(request("POST", RENAME));
    expect(ledger.recoveredCount(RENAME)).toBe(0);
    ledger.answered(request("GET", RENAME, null));
    expect(ledger.recoveredCount(RENAME)).toBe(0);
    ledger.answered(request("POST", `${RENAME}?index`));
    expect(ledger.recoveredCount(RENAME)).toBe(0);
    ledger.answered(request("POST", RENAME, DELETE_BODY));
    expect(ledger.recoveredCount(RENAME)).toBe(0);
    ledger.answered(request("POST", RENAME));
    expect(ledger.recoveredCount(RENAME)).toBe(1);
    expect(ledger.recoveredCount(`${RENAME}?index`)).toBe(0);
  });

  it("pairs each failure with its own later answer, one to one", () => {
    const ledger = new RequestLedger();
    ledger.failed(request("POST", RENAME));
    ledger.failed(request("POST", RENAME));
    ledger.answered(request("POST", RENAME));
    expect(ledger.recoveredCount(RENAME)).toBe(1);
    ledger.answered(request("POST", RENAME));
    ledger.answered(request("POST", RENAME));
    expect(ledger.recoveredCount(RENAME)).toBe(2);
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
    ["when a different intent was answered later", [
      { failed: ["POST", RENAME, DELETE_BODY] },
      { log: RESET, url: RENAME },
      { answered: ["POST", RENAME, RENAME_BODY] },
    ]],
    ["when one was recovered and another to the same URL was not", [
      { failed: ["POST", RENAME, RENAME_BODY] },
      { log: RESET, url: RENAME },
      { failed: ["POST", RENAME, DELETE_BODY] },
      { log: RESET, url: RENAME },
      { answered: ["POST", RENAME, RENAME_BODY] },
    ]],
    ["twice, with one answer", [
      { failed: ["POST", RENAME] },
      { log: RESET, url: RENAME },
      { failed: ["POST", RENAME] },
      { log: RESET, url: RENAME },
      { answered: ["POST", RENAME] },
    ]],
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
