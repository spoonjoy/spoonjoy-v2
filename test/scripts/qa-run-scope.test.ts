// @vitest-environment node
import { generateKeyPairSync } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import {
  API_RETRY_DELAYS_MS,
  CANONICAL_DUMP_FILE,
  GENERATED_BUILD_CONFIG,
  READY_TIMEOUT_MS,
  REQUIRED_RUN_SECRETS,
  SECRETS_FILE,
  STALE_AFTER_MS,
  STATE_DIR,
  STATE_FILE,
  WRANGLER_CONFIG,
  assertOnlyIdentityChanged,
  buildRunSecrets,
  createCloudflareApi,
  defaultCliErrorHandler,
  defaultFs,
  defaultSleep,
  generateVapidKeys,
  isCliEntry,
  localMigrationNames,
  main,
  pendingSharedQaMigrations,
  prepare,
  requireGitHubActions,
  runCliIfEntry,
  runIdentity,
  scopeGeneratedBuildConfig,
  scopeWranglerConfig,
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
const ZERO_DB_ID = "00000000-0000-0000-0000-000000000000";

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
    readDir: vi.fn(() => ["0000_init.sql", "0002_seed.sql", "0003_new.sql", "README.md"]),
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

// A fake `pnpm exec wrangler ...` that answers the shared-QA d1_migrations query.
function fakeExec(applied: string[] = ["0000_init.sql", "0002_seed.sql", "0003_new.sql"], extra: Record<string, string> = {}) {
  const calls: string[][] = [];
  const exec = vi.fn(async (file: string, args: string[]) => {
    calls.push([file, ...args]);
    const command = args.slice(2).join(" ");
    for (const [prefix, stdout] of Object.entries(extra)) {
      if (command.startsWith(prefix)) return { stdout, stderr: "" };
    }
    if (command.includes("SELECT name FROM d1_migrations")) {
      return { stdout: `noise\n${JSON.stringify([{ results: applied.map((name) => ({ name })) }])}`, stderr: "" };
    }
    return { stdout: "", stderr: "" };
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
  function jsonResponse(status: number, body: unknown) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  }

  it("requires a token and a 32-hex account id", () => {
    expect(() => createCloudflareApi({ env: {} })).toThrow(/are required/);
    expect(() => createCloudflareApi({ env: { CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "nope" } })).toThrow(/are required/);
  });

  it("calls the account's D1 and Workers endpoints with the bearer token", async () => {
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
      `GET ${base}/d1/database?name=spoonjoy-qa-run-&page=1&per_page=100`,
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

  it("retries rate limits, server errors and network failures, then reports the failure", async () => {
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
    const api = createCloudflareApi({ env: RUN_ENV, fetchImpl, sleep });
    expect(await api.listWorkers()).toEqual([]);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual(API_RETRY_DELAYS_MS);

    const down = createCloudflareApi({
      env: RUN_ENV,
      fetchImpl: vi.fn(async () => {
        throw "offline";
      }),
      sleep,
    });
    await expect(down.listWorkers()).rejects.toThrow(/returned a network error: offline/);

    const failing = createCloudflareApi({ env: RUN_ENV, fetchImpl: vi.fn(async () => jsonResponse(500, {})), sleep });
    await expect(failing.listWorkers()).rejects.toThrow(/GET \/workers\/scripts returned 500$/);
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

describe("sweepStaleRunStacks", () => {
  const now = () => Date.parse("2026-10-09T12:00:00Z");
  const old = new Date(now() - STALE_AFTER_MS - 1).toISOString();
  const fresh = new Date(now() - 60_000).toISOString();

  it("deletes only per-run stacks older than three hours, never shared QA or another run in progress", async () => {
    const api = fakeApi({
      listDatabases: vi.fn(async () => [
        { name: "spoonjoy-qa-run-1-1", uuid: "stale-db", created_at: old },
        { name: "spoonjoy-qa-run-2-1", uuid: "fresh-db", created_at: fresh },
        { name: "spoonjoy-qa", uuid: "shared", created_at: old },
        { name: "spoonjoy-qa-run-x", uuid: "odd", created_at: old },
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

    expect(await sweepStaleRunStacks({ api, now, log })).toBe(2);
    expect(api.deleteDatabase.mock.calls).toEqual([["stale-db"]]);
    expect(api.deleteWorker.mock.calls).toEqual([["spoonjoy-v2-qa-run-1-1"]]);
    expect(log).toHaveBeenCalledTimes(2);
  });
});

describe("pendingSharedQaMigrations", () => {
  it("lists this checkout's migrations that shared QA's d1_migrations does not record", async () => {
    const { exec, calls } = fakeExec(["0000_init.sql"]);
    const readDir = vi.fn(() => ["0003_new.sql", "0000_init.sql", "notes.txt", "0002_seed.sql"]);

    expect(await pendingSharedQaMigrations({ exec, readDir })).toEqual(["0002_seed.sql", "0003_new.sql"]);
    expect(calls[0]).toEqual([
      "pnpm", "exec", "wrangler", "d1", "execute", "DB", "--remote", "--env", "qa", "--json",
      "--command", "SELECT name FROM d1_migrations ORDER BY id;",
    ]);
  });

  it("treats an empty result as nothing applied, and fails on output without JSON", async () => {
    const empty = vi.fn(async () => ({ stdout: "[{}]", stderr: "" }));
    expect(await pendingSharedQaMigrations({ exec: empty, readDir: () => ["0000_init.sql"] })).toEqual(["0000_init.sql"]);

    const garbage = vi.fn(async () => ({ stdout: "error", stderr: "" }));
    await expect(pendingSharedQaMigrations({ exec: garbage, readDir: () => [] })).rejects.toThrow(/no JSON results/);
  });

  it("reads the real migrations directory by default", () => {
    const names = localMigrationNames(readdirSync);
    expect(names[0]).toBe("0000_init.sql");
    expect(names.every((name) => /^\d{4}_.+\.sql$/.test(name))).toBe(true);
  });
});

describe("prepare", () => {
  const secrets = () => ({ SESSION_SECRET: "s3cret", VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "x", POSTHOG_DISABLED: "1" });

  it("creates the run's database, rewrites both configs to it, writes secrets and exports the run's URL", async () => {
    const files = fakeFs(preparedFiles());
    const api = fakeApi();
    const { exec, calls } = fakeExec();
    const log = vi.fn();

    const state = await prepare({ env: RUN_ENV, exec, fs: files.fs, api, now: Date.now, log, secrets });

    expect(state).toEqual({ ...IDENTITY, databaseId: RUN_DB_ID, clonedFromSharedQa: false, pendingMigrations: [] });
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
    expect(log).toHaveBeenCalledWith("::add-mask::s3cret");
    // Only the shared-QA migration read ran: no export, no import.
    expect(calls).toHaveLength(1);
    expect(files.fs.mkdir).toHaveBeenCalledWith(STATE_DIR, { recursive: true });
  });

  it("starts the run's database as a copy of shared QA when this checkout has migrations shared QA lacks", async () => {
    const files = fakeFs(preparedFiles());
    const { exec, calls } = fakeExec(["0000_init.sql", "0002_seed.sql"]);
    const order: string[] = [];
    exec.mockImplementation(async (file: string, args: string[]) => {
      calls.push([file, ...args]);
      const command = args.slice(2).join(" ");
      // The import must target the run's database: wrangler.json is already rewritten by then.
      order.push(`${args[3]}:${JSON.parse(files.store.get(WRANGLER_CONFIG)!).env.qa.d1_databases[0].database_name}`);
      if (command.includes("SELECT name FROM d1_migrations")) {
        return { stdout: JSON.stringify([{ results: [{ name: "0000_init.sql" }, { name: "0002_seed.sql" }] }]), stderr: "" };
      }
      return { stdout: "", stderr: "" };
    });

    const state = await prepare({ now: Date.now, env: RUN_ENV, exec, fs: files.fs, api: fakeApi(), log: vi.fn(), secrets });

    expect(state.clonedFromSharedQa).toBe(true);
    expect(state.pendingMigrations).toEqual(["0003_new.sql"]);
    expect(calls.map((call) => call.slice(3, 5).join(" "))).toEqual(["d1 execute", "d1 export", "d1 execute"]);
    expect(calls[1]).toContain(CANONICAL_DUMP_FILE);
    expect(calls[2]).toEqual(["pnpm", "exec", "wrangler", "d1", "execute", "DB", "--remote", "--env", "qa", "--yes", "--file", CANONICAL_DUMP_FILE]);
    expect(order).toEqual(["execute:spoonjoy-qa", "export:spoonjoy-qa", `execute:${IDENTITY.databaseName}`]);
    // The dump of shared QA is emptied once imported.
    expect(files.store.get(CANONICAL_DUMP_FILE)).toBe("");
  });

  it("replaces a database left by an earlier try of the same attempt, and still runs when the sweep fails", async () => {
    const files = fakeFs(preparedFiles());
    const api = fakeApi({
      listDatabases: vi.fn()
        .mockRejectedValueOnce(new Error("sweep down"))
        .mockResolvedValueOnce([{ name: IDENTITY.databaseName, uuid: "leftover" }, { name: "other", uuid: "keep" }]),
    });
    const log = vi.fn();
    await prepare({ now: Date.now, env: { ...RUN_ENV, GITHUB_ENV: undefined }, exec: fakeExec().exec, fs: files.fs, api, log, secrets });

    expect(api.deleteDatabase.mock.calls).toEqual([["leftover"]]);
    expect(log).toHaveBeenCalledWith("::warning::Could not sweep stale QA run stacks: sweep down");
    expect(files.appended).toEqual([]);

    const stringFailure = fakeApi({ listDatabases: vi.fn().mockRejectedValueOnce("plain").mockResolvedValue([]) });
    const log2 = vi.fn();
    await prepare({ now: Date.now, env: RUN_ENV, exec: fakeExec().exec, fs: fakeFs(preparedFiles()).fs, api: stringFailure, log: log2, secrets });
    expect(log2).toHaveBeenCalledWith("::warning::Could not sweep stale QA run stacks: plain");
  });

  it("creates nothing unless both configs name shared QA and the build exists", async () => {
    const api = fakeApi();
    const missingBuild = fakeFs({ [WRANGLER_CONFIG]: JSON.stringify(REAL_WRANGLER) });
    await expect(prepare({ now: Date.now, env: RUN_ENV, exec: fakeExec().exec, fs: missingBuild.fs, api, log: vi.fn() })).rejects.toThrow(/is missing/);

    const production = structuredClone(REAL_WRANGLER);
    production.env.qa.vars.SPOONJOY_BASE_URL = "https://spoonjoy.app";
    const wrongConfig = fakeFs({ ...preparedFiles(), [WRANGLER_CONFIG]: JSON.stringify(production) });
    await expect(prepare({ now: Date.now, env: RUN_ENV, exec: fakeExec().exec, fs: wrongConfig.fs, api, log: vi.fn() })).rejects.toThrow(/does not target/);

    await expect(prepare({ now: Date.now, env: { ...RUN_ENV, GITHUB_ACTIONS: undefined }, exec: fakeExec().exec, fs: fakeFs(preparedFiles()).fs, api, log: vi.fn() }))
      .rejects.toThrow(/only inside GitHub Actions/);

    expect(api.createDatabase).not.toHaveBeenCalled();
    expect(api.listDatabases).not.toHaveBeenCalled();
  });

  it("fails if Cloudflare returns no database id", async () => {
    const api = fakeApi({ createDatabase: vi.fn(async () => ({})) });
    await expect(prepare({ now: Date.now, env: RUN_ENV, exec: fakeExec().exec, fs: fakeFs(preparedFiles()).fs, api, log: vi.fn(), secrets }))
      .rejects.toThrow(/did not return the new database's id/);
    const nothing = fakeApi({ createDatabase: vi.fn(async () => undefined) });
    await expect(prepare({ now: Date.now, env: RUN_ENV, exec: fakeExec().exec, fs: fakeFs(preparedFiles()).fs, api: nothing, log: vi.fn(), secrets }))
      .rejects.toThrow(/did not return the new database's id/);
  });
});

function scopedFiles(overrides: Record<string, unknown> = {}) {
  const state = { ...IDENTITY, databaseId: RUN_DB_ID, clonedFromSharedQa: false, pendingMigrations: [], ...overrides };
  return fakeFs({
    [STATE_FILE]: JSON.stringify(state),
    [WRANGLER_CONFIG]: JSON.stringify(scopeWranglerConfig(REAL_WRANGLER, IDENTITY, RUN_DB_ID)),
  });
}

function verifyExec({ secrets = REQUIRED_RUN_SECRETS, migrations = "✅ No migrations to apply!" } = {}) {
  return fakeExec([], {
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
    const nullRows = fakeExec([], { "secret list": "[null]" });
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

describe("teardown", () => {
  it("deletes this run's Worker and database and its local state", async () => {
    const api = fakeApi({
      listDatabases: vi.fn(async () => [
        { name: IDENTITY.databaseName, uuid: RUN_DB_ID },
        { name: "spoonjoy-qa-run-1001-1", uuid: "earlier-attempt" },
      ]),
    });
    const files = scopedFiles();
    const log = vi.fn();

    expect(await teardown({ env: RUN_ENV, fs: files.fs, api, log })).toBe(true);
    expect(api.deleteWorker.mock.calls).toEqual([[IDENTITY.workerName]]);
    expect(api.deleteDatabase.mock.calls).toEqual([[RUN_DB_ID]]);
    expect(files.removed).toEqual([STATE_DIR]);
  });

  it("treats an already-deleted Worker as done", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ success: false }) }));
    const realApi = createCloudflareApi({ env: RUN_ENV, fetchImpl, sleep: vi.fn() });
    const api = fakeApi({ deleteWorker: realApi.deleteWorker });
    expect(await teardown({ env: RUN_ENV, fs: scopedFiles().fs, api, log: vi.fn() })).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
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
    expect(await teardown({ env: RUN_ENV, fs: scopedFiles().fs, api, log })).toBe(false);
    expect(log).toHaveBeenCalledWith(
      "::warning::Could not fully delete this run's QA stack (worker 500; d1 500). A later run deletes it once it is 3 hours old.",
    );
  });

  it("works from the run's names alone when prepare failed before writing state", async () => {
    const api = fakeApi();
    expect(await teardown({ env: RUN_ENV, fs: fakeFs().fs, api, log: vi.fn() })).toBe(true);
    expect(api.deleteWorker).toHaveBeenCalledWith(IDENTITY.workerName);
    await expect(teardown({ env: { ...RUN_ENV, GITHUB_ACTIONS: "false" }, fs: fakeFs().fs, api, log: vi.fn() })).rejects.toThrow(/GitHub Actions/);
  });
});

describe("main and the CLI guard", () => {
  it("dispatches each command and rejects anything else", async () => {
    const api = fakeApi();
    const files = fakeFs(preparedFiles());
    const log = vi.fn();
    const secrets = () => ({ SESSION_SECRET: "s", VAPID_PUBLIC_KEY: "p", VAPID_PRIVATE_KEY: "k", VAPID_SUBJECT: "x", POSTHOG_DISABLED: "1" });

    await main(["prepare"], { env: RUN_ENV, exec: fakeExec().exec, fs: files.fs, api, log, secrets, now: Date.now });
    expect(api.createDatabase).toHaveBeenCalled();

    await main(["verify"], { env: RUN_ENV, exec: verifyExec().exec, fs: files.fs, fetchImpl: site(LIVE), log });
    expect(await main(["teardown"], { env: RUN_ENV, fs: files.fs, api, log })).toBe(true);
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
    expect(step("Deploy this build to this run's QA Worker").run).toBe(`pnpm exec wrangler deploy --env qa --secrets-file ${SECRETS_FILE}`);
    expect(step("Check this run's QA Worker is live").run).toBe("node scripts/qa-run-scope.mjs verify");
    expect(step("Start QA Worker tail").run).toContain('wrangler tail "$SPOONJOY_QA_RUN_WORKER"');
  });

  it("touches the run's stack after a failure only if it was created, and always deletes it last", () => {
    for (const name of ["Stop QA Worker tail and summarise it", "Rotate persona passwords", "Clean up disposable QA data"]) {
      expect(step(name).if, name).toBe("always() && steps.qa-run.outcome == 'success'");
    }
    const last = steps.at(-1)!;
    expect(last.name).toBe("Delete this run's QA stack");
    expect(last.if).toBe("always()");
    expect(last.run).toBe("node scripts/qa-run-scope.mjs teardown");
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
  });

  it("keeps shared QA a mirror of main: deployed only after main's journeys pass, one deploy at a time", () => {
    const deploy = workflow.jobs["deploy-shared-qa"];
    expect(deploy.needs).toBe("journeys");
    expect(deploy.if).toContain("github.event_name == 'push'");
    expect(deploy.if).toContain("github.ref == 'refs/heads/main'");
    expect(deploy.if).toContain("needs.journeys.result == 'success'");
    expect(deploy.concurrency).toEqual({ group: "journeys-shared-qa-deploy", "cancel-in-progress": false });
    const deploySteps: Array<{ name?: string; run?: string; env?: Record<string, string> }> = deploy.steps;
    expect(deploySteps.at(-1)).toMatchObject({ name: "Deploy main to shared QA", run: "pnpm run deploy:qa" });
    expect(deploySteps.filter((candidate) => candidate.env?.CLOUDFLARE_API_TOKEN)).toHaveLength(1);
  });

  it("targets shared QA by the same identity the preflight pins", () => {
    expect(REAL_WRANGLER.env.qa.vars.SPOONJOY_BASE_URL).toBe(QA_BASE_URL);
    expect(REAL_WRANGLER.env.qa.d1_databases[0].database_id).toBe(QA_D1_DATABASE_ID);
  });
});
