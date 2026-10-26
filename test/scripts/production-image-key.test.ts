import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  COVER_REPORT_SQL,
  coverReportRows,
  createdVersionId,
  createWranglerRunner,
  formatCoverReport,
  main,
  newestVersionId,
  report,
  sanitizeReason,
  secretNames,
  setImageKey,
  wranglerEnv,
  type WranglerRunner,
} from "../../scripts/production-image-key";

const ACTIVE = "11111111-1111-4111-8111-111111111111";
const KEY_VERSION = "22222222-2222-4222-8222-222222222222";
const PROVIDER_VERSION = "33333333-3333-4333-8333-333333333333";
const SOURCE_SHA = "a".repeat(40);
const ENV = {
  CLOUDFLARE_ACCOUNT_ID: "account",
  CLOUDFLARE_WORKERS_API_TOKEN: "workers-token",
  CLOUDFLARE_D1_API_TOKEN: "d1-token",
  OPENAI_API_KEY: "sk-test-key",
  PATH: "/usr/bin",
};

function deployments(versionId: string): string {
  return JSON.stringify([
    { id: "44444444-4444-4444-8444-444444444444", created_on: "2026-10-01T00:00:00Z", versions: [{ version_id: ACTIVE, percentage: 100 }] },
    { id: "55555555-5555-4555-8555-555555555555", created_on: "2026-10-02T00:00:00Z", versions: [{ version_id: versionId, percentage: 100 }] },
  ]);
}

function versionsList(newest: string): string {
  return JSON.stringify([
    { id: ACTIVE, metadata: { created_on: "2026-10-01T00:00:00Z" } },
    { id: newest, metadata: { created_on: "2026-10-03T00:00:00Z" } },
  ]);
}

function versionView(id: string, tag: string = SOURCE_SHA): string {
  return JSON.stringify({
    id,
    number: 7,
    annotations: { "workers/tag": tag },
    metadata: { created_on: "2026-10-01T00:00:00Z", source: "wrangler" },
  });
}

const D1_REPORT = JSON.stringify([{
  results: [
    { day: "2026-10-26", source: "ai-placeholder", status: "failed", reason: "Placeholder image generation failed: 429 quota", covers: 3 },
    { day: "2026-10-25", source: "spoon", status: "succeeded", reason: null, covers: 1 },
  ],
  success: true,
}]);

const SECRETS = JSON.stringify([
  { name: "SESSION_SECRET", type: "secret_text" },
  { name: "OPENAI_API_KEY", type: "secret_text" },
  { name: "IMAGE_PROVIDER_PRIMARY", type: "secret_text" },
]);

interface FakeOptions {
  deployedAfter?: string;
  newest?: string;
  tagAfter?: string;
}

function fakeWrangler({ deployedAfter = PROVIDER_VERSION, newest = ACTIVE, tagAfter = SOURCE_SHA }: FakeOptions = {}) {
  let deployed = false;
  const calls: Array<{ args: readonly string[]; env: NodeJS.ProcessEnv; input?: string }> = [];
  const run: WranglerRunner = async (args, { env, input }) => {
    calls.push({ args, env, input });
    const command = args.slice(0, 3).join(" ");
    if (command.startsWith("deployments list")) return deployments(deployed ? deployedAfter : ACTIVE);
    if (command.startsWith("versions list")) return newest === ACTIVE ? JSON.stringify([{ id: ACTIVE, metadata: { created_on: "2026-10-01T00:00:00Z" } }]) : versionsList(newest);
    if (command.startsWith("versions view")) return versionView(args[2], args[2] === ACTIVE ? SOURCE_SHA : tagAfter);
    if (command === "versions secret put") {
      const id = args[3] === "OPENAI_API_KEY" ? KEY_VERSION : PROVIDER_VERSION;
      return `✨ Success! Created version ${id} with secret ${args[3]}.`;
    }
    if (command.startsWith("versions deploy")) {
      deployed = true;
      return "Deployed";
    }
    if (command.startsWith("secret list")) return SECRETS;
    if (command.startsWith("d1 execute")) return D1_REPORT;
    throw new Error(`unexpected wrangler ${args.join(" ")}`);
  };
  return { run, calls };
}

function deps(run: WranglerRunner, log = vi.fn()) {
  return {
    run,
    workersEnv: wranglerEnv(ENV, "CLOUDFLARE_WORKERS_API_TOKEN"),
    d1Env: wranglerEnv(ENV, "CLOUDFLARE_D1_API_TOKEN"),
    log,
  };
}

describe("scripts/production-image-key", () => {
  describe("parsing", () => {
    it("reads secret names only, sorted", () => {
      expect(secretNames(SECRETS)).toEqual(["IMAGE_PROVIDER_PRIMARY", "OPENAI_API_KEY", "SESSION_SECRET"]);
      expect(secretNames(JSON.stringify([{ type: "secret_text" }]))).toEqual([]);
      expect(() => secretNames("not json")).toThrow("Wrangler secret list was not valid JSON.");
      expect(() => secretNames("{}")).toThrow("Wrangler secret list was not a list of rows.");
      expect(() => secretNames("[1]")).toThrow("Wrangler secret list was not a list of rows.");
      expect(() => secretNames("[[]]")).toThrow("Wrangler secret list was not a list of rows.");
      expect(() => secretNames("[null]")).toThrow("Wrangler secret list was not a list of rows.");
    });

    it("finds the newest version by creation time", () => {
      expect(newestVersionId(versionsList(KEY_VERSION))).toBe(KEY_VERSION);
      expect(() => newestVersionId("[]")).toThrow("Wrangler versions list had no versions.");
      expect(() => newestVersionId(JSON.stringify([{ id: ACTIVE }]))).toThrow("without an id or creation time");
      expect(() => newestVersionId(JSON.stringify([{ metadata: { created_on: "2026-10-01T00:00:00Z" } }]))).toThrow(
        "without an id or creation time",
      );
    });

    it("reads the version wrangler created", () => {
      expect(createdVersionId(`✨ Success! Created version ${KEY_VERSION} with secret OPENAI_API_KEY.`)).toBe(KEY_VERSION);
      expect(() => createdVersionId("Success!")).toThrow("did not report the version it created");
    });

    it("keeps failure reasons short, without addresses or long ids", () => {
      expect(sanitizeReason("  fetch  https://example.com/a?b=c failed\nreq_abcdefghijklmnopqrstuvwxyz0123 ")).toBe(
        "fetch <url> failed <id>",
      );
      expect(sanitizeReason("x".repeat(10) + " " + "y ".repeat(100)).length).toBe(120);
    });

    it("reads and formats the cover report", () => {
      const covers = coverReportRows(D1_REPORT);
      expect(covers).toEqual([
        { day: "2026-10-26", source: "ai-placeholder", status: "failed", reason: "Placeholder image generation failed: 429 quota", covers: 3 },
        { day: "2026-10-25", source: "spoon", status: "succeeded", reason: "", covers: 1 },
      ]);
      expect(formatCoverReport(covers)).toEqual([
        "2026-10-26  ai-placeholder failed        3  Placeholder image generation failed: 429 quota",
        "2026-10-25  spoon          succeeded     1",
      ]);
      expect(formatCoverReport([])).toEqual(["No AI cover generations in the last 45 days."]);
      expect(() => coverReportRows("[]")).toThrow("Wrangler d1 execute results was not a list of rows.");
    });

    it("asks D1 only for counts over the last 45 days", () => {
      expect(COVER_REPORT_SQL).toContain("COUNT(*)");
      expect(COVER_REPORT_SQL).toContain("date('now', '-45 days')");
      expect(COVER_REPORT_SQL).not.toMatch(/"(title|imageUrl|promptAddition|recipeId)"/);
    });
  });

  describe("wranglerEnv", () => {
    it("gives wrangler one Cloudflare token and never the OpenAI key", () => {
      const env = wranglerEnv(ENV, "CLOUDFLARE_D1_API_TOKEN");
      expect(env).toEqual({ CLOUDFLARE_ACCOUNT_ID: "account", CLOUDFLARE_API_TOKEN: "d1-token", PATH: "/usr/bin" });
    });

    it("requires the token and the account", () => {
      expect(() => wranglerEnv({ ...ENV, CLOUDFLARE_D1_API_TOKEN: "" }, "CLOUDFLARE_D1_API_TOKEN")).toThrow(
        "CLOUDFLARE_D1_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required.",
      );
      expect(() => wranglerEnv({ ...ENV, CLOUDFLARE_ACCOUNT_ID: undefined }, "CLOUDFLARE_D1_API_TOKEN")).toThrow("are required");
    });
  });

  describe("report", () => {
    it("logs secret names and cover outcomes with the right token for each", async () => {
      const { run, calls } = fakeWrangler();
      const log = vi.fn();
      const result = await report(deps(run, log));
      expect(result.names).toContain("OPENAI_API_KEY");
      expect(log).toHaveBeenCalledWith("Production has OPENAI_API_KEY and IMAGE_PROVIDER_PRIMARY.");
      expect(log).toHaveBeenCalledWith("2026-10-25  spoon          succeeded     1");
      expect(calls[0].env.CLOUDFLARE_API_TOKEN).toBe("workers-token");
      expect(calls[1].env.CLOUDFLARE_API_TOKEN).toBe("d1-token");
      expect(calls[1].args).toEqual(["d1", "execute", "DB", "--remote", "--json", "--command", COVER_REPORT_SQL]);
    });

    it("names what production lacks", async () => {
      const log = vi.fn();
      const run: WranglerRunner = async (args) => (args[0] === "secret" ? "[]" : JSON.stringify([{ results: [] }]));
      await report(deps(run, log));
      expect(log).toHaveBeenCalledWith("Production Worker secrets (names only): none.");
      expect(log).toHaveBeenCalledWith("Production lacks: OPENAI_API_KEY, IMAGE_PROVIDER_PRIMARY.");
    });
  });

  describe("setImageKey", () => {
    it("stores both values on stdin in tagged versions copied from production, then deploys", async () => {
      const { run, calls } = fakeWrangler();
      const log = vi.fn();
      await expect(setImageKey(deps(run, log), "  sk-test-key \n")).resolves.toBe(PROVIDER_VERSION);

      const puts = calls.filter((call) => call.args[0] === "versions" && call.args[1] === "secret");
      expect(puts.map((call) => [call.args, call.input])).toEqual([
        [["versions", "secret", "put", "OPENAI_API_KEY", "--tag", SOURCE_SHA], "sk-test-key"],
        [["versions", "secret", "put", "IMAGE_PROVIDER_PRIMARY", "--tag", SOURCE_SHA], "openai"],
      ]);
      // The key goes only to stdin: never in an argument, never in wrangler's environment.
      for (const call of calls) {
        expect(call.args.join(" ")).not.toContain("sk-test-key");
        expect(Object.values(call.env)).not.toContain("sk-test-key");
      }
      expect(calls.find((call) => call.args[1] === "deploy")?.args).toEqual(["versions", "deploy", `${PROVIDER_VERSION}@100%`, "-y"]);
      expect(log).toHaveBeenLastCalledWith(
        `Production now runs ${PROVIDER_VERSION}, built from ${SOURCE_SHA}, with OPENAI_API_KEY and IMAGE_PROVIDER_PRIMARY=openai.`,
      );
    });

    it("refuses an empty key", async () => {
      const { run, calls } = fakeWrangler();
      await expect(setImageKey(deps(run), "  ")).rejects.toThrow("OPENAI_API_KEY is empty");
      await expect(setImageKey(deps(run), undefined)).rejects.toThrow("OPENAI_API_KEY is empty");
      expect(calls).toEqual([]);
    });

    it("refuses when the newest version is not the one production runs", async () => {
      const { run, calls } = fakeWrangler({ newest: KEY_VERSION });
      await expect(setImageKey(deps(run), "sk-test-key")).rejects.toThrow(
        `The newest Worker version (${KEY_VERSION}) is not the one production runs (${ACTIVE})`,
      );
      expect(calls.some((call) => call.args[1] === "secret")).toBe(false);
    });

    it("fails when production does not end up on the new version", async () => {
      const { run } = fakeWrangler({ deployedAfter: ACTIVE });
      await expect(setImageKey(deps(run), "sk-test-key")).rejects.toThrow(
        `Production runs ${ACTIVE} after the deploy, not the new version ${PROVIDER_VERSION}.`,
      );
    });

    it("fails when the new version lost production's source tag", async () => {
      const { run } = fakeWrangler({ tagAfter: "b".repeat(40) });
      await expect(setImageKey(deps(run), "sk-test-key")).rejects.toThrow(
        `Version ${PROVIDER_VERSION} does not carry production's source tag ${SOURCE_SHA}.`,
      );
    });
  });

  describe("main", () => {
    it("reports, and sets the key first when asked", async () => {
      const reportOnly = fakeWrangler();
      await main(["report"], { env: ENV, run: reportOnly.run, log: vi.fn() });
      expect(reportOnly.calls.some((call) => call.args[1] === "secret")).toBe(false);

      const setKey = fakeWrangler();
      await main(["set-key"], { env: ENV, run: setKey.run, log: vi.fn() });
      expect(setKey.calls.filter((call) => call.args[1] === "secret").map((call) => call.input)).toEqual(["sk-test-key", "openai"]);
      expect(setKey.calls.at(-1)?.args[0]).toBe("d1");
    });

    it("refuses an unknown command before touching Cloudflare", async () => {
      await expect(main(["delete"])).rejects.toThrow("Usage: production-image-key.ts <report|set-key>");
    });
  });

  describe("createWranglerRunner", () => {
    function fakeChild() {
      const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stdin: PassThrough };
      child.stdout = new PassThrough();
      child.stdin = new PassThrough();
      return child;
    }

    it("runs pnpm exec wrangler, writes the input to stdin and resolves with stdout", async () => {
      const child = fakeChild();
      let stdin = "";
      child.stdin.on("data", (chunk) => {
        stdin += String(chunk);
      });
      const spawnImpl = vi.fn(() => child);
      const result = createWranglerRunner(spawnImpl as never)(["secret", "list"], { env: { A: "1" }, input: "value" });
      child.stdout.write("out");
      child.stdout.end();
      await new Promise((resolve) => setImmediate(resolve));
      child.emit("close", 0);
      await expect(result).resolves.toBe("out");
      expect(stdin).toBe("value");
      expect(spawnImpl).toHaveBeenCalledWith("pnpm", ["exec", "wrangler", "secret", "list"], {
        env: { A: "1" },
        stdio: ["pipe", "pipe", "inherit"],
      });
    });

    it("rejects on a non-zero exit, naming only the command", async () => {
      const child = fakeChild();
      const result = createWranglerRunner((() => child) as never)(["versions", "secret", "put", "OPENAI_API_KEY"], { env: {} });
      child.emit("close", 1);
      await expect(result).rejects.toThrow("wrangler versions secret put exited with code 1.");
    });

    it("rejects when the process cannot start", async () => {
      const child = fakeChild();
      const result = createWranglerRunner((() => child) as never)(["secret", "list"], { env: {} });
      child.emit("error", new Error("spawn pnpm ENOENT"));
      await expect(result).rejects.toThrow("spawn pnpm ENOENT");
    });

    it("works with a child that has no pipes", async () => {
      const child = new EventEmitter();
      const result = createWranglerRunner((() => child) as never)(["secret", "list"], { env: {} });
      child.emit("close", 0);
      await expect(result).resolves.toBe("");
    });
  });
});
