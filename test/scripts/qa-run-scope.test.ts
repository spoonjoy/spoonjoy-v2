// @vitest-environment node
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import {
  API_RETRY_DELAYS_MS,
  DEPLOY_RETRY_DELAYS_MS,
  GENERATED_BUILD_CONFIG,
  MASKED_RUN_SECRETS,
  MAX_RETRY_AFTER_MS,
  MAX_RUN_WORKERS,
  READY_TIMEOUT_MS,
  REQUIRED_RUN_SECRETS,
  SECRETS_FILE,
  STALE_AFTER_MS,
  STATE_DIR,
  STATE_FILE,
  WRANGLER_CONFIG,
  assertOnlyIdentityChanged,
  assertRunWorkerHeadroom,
  buildRunSecrets,
  createCloudflareApi,
  defaultCliErrorHandler,
  defaultFs,
  defaultSleep,
  deploy,
  generateVapidKeys,
  isCliEntry,
  main,
  prepare,
  requireGitHubActions,
  retryDelayMs,
  runCliIfEntry,
  runIdentity,
  scopeGeneratedBuildConfig,
  scopeWranglerConfig,
  sweep,
  sweepStaleRunStacks,
  teardown,
  verify,
} from "../../scripts/qa-run-scope.mjs";
import { QA_BASE_URL, QA_D1_DATABASE_ID } from "../../scripts/script-environment.mjs";
import { expectConsoleError } from "../warning-policy";

const ROOT = resolve(__dirname, "../..");
const REAL_WRANGLER = JSON.parse(readFileSync(resolve(ROOT, "wrangler.json"), "utf8"));
const RUN_ENV = {
  GITHUB_ACTIONS: "true",
  GITHUB_RUN_ID: "1001",
  GITHUB_RUN_ATTEMPT: "2",
  GITHUB_ENV: "/tmp/github-env",
  CLOUDFLARE_API_TOKEN: "token",
  CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
};
const IDENTITY = {
  workerName: "spoonjoy-v2-qa-run-1001-2",
  databaseName: "spoonjoy-qa-run-1001-2",
  baseUrl: "https://spoonjoy-v2-qa-run-1001-2.mendelow-studio.workers.dev",
};
const RUN_DB_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

// The generated build config as the Cloudflare Vite plugin writes it for CLOUDFLARE_ENV=qa: the
// QA section flattened, named spoonjoy-v2-qa.
function generatedBuildConfig() {
  const qa = structuredClone(REAL_WRANGLER.env.qa);
  return { name: "spoonjoy-v2-qa", main: "_worker.js", assets: { directory: "../client" }, ...qa };
}

function fakeFs(files: Record<string, string> = {}) {
  const store = new Map(Object.entries(files));
  const appended: Array<[string, string]> = [];
  const modes = new Map<string, number>();
  const removed: string[] = [];
  const fs = {
    readFile: vi.fn((path: string) => {
      if (!store.has(path)) throw new Error(`ENOENT: ${path}`);
      return store.get(path)!;
    }),
    writeFile: vi.fn((path: string, data: string) => {
      store.set(path, data);
    }),
    appendFile: vi.fn((path: string, data: string) => {
      appended.push([path, data]);
    }),
    chmod: vi.fn((path: string, mode: number) => {
      modes.set(path, mode);
    }),
    exists: vi.fn((path: string) => store.has(path)),
    mkdir: vi.fn(),
    remove: vi.fn((path: string) => {
      removed.push(path);
      for (const key of [...store.keys()]) if (key.startsWith(path)) store.delete(key);
    }),
  };
  return { fs, store, appended, modes, removed, json: (path: string) => JSON.parse(store.get(path)!) };
}

function preparedFiles() {
  return {
    [WRANGLER_CONFIG]: JSON.stringify(REAL_WRANGLER),
    [GENERATED_BUILD_CONFIG]: JSON.stringify(generatedBuildConfig()),
  };
}

function fakeApi(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    listDatabases: vi.fn(async () => [] as Array<{ name: string; uuid: string; created_at?: string }>),
    createDatabase: vi.fn(async (name: string) => ({ uuid: RUN_DB_ID, name })),
    deleteDatabase: vi.fn(async () => ({ success: true })),
    listWorkers: vi.fn(async () => [] as Array<{ id: string; created_on?: string }>),
    deleteWorker: vi.fn(async () => ({ success: true })),
    ...overrides,
  };
}

// A fake `pnpm exec wrangler ...` answering by command prefix.
function fakeExec(answers: Record<string, string> = {}) {
  const calls: string[][] = [];
  const exec = vi.fn(async (file: string, args: string[]) => {
    calls.push([file, ...args]);
    const command = args.slice(2).join(" ");
    const match = Object.entries(answers).find(([prefix]) => command.startsWith(prefix));
    return { stdout: match ? match[1] : "", stderr: "" };
  });
  return { exec, calls };
}

describe("runIdentity", () => {
  it("names the run's Worker, database and workers.dev URL after the run and attempt", () => {
    expect(runIdentity(RUN_ENV)).toEqual(IDENTITY);
  });

  it("refuses a missing or non-numeric run id or attempt", () => {
    expect(() => runIdentity({ GITHUB_RUN_ATTEMPT: "1" })).toThrow(/whole numbers/);
    expect(() => runIdentity({ GITHUB_RUN_ID: "1" })).toThrow(/whole numbers/);
    expect(() => runIdentity({ GITHUB_RUN_ID: "1", GITHUB_RUN_ATTEMPT: "x" })).toThrow(/whole numbers/);
  });
});

describe("requireGitHubActions", () => {
  it("refuses to run outside GitHub Actions, so a developer's wrangler.json is never rewritten", () => {
    expect(() => requireGitHubActions({})).toThrow(/only inside GitHub Actions/);
    expect(() => requireGitHubActions({ GITHUB_ACTIONS: "true" })).not.toThrow();
  });
});

describe("scopeWranglerConfig", () => {
  it("rewrites only env.qa's Worker name, D1 binding and base URL, and leaves production alone", () => {
    const scoped = scopeWranglerConfig(REAL_WRANGLER, IDENTITY, RUN_DB_ID);

    expect(scoped.env.qa.name).toBe(IDENTITY.workerName);
    expect(scoped.env.qa.vars.SPOONJOY_BASE_URL).toBe(IDENTITY.baseUrl);
    expect(scoped.env.qa.d1_databases).toEqual([
      { binding: "DB", database_name: IDENTITY.databaseName, database_id: RUN_DB_ID },
    ]);
    // Everything else in env.qa is unchanged: R2, rate limits, Durable Object, other vars.
    expect(scoped.env.qa.r2_buckets).toEqual(REAL_WRANGLER.env.qa.r2_buckets);
    expect(scoped.env.qa.ratelimits).toEqual(REAL_WRANGLER.env.qa.ratelimits);
    expect(scoped.env.qa.durable_objects).toEqual(REAL_WRANGLER.env.qa.durable_objects);
    expect(scoped.env.qa.vars.COOK_SESSION_BOOTSTRAP_MODE).toBe("1");
    const { env: _scopedEnv, ...scopedTop } = scoped;
    const { env: _realEnv, ...realTop } = REAL_WRANGLER;
    expect(scopedTop).toEqual(realTop);
    // The input is not mutated.
    expect(REAL_WRANGLER.env.qa.d1_databases[0].database_id).toBe(QA_D1_DATABASE_ID);
  });

  it("refuses a config whose env.qa does not name shared QA", () => {
    const noQa = { ...REAL_WRANGLER, env: {} };
    expect(() => scopeWranglerConfig(noQa, IDENTITY, RUN_DB_ID)).toThrow(/no env.qa/);

    const otherDb = structuredClone(REAL_WRANGLER);
    otherDb.env.qa.d1_databases[0].database_id = RUN_DB_ID;
    expect(() => scopeWranglerConfig(otherDb, IDENTITY, RUN_DB_ID)).toThrow(/does not bind the shared QA database/);

    const otherUrl = structuredClone(REAL_WRANGLER);
    otherUrl.env.qa.vars.SPOONJOY_BASE_URL = "https://spoonjoy.app";
    expect(() => scopeWranglerConfig(otherUrl, IDENTITY, RUN_DB_ID)).toThrow(/does not target/);

    const noDb = structuredClone(REAL_WRANGLER);
    noDb.env.qa.d1_databases = [];
    expect(() => scopeWranglerConfig(noDb, IDENTITY, RUN_DB_ID)).toThrow(/no D1 binding named DB/);
    delete noDb.env.qa.d1_databases;
    expect(() => scopeWranglerConfig(noDb, IDENTITY, RUN_DB_ID)).toThrow(/no D1 binding named DB/);
  });
});

describe("scopeGeneratedBuildConfig", () => {
  it("rewrites the generated QA build config's identity only", () => {
    const config = generatedBuildConfig();
    const scoped = scopeGeneratedBuildConfig(config, IDENTITY, RUN_DB_ID);

    expect(scoped.name).toBe(IDENTITY.workerName);
    expect(scoped.vars.SPOONJOY_BASE_URL).toBe(IDENTITY.baseUrl);
    expect(scoped.d1_databases[0]).toEqual({ binding: "DB", database_name: IDENTITY.databaseName, database_id: RUN_DB_ID });
    expect(scoped.migrations).toEqual(config.migrations);
    expect(scoped.assets).toEqual(config.assets);
    expect(config.name).toBe("spoonjoy-v2-qa");
  });

  it("refuses a build that was not made for shared QA", () => {
    expect(() => scopeGeneratedBuildConfig({ ...generatedBuildConfig(), name: "spoonjoy-v2" }, IDENTITY, RUN_DB_ID))
      .toThrow(/Build with CLOUDFLARE_ENV=qa first/);
    expect(() => scopeGeneratedBuildConfig(undefined, IDENTITY, RUN_DB_ID)).toThrow(/is for undefined/);
  });
});

describe("assertOnlyIdentityChanged", () => {
  it("accepts identity-only changes and rejects any other difference", () => {
    const before = generatedBuildConfig();
    const after = scopeGeneratedBuildConfig(before, IDENTITY, RUN_DB_ID);
    expect(() => assertOnlyIdentityChanged(before, after)).not.toThrow();

    const sneaky = structuredClone(after);
    sneaky.r2_buckets[0].bucket_name = "spoonjoy-photos";
    expect(() => assertOnlyIdentityChanged(before, sneaky)).toThrow(/more than its identity/);

    // A config without vars or D1 still compares.
    expect(() => assertOnlyIdentityChanged({ name: "a" }, { name: "b" })).not.toThrow();
    expect(() => assertOnlyIdentityChanged({ d1_databases: [null] }, { d1_databases: [null] })).not.toThrow();
  });
});

describe("per-run secrets", () => {
  it("generates VAPID keys in the app's shape: a 65-byte uncompressed point and a 32-byte private scalar", () => {
    const keys = generateVapidKeys();
    const publicKey = Buffer.from(keys.publicKey, "base64url");
    expect(publicKey).toHaveLength(65);
    expect(publicKey[0]).toBe(4);
    expect(Buffer.from(keys.privateKey, "base64url")).toHaveLength(32);
    expect(generateVapidKeys(generateKeyPairSync).publicKey).not.toBe(keys.publicKey);
  });

  it("gives every run a fresh session secret and VAPID pair, with analytics off", () => {
    const secrets = buildRunSecrets(IDENTITY, {
      random: (size: number) => Buffer.alloc(size, 1),
      vapid: () => ({ publicKey: "pub", privateKey: "priv" }),
    });
    expect(secrets).toEqual({
      SESSION_SECRET: "01".repeat(32),
      VAPID_PUBLIC_KEY: "pub",
      VAPID_PRIVATE_KEY: "priv",
      VAPID_SUBJECT: IDENTITY.baseUrl,
      POSTHOG_DISABLED: "1",
    });
    for (const name of REQUIRED_RUN_SECRETS) expect(Object.keys(buildRunSecrets(IDENTITY))).toContain(name);
  });
});

describe("createCloudflareApi", () => {
  function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
    return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => body };
  }
  const half = () => 0.5;

  it("requires a token and a 32-hex account id", () => {
    expect(() => createCloudflareApi({ env: {} })).toThrow(/are required/);
    expect(() => createCloudflareApi({ env: { CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "nope" } })).toThrow(/are required/);
  });

  it("calls the account's D1 and Workers endpoints with the bearer token, listing databases unfiltered", async () => {
    const fetchImpl = vi.fn(async (url: string, init: { method: string; body?: string }) => {
      if (url.includes("/d1/database?")) return jsonResponse(200, { success: true, result: [{ name: "spoonjoy-qa-run-1-1", uuid: "u" }] });
      if (init.method === "POST") return jsonResponse(200, { success: true, result: { uuid: RUN_DB_ID } });
      if (url.endsWith("/workers/scripts")) return jsonResponse(200, { success: true, result: [{ id: "w" }] });
      return jsonResponse(200, { success: true, result: null });
    });
    const api = createCloudflareApi({ env: RUN_ENV, fetchImpl, sleep: vi.fn() });

    expect(await api.listDatabases()).toEqual([{ name: "spoonjoy-qa-run-1-1", uuid: "u" }]);
    expect(await api.createDatabase("spoonjoy-qa-run-1-1")).toEqual({ uuid: RUN_DB_ID });
    await api.deleteDatabase("u");
    expect(await api.listWorkers()).toEqual([{ id: "w" }]);
    await api.deleteWorker("spoonjoy-v2-qa-run-1-1");

    const base = `https://api.cloudflare.com/client/v4/accounts/${RUN_ENV.CLOUDFLARE_ACCOUNT_ID}`;
    expect(fetchImpl.mock.calls.map(([url, init]) => `${init.method} ${url}`)).toEqual([
      `GET ${base}/d1/database?page=1&per_page=100`,
      `POST ${base}/d1/database`,
      `DELETE ${base}/d1/database/u`,
      `GET ${base}/workers/scripts`,
      `DELETE ${base}/workers/scripts/spoonjoy-v2-qa-run-1-1?force=true`,
    ]);
    expect(fetchImpl.mock.calls[1][1].body).toBe(JSON.stringify({ name: "spoonjoy-qa-run-1-1" }));
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ headers: { Authorization: "Bearer token" } });
  });

  it("pages through database listings until a short page or the last page", async () => {
    const full = Array.from({ length: 100 }, (_, index) => ({ name: `db-${index}` }));
    const pages = [
      { success: true, result: full, result_info: { total_pages: 3 } },
      { success: true, result: full, result_info: { total_pages: 3 } },
      { success: true, result: full, result_info: { total_pages: 3 } },
    ];
    const fetchImpl = vi.fn(async () => jsonResponse(200, pages.shift()));
    const api = createCloudflareApi({ env: RUN_ENV, fetchImpl, sleep: vi.fn() });
    expect(await api.listDatabases()).toHaveLength(300);
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    const short = vi.fn(async () => jsonResponse(200, { success: true }));
    const shortApi = createCloudflareApi({ env: RUN_ENV, fetchImpl: short, sleep: vi.fn() });
    expect(await shortApi.listDatabases()).toEqual([]);
    expect(await shortApi.listWorkers()).toEqual([]);

    const endless = vi.fn(async () => jsonResponse(200, { success: true, result: full }));
    const endlessApi = createCloudflareApi({ env: RUN_ENV, fetchImpl: endless, sleep: vi.fn() });
    expect(await endlessApi.listDatabases()).toHaveLength(2000);
    expect(endless).toHaveBeenCalledTimes(20);
  });

  it("backs off for about four minutes on rate limits, server errors and network failures, then reports the failure", async () => {
    const sleep = vi.fn(async () => {});
    const responses: Array<() => unknown> = [
      () => jsonResponse(429, {}),
      () => {
        throw new Error("socket hang up");
      },
      () => jsonResponse(503, {}),
      () => jsonResponse(200, { success: true, result: [] }),
    ];
    const fetchImpl = vi.fn(async () => responses.shift()!());
    const api = createCloudflareApi({ env: RUN_ENV, fetchImpl, sleep, random: half });
    expect(await api.listWorkers()).toEqual([]);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual(API_RETRY_DELAYS_MS.slice(0, 3));

    const down = createCloudflareApi({
      env: RUN_ENV,
      fetchImpl: vi.fn(async () => {
        throw "offline";
      }),
      sleep,
      random: half,
    });
    await expect(down.listWorkers()).rejects.toThrow(/returned a network error: offline/);

    sleep.mockClear();
    const failing = createCloudflareApi({ env: RUN_ENV, fetchImpl: vi.fn(async () => jsonResponse(429, {})), sleep, random: half });
    await expect(failing.listWorkers()).rejects.toThrow(/GET \/workers\/scripts returned 429$/);
    const total = sleep.mock.calls.reduce((sum, [ms]) => sum + ms, 0);
    expect(total).toBe(246_000);
    expect(sleep).toHaveBeenCalledTimes(API_RETRY_DELAYS_MS.length);
  });

  it("waits at least as long as Retry-After asks, up to five minutes, with jitter on its own delays", () => {
    expect(retryDelayMs(0, jsonResponse(429, {}, { "retry-after": "30" }), half)).toBe(30_000);
    expect(retryDelayMs(0, jsonResponse(429, {}, { "retry-after": "9999" }), half)).toBe(MAX_RETRY_AFTER_MS);
    expect(retryDelayMs(3, jsonResponse(429, {}, { "retry-after": "1" }), half)).toBe(16_000);
    expect(retryDelayMs(3, jsonResponse(429, {}, { "retry-after": "soon" }), half)).toBe(16_000);
    expect(retryDelayMs(3, jsonResponse(429, {}, { "retry-after": "-5" }), half)).toBe(16_000);
    expect(retryDelayMs(3, undefined, () => 0)).toBe(8_000);
    expect(retryDelayMs(3, { status: 503 }, () => 0.999)).toBe(23_984);
    const jittered = retryDelayMs(1, jsonResponse(503, {}));
    expect(jittered).toBeGreaterThanOrEqual(2_000);
    expect(jittered).toBeLessThanOrEqual(6_000);
  });

  it("reports a client error or an unsuccessful payload with Cloudflare's messages, without retrying", async () => {
    const sleep = vi.fn();
    const api = createCloudflareApi({
      env: RUN_ENV,
      fetchImpl: vi.fn(async () => jsonResponse(403, { success: false, errors: [{ message: "Authentication error" }, {}] })),
      sleep,
    });
    await expect(api.createDatabase("x")).rejects.toThrow("Cloudflare API POST /d1/database returned 403: Authentication error");
    expect(sleep).not.toHaveBeenCalled();

    const okButFailed = createCloudflareApi({
      env: RUN_ENV,
      fetchImpl: vi.fn(async () => jsonResponse(200, { success: false })),
      sleep,
    });
    await expect(okButFailed.deleteDatabase("x")).rejects.toThrow(/returned 200$/);

    const notJson = createCloudflareApi({
      env: RUN_ENV,
      fetchImpl: vi.fn(async () => ({ ok: false, status: 404, json: async () => Promise.reject(new Error("not json")) })),
      sleep,
    });
    await expect(notJson.deleteWorker("x")).rejects.toMatchObject({ status: 404 });
  });
});

function notFoundApi() {
  return createCloudflareApi({
    env: RUN_ENV,
    fetchImpl: vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ success: false }) })),
    sleep: vi.fn(),
  });
}

describe("sweepStaleRunStacks", () => {
  const now = () => Date.parse("2026-10-09T12:00:00Z");
  const old = new Date(now() - STALE_AFTER_MS - 1).toISOString();
  const fresh = new Date(now() - 60_000).toISOString();

  it("deletes only per-run stacks older than three hours, never shared QA or another run in progress", async () => {
    const api = fakeApi({
      // A listing that returns more than per-run names: the sweep matches names itself.
      listDatabases: vi.fn(async () => [
        { name: "spoonjoy-qa-run-1-1", uuid: "stale-db", created_at: old },
        { name: "spoonjoy-qa-run-2-1", uuid: "fresh-db", created_at: fresh },
        { name: "spoonjoy-qa", uuid: "shared", created_at: old },
        { name: "spoonjoy", uuid: "production", created_at: old },
        { name: "spoonjoy-qa-run-x", uuid: "odd", created_at: old },
        { name: "copy-of-spoonjoy-qa-run-4-1", uuid: "not-a-prefix", created_at: old },
        { uuid: "nameless", created_at: old },
        { name: "spoonjoy-qa-run-3-1", uuid: "undated" },
      ]),
      listWorkers: vi.fn(async () => [
        { id: "spoonjoy-v2-qa-run-1-1", created_on: old },
        { id: "spoonjoy-v2-qa-run-2-1", created_on: fresh },
        { id: "spoonjoy-v2-qa", created_on: old },
        { id: "spoonjoy-v2", created_on: old },
        { created_on: old },
      ]),
    });
    const log = vi.fn();

    expect(await sweepStaleRunStacks({ api, now, log })).toEqual({ swept: 2, remainingRunWorkers: 1 });
    expect(api.deleteDatabase.mock.calls).toEqual([["stale-db"]]);
    expect(api.deleteWorker.mock.calls).toEqual([["spoonjoy-v2-qa-run-1-1"]]);
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("treats a stack another run deleted first (404) as already gone, and fails on any other error", async () => {
    const gone = notFoundApi();
    const api = fakeApi({
      listDatabases: vi.fn(async () => [{ name: "spoonjoy-qa-run-1-1", uuid: "stale-db", created_at: old }]),
      deleteDatabase: gone.deleteDatabase,
      listWorkers: vi.fn(async () => [{ id: "spoonjoy-v2-qa-run-1-1", created_on: old }]),
      deleteWorker: gone.deleteWorker,
    });
    const log = vi.fn();
    expect(await sweepStaleRunStacks({ api, now, log })).toEqual({ swept: 2, remainingRunWorkers: 0 });
    expect(log.mock.calls.map(([line]) => line)).toEqual([
      `Already gone: stale QA run database spoonjoy-qa-run-1-1 (created ${old}).`,
      `Already gone: stale QA run Worker spoonjoy-v2-qa-run-1-1 (created ${old}).`,
    ]);

    const broken = fakeApi({
      listDatabases: vi.fn(async () => [{ name: "spoonjoy-qa-run-1-1", uuid: "stale-db", created_at: old }]),
      deleteDatabase: vi.fn(async () => {
        throw new Error("d1 500");
      }),
    });
    await expect(sweepStaleRunStacks({ api: broken, now, log })).rejects.toThrow("d1 500");
  });

  it("fails loudly once more than 100 run Workers are in use", async () => {
    const workers = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `spoonjoy-v2-qa-run-${index}-1`, created_on: fresh }));
    const log = vi.fn();
    expect(await sweep({ api: fakeApi({ listWorkers: vi.fn(async () => workers(MAX_RUN_WORKERS)) }), now, log })).toEqual({
      swept: 0,
      remainingRunWorkers: MAX_RUN_WORKERS,
    });
    expect(log).toHaveBeenCalledWith(`Swept 0 stale QA run resource(s); ${MAX_RUN_WORKERS} run Worker(s) are in use.`);
    await expect(sweep({ api: fakeApi({ listWorkers: vi.fn(async () => workers(MAX_RUN_WORKERS + 1)) }), now, log })).rejects.toThrow(
      /101 QA run Workers exist \(limit 100; the account allows 500 scripts\)/,
    );
    expect(() => assertRunWorkerHeadroom(0)).not.toThrow();
  });
});

describe("prepare", () => {
  const secrets = () => ({ SESSION_SECRET: "s3cret", VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: IDENTITY.baseUrl, POSTHOG_DISABLED: "1" });

  it("creates the run's empty database, rewrites both configs to it, writes secrets and exports the run's URL", async () => {
    const files = fakeFs(preparedFiles());
    const api = fakeApi();
    const log = vi.fn();

    const state = await prepare({ env: RUN_ENV, fs: files.fs, api, now: Date.now, log, secrets });

    expect(state).toEqual({ ...IDENTITY, databaseId: RUN_DB_ID });
    expect(api.createDatabase).toHaveBeenCalledWith(IDENTITY.databaseName);
    expect(files.json(STATE_FILE)).toEqual(state);
    expect(files.json(WRANGLER_CONFIG).env.qa.d1_databases[0].database_id).toBe(RUN_DB_ID);
    expect(files.json(WRANGLER_CONFIG).d1_databases).toEqual(REAL_WRANGLER.d1_databases);
    expect(files.json(GENERATED_BUILD_CONFIG).name).toBe(IDENTITY.workerName);
    expect(files.json(SECRETS_FILE)).toEqual(secrets());
    expect(files.modes.get(SECRETS_FILE)).toBe(0o600);
    expect(files.appended).toEqual([
      [RUN_ENV.GITHUB_ENV, `SPOONJOY_JOURNEYS_BASE_URL=${IDENTITY.baseUrl}\nSPOONJOY_QA_RUN_WORKER=${IDENTITY.workerName}\n`],
    ]);
    expect(files.fs.mkdir).toHaveBeenCalledWith(STATE_DIR, { recursive: true });
    // Nothing is copied from shared QA: no file but the configs, state and secrets is written.
    expect([...files.store.keys()].sort()).toEqual([GENERATED_BUILD_CONFIG, SECRETS_FILE, STATE_FILE, WRANGLER_CONFIG].sort());
  });

  it("masks only the real secrets, so the run's URL and plain flags stay readable in the log", async () => {
    const log = vi.fn();
    await prepare({ env: RUN_ENV, fs: fakeFs(preparedFiles()).fs, api: fakeApi(), now: Date.now, log, secrets });
    const masks = log.mock.calls.map(([line]) => line).filter((line: string) => line.startsWith("::add-mask::"));
    expect(masks).toEqual(["::add-mask::s3cret", "::add-mask::priv"]);
    expect(MASKED_RUN_SECRETS).toEqual(["SESSION_SECRET", "VAPID_PRIVATE_KEY"]);
  });

  it("replaces a database left by an earlier try of the same attempt, and still runs when the sweep fails", async () => {
    const files = fakeFs(preparedFiles());
    const api = fakeApi({
      listDatabases: vi.fn()
        .mockRejectedValueOnce(new Error("sweep down"))
        .mockResolvedValueOnce([{ name: IDENTITY.databaseName, uuid: "leftover" }, { name: "other", uuid: "keep" }]),
    });
    const log = vi.fn();
    await prepare({ now: Date.now, env: { ...RUN_ENV, GITHUB_ENV: undefined }, fs: files.fs, api, log, secrets });

    expect(api.deleteDatabase.mock.calls).toEqual([["leftover"]]);
    expect(log).toHaveBeenCalledWith("::warning::Could not sweep stale QA run stacks: sweep down");
    expect(files.appended).toEqual([]);

    const stringFailure = fakeApi({ listDatabases: vi.fn().mockRejectedValueOnce("plain").mockResolvedValue([]) });
    const log2 = vi.fn();
    await prepare({ now: Date.now, env: RUN_ENV, fs: fakeFs(preparedFiles()).fs, api: stringFailure, log: log2, secrets });
    expect(log2).toHaveBeenCalledWith("::warning::Could not sweep stale QA run stacks: plain");

    // A leftover another sweep already deleted (404) does not stop the run.
    const gone = notFoundApi();
    const raced = fakeApi({
      listDatabases: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ name: IDENTITY.databaseName, uuid: "leftover" }]),
      deleteDatabase: gone.deleteDatabase,
    });
    await expect(prepare({ now: Date.now, env: RUN_ENV, fs: fakeFs(preparedFiles()).fs, api: raced, log: vi.fn(), secrets })).resolves.toMatchObject({
      databaseId: RUN_DB_ID,
    });
  });

  it("reuses the run's database when a retried create finds the first try had worked", async () => {
    const api = fakeApi({
      listDatabases: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ name: `${IDENTITY.databaseName}0`, uuid: "similar" }, { name: IDENTITY.databaseName, uuid: RUN_DB_ID }]),
      createDatabase: vi.fn(async () => {
        throw new Error("Cloudflare API POST /d1/database returned 400: database already exists");
      }),
    });
    const state = await prepare({ now: Date.now, env: RUN_ENV, fs: fakeFs(preparedFiles()).fs, api, log: vi.fn(), secrets });
    expect(state.databaseId).toBe(RUN_DB_ID);

    const failed = fakeApi({
      createDatabase: vi.fn(async () => {
        throw new Error("create 500");
      }),
    });
    await expect(prepare({ now: Date.now, env: RUN_ENV, fs: fakeFs(preparedFiles()).fs, api: failed, log: vi.fn(), secrets })).rejects.toThrow("create 500");
  });

  it("refuses to create a stack when more than 100 run Workers are already in use", async () => {
    const workers = Array.from({ length: MAX_RUN_WORKERS + 1 }, (_, index) => ({ id: `spoonjoy-v2-qa-run-${index}-1`, created_on: new Date().toISOString() }));
    const api = fakeApi({ listWorkers: vi.fn(async () => workers) });
    await expect(prepare({ now: Date.now, env: RUN_ENV, fs: fakeFs(preparedFiles()).fs, api, log: vi.fn(), secrets })).rejects.toThrow(/101 QA run Workers exist/);
    expect(api.createDatabase).not.toHaveBeenCalled();
  });

  it("creates nothing unless both configs name shared QA and the build exists", async () => {
    const api = fakeApi();
    const missingBuild = fakeFs({ [WRANGLER_CONFIG]: JSON.stringify(REAL_WRANGLER) });
    await expect(prepare({ now: Date.now, env: RUN_ENV, fs: missingBuild.fs, api, log: vi.fn() })).rejects.toThrow(/is missing/);

    const production = structuredClone(REAL_WRANGLER);
    production.env.qa.vars.SPOONJOY_BASE_URL = "https://spoonjoy.app";
    const wrongConfig = fakeFs({ ...preparedFiles(), [WRANGLER_CONFIG]: JSON.stringify(production) });
    await expect(prepare({ now: Date.now, env: RUN_ENV, fs: wrongConfig.fs, api, log: vi.fn() })).rejects.toThrow(/does not target/);

    await expect(prepare({ now: Date.now, env: { ...RUN_ENV, GITHUB_ACTIONS: undefined }, fs: fakeFs(preparedFiles()).fs, api, log: vi.fn() }))
      .rejects.toThrow(/only inside GitHub Actions/);

    expect(api.createDatabase).not.toHaveBeenCalled();
    expect(api.listDatabases).not.toHaveBeenCalled();
  });

  it("fails if Cloudflare returns no database id", async () => {
    const api = fakeApi({ createDatabase: vi.fn(async () => ({})) });
    await expect(prepare({ now: Date.now, env: RUN_ENV, fs: fakeFs(preparedFiles()).fs, api, log: vi.fn(), secrets }))
      .rejects.toThrow(/did not return the new database's id/);
    const nothing = fakeApi({ createDatabase: vi.fn(async () => undefined) });
    await expect(prepare({ now: Date.now, env: RUN_ENV, fs: fakeFs(preparedFiles()).fs, api: nothing, log: vi.fn(), secrets }))
      .rejects.toThrow(/did not return the new database's id/);
  });
});

function scopedFiles(overrides: Record<string, unknown> = {}) {
  const state = { ...IDENTITY, databaseId: RUN_DB_ID, ...overrides };
  return fakeFs({
    [STATE_FILE]: JSON.stringify(state),
    [WRANGLER_CONFIG]: JSON.stringify(scopeWranglerConfig(REAL_WRANGLER, IDENTITY, RUN_DB_ID)),
  });
}

function verifyExec({ secrets = REQUIRED_RUN_SECRETS, migrations = "✅ No migrations to apply!" } = {}) {
  return fakeExec({
    "secret list": JSON.stringify(secrets.map((name) => ({ name, type: "secret_text" }))),
    "d1 migrations list": migrations,
  });
}

function site(routes: Record<string, { status: number; body?: string } | Error>) {
  return vi.fn(async (url: string) => {
    const path = url.slice(IDENTITY.baseUrl.length);
    const route = routes[path] ?? { status: 404 };
    if (route instanceof Error) throw route;
    return { status: route.status, text: async () => route.body ?? "" };
  });
}

const LIVE = {
  "/health": { status: 200 },
  "/": { status: 200, body: '<link rel="modulepreload" href="/assets/entry.client-AbC_1.js">' },
  "/assets/entry.client-AbC_1.js": { status: 200 },
};

describe("verify", () => {
  it("passes once the run's Worker has its secrets, no pending migration, and serves /health and a hashed asset", async () => {
    const { exec, calls } = verifyExec();
    const fetchImpl = site(LIVE);
    const state = await verify({ env: RUN_ENV, exec, fs: scopedFiles().fs, fetchImpl, now: Date.now, sleep: vi.fn(), log: vi.fn() });

    expect(state.workerName).toBe(IDENTITY.workerName);
    expect(calls.map((call) => call.slice(3, 5).join(" "))).toEqual(["secret list", "d1 migrations"]);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      `${IDENTITY.baseUrl}/health`,
      `${IDENTITY.baseUrl}/`,
      `${IDENTITY.baseUrl}/assets/entry.client-AbC_1.js`,
    ]);
  });

  it("waits for a new hostname to come up", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      calls += 1;
      if (calls === 1) throw new Error("ENOTFOUND");
      if (calls === 2) throw "reset";
      const route = LIVE[url.slice(IDENTITY.baseUrl.length) as keyof typeof LIVE];
      return { status: route.status, text: async () => ("body" in route ? route.body : "") };
    });
    const sleep = vi.fn(async () => {});
    await verify({ env: RUN_ENV, exec: verifyExec().exec, fs: scopedFiles().fs, fetchImpl, now: Date.now, sleep, log: vi.fn() });
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["/health is down", { ...LIVE, "/health": { status: 503 } }, "/health returned 503"],
    ["/ is down", { ...LIVE, "/": { status: 500 } }, "/ returned 500"],
    ["/ names no script", { ...LIVE, "/": { status: 200, body: "<html></html>" } }, "/ referenced no hashed script"],
    ["the script is missing", { ...LIVE, "/assets/entry.client-AbC_1.js": { status: 404 } }, "/assets/entry.client-AbC_1.js returned 404"],
  ])("fails with the last reason when %s for the whole wait", async (_name, routes, reason) => {
    let clock = 0;
    const now = () => clock;
    const sleep = vi.fn(async (ms: number) => {
      clock += ms;
    });
    await expect(verify({ env: RUN_ENV, exec: verifyExec().exec, fs: scopedFiles().fs, fetchImpl: site(routes), now, sleep, log: vi.fn() }))
      .rejects.toThrow(`${IDENTITY.baseUrl} did not become ready within ${READY_TIMEOUT_MS / 1000} s: ${reason}.`);
  });

  it("fails on a missing secret or a pending migration", async () => {
    await expect(verify({ env: RUN_ENV, exec: verifyExec({ secrets: ["SESSION_SECRET"] }).exec, fs: scopedFiles().fs, fetchImpl: site(LIVE), log: vi.fn() }))
      .rejects.toThrow("The run's Worker is missing secret(s): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.");
    await expect(verify({ env: RUN_ENV, exec: verifyExec({ migrations: "0029_x.sql pending" }).exec, fs: scopedFiles().fs, fetchImpl: site(LIVE), log: vi.fn() }))
      .rejects.toThrow(/still has pending migrations/);
    const noJson = fakeExec({ "secret list": "Authentication error" });
    await expect(verify({ env: RUN_ENV, exec: noJson.exec, fs: scopedFiles().fs, fetchImpl: site(LIVE), log: vi.fn() }))
      .rejects.toThrow(/no JSON results/);
    const nullRows = fakeExec({ "secret list": "[null]" });
    await expect(verify({ env: RUN_ENV, exec: nullRows.exec, fs: scopedFiles().fs, fetchImpl: site(LIVE), log: vi.fn() }))
      .rejects.toThrow(/missing secret/);
  });

  it("refuses when wrangler.json no longer names this run's stack, or the state names a non-run stack", async () => {
    const files = scopedFiles();
    files.store.set(WRANGLER_CONFIG, JSON.stringify(REAL_WRANGLER));
    await expect(verify({ env: RUN_ENV, exec: verifyExec().exec, fs: files.fs, fetchImpl: site(LIVE), log: vi.fn() }))
      .rejects.toThrow(/does not name this run's QA stack/);

    const wrongDb = scopedFiles({ databaseId: QA_D1_DATABASE_ID });
    await expect(verify({ env: RUN_ENV, exec: verifyExec().exec, fs: wrongDb.fs, fetchImpl: site(LIVE), log: vi.fn() }))
      .rejects.toThrow(/does not name this run's QA stack/);

    const shared = scopedFiles({ workerName: "spoonjoy-v2-qa" });
    await expect(verify({ env: RUN_ENV, exec: verifyExec().exec, fs: shared.fs, fetchImpl: site(LIVE), log: vi.fn() }))
      .rejects.toThrow(/Refusing to touch spoonjoy-v2-qa/);
  });
});

describe("deploy", () => {
  const notFound = Object.assign(new Error("Command failed: pnpm exec wrangler deploy"), {
    stdout: "Uploaded 127 of 127 assets\n",
    stderr: "A request to the Cloudflare API (/accounts/x/workers/scripts/spoonjoy-v2-qa-run-1001-2/subdomain) failed.\n  This Worker does not exist on your account. [code: 10007]\n",
  });

  it("deploys the build to this run's Worker with the run's secrets", async () => {
    const exec = vi.fn(async () => ({ stdout: "Deployed spoonjoy-v2-qa-run-1001-2\n", stderr: "" }));
    const log = vi.fn();
    expect(await deploy({ env: RUN_ENV, exec, fs: scopedFiles().fs, sleep: vi.fn(), log })).toBe(1);
    expect(exec).toHaveBeenCalledWith(
      "pnpm",
      ["exec", "wrangler", "deploy", "--env", "qa", "--secrets-file", SECRETS_FILE],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    expect(log).toHaveBeenCalledWith("Deployed spoonjoy-v2-qa-run-1001-2\n");
  });

  it("deploys again when Cloudflare does not yet know the brand-new script (code 10007)", async () => {
    const exec = vi.fn()
      .mockRejectedValueOnce(notFound)
      .mockRejectedValueOnce(notFound)
      .mockResolvedValueOnce({ stdout: "Deployed\n", stderr: "warning\n" });
    const sleep = vi.fn(async () => {});
    const log = vi.fn();
    expect(await deploy({ env: RUN_ENV, exec, fs: scopedFiles().fs, sleep, log })).toBe(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual(DEPLOY_RETRY_DELAYS_MS.slice(0, 2));
    expect(log).toHaveBeenCalledWith(`${notFound.stdout}${notFound.stderr}`);
    expect(log).toHaveBeenCalledWith(`::warning::Cloudflare did not yet know ${IDENTITY.workerName} (code 10007); deploying again in 5 s.`);
    expect(log).toHaveBeenLastCalledWith("Deployed\nwarning\n");
  });

  it("gives up after the last retry, and never retries any other failure", async () => {
    const always = vi.fn().mockRejectedValue(notFound);
    const sleep = vi.fn(async () => {});
    await expect(deploy({ env: RUN_ENV, exec: always, fs: scopedFiles().fs, sleep, log: vi.fn() })).rejects.toBe(notFound);
    expect(always).toHaveBeenCalledTimes(DEPLOY_RETRY_DELAYS_MS.length + 1);

    const other = Object.assign(new Error("build failed"), { stderr: "Authentication error [code: 10000]" });
    const once = vi.fn().mockRejectedValue(other);
    await expect(deploy({ env: RUN_ENV, exec: once, fs: scopedFiles().fs, sleep: vi.fn(), log: vi.fn() })).rejects.toBe(other);
    expect(once).toHaveBeenCalledTimes(1);

    const bare = vi.fn().mockRejectedValue(undefined);
    await expect(deploy({ env: RUN_ENV, exec: bare, fs: scopedFiles().fs, sleep: vi.fn(), log: vi.fn() })).rejects.toBeUndefined();
  });

  it("deploys only to this run's own stack, and only in GitHub Actions", async () => {
    const files = scopedFiles();
    files.store.set(WRANGLER_CONFIG, JSON.stringify(REAL_WRANGLER));
    const exec = vi.fn();
    await expect(deploy({ env: RUN_ENV, exec, fs: files.fs, sleep: vi.fn(), log: vi.fn() })).rejects.toThrow(/does not name this run's QA stack/);
    await expect(deploy({ env: { ...RUN_ENV, GITHUB_ACTIONS: undefined }, exec, fs: scopedFiles().fs, sleep: vi.fn(), log: vi.fn() })).rejects.toThrow(/GitHub Actions/);
    expect(exec).not.toHaveBeenCalled();
  });
});

describe("teardown", () => {
  it("deletes this run's Worker and the database prepare recorded, by id, and its local state", async () => {
    const api = fakeApi();
    const files = scopedFiles();
    const log = vi.fn();

    expect(await teardown({ env: RUN_ENV, fs: files.fs, api, log })).toBe(true);
    expect(api.deleteWorker.mock.calls).toEqual([[IDENTITY.workerName]]);
    expect(api.deleteDatabase.mock.calls).toEqual([[RUN_DB_ID]]);
    // The recorded id is enough: no listing, so nothing depends on how a listing matches names.
    expect(api.listDatabases).not.toHaveBeenCalled();
    expect(files.removed).toEqual([STATE_DIR]);
    expect(log).toHaveBeenCalledWith(`Deleted QA run database ${IDENTITY.databaseName} (${RUN_DB_ID}).`);
  });

  it("finds the database by its exact name when prepare failed before recording it", async () => {
    const api = fakeApi({
      listDatabases: vi.fn(async () => [
        { name: `${IDENTITY.databaseName}0`, uuid: "longer-name" },
        { name: "spoonjoy-qa-run-1001-1", uuid: "earlier-attempt" },
        { name: IDENTITY.databaseName, uuid: RUN_DB_ID },
      ]),
    });
    expect(await teardown({ env: RUN_ENV, fs: fakeFs().fs, api, log: vi.fn() })).toBe(true);
    expect(api.deleteDatabase.mock.calls).toEqual([[RUN_DB_ID]]);

    // State from another attempt is ignored in favour of the exact-name lookup.
    const other = fakeApi({ listDatabases: vi.fn(async () => []) });
    const foreign = scopedFiles({ workerName: "spoonjoy-v2-qa-run-1001-1", databaseName: "spoonjoy-qa-run-1001-1", databaseId: "other" });
    await teardown({ env: RUN_ENV, fs: foreign.fs, api: other, log: vi.fn() });
    expect(other.deleteDatabase).not.toHaveBeenCalled();
    expect(other.listDatabases).toHaveBeenCalled();
  });

  it("warns when there was nothing to delete", async () => {
    const gone = notFoundApi();
    const api = fakeApi({ deleteWorker: gone.deleteWorker, listDatabases: vi.fn(async () => [{ name: "spoonjoy-qa-run-1-1", uuid: "x" }]) });
    const log = vi.fn();
    expect(await teardown({ env: RUN_ENV, fs: fakeFs().fs, api, log })).toBe(true);
    expect(api.deleteDatabase).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      `::warning::Nothing to delete for part of this run's QA stack: no Worker named ${IDENTITY.workerName} existed; no database named ${IDENTITY.databaseName} existed.`,
    );

    const alreadyDeleted = fakeApi({ deleteDatabase: gone.deleteDatabase });
    const log2 = vi.fn();
    expect(await teardown({ env: RUN_ENV, fs: scopedFiles().fs, api: alreadyDeleted, log: log2 })).toBe(true);
    expect(log2).toHaveBeenCalledWith(
      `::warning::Nothing to delete for part of this run's QA stack: database ${IDENTITY.databaseName} (${RUN_DB_ID}) was already deleted.`,
    );
  });

  it("warns instead of failing when deletion fails, so the sweep can finish it later", async () => {
    const api = fakeApi({
      deleteWorker: vi.fn(async () => {
        throw new Error("worker 500");
      }),
      listDatabases: vi.fn(async () => {
        throw new Error("d1 500");
      }),
    });
    const log = vi.fn();
    expect(await teardown({ env: RUN_ENV, fs: fakeFs().fs, api, log })).toBe(false);
    expect(log).toHaveBeenCalledWith(
      "::warning::Could not fully delete this run's QA stack (worker 500; d1 500). The scheduled sweep deletes it once it is 3 hours old.",
    );
  });

  it("refuses to run outside GitHub Actions", async () => {
    await expect(teardown({ env: { ...RUN_ENV, GITHUB_ACTIONS: "false" }, fs: fakeFs().fs, api: fakeApi(), log: vi.fn() })).rejects.toThrow(/GitHub Actions/);
  });
});

describe("main and the CLI guard", () => {
  it("dispatches each command and rejects anything else", async () => {
    const api = fakeApi();
    const files = fakeFs(preparedFiles());
    const log = vi.fn();
    const secrets = () => ({ SESSION_SECRET: "s", VAPID_PUBLIC_KEY: "p", VAPID_PRIVATE_KEY: "k", VAPID_SUBJECT: "x", POSTHOG_DISABLED: "1" });

    await main(["prepare"], { env: RUN_ENV, fs: files.fs, api, log, secrets, now: Date.now });
    expect(api.createDatabase).toHaveBeenCalled();

    expect(await main(["deploy"], { env: RUN_ENV, exec: vi.fn(async () => ({ stdout: "", stderr: "" })), fs: files.fs, log })).toBe(1);
    await main(["verify"], { env: RUN_ENV, exec: verifyExec().exec, fs: files.fs, fetchImpl: site(LIVE), log });
    expect(await main(["teardown"], { env: RUN_ENV, fs: files.fs, api, log })).toBe(true);
    expect(await main(["sweep"], { env: RUN_ENV, api, log })).toEqual({ swept: 0, remainingRunWorkers: 0 });
    await expect(main(["release"], { env: RUN_ENV, api })).rejects.toThrow(/Usage/);
  });

  it("builds a real API client when none is injected", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, result: [] }) }));
    expect(await main(["teardown"], { env: RUN_ENV, fs: fakeFs().fs, fetchImpl, log: vi.fn() })).toBe(true);
    expect(fetchImpl).toHaveBeenCalled();
  });

  it("detects the CLI entry and reports errors as workflow errors", async () => {
    expect(isCliEntry("file:///repo/scripts/qa-run-scope.mjs", "/repo/scripts/qa-run-scope.mjs")).toBe(true);
    expect(isCliEntry("file:///repo/scripts/qa-run-scope.mjs", undefined)).toBe(false);

    expect(await runCliIfEntry({ moduleUrl: "file:///a.mjs", argv1: "/b.mjs" })).toBe(false);
    const runMain = vi.fn(async () => {});
    expect(await runCliIfEntry({ moduleUrl: "file:///a.mjs", argv1: "/a.mjs", runMain })).toBe(true);
    expect(runMain).toHaveBeenCalled();

    const onError = vi.fn();
    await runCliIfEntry({ moduleUrl: "file:///a.mjs", argv1: "/a.mjs", runMain: async () => Promise.reject(new Error("boom")), onError });
    expect(onError).toHaveBeenCalledWith(new Error("boom"));

    const io = { error: vi.fn() };
    defaultCliErrorHandler(new Error("boom"), io);
    defaultCliErrorHandler("plain", io);
    expect(io.error.mock.calls).toEqual([["::error::boom"], ["::error::plain"]]);
    expect(process.exitCode).toBe(1);
    expectConsoleError("::error::qa-run-scope-default-output");
    defaultCliErrorHandler(new Error("qa-run-scope-default-output"));
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it("falls back to the real process, filesystem and clock, and still refuses an unknown command", async () => {
    await expect(main()).rejects.toThrow(/Usage/);
    await expect(main(["status"])).rejects.toThrow(/Usage/);
    expect(defaultFs.remove).toBeTypeOf("function");
  });

  it("sleeps for real by default", async () => {
    vi.useFakeTimers();
    try {
      let done = false;
      const sleeping = defaultSleep(1_000).then(() => {
        done = true;
      });
      await vi.advanceTimersByTimeAsync(999);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await sleeping;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Journeys workflow", () => {
  const workflow = parse(readFileSync(resolve(ROOT, ".github/workflows/journeys.yml"), "utf8"));
  const journeys = workflow.jobs.journeys;
  const steps: Array<{ name?: string; id?: string; if?: string; run?: string; env?: Record<string, string> }> = journeys.steps;
  const index = (name: string) => {
    const found = steps.findIndex((step) => step.name === name);
    if (found === -1) throw new Error(`Missing workflow step: ${name}`);
    return found;
  };
  const step = (name: string) => steps[index(name)];

  it("no longer queues runs for one shared QA Worker", () => {
    expect(Object.keys(workflow.jobs).sort()).toEqual(["deploy-shared-qa", "fork-notice", "journeys"]);
    expect(journeys.needs).toBeUndefined();
    const text = JSON.stringify(steps);
    expect(text).not.toMatch(/qa-lock|wait-for-qa-turn|deploy:qa/);
    expect(workflow.env.SPOONJOY_JOURNEYS_BASE_URL).toBeUndefined();
  });

  it("checks the build against shared QA's config before creating the run's stack, then migrates, deploys and verifies it", () => {
    const order = [
      "Install dependencies",
      "Check the QA config",
      "Build for QA",
      "Check the generated QA build",
      "Create this run's QA stack",
      "Migrate this run's QA database",
      "Deploy this build to this run's QA Worker",
      "Check this run's QA Worker is live",
      "Start QA Worker tail",
      "Seed the QA kitchen",
      "Run test suite",
    ].map(index);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(step("Check the generated QA build").run).toContain("SPOONJOY_QA_PREFLIGHT_EXPECT_BUILD_CONFIG=1");
    expect(step("Create this run's QA stack").id).toBe("qa-run");
    expect(step("Create this run's QA stack").run).toBe("node scripts/qa-run-scope.mjs prepare");
    expect(step("Deploy this build to this run's QA Worker").run).toBe("node scripts/qa-run-scope.mjs deploy");
    expect(step("Check this run's QA Worker is live").run).toBe("node scripts/qa-run-scope.mjs verify");
    expect(step("Start QA Worker tail").run).toContain('wrangler tail "$SPOONJOY_QA_RUN_WORKER"');
  });

  it("touches the run's stack after a failure only if it was created, and always deletes it, then reports API use", () => {
    for (const name of ["Stop QA Worker tail and summarise it", "Rotate persona passwords", "Clean up disposable QA data"]) {
      expect(step(name).if, name).toBe("always() && steps.qa-run.outcome == 'success'");
    }
    const [teardownStep, report] = steps.slice(-2);
    expect(teardownStep.name).toBe("Delete this run's QA stack");
    expect(teardownStep.if).toBe("always()");
    expect(teardownStep.run).toBe("node scripts/qa-run-scope.mjs teardown");
    expect(report.name).toBe("Report Cloudflare API requests");
    expect(report.if).toBe("always()");
    expect(report.run).toContain('node scripts/count-cloudflare-requests.mjs summary "$RUNNER_TEMP/cloudflare-requests.log"');
  });

  it("migrates the run's empty database itself and never exports or copies shared QA", () => {
    const text = readFileSync(resolve(ROOT, ".github/workflows/journeys.yml"), "utf8");
    expect(text).not.toMatch(/d1 export/);
    expect(step("Migrate this run's QA database").run).toBe("pnpm run qa:migrate");
  });

  it("gives the Cloudflare token only to steps that use Cloudflare, never to dependency install", () => {
    expect(journeys.env?.CLOUDFLARE_API_TOKEN).toBeUndefined();
    const withToken = steps.filter((candidate) => candidate.env?.CLOUDFLARE_API_TOKEN).map((candidate) => candidate.name);
    expect(withToken).toEqual([
      "Require Cloudflare credentials",
      "Create this run's QA stack",
      "Migrate this run's QA database",
      "Deploy this build to this run's QA Worker",
      "Check this run's QA Worker is live",
      "Start QA Worker tail",
      "Seed the QA kitchen",
      "Rotate persona passwords",
      "Clean up disposable QA data",
      "Delete this run's QA stack",
    ]);
    // Every one of those steps also logs its Cloudflare API requests.
    for (const name of withToken) {
      expect(step(name!).env, name).toMatchObject({
        NODE_OPTIONS: "--import ${{ github.workspace }}/scripts/count-cloudflare-requests.mjs",
        SPOONJOY_CF_REQUEST_LOG: "${{ runner.temp }}/cloudflare-requests.log",
      });
    }
  });

  it("keeps shared QA a mirror of main: deployed only after main's journeys pass, one deploy at a time", () => {
    const deploy = workflow.jobs["deploy-shared-qa"];
    expect(deploy.needs).toBe("journeys");
    expect(deploy.if).toContain("github.event_name == 'push'");
    expect(deploy.if).toContain("github.ref == 'refs/heads/main'");
    expect(deploy.if).toContain("needs.journeys.result == 'success'");
    expect(deploy.concurrency).toEqual({ group: "journeys-shared-qa-deploy", "cancel-in-progress": false });
    const deploySteps: Array<{ name?: string; id?: string; if?: string; run?: string; env?: Record<string, string> }> = deploy.steps;
    expect(deploySteps.at(-1)).toMatchObject({
      name: "Deploy main to shared QA",
      if: "steps.tip.outputs.current == 'true'",
      run: "pnpm run deploy:qa",
    });
    expect(deploySteps.filter((candidate) => candidate.env?.CLOUDFLARE_API_TOKEN)).toHaveLength(1);
  });

  it("never deploys an older main over a newer one", () => {
    const deploySteps: Array<{ name?: string; id?: string; run?: string }> = workflow.jobs["deploy-shared-qa"].steps;
    const tip = deploySteps.at(-2)!;
    expect(tip).toMatchObject({ name: "Check this commit is still main's tip", id: "tip" });
    expect(tip.run).toContain('gh api "repos/$GITHUB_REPOSITORY/commits/main" --jq .sha');
    expect(tip.run).toContain('if [ "$tip" = "$GITHUB_SHA" ]; then');
    expect(tip.run).toContain('echo "current=true" >> "$GITHUB_OUTPUT"');
    expect(tip.run).toContain('echo "current=false" >> "$GITHUB_OUTPUT"');
  });

  it("sweeps orphaned run stacks every hour, with only the Cloudflare credentials", () => {
    const sweepWorkflow = parse(readFileSync(resolve(ROOT, ".github/workflows/qa-run-sweep.yml"), "utf8"));
    expect(sweepWorkflow.on.schedule).toEqual([{ cron: "41 * * * *" }]);
    expect(sweepWorkflow.permissions).toEqual({ contents: "read" });
    const sweepSteps: Array<{ name?: string; run?: string; env?: Record<string, string> }> = sweepWorkflow.jobs.sweep.steps;
    expect(sweepSteps.at(-1)).toMatchObject({ name: "Delete stale QA run stacks", run: "node scripts/qa-run-scope.mjs sweep" });
    expect(sweepSteps.filter((candidate) => candidate.env?.CLOUDFLARE_API_TOKEN)).toHaveLength(1);
    expect(sweepSteps.some((candidate) => candidate.run?.includes("pnpm install"))).toBe(false);
  });

  it("targets shared QA by the same identity the preflight pins", () => {
    expect(REAL_WRANGLER.env.qa.vars.SPOONJOY_BASE_URL).toBe(QA_BASE_URL);
    expect(REAL_WRANGLER.env.qa.d1_databases[0].database_id).toBe(QA_D1_DATABASE_ID);
  });
});
