import { describe, expect, it, vi } from "vitest";
import {
  CONFIG_READ_ATTEMPTS,
  CONFIG_READ_RETRY_MS,
  NATIVE_KILL_SWITCHES_SECRET,
  describeKillSwitches,
  main,
  readProductionKillSwitches,
  report,
  setKillSwitches,
  type ConfigFetcher,
} from "../../scripts/native-kill-switches";
import { wranglerEnv, type WranglerRunner } from "../../scripts/production-image-key";

const ACTIVE = "11111111-1111-4111-8111-111111111111";
const NEW_VERSION = "22222222-2222-4222-8222-222222222222";
const SOURCE_SHA = "b".repeat(40);
const ENV = {
  CLOUDFLARE_ACCOUNT_ID: "account",
  CLOUDFLARE_WORKERS_API_TOKEN: "workers-token",
  PATH: "/usr/bin",
};

// The Wrangler calls storeProductionSecrets makes, for a production running ACTIVE with nothing newer.
function fakeWrangler() {
  let made = false;
  let deployed = false;
  const calls: Array<{ args: readonly string[]; input?: string }> = [];
  const run: WranglerRunner = async (args, { input }) => {
    calls.push({ args, input });
    const command = args.slice(0, 3).join(" ");
    if (command.startsWith("deployments list")) {
      return JSON.stringify([{ id: "44444444-4444-4444-8444-444444444444", created_on: "2026-11-01T00:00:00Z", versions: [{ version_id: deployed ? NEW_VERSION : ACTIVE, percentage: 100 }] }]);
    }
    if (command.startsWith("versions list")) {
      return JSON.stringify([
        { id: ACTIVE, metadata: { created_on: "2026-11-01T00:00:00Z" } },
        ...(made ? [{ id: NEW_VERSION, metadata: { created_on: "2026-11-02T00:00:00Z" } }] : []),
      ]);
    }
    if (command.startsWith("versions view")) {
      return JSON.stringify({ id: args[2], number: 7, annotations: { "workers/tag": SOURCE_SHA }, metadata: { created_on: "2026-11-01T00:00:00Z", source: "wrangler" } });
    }
    if (command === "versions secret bulk") {
      made = true;
      return `Created version ${NEW_VERSION} with 1 secret.`;
    }
    if (command.startsWith("versions deploy")) {
      deployed = true;
      return "Deployed";
    }
    if (command.startsWith("secret list")) return JSON.stringify([{ name: NATIVE_KILL_SWITCHES_SECRET, type: "secret_text" }]);
    throw new Error(`unexpected wrangler ${args.join(" ")}`);
  };
  return { run, calls };
}

const FEATURES = ["cook-session-sync", "spotlight-indexing"];

function configResponse(killSwitches: unknown, status = 200, features: unknown = FEATURES): Response {
  return new Response(JSON.stringify({ ok: status === 200, requestId: "req", data: status === 200 ? { killSwitches, features } : undefined }), { status });
}

/** Serves each answer in turn; the last repeats. */
function fakeFetch(...answers: unknown[]) {
  const urls: string[] = [];
  let calls = 0;
  const fetchConfig: ConfigFetcher = async (url) => {
    urls.push(url);
    const answer = answers[Math.min(calls, answers.length - 1)];
    calls += 1;
    return answer instanceof Response ? answer.clone() : configResponse(answer);
  };
  return { fetchConfig, urls };
}

function deps(run: WranglerRunner, fetchConfig: ConfigFetcher, log = vi.fn(), sleep = vi.fn(async () => undefined)) {
  return { run, workersEnv: wranglerEnv(ENV, "CLOUDFLARE_WORKERS_API_TOKEN"), log, sleep, fetchConfig, baseUrl: "https://spoonjoy.test" };
}

describe("scripts/native-kill-switches", () => {
  it("describes the switches in plain lines", () => {
    expect(describeKillSwitches({})).toEqual(["Every native feature is on."]);
    expect(describeKillSwitches({
      "cook-session-sync": { off: true, reason: "Durable Object outage" },
      "spotlight-indexing": { off: true, reason: null },
    })).toEqual(["cook-session-sync is off: Durable Object outage", "spotlight-indexing is off."]);
  });

  it("reads production's switches past any cache, and fails on an answer it cannot use", async () => {
    const { fetchConfig, urls } = fakeFetch({ "spotlight-indexing": { off: true, reason: null } });
    await expect(readProductionKillSwitches({ fetchConfig, baseUrl: "https://spoonjoy.test" }))
      .resolves.toEqual({ "spotlight-indexing": { off: true, reason: null } });
    expect(urls[0]).toMatch(/^https:\/\/spoonjoy\.test\/api\/v1\/native\/config\?fresh=\d+$/);

    await expect(readProductionKillSwitches({ fetchConfig: fakeFetch(configResponse(null, 503)).fetchConfig, baseUrl: "x" }))
      .rejects.toThrow("GET /api/v1/native/config answered 503.");
    await expect(readProductionKillSwitches({ fetchConfig: fakeFetch(new Response("{}")).fetchConfig, baseUrl: "x" }))
      .rejects.toThrow("GET /api/v1/native/config answered without killSwitches.");
    await expect(readProductionKillSwitches({ fetchConfig: fakeFetch("off").fetchConfig, baseUrl: "x" }))
      .rejects.toThrow("GET /api/v1/native/config answered without killSwitches.");
  });

  it("reports production's switches", async () => {
    const log = vi.fn();
    await report({ fetchConfig: fakeFetch({}).fetchConfig, baseUrl: "https://spoonjoy.test", log });
    expect(log.mock.calls.map(([line]) => line)).toEqual([
      "Production's native kill switches (https://spoonjoy.test/api/v1/native/config):",
      "  Every native feature is on.",
    ]);
  });

  it("stores the canonical value in a tagged production version, then waits for production to answer it", async () => {
    const { run, calls } = fakeWrangler();
    const expected = { "cook-session-sync": { off: true, reason: null } };
    // The first answer is the check before storing; the second, still the old switches, makes set wait.
    const { fetchConfig } = fakeFetch({}, {}, expected);
    const log = vi.fn();
    const sleep = vi.fn(async () => undefined);

    await expect(setKillSwitches(deps(run, fetchConfig, log, sleep), "cook-session-sync")).resolves.toEqual(expected);

    const bulk = calls.find((call) => call.args.slice(0, 3).join(" ") === "versions secret bulk");
    expect(bulk?.args).toEqual(["versions", "secret", "bulk", "--tag", SOURCE_SHA]);
    expect(JSON.parse(bulk!.input!)).toEqual({ [NATIVE_KILL_SWITCHES_SECRET]: JSON.stringify(expected) });
    expect(calls.some((call) => call.args.join(" ") === `versions deploy ${NEW_VERSION}@100% -y`)).toBe(true);
    expect(sleep).toHaveBeenCalledWith(CONFIG_READ_RETRY_MS);
    const lines = log.mock.calls.map(([line]) => line);
    expect(lines[0]).toBe(`Setting ${NATIVE_KILL_SWITCHES_SECRET} to ${JSON.stringify(expected)}.`);
    expect(lines.slice(-2)).toEqual(["Production now answers:", "  cook-session-sync is off."]);
  });

  it("turns every feature back on with none", async () => {
    const { run, calls } = fakeWrangler();
    await expect(setKillSwitches(deps(run, fakeFetch({}).fetchConfig), "none")).resolves.toEqual({});
    const bulk = calls.find((call) => call.args.slice(0, 3).join(" ") === "versions secret bulk");
    expect(JSON.parse(bulk!.input!)).toEqual({ [NATIVE_KILL_SWITCHES_SECRET]: "none" });
  });

  it("refuses an unknown feature before touching production", async () => {
    const { run, calls } = fakeWrangler();
    await expect(setKillSwitches(deps(run, fakeFetch({}).fetchConfig), "cook-sessions")).rejects.toThrow(
      "Unknown or unreadable native kill switches: cook-sessions.",
    );
    await expect(setKillSwitches(deps(run, fakeFetch({}).fetchConfig), undefined)).resolves.toEqual({});
    expect(calls.filter((call) => call.args[0] === "versions" && call.args[1] === "secret")).toHaveLength(1);
  });

  it("refuses a feature production's Worker does not know, before touching production", async () => {
    const { run, calls } = fakeWrangler();
    const older = fakeFetch(configResponse({}, 200, ["cook-session-sync"])).fetchConfig;
    await expect(setKillSwitches(deps(run, older), "spotlight-indexing,cook-session-sync")).rejects.toThrow(
      "Production does not know spotlight-indexing; it knows cook-session-sync. Release the spoonjoy-v2 version that adds it first.",
    );
    const featureless = fakeFetch(configResponse({}, 200, "cook-session-sync")).fetchConfig;
    await expect(setKillSwitches(deps(run, featureless), "cook-session-sync")).rejects.toThrow(
      "Production does not know cook-session-sync; it knows no features.",
    );
    expect(calls).toEqual([]);
  });

  it("refuses cleanly when production does not serve the config yet", async () => {
    const { run, calls } = fakeWrangler();
    await expect(setKillSwitches(deps(run, fakeFetch(new Response("Not found", { status: 404 })).fetchConfig), "cook-session-sync")).rejects.toThrow(
      "Production does not serve GET /api/v1/native/config (404). Release the spoonjoy-v2 version that adds it before setting switches.",
    );
    expect(calls).toEqual([]);
  });

  it("fails when production never answers the new switches", async () => {
    const { run } = fakeWrangler();
    const sleep = vi.fn(async () => undefined);
    await expect(setKillSwitches(deps(run, fakeFetch({}).fetchConfig, vi.fn(), sleep), "spotlight-indexing")).rejects.toThrow(
      "Production still answers {} instead of {\"spotlight-indexing\":{\"off\":true,\"reason\":null}}.",
    );
    expect(sleep).toHaveBeenCalledTimes(CONFIG_READ_ATTEMPTS - 1);
  });

  describe("main", () => {
    it("reports without Cloudflare credentials", async () => {
      const log = vi.fn();
      const { fetchConfig, urls } = fakeFetch({});
      await main(["report"], { env: {}, log, fetchConfig, run: vi.fn() });
      expect(urls[0]).toContain("https://spoonjoy.app/api/v1/native/config");
      expect(log).toHaveBeenCalledWith("  Every native feature is on.");
    });

    it("sets production's switches from NATIVE_KILL_SWITCHES", async () => {
      const { run } = fakeWrangler();
      const { fetchConfig, urls } = fakeFetch({ "spotlight-indexing": { off: true, reason: "Index crash" } });
      await main(["set"], {
        env: { ...ENV, NATIVE_KILL_SWITCHES: "{\"spotlight-indexing\":\"Index crash\"}" },
        run,
        log: vi.fn(),
        sleep: vi.fn(async () => undefined),
        fetchConfig,
      });
      expect(urls[0]).toContain("https://spoonjoy.app/api/v1/native/config");
    });

    it("rejects other commands", async () => {
      await expect(main(["toggle"], { env: ENV })).rejects.toThrow("Usage: native-kill-switches.ts <report|set>");
      await expect(main([])).rejects.toThrow("Usage: native-kill-switches.ts <report|set>");
    });

    it("fetches production with the default fetcher", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(configResponse({}));
      try {
        await main(["report"], { env: {}, log: vi.fn() });
        expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining("https://spoonjoy.app/api/v1/native/config"), {
          headers: { "Cache-Control": "no-cache" },
        });
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });
});
