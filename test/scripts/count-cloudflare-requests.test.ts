// @vitest-environment node
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  CLOUDFLARE_API_ORIGIN,
  LOG_ENV,
  describeRequest,
  install,
  isCliEntry,
  main,
  start,
  summarize,
} from "../../scripts/count-cloudflare-requests.mjs";

const ACCOUNT = "0123456789abcdef0123456789abcdef";

describe("count-cloudflare-requests", () => {
  it("records only Cloudflare API requests, with the account id, database ids and query dropped", () => {
    expect(describeRequest({ origin: CLOUDFLARE_API_ORIGIN, method: "GET", path: `/client/v4/accounts/${ACCOUNT}/d1/database?page=1` }))
      .toBe("GET /client/v4/accounts/:account/d1/database");
    expect(describeRequest({ origin: CLOUDFLARE_API_ORIGIN, method: "DELETE", path: `/client/v4/accounts/${ACCOUNT}/d1/database/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee` }))
      .toBe("DELETE /client/v4/accounts/:account/d1/database/:id");
    expect(describeRequest({ origin: CLOUDFLARE_API_ORIGIN, method: "GET" })).toBe("GET ");
    expect(describeRequest({ origin: "https://sparrow.cloudflare.com", method: "POST", path: "/api/v1/event" })).toBeNull();
    expect(describeRequest(undefined)).toBeNull();
  });

  it("subscribes to undici's request channel only when a log path is set", () => {
    const subscribe = vi.fn();
    const append = vi.fn();
    expect(install({ env: {}, subscribe, append })).toBe(false);
    expect(subscribe).not.toHaveBeenCalled();

    expect(install({ env: { [LOG_ENV]: "/tmp/log" }, subscribe, append })).toBe(true);
    expect(subscribe.mock.calls[0][0]).toBe("undici:request:create");
    const onRequest = subscribe.mock.calls[0][1];
    onRequest({ request: { origin: CLOUDFLARE_API_ORIGIN, method: "GET", path: "/client/v4/user/tokens/verify", headers: ["authorization", "Bearer secret"] } });
    onRequest({ request: { origin: "https://example.com", method: "GET", path: "/" } });
    expect(append.mock.calls).toEqual([["/tmp/log", "GET /client/v4/user/tokens/verify\n"]]);
  });

  it("summarises the total and the busiest endpoints", () => {
    expect(summarize("GET /a\nPOST /b\nGET /a\n")).toBe(
      ["Cloudflare API requests this run: 3", "     2  GET /a", "     1  POST /b"].join("\n"),
    );
    expect(summarize("B /x\nA /x\n")).toBe(["Cloudflare API requests this run: 2", "     1  A /x", "     1  B /x"].join("\n"));
    expect(summarize("")).toBe("Cloudflare API requests this run: 0");
  });

  it("prints a summary from the CLI, treating a missing log as no requests", () => {
    const log = vi.fn();
    main(["summary", "/nope"], { exists: () => false, log });
    expect(log).toHaveBeenCalledWith("Cloudflare API requests this run: 0");
    main(["summary", "/log"], { exists: () => true, readFile: () => "GET /a\n", log });
    expect(log).toHaveBeenLastCalledWith("Cloudflare API requests this run: 1\n     1  GET /a");
    const deps = { exists: () => true, readFile: () => "", log };
    expect(() => main(["total"], deps)).toThrow(/Usage/);
    expect(() => main(["summary"], deps)).toThrow(/Usage/);
    expect(isCliEntry("file:///a.mjs", "/a.mjs")).toBe(true);
    expect(isCliEntry("file:///a.mjs", undefined)).toBe(false);
  });

  it("summarises when run as a command and counts when preloaded", () => {
    const runMain = vi.fn();
    const runInstall = vi.fn();
    expect(start({ moduleUrl: "file:///a.mjs", argv: ["node", "/a.mjs", "summary", "/log"], runMain, runInstall })).toBe("summary");
    expect(start({ moduleUrl: "file:///a.mjs", argv: ["node", "/b.mjs"], runMain, runInstall })).toBe("count");
    expect(runMain).toHaveBeenCalledTimes(1);
    expect(runInstall).toHaveBeenCalledTimes(1);
    const print = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      start({ moduleUrl: "file:///a.mjs", argv: ["node", "/a.mjs", "summary", "/no/such/cloudflare-requests.log"] });
      expect(print).toHaveBeenCalledWith("Cloudflare API requests this run: 0");
    } finally {
      print.mockRestore();
    }
  });

  it("counts real fetch requests when preloaded with NODE_OPTIONS, and summarises them from the CLI", () => {
    const dir = mkdtempSync(join(tmpdir(), "cf-count-"));
    const log = join(dir, "requests.log");
    const script = join(__dirname, "../../scripts/count-cloudflare-requests.mjs");
    // Loaded first, so it rewrites a local request's origin before the counter sees it.
    writeFileSync(
      join(dir, "rewrite.mjs"),
      `import { subscribe } from "node:diagnostics_channel";
      subscribe("undici:request:create", ({ request }) => { if (request.path === "/probe") request.origin = "${CLOUDFLARE_API_ORIGIN}"; });`,
    );
    writeFileSync(
      join(dir, "probe.mjs"),
      `import { createServer } from "node:http";
      const s = createServer((_, res) => res.end("ok")).listen(0, async () => {
        await (await fetch("http://127.0.0.1:" + s.address().port + "/probe")).text();
        s.close();
      });`,
    );
    execFileSync(process.execPath, ["--import", join(dir, "rewrite.mjs"), "--import", script, join(dir, "probe.mjs")], {
      env: { ...process.env, [LOG_ENV]: log },
    });
    expect(readFileSync(log, "utf8")).toBe("GET /probe\n");
    const out = execFileSync(process.execPath, [script, "summary", log], { env: { ...process.env, [LOG_ENV]: "" }, encoding: "utf8" });
    expect(out).toBe("Cloudflare API requests this run: 1\n     1  GET /probe\n");
  });
});
