import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

import * as lifecycle from "../../scripts/ensure-r2-upload-lifecycle.mjs";
import { isTransientCloudflareApiError } from "../../scripts/retry-cloudflare.mjs";

// What wrangler 4.90.0 prints for a bucket with only R2's default rule (tableFromLifecycleRulesResponse
// in its cli.js), with the colours it adds on a terminal.
const DEFAULT_ONLY = [
  "",
  " ⛅️ wrangler 4.90.0",
  "───────────────────",
  "Listing lifecycle rules for bucket 'spoonjoy-photos-qa'...",
  "\u001b[37mname:\u001b[39m     \u001b[90mDefault Multipart Abort Rule\u001b[39m",
  "\u001b[37menabled:\u001b[39m  \u001b[90mYes\u001b[39m",
  "\u001b[37mprefix:\u001b[39m   \u001b[90m(all prefixes)\u001b[39m",
  "\u001b[37maction:\u001b[39m   \u001b[90mAbort incomplete multipart uploads after 7 days\u001b[39m",
  "",
].join("\n");

const rule = (id: string, enabled: string, prefix: string, action: string) =>
  [`name:     ${id}`, `enabled:  ${enabled}`, `prefix:   ${prefix}`, `action:   ${action}`].join("\n");

const WITH_OURS = `Listing lifecycle rules for bucket 'spoonjoy-photos'...\n${[
  rule("Default Multipart Abort Rule", "Yes", "(all prefixes)", "Abort incomplete multipart uploads after 7 days"),
  rule("move-in-upload-abort", "Yes", "pending-uploads/move-in/", "Abort incomplete multipart uploads after 1 days"),
].join("\n\n")}\n`;

function wranglerAnswering(...outputs: string[]) {
  return vi.fn(async () => ({ stdout: outputs.shift() ?? "", stderr: "" }));
}

describe("reading a bucket's lifecycle rules", () => {
  it("reads each rule's id, whether it is on, its prefix and when it aborts unfinished uploads", () => {
    expect(lifecycle.parseLifecycleRules(DEFAULT_ONLY)).toEqual([
      { id: "Default Multipart Abort Rule", enabled: true, prefix: "", abortDays: 7 },
    ]);
    expect(lifecycle.parseLifecycleRules(`${rule("old-photos", "No", "photos/", "Expire objects after 30 days")}\n`)).toEqual([
      { id: "old-photos", enabled: false, prefix: "photos/", abortDays: null },
    ]);
    // A rule with several actions, part days, and none.
    expect(
      lifecycle.parseLifecycleRules(
        `${rule("both", "Yes", "pending-uploads/", "Expire objects after 30 days, Abort incomplete multipart uploads after 0.5 days")}\n\n${rule("idle", "Yes", "(all prefixes)", "(none)")}\n`,
      ),
    ).toEqual([
      { id: "both", enabled: true, prefix: "pending-uploads/", abortDays: 0.5 },
      { id: "idle", enabled: true, prefix: "", abortDays: null },
    ]);
  });

  it("reads a bucket with no rules as none, and fails on output it doesn't recognise", () => {
    expect(lifecycle.parseLifecycleRules("There are no lifecycle rules for bucket 'spoonjoy-photos-qa'.\n")).toEqual([]);
    expect(() => lifecycle.parseLifecycleRules("Something else entirely\n")).toThrow(/no rules in a form this script reads/);
    expect(lifecycle.parseLifecycleRules("name: bare\n")).toEqual([{ id: "bare", enabled: false, prefix: "", abortDays: null }]);
  });
});

describe("deciding what a bucket needs", () => {
  const base = { id: "r", enabled: true, prefix: "", abortDays: 1 };

  it("keeps a bucket where an enabled rule over the move-in prefix aborts within a day", () => {
    expect(lifecycle.lifecycleDecision([base])).toEqual({ action: "keep", covering: ["r"] });
    expect(lifecycle.lifecycleDecision([{ ...base, prefix: "pending-uploads/" }]).action).toBe("keep");
    expect(lifecycle.lifecycleDecision([{ ...base, prefix: "pending-uploads/move-in/", abortDays: 0.5 }]).action).toBe("keep");
  });

  it("adds the rule where no rule covers move-in uploads within a day, R2's 7-day default included", () => {
    for (const rules of [
      [],
      [{ ...base, abortDays: 7 }],
      [{ ...base, enabled: false }],
      [{ ...base, prefix: "photos/" }],
      [{ ...base, prefix: "pending-uploads/move-in/other/" }],
      [{ ...base, abortDays: null }],
    ]) {
      expect(lifecycle.lifecycleDecision(rules), JSON.stringify(rules)).toEqual({ action: "add", covering: [] });
    }
  });

  it("refuses to touch its own rule once someone changed it", () => {
    expect(lifecycle.lifecycleDecision([{ ...base, id: "move-in-upload-abort", abortDays: 3 }]).action).toBe("refuse");
  });
});

describe("ensure-r2-upload-lifecycle", () => {
  it("adds the rule to a bucket that has only R2's default, logging ids and counts only", async () => {
    const exec = wranglerAnswering(DEFAULT_ONLY, "Adding lifecycle rule…");
    const log = vi.fn();
    await expect(lifecycle.main(["spoonjoy-photos-qa"], { exec, log })).resolves.toEqual({ action: "add", covering: [] });
    expect(exec.mock.calls.map((call) => call[1])).toEqual([
      ["exec", "wrangler", "r2", "bucket", "lifecycle", "list", "spoonjoy-photos-qa"],
      ["exec", "wrangler", "r2", "bucket", "lifecycle", "add", "spoonjoy-photos-qa", "move-in-upload-abort", "pending-uploads/move-in/", "--abort-multipart-days", "1", "--force"],
    ]);
    expect(log.mock.calls.map((call) => call[0])).toEqual([
      "spoonjoy-photos-qa has 1 lifecycle rule(s): Default Multipart Abort Rule.",
      "Added move-in-upload-abort to spoonjoy-photos-qa: unfinished uploads under pending-uploads/move-in/ are aborted after 1 day.",
    ]);
  });

  it("changes nothing when run again", async () => {
    const exec = wranglerAnswering(WITH_OURS);
    const log = vi.fn();
    await expect(lifecycle.main(["spoonjoy-photos"], { exec, log })).resolves.toMatchObject({ action: "keep" });
    expect(exec).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenLastCalledWith("move-in-upload-abort already aborts unfinished uploads under pending-uploads/move-in/ within 1 day; nothing to change.");
  });

  it("only says what it would add with --check", async () => {
    const exec = wranglerAnswering("There are no lifecycle rules for bucket 'spoonjoy-photos-qa'.\n");
    const log = vi.fn();
    await lifecycle.main(["spoonjoy-photos-qa", "--check"], { exec, log });
    expect(exec).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.map((call) => call[0])).toEqual([
      "spoonjoy-photos-qa has 0 lifecycle rule(s): none.",
      "No rule aborts unfinished uploads under pending-uploads/move-in/ within 1 day; without --check this adds move-in-upload-abort.",
    ]);
  });

  it("fails without changing its own rule once someone changed it", async () => {
    const exec = wranglerAnswering(rule("move-in-upload-abort", "No", "pending-uploads/move-in/", "Abort incomplete multipart uploads after 1 days"));
    await expect(lifecycle.main(["spoonjoy-photos"], { exec, log: vi.fn() })).rejects.toThrow(/Someone changed it, so it was left as it is/);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("passes wrangler's error on to stderr, where retry-cloudflare can tell Cloudflare's own failures apart", async () => {
    const refused = Object.assign(new Error("Command failed: pnpm exec wrangler r2 bucket lifecycle list spoonjoy-photos"), {
      stdout: "Listing lifecycle rules for bucket 'spoonjoy-photos'...\n",
      stderr: "✘ [ERROR] A request to the Cloudflare API (/accounts/x/r2/buckets/spoonjoy-photos/lifecycle) failed.\n\n  Authentication error [code: 10000]\n",
    });
    const written: string[] = [];
    const stderr = { write: (chunk: string) => written.push(chunk) };
    const exec = vi.fn(async () => {
      throw refused;
    });
    // One line for the GitHub annotation, naming the cause.
    await expect(lifecycle.main(["spoonjoy-photos"], { exec, log: vi.fn(), stderr })).rejects.toThrow(
      /^wrangler r2 bucket lifecycle list failed: Authentication error \[code: 10000\]$/,
    );
    expect(written.join("")).toContain("Authentication error [code: 10000]");
    // Wrangler's stdout, which can name the token's accounts, stays out of the log.
    expect(written.join("")).not.toContain("Listing lifecycle rules");
    expect(isTransientCloudflareApiError(written.join(""))).toBe(false);

    const silent = vi.fn(async () => {
      throw new Error("spawn pnpm ENOENT");
    });
    written.length = 0;
    await expect(lifecycle.main(["spoonjoy-photos"], { exec: silent, log: vi.fn(), stderr })).rejects.toThrow(/^wrangler r2 bucket lifecycle list failed$/);
    expect(written).toEqual([]);
  });

  it("sums up wrangler's error by its coded line, else its error line, else its first", () => {
    expect(lifecycle.errorSummary("\u001b[31m✘ [ERROR]\u001b[39m A request failed.\n\n  Bad thing [code: 10006]\n")).toBe("Bad thing [code: 10006]");
    expect(lifecycle.errorSummary("noise\n✘ [ERROR] Received a malformed response from the API\n")).toBe("✘ [ERROR] Received a malformed response from the API");
    expect(lifecycle.errorSummary("\nfirst\nsecond")).toBe("first");
  });

  it("takes exactly one bucket name, and --check", () => {
    expect(lifecycle.parseArgs(["spoonjoy-photos"])).toEqual({ bucket: "spoonjoy-photos", check: false });
    expect(lifecycle.parseArgs(["--check", "spoonjoy-photos-qa"])).toEqual({ bucket: "spoonjoy-photos-qa", check: true });
    for (const argv of [[], ["a", "b"], ["Not_A_Bucket"], ["--force"]]) {
      expect(() => lifecycle.parseArgs(argv), argv.join(" ")).toThrow(/Usage/);
    }
  });

  it("runs only as the entry script, and reports a failure as a GitHub error", async () => {
    const io = { error: vi.fn() };
    const setExitCode = vi.fn();
    const url = pathToFileURL("/repo/scripts/ensure-r2-upload-lifecycle.mjs").href;
    expect(await lifecycle.runCliIfEntry({ moduleUrl: url, argv1: undefined, io, setExitCode })).toBe(false);
    expect(await lifecycle.runCliIfEntry({ moduleUrl: url, argv1: "/repo/other.mjs", io, setExitCode })).toBe(false);

    const ok = vi.fn(async () => ({ action: "keep", covering: ["r"] }));
    expect(await lifecycle.runCliIfEntry({ moduleUrl: url, argv1: "/repo/scripts/ensure-r2-upload-lifecycle.mjs", runMain: ok, io, setExitCode })).toBe(true);
    expect(setExitCode).not.toHaveBeenCalled();

    for (const failure of [new Error("refused"), "plain"]) {
      const fail = vi.fn(async () => {
        throw failure;
      });
      await lifecycle.runCliIfEntry({ moduleUrl: url, argv1: "/repo/scripts/ensure-r2-upload-lifecycle.mjs", runMain: fail, io, setExitCode });
    }
    expect(io.error.mock.calls.map((call) => call[0])).toEqual(["::error::refused", "::error::plain"]);
    expect(setExitCode).toHaveBeenCalledWith(1);
  });
});
