// The Journeys workflow's two Worker tails are read into one stream of invocations, each once,
// with counts that say what each tail delivered (scripts/read-worker-tail.mjs).
import { describe, expect, it, vi } from "vitest";
import { main, readJsonStream, readTails, tailNotice, tailOfFile } from "../../scripts/read-worker-tail.mjs";

const pretty = (value: object) => JSON.stringify(value, null, 2);
const invocation = (eventTimestamp: number, path = "/recipes") => ({
  outcome: "ok",
  eventTimestamp,
  wallTime: 12,
  cpuTime: 3,
  event: { request: { url: `https://qa.example${path}`, method: "GET" }, response: { status: 200 } },
});
const overload = { message: "Tail is currently in sampling mode due to the high volume of messages. To prevent messages from being dropped consider adding filters.", type: "overload" };

describe("tailOfFile", () => {
  it("reads the tail and connection from the file name", () => {
    expect(tailOfFile(".worker-tail/tail-b-12.json")).toEqual({ tail: "b", connection: 12 });
    expect(tailOfFile(".worker-tail/tail-3.json")).toEqual({ tail: "a", connection: 3 });
    expect(tailOfFile(".worker-tail/tail.err")).toBeNull();
  });
});

describe("readJsonStream", () => {
  it("reads pretty-printed and one-line values, skipping text between them instead of stopping", () => {
    const text = [
      " ⛅️ wrangler 4.90.0",
      pretty(invocation(1)),
      "Tail disconnected, exiting.",
      JSON.stringify(invocation(2)),
      pretty(invocation(3)),
      "",
    ].join("\n");

    expect(readJsonStream(text)).toEqual({ values: [invocation(1), invocation(2), invocation(3)], unreadableLines: 2, cutOff: false });
  });

  it("reports a value cut off at the end, and skips one that does not parse", () => {
    const cut = pretty(invocation(2)).split("\n").slice(0, 4).join("\n");
    expect(readJsonStream(`${pretty(invocation(1))}\n${cut}`)).toEqual({ values: [invocation(1)], unreadableLines: 0, cutOff: true });
    expect(readJsonStream(`{\n  "a": \n}\n${pretty(invocation(1))}\n`)).toEqual({ values: [invocation(1)], unreadableLines: 3, cutOff: false });
  });
});

describe("readJsonStream after a value cut off mid-stream", () => {
  it("counts the cut-off lines as unreadable and still reads the next value", () => {
    const cut = pretty(invocation(1)).split("\n").slice(0, 3);
    expect(readJsonStream([...cut, pretty(invocation(2)), JSON.stringify(invocation(3)), ""].join("\n")))
      .toEqual({ values: [invocation(2), invocation(3)], unreadableLines: 3, cutOff: false });
    expect(readJsonStream([...cut, JSON.stringify(invocation(3)), ""].join("\n")))
      .toEqual({ values: [invocation(3)], unreadableLines: 3, cutOff: false });
  });
});

describe("tailNotice", () => {
  it("is the type of the tail's own message, bare or as the event", () => {
    expect(tailNotice(overload)).toBe("overload");
    expect(tailNotice({ eventTimestamp: 1, event: { message: "Tail has exited sampling mode and is no longer dropping messages.", type: "overload-stop" } })).toBe("overload-stop");
    expect(tailNotice(invocation(1))).toBeNull();
    expect(tailNotice({ event: { message: "x", type: "y", request: {} } })).toBeNull();
  });
});

describe("readTails", () => {
  it("keeps each invocation once, oldest first, whichever tail saw it and whatever its key order", () => {
    const aAgain = { eventTimestamp: 2, event: invocation(2).event, cpuTime: 3, wallTime: 12, outcome: "ok" };
    const { events, stats } = readTails([
      { name: "tail-a-1.json", text: `${pretty(invocation(2))}\n${pretty(invocation(3))}\n` },
      { name: "tail-b-1.json", text: `${pretty(invocation(1))}\n${pretty(aAgain)}\n` },
      { name: "tail-b-2.json", text: `${pretty(overload)}\n${pretty(invocation(3))}\n${pretty(invocation(4)).slice(0, 20)}` },
      { name: "tail.err", text: "ignored" },
    ]);

    expect(events.map((event) => event.eventTimestamp)).toEqual([1, 2, 3]);
    expect(stats).toEqual({
      tails: {
        a: { connections: 1, events: 2, overloadNotices: 0, unreadableLines: 0, cutOff: 0 },
        b: { connections: 2, events: 3, overloadNotices: 1, unreadableLines: 0, cutOff: 1 },
      },
      eventsSeen: 5,
      eventsKept: 3,
    });
  });

  it("keeps two invocations that differ in any field", () => {
    const { events } = readTails([{ name: "tail-a-1.json", text: `${pretty(invocation(1, "/a"))}\n${pretty(invocation(1, "/b"))}\n` }]);
    expect(events).toHaveLength(2);
  });
});

describe("main", () => {
  it("writes one invocation per line and prints the counts, skipping files that do not exist", () => {
    const write = vi.fn();
    const print = vi.fn();
    main(["events.ndjson", "tail-a-1.json", "tail-b-1.json", ".worker-tail/tail-*.json"], {
      read: () => `${pretty(invocation(1))}\n`,
      exists: (path: string) => !path.includes("*"),
      write,
      print,
    });

    expect(write).toHaveBeenCalledExactlyOnceWith("events.ndjson", `${JSON.stringify(invocation(1))}\n`);
    expect(JSON.parse(print.mock.calls[0][0])).toMatchObject({ eventsSeen: 2, eventsKept: 1 });
  });

  it("needs an output file", () => {
    expect(() => main([])).toThrow("Usage: read-worker-tail.mjs");
  });
});
