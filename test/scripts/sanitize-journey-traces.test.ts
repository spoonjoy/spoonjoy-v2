import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import zlib from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
  REDACTED,
  defaultCliErrorHandler,
  errorMessage,
  findTraceLeaks,
  isCliEntry,
  main,
  readZip,
  redactTraceValue,
  runCliIfEntry,
  sanitizeTraceText,
  sanitizeTraceZip,
  writeZip,
} from "../../scripts/sanitize-journey-traces.mjs";
import { expectConsoleError } from "../warning-policy";

type Entry = { name: string; data: Buffer; time?: number; date?: number };

const SESSION_COOKIE = "__session=s3cr3t-session-value";
const lines = (...events: unknown[]) => events.map((event) => JSON.stringify(event)).join("\n");
const entry = (name: string, data: string | Buffer): Entry => ({
  name,
  data: typeof data === "string" ? Buffer.from(data, "utf8") : data,
});

// The shape of a Playwright 1.58 test-level trace.zip for a signed-in journey that failed.
function playwrightLikeTrace(): Entry[] {
  return [
    entry(
      "test.trace",
      lines(
        { type: "context-options", origin: "testRunner", options: {} },
        { type: "before", callId: "call@1", title: 'Fill "hunter2"', params: { value: "hunter2" } },
      ),
    ),
    entry(
      "0-trace.trace",
      [
        JSON.stringify({
          type: "context-options",
          options: {
            baseURL: "https://qa.example",
            storageState: { cookies: [{ name: "__session", value: "s3cr3t-session-value" }], origins: [] },
          },
        }),
        JSON.stringify({ type: "screencast-frame", sha1: "page@1-100.jpeg" }),
        JSON.stringify({ type: "after", callId: "call@2", result: { cookies: [{ value: "s3cr3t-session-value" }] } }),
        JSON.stringify({ type: "before", method: "setExtraHTTPHeaders", params: { headers: [{ name: "Cookie", value: SESSION_COOKIE }] } }),
        "",
      ].join("\n"),
    ),
    entry(
      "0-trace.network",
      lines({
        type: "resource-snapshot",
        snapshot: {
          request: { headers: [{ name: "Cookie", value: SESSION_COOKIE }], postData: { _sha1: "post.dat" } },
          response: { headers: [{ name: "Set-Cookie", value: `${SESSION_COOKIE}; HttpOnly` }], content: { _sha1: "body.html" } },
        },
      }),
    ),
    entry("0-trace.stacks", JSON.stringify({ files: ["sign-in.journey.ts"] })),
    entry("resources/page@1-100.jpeg", Buffer.from([0xff, 0xd8, 0xff])),
    entry("resources/post.dat", "username=qa_kitchen_chef&password=hunter2"),
    entry("resources/body.html", "<html>signed in</html>"),
    entry("resources/src@abc.txt", "test('x', async () => {});"),
  ];
}

const names = (entries: Entry[]) => entries.map((e) => e.name);
const text = (entries: Entry[], name: string) => entries.find((e) => e.name === name)!.data.toString("utf8");

// A zip written the way a streaming writer does it: stored entry, general-purpose bit 3 set,
// zero crc/sizes in the local header and the real values only in a trailing data descriptor
// and the central directory.
function streamedStoredZip(name: string, data: Buffer): Buffer {
  const nameBytes = Buffer.from(name, "utf8");
  const crc = zlib.crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0808, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt16LE(nameBytes.length, 26);
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(crc, 4);
  descriptor.writeUInt32LE(data.length, 8);
  descriptor.writeUInt32LE(data.length, 12);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0x0808, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt16LE(3, 30); // extra field length
  central.writeUInt16LE(2, 32); // comment length
  central.writeUInt32LE(0, 42);
  const extraAndComment = Buffer.from([1, 2, 3, 9, 9]);
  const localPart = Buffer.concat([local, nameBytes, data, descriptor]);
  const centralPart = Buffer.concat([central, nameBytes, extraAndComment]);
  const eocd = Buffer.alloc(22 + 4);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  eocd.writeUInt16LE(4, 20); // archive comment length
  return Buffer.concat([localPart, centralPart, eocd]);
}

describe("zip reading and writing", () => {
  it("round-trips entries, names and timestamps", () => {
    const written = writeZip([
      { name: "a.trace", data: Buffer.from("hello"), time: 1234, date: 5678 },
      { name: "resources/ünïcode.txt", data: Buffer.alloc(0) },
    ]);
    const read = readZip(written);
    expect(read.map((e: Entry) => [e.name, e.data.toString(), e.time, e.date])).toEqual([
      ["a.trace", "hello", 1234, 5678],
      ["resources/ünïcode.txt", "", 0, 0x21],
    ]);
  });

  it("reads stored entries whose sizes live only in the central directory (data descriptor)", () => {
    const read = readZip(streamedStoredZip("trace.trace", Buffer.from("{}")));
    expect(read).toHaveLength(1);
    expect(read[0].name).toBe("trace.trace");
    expect(read[0].data.toString()).toBe("{}");
  });

  it("rejects a buffer with no end-of-central-directory record", () => {
    expect(() => readZip(Buffer.alloc(40))).toThrow("not a zip archive");
  });

  it("rejects ZIP64 archives flagged by entry count or central-directory offset", () => {
    const byCount = writeZip([]);
    byCount.writeUInt16LE(0xffff, byCount.length - 22 + 10);
    expect(() => readZip(byCount)).toThrow("ZIP64");
    const byOffset = writeZip([]);
    byOffset.writeUInt32LE(0xffffffff, byOffset.length - 22 + 16);
    expect(() => readZip(byOffset)).toThrow("ZIP64");
  });

  it("rejects ZIP64 sentinel sizes inside a central-directory entry", () => {
    const zip = writeZip([entry("a", "x")]);
    const central = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    zip.writeUInt32LE(0xffffffff, central + 24);
    expect(() => readZip(zip)).toThrow("ZIP64");
  });

  it("rejects a corrupt central directory and a corrupt local header", () => {
    const badCentral = writeZip([entry("a", "x")]);
    badCentral.writeUInt32LE(0, badCentral.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])));
    expect(() => readZip(badCentral)).toThrow("corrupt zip central directory");
    const badLocal = writeZip([entry("a", "x")]);
    badLocal.writeUInt32LE(0, 0);
    expect(() => readZip(badLocal)).toThrow('corrupt local header for "a"');
  });

  it("rejects an unsupported compression method and a CRC mismatch", () => {
    const badMethod = streamedStoredZip("a", Buffer.from("x"));
    badMethod.writeUInt16LE(12, badMethod.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 10);
    expect(() => readZip(badMethod)).toThrow("unsupported compression method 12");
    const badCrc = streamedStoredZip("a", Buffer.from("x"));
    badCrc.writeUInt32LE(1, badCrc.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 16);
    expect(() => readZip(badCrc)).toThrow('CRC mismatch for "a"');
  });
});

describe("redaction", () => {
  it("redacts storage state, cookies, origins and credential headers, leaving everything else", () => {
    expect(
      redactTraceValue({
        options: { storageState: { cookies: [] }, baseURL: "https://qa.example" },
        result: { Cookies: [{ value: "x" }], origins: [] },
        headers: [
          { name: "Set-Cookie", value: "a=b" },
          { name: "authorization", value: "Bearer t" },
          { name: "accept", value: "text/html" },
        ],
        map: { cookie: "a=b", "Proxy-Authorization": "Basic x", accept: "*/*" },
        list: [1, null, "s"],
        nameIsNotAString: { name: 3, value: "kept" },
      }),
    ).toEqual({
      options: { storageState: REDACTED, baseURL: "https://qa.example" },
      result: { Cookies: REDACTED, origins: REDACTED },
      headers: [
        { name: "Set-Cookie", value: REDACTED },
        { name: "authorization", value: REDACTED },
        { name: "accept", value: "text/html" },
      ],
      map: { cookie: REDACTED, "Proxy-Authorization": REDACTED, accept: "*/*" },
      list: [1, null, "s"],
      nameIsNotAString: { name: 3, value: "kept" },
    });
  });

  it("redacts each JSON line, drops blank and unparseable lines, and is idempotent", () => {
    const input = `${JSON.stringify({ cookies: [1] })}\n\nnot json\n${JSON.stringify({ type: "log" })}\n`;
    const once = sanitizeTraceText(input);
    expect(once).toEqual({ text: `{"cookies":"${REDACTED}"}\n{"type":"log"}`, droppedLines: 1 });
    expect(sanitizeTraceText(once.text)).toEqual({ text: once.text, droppedLines: 0 });
  });
});

describe("sanitizeTraceZip", () => {
  it("returns null for a zip that is not a Playwright trace", () => {
    expect(sanitizeTraceZip(writeZip([entry("report.json", "{}")]))).toBeNull();
  });

  it("removes network logs and network-only resources, redacts session state, and keeps the rest", () => {
    const result = sanitizeTraceZip(writeZip(playwrightLikeTrace()))!;
    const out = readZip(result.buffer);

    expect(names(out)).toEqual([
      "test.trace",
      "0-trace.trace",
      "0-trace.stacks",
      "resources/page@1-100.jpeg",
      "resources/src@abc.txt",
    ]);
    expect(result).toMatchObject({ removedNetworkLogs: 1, removedResources: 2, droppedLines: 0 });

    const contextTrace = text(out, "0-trace.trace");
    expect(contextTrace).not.toContain("s3cr3t-session-value");
    expect(contextTrace).toContain('"storageState":"[redacted]"');
    expect(contextTrace).toContain('"baseURL":"https://qa.example"');
    expect(contextTrace).toContain("page@1-100.jpeg");
    expect(text(out, "test.trace")).toContain('Fill \\"hunter2\\"');
    expect(findTraceLeaks(out)).toEqual([]);
    for (const e of out) expect(e.data.toString("latin1")).not.toContain("s3cr3t-session-value");
  });

  it("findTraceLeaks reports surviving network entries and unredacted trace lines", () => {
    expect(
      findTraceLeaks(readZip(writeZip([entry("1-trace.network", ""), entry("1-trace.trace", '{"cookies":[]}'), entry("resources/x", "")]))),
    ).toEqual(['network log "1-trace.network" is still present', '"1-trace.trace" still has unredacted content']);
  });
});

function fakeFile(parentPath: string, name: string) {
  return { name, parentPath, isFile: () => true };
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    io: { log: vi.fn(), error: vi.fn() },
    exit: vi.fn(),
    readdir: vi.fn().mockResolvedValue([]),
    readFile: vi.fn(),
    writeFile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("main", () => {
  it("prints usage and exits 1 without a directory", async () => {
    const d = deps();
    await main([], d);
    expect(d.io.error).toHaveBeenCalledWith(expect.stringContaining("Usage"));
    expect(d.exit).toHaveBeenCalledWith(1);
  });

  it("skips a directory that does not exist without failing", async () => {
    const missing = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    const d = deps({ readdir: vi.fn().mockRejectedValue(missing) });
    await main(["test-results"], d);
    expect(d.io.log).toHaveBeenCalledWith(expect.stringContaining("test-results does not exist"));
    expect(d.io.log).toHaveBeenCalledWith(expect.stringContaining("Sanitized 0 trace(s)"));
    expect(d.exit).not.toHaveBeenCalled();
  });

  it("fails on any other directory read error, including a non-Error rejection", async () => {
    const d = deps({ readdir: vi.fn().mockRejectedValueOnce(new Error("EACCES")).mockRejectedValueOnce("odd") });
    await main(["a", "b"], d);
    expect(d.io.error).toHaveBeenCalledWith('sanitize-journey-traces: cannot read directory "a": EACCES');
    expect(d.io.error).toHaveBeenCalledWith('sanitize-journey-traces: cannot read directory "b": odd');
    expect(d.exit).toHaveBeenCalledWith(1);
  });

  it("rewrites trace zips in place, ignores non-zip files and non-trace zips, and resolves entry paths", async () => {
    const trace = writeZip(playwrightLikeTrace());
    const notTrace = writeZip([entry("index.json", "{}")]);
    const written = new Map<string, Buffer>();
    const readFile = vi.fn(async (file: string) => {
      if (written.has(file)) return written.get(file)!;
      return file.endsWith("other.zip") ? notTrace : trace;
    });
    const writeFile = vi.fn(async (file: string, data: Buffer) => {
      written.set(file, data);
    });
    const d = deps({
      readdir: vi.fn().mockResolvedValue([
        fakeFile("test-results/sign-in", "trace.zip"),
        { name: "legacy.zip", path: "test-results/legacy", isFile: () => true },
        { name: "bare.zip", isFile: () => true },
        fakeFile("test-results", "other.zip"),
        fakeFile("test-results", "video.webm"),
        { name: "nested.zip", parentPath: "test-results", isFile: () => false },
      ]),
      readFile,
      writeFile,
    });
    await main(["test-results"], d);
    expect([...written.keys()]).toEqual([
      join("test-results/sign-in", "trace.zip"),
      join("test-results/legacy", "legacy.zip"),
      join("test-results", "bare.zip"),
    ]);
    expect(d.io.log).toHaveBeenCalledWith(
      "Sanitized 3 trace(s): removed 3 network log(s) and 6 network resource(s), dropped 0 unparseable trace line(s).",
    );
    expect(d.exit).not.toHaveBeenCalled();
  });

  it("fails when the re-read zip still contains a network entry", async () => {
    const trace = writeZip(playwrightLikeTrace());
    const d = deps({
      readdir: vi.fn().mockResolvedValue([fakeFile("test-results", "trace.zip")]),
      readFile: vi.fn().mockResolvedValue(trace),
    });
    await main(["test-results"], d);
    expect(d.io.error).toHaveBeenCalledWith(
      `${join("test-results", "trace.zip")}: network log "0-trace.network" is still present`,
    );
    expect(d.exit).toHaveBeenCalledWith(1);
  });

  it("fails on a zip it cannot parse", async () => {
    const d = deps({
      readdir: vi.fn().mockResolvedValue([fakeFile("journeys-report/data", "abc.zip")]),
      readFile: vi.fn().mockResolvedValue(Buffer.from("not a zip at all, definitely")),
    });
    await main(["journeys-report"], d);
    expect(d.io.error).toHaveBeenCalledWith(expect.stringContaining("not a zip archive"));
    expect(d.exit).toHaveBeenCalledWith(1);
  });

  it("sanitizes a real directory tree through the default fs dependencies", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sanitize-journey-traces-"));
    try {
      mkdirSync(join(dir, "data"));
      writeFileSync(join(dir, "data", "trace.zip"), writeZip(playwrightLikeTrace()));
      const io = { log: vi.fn(), error: vi.fn() };
      const exit = vi.fn();
      await main([dir], { io, exit });
      const out = readZip(readFileSync(join(dir, "data", "trace.zip")));
      expect(names(out)).not.toContain("0-trace.network");
      expect(findTraceLeaks(out)).toEqual([]);
      expect(exit).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses default argv, io and exit when nothing is passed", async () => {
    const originalArgv = process.argv;
    process.argv = ["node", "sanitize-journey-traces.mjs"];
    expectConsoleError("Usage: sanitize-journey-traces.mjs <directory> [<directory> ...]");
    try {
      await expect(main()).resolves.toBeUndefined();
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = 0;
      process.argv = originalArgv;
    }
  });
});

describe("CLI entry guard", () => {
  it("errorMessage formats Errors and anything else", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage(42)).toBe("42");
  });

  it("isCliEntry is true only when argv1 resolves to this module", () => {
    expect(isCliEntry("file:///a/b.mjs", "/a/b.mjs")).toBe(true);
    expect(isCliEntry("file:///a/b.mjs", "/a/other.mjs")).toBe(false);
    expect(isCliEntry("file:///a/b.mjs", undefined)).toBe(false);
  });

  it("runCliIfEntry does nothing when this module is not the entry point", () => {
    const runMain = vi.fn();
    expect(runCliIfEntry({ moduleUrl: "file:///a/b.mjs", argv1: "/a/other.mjs", runMain })).toBe(false);
    expect(runMain).not.toHaveBeenCalled();
  });

  it("runCliIfEntry runs main and routes a rejection to onError", async () => {
    const failure = new Error("boom");
    const runMain = vi.fn().mockRejectedValue(failure);
    const onError = vi.fn();
    expect(runCliIfEntry({ moduleUrl: "file:///a/b.mjs", argv1: "/a/b.mjs", runMain, onError })).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it("runCliIfEntry uses its defaults when called with no options", () => {
    expect(runCliIfEntry()).toBe(false);
  });

  it("defaultCliErrorHandler reports through the injected io, or console by default, and sets exitCode 1", () => {
    const io = { error: vi.fn() };
    defaultCliErrorHandler(new Error("boom"), io);
    expect(io.error).toHaveBeenCalledWith("boom");
    expect(process.exitCode).toBe(1);
    expectConsoleError("boom-default");
    defaultCliErrorHandler("boom-default");
    process.exitCode = 0;
  });
});
