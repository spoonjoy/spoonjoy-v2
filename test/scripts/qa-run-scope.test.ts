// @vitest-environment node
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
  APP_ANSWERS_IN_A_ROW,
  APP_ANSWER_GAP_MS,
  WORKERS_DEV_PLACEHOLDER,
  waitForAppAnswers,
  READY_POLL_MS,
  ASSETS_READY_TIMEOUT_MS,
  ASSET_FETCH_CONCURRENCY,
  ASSET_SERVER_ERROR_GRACE_MS,
  AssetServerErrors,
  MAX_ASSET_REDEPLOYS,
  CLIENT_ASSETS_DIR,
  builtAssetPaths,
  waitForBuiltAssets,
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
  RUN_DATABASE_PATTERN,
  RUN_WORKER_PATTERN,
  scopeGeneratedBuildConfig,
  scopeWranglerConfig,
  sweep,
  sweepStaleRunStacks,
  teardown,
  verify,
  QA_ERROR_LOGS_VAR,
  RUN_QUEUE_PATTERN,
  SHARED_QA_QUEUE,
  ensureSharedQueue,
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
  queueName: "spoonjoy-jobs-qa-run-1001-2",
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
    exists: vi.fn((path: string) => store.has(path) || [...store.keys()].some((key) => key.startsWith(`${path}/`))),
    listDir: vi.fn((path: string) =>
      [...store.keys()].filter((key) => key.startsWith(`${path}/`)).map((key) => key.slice(path.length + 1).split("/")[0])),
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
    listQueues: vi.fn(async () => [] as Array<{ queue_name?: string; queue_id: string; created_on?: string }>),
    createQueue: vi.fn(async (name: string) => ({ queue_id: "new-queue", queue_name: name })),
    deleteQueue: vi.fn(async () => ({ success: true })),
    listQueueConsumers: vi.fn(async (queueId: string) => [{ consumer_id: `${queueId}-consumer`, script_name: "a-worker" }]),
    deleteQueueConsumer: vi.fn(async () => ({ success: true })),
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
  it("names the run's Worker, database, jobs queue and workers.dev URL after the run and attempt", () => {
    expect(runIdentity(RUN_ENV)).toEqual(IDENTITY);
  });

  it("refuses a missing or non-numeric run id or attempt", () => {
    expect(() => runIdentity({ GITHUB_RUN_ATTEMPT: "1" })).toThrow(/whole numbers/);
    expect(() => runIdentity({ GITHUB_RUN_ID: "1" })).toThrow(/whole numbers/);
    expect(() => runIdentity({ GITHUB_RUN_ID: "1", GITHUB_RUN_ATTEMPT: "x" })).toThrow(/whole numbers/);
  });

  it("gives each later part of a split suite its own stack, and part 1 the plain name", () => {
    expect(runIdentity({ ...RUN_ENV, SPOONJOY_QA_RUN_PART: "1" })).toEqual(IDENTITY);
    const second = runIdentity({ ...RUN_ENV, SPOONJOY_QA_RUN_PART: "2" });
    expect(second).toEqual({
      workerName: "spoonjoy-v2-qa-run-1001-2-p2",
      databaseName: "spoonjoy-qa-run-1001-2-p2",
      queueName: "spoonjoy-jobs-qa-run-1001-2-p2",
      baseUrl: "https://spoonjoy-v2-qa-run-1001-2-p2.mendelow-studio.workers.dev",
    });
    // The sweep still finds a later part's stack.
    expect(RUN_WORKER_PATTERN.test(second.workerName)).toBe(true);
    expect(RUN_DATABASE_PATTERN.test(second.databaseName)).toBe(true);
    expect(RUN_QUEUE_PATTERN.test(second.queueName)).toBe(true);
  });

  it("lets the sweep find a Worker verify deployed again under a fresh name, and nothing else", () => {
    for (const name of ["spoonjoy-v2-qa-run-1001-2-r2", "spoonjoy-v2-qa-run-1001-2-p2-r3"]) expect(RUN_WORKER_PATTERN.test(name)).toBe(true);
    for (const name of ["spoonjoy-v2-qa-run-1001-2-r1", "spoonjoy-v2-qa-run-1001-2-r10", "spoonjoy-v2-qa-run-1001-2-r2-p2"]) {
      expect(RUN_WORKER_PATTERN.test(name)).toBe(false);
    }
  });

  it("refuses a part that is not a single digit from 1 to 9", () => {
    for (const part of ["", "0", "10", "x", " 2"]) {
      expect(() => runIdentity({ ...RUN_ENV, SPOONJOY_QA_RUN_PART: part })).toThrow(/single digit from 1 to 9/);
    }
  });
});

describe("requireGitHubActions", () => {
  it("refuses to run outside GitHub Actions, so a developer's wrangler.json is never rewritten", () => {
    expect(() => requireGitHubActions({})).toThrow(/only inside GitHub Actions/);
    expect(() => requireGitHubActions({ GITHUB_ACTIONS: "true" })).not.toThrow();
  });

  it("runs on a developer machine only with the explicit SPOONJOY_QA_LOCAL_RUN=1 opt-in", () => {
    expect(() => requireGitHubActions({ SPOONJOY_QA_LOCAL_RUN: "1" })).not.toThrow();
  });

  it("accepts no other spelling of the local-run opt-in", () => {
    for (const value of ["", "0", "true", "yes", "TRUE", " 1", "1 "]) {
      expect(() => requireGitHubActions({ SPOONJOY_QA_LOCAL_RUN: value })).toThrow(/only inside GitHub Actions/);
    }
    expect(() => requireGitHubActions({ GITHUB_ACTIONS: "false", SPOONJOY_QA_LOCAL_RUN: "0" })).toThrow(
      /SPOONJOY_QA_LOCAL_RUN=1/,
    );
  });

  it("still needs a numeric run identity on a local run, so the stack keeps a sweepable per-run name", () => {
    expect(() => runIdentity({ SPOONJOY_QA_LOCAL_RUN: "1" })).toThrow(/whole numbers/);
    expect(runIdentity({ SPOONJOY_QA_LOCAL_RUN: "1", GITHUB_RUN_ID: "1001", GITHUB_RUN_ATTEMPT: "2" })).toEqual(IDENTITY);
  });
});

describe("scopeWranglerConfig", () => {
  it("rewrites only env.qa's Worker name, D1 binding, jobs queue and base URL, and leaves production alone", () => {
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
    // The run's Worker sends its jobs to its own queue and takes them from there, one at a time.
    expect(REAL_WRANGLER.env.qa.queues.producers).toEqual([{ binding: "JOBS", queue: SHARED_QA_QUEUE }]);
    expect(scoped.env.qa.queues).toEqual({
      producers: [{ binding: "JOBS", queue: IDENTITY.queueName }],
      consumers: [{ ...REAL_WRANGLER.env.qa.queues.consumers[0], queue: IDENTITY.queueName }],
    });
    expect(scoped.env.qa.queues.consumers[0].max_batch_size).toBe(1);
    const { env: _scopedEnv, ...scopedTop } = scoped;
    const { env: _realEnv, ...realTop } = REAL_WRANGLER;
    expect(scopedTop).toEqual(realTop);
    // The input is not mutated.
    expect(REAL_WRANGLER.env.qa.d1_databases[0].database_id).toBe(QA_D1_DATABASE_ID);
  });

  it("turns on the QA error log line for the run's own Worker only, never for shared QA or production", () => {
    const scoped = scopeWranglerConfig(REAL_WRANGLER, IDENTITY, RUN_DB_ID);
    const generated = scopeGeneratedBuildConfig(generatedBuildConfig(), IDENTITY, RUN_DB_ID);

    expect(QA_ERROR_LOGS_VAR).toBe("SPOONJOY_QA_ERROR_LOGS");
    expect(scoped.env.qa.vars[QA_ERROR_LOGS_VAR]).toBe("1");
    expect(generated.vars[QA_ERROR_LOGS_VAR]).toBe("1");
    expect(scoped.vars).not.toHaveProperty(QA_ERROR_LOGS_VAR);
    expect(REAL_WRANGLER.vars).not.toHaveProperty(QA_ERROR_LOGS_VAR);
    expect(REAL_WRANGLER.env.qa.vars).not.toHaveProperty(QA_ERROR_LOGS_VAR);
    // A shared QA config that already carried the switch would be more than an identity change.
    const sharedWithSwitch = structuredClone(REAL_WRANGLER);
    sharedWithSwitch.env.qa.vars[QA_ERROR_LOGS_VAR] = "1";
    expect(() => scopeWranglerConfig(sharedWithSwitch, IDENTITY, RUN_DB_ID)).toThrow(/already sets SPOONJOY_QA_ERROR_LOGS/);
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

    const otherQueue = structuredClone(REAL_WRANGLER);
    otherQueue.env.qa.queues.producers[0].queue = "spoonjoy-jobs";
    otherQueue.env.qa.queues.consumers[0].queue = "spoonjoy-jobs";
    expect(() => scopeWranglerConfig(otherQueue, IDENTITY, RUN_DB_ID)).toThrow(/does not use shared QA's jobs queue/);

    const noConsumer = structuredClone(REAL_WRANGLER);
    noConsumer.env.qa.queues.consumers = [];
    expect(() => scopeWranglerConfig(noConsumer, IDENTITY, RUN_DB_ID)).toThrow(/no JOBS queue with one consumer/);
    delete noConsumer.env.qa.queues;
    expect(() => scopeWranglerConfig(noConsumer, IDENTITY, RUN_DB_ID)).toThrow(/no JOBS queue with one consumer/);

    const deadLetters = structuredClone(REAL_WRANGLER);
    deadLetters.env.qa.queues.consumers[0].dead_letter_queue = "spoonjoy-jobs-qa-dead";
    expect(() => scopeWranglerConfig(deadLetters, IDENTITY, RUN_DB_ID)).toThrow(/dead-letter queue; a run can't have its own/);

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
    expect(scoped.queues.producers[0].queue).toBe(IDENTITY.queueName);
    expect(scoped.queues.consumers[0].queue).toBe(IDENTITY.queueName);
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

    // Only the jobs queue's name may change, not how its consumer takes messages.
    const retried = structuredClone(after);
    retried.queues.consumers[0].max_retries = 1;
    expect(() => assertOnlyIdentityChanged(before, retried)).toThrow(/more than its identity/);

    // A config without vars or D1 still compares.
    expect(() => assertOnlyIdentityChanged({ name: "a" }, { name: "b" })).not.toThrow();
    expect(() => assertOnlyIdentityChanged({ d1_databases: [null] }, { d1_databases: [null] })).not.toThrow();
    const producerOnly = (queue: string) => ({ queues: { producers: [{ binding: "JOBS", queue }] } });
    expect(() => assertOnlyIdentityChanged(producerOnly("a"), producerOnly("b"))).not.toThrow();
    // Another queue's consumer is not the jobs queue's identity, so its name must stay.
    const withOther = (queue: string, other: string) => ({ queues: { producers: [{ binding: "JOBS", queue }], consumers: [{ queue: other }] } });
    expect(() => assertOnlyIdentityChanged(withOther("a", "x"), withOther("b", "y"))).toThrow(/more than its identity/);
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
      if (url.includes("/queues?")) return jsonResponse(200, { success: true, result: [{ queue_name: "spoonjoy-jobs-qa-run-1-1", queue_id: "q" }] });
      if (init.method === "POST" && url.endsWith("/queues")) return jsonResponse(200, { success: true, result: { queue_id: "q" } });
      if (init.method === "POST") return jsonResponse(200, { success: true, result: { uuid: RUN_DB_ID } });
      if (url.endsWith("/workers/scripts")) return jsonResponse(200, { success: true, result: [{ id: "w" }] });
      if (init.method === "GET" && url.endsWith("/consumers")) return jsonResponse(200, { success: true, result: [{ consumer_id: "c" }] });
      return jsonResponse(200, { success: true, result: null });
    });
    const api = createCloudflareApi({ env: RUN_ENV, fetchImpl, sleep: vi.fn() });

    expect(await api.listDatabases()).toEqual([{ name: "spoonjoy-qa-run-1-1", uuid: "u" }]);
    expect(await api.createDatabase("spoonjoy-qa-run-1-1")).toEqual({ uuid: RUN_DB_ID });
    await api.deleteDatabase("u");
    expect(await api.listWorkers()).toEqual([{ id: "w" }]);
    await api.deleteWorker("spoonjoy-v2-qa-run-1-1");
    expect(await api.listQueues()).toEqual([{ queue_name: "spoonjoy-jobs-qa-run-1-1", queue_id: "q" }]);
    expect(await api.createQueue("spoonjoy-jobs-qa-run-1-1")).toEqual({ queue_id: "q" });
    await api.deleteQueue("q");
    expect(await api.listQueueConsumers("q")).toEqual([{ consumer_id: "c" }]);
    await api.deleteQueueConsumer("q", "c");

    const base = `https://api.cloudflare.com/client/v4/accounts/${RUN_ENV.CLOUDFLARE_ACCOUNT_ID}`;
    expect(fetchImpl.mock.calls.map(([url, init]) => `${init.method} ${url}`)).toEqual([
      `GET ${base}/d1/database?page=1&per_page=100`,
      `POST ${base}/d1/database`,
      `DELETE ${base}/d1/database/u`,
      `GET ${base}/workers/scripts`,
      `DELETE ${base}/workers/scripts/spoonjoy-v2-qa-run-1-1?force=true`,
      `GET ${base}/queues?page=1&per_page=100`,
      `POST ${base}/queues`,
      `DELETE ${base}/queues/q`,
      `GET ${base}/queues/q/consumers`,
      `DELETE ${base}/queues/q/consumers/c`,
    ]);
    expect(fetchImpl.mock.calls[1][1].body).toBe(JSON.stringify({ name: "spoonjoy-qa-run-1-1" }));
    expect(fetchImpl.mock.calls[6][1].body).toBe(JSON.stringify({ queue_name: "spoonjoy-jobs-qa-run-1-1" }));
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
    expect(await shortApi.listQueueConsumers("q")).toEqual([]);

    // Smaller pages than asked for still come in full when the API says how many there are.
    const small = [
      { success: true, result: [{ name: "a" }], result_info: { total_pages: 2 } },
      { success: true, result: [{ name: "b" }], result_info: { total_pages: 2 } },
    ];
    const smallApi = createCloudflareApi({ env: RUN_ENV, fetchImpl: vi.fn(async () => jsonResponse(200, small.shift())), sleep: vi.fn() });
    expect(await smallApi.listQueues()).toEqual([{ name: "a" }, { name: "b" }]);
    const empty = vi.fn(async () => jsonResponse(200, { success: true, result: [], result_info: { total_pages: 5 } }));
    expect(await createCloudflareApi({ env: RUN_ENV, fetchImpl: empty, sleep: vi.fn() }).listQueues()).toEqual([]);
    expect(empty).toHaveBeenCalledTimes(1);

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
        { name: "spoonjoy-qa-2", uuid: "shared", created_at: old },
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
      listQueues: vi.fn(async () => [
        { queue_name: "spoonjoy-jobs-qa-run-1-1", queue_id: "stale-queue", created_on: old },
        { queue_name: "spoonjoy-jobs-qa-run-2-1", queue_id: "fresh-queue", created_on: fresh },
        { queue_name: SHARED_QA_QUEUE, queue_id: "shared-queue", created_on: old },
        { queue_name: "spoonjoy-jobs", queue_id: "production-queue", created_on: old },
        { queue_id: "nameless-queue", created_on: old },
      ]),
    });
    const log = vi.fn();

    expect(await sweepStaleRunStacks({ api, now, log })).toEqual({ swept: 3, remainingRunWorkers: 1 });
    expect(api.deleteDatabase.mock.calls).toEqual([["stale-db"]]);
    expect(api.deleteQueue.mock.calls).toEqual([["stale-queue"]]);
    expect(api.deleteWorker.mock.calls).toEqual([["spoonjoy-v2-qa-run-1-1"]]);
    // Cloudflare deletes neither a Worker that consumes a queue nor a queue a Worker binds: consumer, Worker, queue.
    expect(api.deleteQueueConsumer.mock.calls).toEqual([["stale-queue", "stale-queue-consumer"]]);
    expect(api.deleteQueueConsumer.mock.invocationCallOrder[0]).toBeLessThan(api.deleteWorker.mock.invocationCallOrder[0]);
    expect(api.deleteWorker.mock.invocationCallOrder[0]).toBeLessThan(api.deleteQueue.mock.invocationCallOrder[0]);
    expect(log).toHaveBeenCalledTimes(3);
    expect(RUN_QUEUE_PATTERN.test(SHARED_QA_QUEUE)).toBe(false);
  });

  it("treats a stack another run deleted first (404) as already gone, and fails on any other error", async () => {
    const gone = notFoundApi();
    const api = fakeApi({
      listDatabases: vi.fn(async () => [{ name: "spoonjoy-qa-run-1-1", uuid: "stale-db", created_at: old }]),
      deleteDatabase: gone.deleteDatabase,
      listWorkers: vi.fn(async () => [{ id: "spoonjoy-v2-qa-run-1-1", created_on: old }]),
      deleteWorker: gone.deleteWorker,
      listQueues: vi.fn(async () => [{ queue_name: "spoonjoy-jobs-qa-run-1-1", queue_id: "stale-queue", created_on: old }]),
      deleteQueue: gone.deleteQueue,
      listQueueConsumers: gone.listQueueConsumers,
    });
    const log = vi.fn();
    expect(await sweepStaleRunStacks({ api, now, log })).toEqual({ swept: 3, remainingRunWorkers: 0 });
    expect(log.mock.calls.map(([line]) => line)).toEqual([
      `Already gone: stale QA run database spoonjoy-qa-run-1-1 (created ${old}).`,
      `Already gone: stale QA run Worker spoonjoy-v2-qa-run-1-1 (created ${old}).`,
      `Already gone: stale QA run jobs queue spoonjoy-jobs-qa-run-1-1 (created ${old}).`,
    ]);
    // A consumer another sweep removed first is gone too; any other error stops the sweep.
    const consumerGone = fakeApi({
      listQueues: vi.fn(async () => [{ queue_name: "spoonjoy-jobs-qa-run-1-1", queue_id: "stale-queue", created_on: old }]),
      deleteQueueConsumer: gone.deleteQueueConsumer,
    });
    expect(await sweepStaleRunStacks({ api: consumerGone, now, log: vi.fn() })).toEqual({ swept: 1, remainingRunWorkers: 0 });
    const consumersBroken = fakeApi({
      listQueues: vi.fn(async () => [{ queue_name: "spoonjoy-jobs-qa-run-1-1", queue_id: "stale-queue", created_on: old }]),
      listQueueConsumers: vi.fn(async () => {
        throw new Error("queues 500");
      }),
    });
    await expect(sweepStaleRunStacks({ api: consumersBroken, now, log: vi.fn() })).rejects.toThrow("queues 500");

    const broken = fakeApi({
      listDatabases: vi.fn(async () => [{ name: "spoonjoy-qa-run-1-1", uuid: "stale-db", created_at: old }]),
      deleteDatabase: vi.fn(async () => {
        throw new Error("d1 500");
      }),
    });
    await expect(sweepStaleRunStacks({ api: broken, now, log })).rejects.toThrow("d1 500");
  });

  it("skips a stale run Worker Cloudflare refuses to delete, counting it as in use, and sweeps the rest", async () => {
    const refusing = createCloudflareApi({
      env: RUN_ENV,
      fetchImpl: vi.fn(async () => ({
        ok: false,
        status: 403,
        json: async () => ({ success: false, errors: [{ message: "Cannot delete this Worker as it is a consumer for a Queue." }] }),
      })),
      sleep: vi.fn(),
    });
    const deleteWorker = vi.fn(async (id: string) => (id === "spoonjoy-v2-qa-run-1-1" ? refusing.deleteWorker(id) : undefined));
    const api = fakeApi({
      listWorkers: vi.fn(async () => [
        { id: "spoonjoy-v2-qa-run-1-1", created_on: old },
        { id: "spoonjoy-v2-qa-run-2-1", created_on: old },
      ]),
      deleteWorker,
    });
    const log = vi.fn();

    expect(await sweepStaleRunStacks({ api, now, log })).toEqual({ swept: 1, remainingRunWorkers: 1 });
    expect(deleteWorker.mock.calls).toEqual([["spoonjoy-v2-qa-run-1-1"], ["spoonjoy-v2-qa-run-2-1"]]);
    expect(log.mock.calls[0][0]).toMatch(/^::warning::Could not delete stale QA run Worker spoonjoy-v2-qa-run-1-1 \(created .*\): Cloudflare API DELETE .* returned 403/);
    expect(log).toHaveBeenLastCalledWith(`Deleted stale QA run Worker spoonjoy-v2-qa-run-2-1 (created ${old}).`);
  });

  it("still fails the sweep when deleting a stale run Worker fails any other way", async () => {
    const api = fakeApi({
      listWorkers: vi.fn(async () => [{ id: "spoonjoy-v2-qa-run-1-1", created_on: old }]),
      deleteWorker: vi.fn(async () => {
        throw new Error("network down");
      }),
    });
    await expect(sweepStaleRunStacks({ api, now, log: vi.fn() })).rejects.toThrow("network down");
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
    expect(api.createQueue).toHaveBeenCalledWith(IDENTITY.queueName);
    expect(log).toHaveBeenCalledWith(`Created QA run jobs queue ${IDENTITY.queueName}.`);
    expect(files.json(WRANGLER_CONFIG).env.qa.queues.producers[0].queue).toBe(IDENTITY.queueName);
    expect(files.json(GENERATED_BUILD_CONFIG).queues.consumers[0].queue).toBe(IDENTITY.queueName);
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

  it("replaces a jobs queue left by an earlier try of the same attempt, and reuses one a retried create made", async () => {
    const api = fakeApi({
      listQueues: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ queue_name: IDENTITY.queueName, queue_id: "leftover" }, { queue_name: SHARED_QA_QUEUE, queue_id: "keep" }]),
    });
    await prepare({ now: Date.now, env: RUN_ENV, fs: fakeFs(preparedFiles()).fs, api, log: vi.fn(), secrets });
    expect(api.deleteQueue.mock.calls).toEqual([["leftover"]]);
    expect(api.createQueue.mock.calls).toEqual([[IDENTITY.queueName]]);

    const retried = fakeApi({
      listQueues: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ queue_name: IDENTITY.queueName, queue_id: "made-first-time" }]),
      createQueue: vi.fn(async () => {
        throw new Error("Cloudflare API POST /queues returned 409: queue name already taken");
      }),
    });
    const log = vi.fn();
    await prepare({ now: Date.now, env: RUN_ENV, fs: fakeFs(preparedFiles()).fs, api: retried, log, secrets });
    expect(log).toHaveBeenCalledWith(`Created QA run jobs queue ${IDENTITY.queueName}.`);

    const refused = fakeApi({
      createQueue: vi.fn(async () => {
        throw new Error("Cloudflare API POST /queues returned 403: not allowed");
      }),
    });
    await expect(prepare({ now: Date.now, env: RUN_ENV, fs: fakeFs(preparedFiles()).fs, api: refused, log: vi.fn(), secrets })).rejects.toThrow(/403/);
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
    [`${CLIENT_ASSETS_DIR}/entry.client-AbC_1.js`]: "",
    [`${CLIENT_ASSETS_DIR}/createLucideIcon-Xy9.js`]: "",
    [`${CLIENT_ASSETS_DIR}/root-Q1.css`]: "",
    [`${CLIENT_ASSETS_DIR}/nested/ignored.txt`]: "",
  });
}

function verifyExec({ secrets = REQUIRED_RUN_SECRETS, migrations = "✅ No migrations to apply!" } = {}) {
  return fakeExec({
    "secret list": JSON.stringify(secrets.map((name) => ({ name, type: "secret_text" }))),
    "d1 migrations list": migrations,
  });
}

type Route = { status: number; body?: string; type?: string; headers?: Record<string, string> };

function site(routes: Record<string, Route | Error>, baseUrl = IDENTITY.baseUrl) {
  return vi.fn(async (url: string) => {
    const path = url.slice(baseUrl.length);
    const route = routes[path] ?? { status: 404 };
    if (route instanceof Error) throw route;
    const headers = new Headers({ ...route.headers, ...(route.type === undefined ? {} : { "content-type": route.type }) });
    return { status: route.status, headers, text: async () => route.body ?? "" };
  });
}

const JS = "application/javascript; charset=utf-8";
const APP_PAGE = "<script>window.__reactRouterContext = {};</script>";
const LIVE: Record<string, Route> = {
  "/health": { status: 200 },
  "/": { status: 200, body: '<link rel="modulepreload" href="/assets/entry.client-AbC_1.js">' },
  "/assets/entry.client-AbC_1.js": { status: 200, type: JS },
  "/assets/createLucideIcon-Xy9.js": { status: 200, type: JS },
  "/assets/root-Q1.css": { status: 200, type: "text/css; charset=utf-8" },
  "/login": { status: 200, body: APP_PAGE },
};
const ASSET_URLS = ["/assets/createLucideIcon-Xy9.js", "/assets/entry.client-AbC_1.js", "/assets/root-Q1.css"]
  .map((path) => `${IDENTITY.baseUrl}${path}`);

// The waits verify makes other than the gaps between its /login checks.
function pollSleeps(sleep: { mock: { calls: unknown[][] } }): unknown[] {
  return sleep.mock.calls.map(([ms]) => ms).filter((ms) => ms !== APP_ANSWER_GAP_MS);
}

describe("waitForAppAnswers", () => {
  const login = `${IDENTITY.baseUrl}/login`;
  const app = { status: 200, body: APP_PAGE };
  const placeholder = { status: 404, body: `<title>Page not found</title><h1>${WORKERS_DEV_PLACEHOLDER}</h1>` };

  function answers(...replies: Array<Route | Error | string>) {
    return vi.fn(async (url: string) => {
      expect(url).toBe(login);
      const reply = replies.length > 1 ? replies.shift()! : replies[0]!;
      if (reply instanceof Error || typeof reply === "string") throw reply;
      return { status: reply.status, headers: new Headers(), text: async () => reply.body ?? "" };
    });
  }

  it("passes once the app answers five times in a row, about ten seconds apart in all", async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = answers(app);
    await waitForAppAnswers({ fetchImpl, now: () => 0, sleep, baseUrl: IDENTITY.baseUrl });
    expect(fetchImpl).toHaveBeenCalledTimes(APP_ANSWERS_IN_A_ROW);
    expect(sleep.mock.calls).toEqual(Array(APP_ANSWERS_IN_A_ROW - 1).fill([APP_ANSWER_GAP_MS]));
    expect((APP_ANSWERS_IN_A_ROW - 1) * APP_ANSWER_GAP_MS).toBe(10_000);
  });

  it("starts the count again after the placeholder, an error or a page without the app", async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = answers(app, app, placeholder, app, new Error("socket hang up"), app, { status: 200, body: "<html></html>" }, app);
    await waitForAppAnswers({ fetchImpl, now: () => 0, sleep, baseUrl: IDENTITY.baseUrl });
    expect(fetchImpl).toHaveBeenCalledTimes(7 + APP_ANSWERS_IN_A_ROW);
  });

  it.each([
    ["the placeholder", placeholder, "/login returned 404, Cloudflare's workers.dev placeholder"],
    ["an app error", { status: 500, body: APP_PAGE }, "/login returned 500"],
    ["a page without the app", { status: 200, body: "<html></html>" }, "/login answered without the app"],
    ["a dropped connection", new Error("socket hang up"), "/login failed: socket hang up"],
    ["a thrown string", "reset", "/login failed: reset"],
  ])("fails as a setup error when it keeps getting %s", async (_name, reply, reason) => {
    let clock = 0;
    const sleep = vi.fn(async (ms: number) => {
      clock += ms;
    });
    await expect(waitForAppAnswers({ fetchImpl: answers(reply), now: () => clock, sleep, baseUrl: IDENTITY.baseUrl, timeoutMs: 20_000 }))
      .rejects.toThrow(`Setup error, not a test failure: ${login} did not answer with the app ${APP_ANSWERS_IN_A_ROW} times in a row within 20 s: ${reason}.`);
  });

  it("opens a new connection for each request", async () => {
    const http = await import("node:http");
    const ports: number[] = [];
    const server = http.createServer((request, response) => {
      ports.push(request.socket.remotePort!);
      response.end(APP_PAGE);
    });
    await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
    try {
      const { port } = server.address() as { port: number };
      await waitForAppAnswers({ fetchImpl: fetch, now: () => 0, sleep: async () => {}, baseUrl: `http://127.0.0.1:${port}` });
      expect(new Set(ports).size).toBe(APP_ANSWERS_IN_A_ROW);
    } finally {
      server.close();
    }
  });
});

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
      ...ASSET_URLS,
      ...Array(APP_ANSWERS_IN_A_ROW).fill(`${IDENTITY.baseUrl}/login`),
    ]);
    expect(fetchImpl.mock.calls.at(-1)![1]).toEqual({ redirect: "manual", headers: { connection: "close" } });
  });

  it("waits until every built asset is live, re-fetching only the ones still missing", async () => {
    let lucideTries = 0;
    const live = site(LIVE);
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/assets/createLucideIcon-Xy9.js") && ++lucideTries < 3) {
        if (lucideTries === 1) throw new Error("socket hang up");
        throw "connection reset";
      }
      return live(url, init);
    });
    const sleep = vi.fn(async () => {});
    const log = vi.fn();
    await verify({ env: RUN_ENV, exec: verifyExec().exec, fs: scopedFiles().fs, fetchImpl, now: Date.now, sleep, log });

    expect(pollSleeps(sleep)).toHaveLength(2);
    const assetFetches = fetchImpl.mock.calls.map(([url]) => url).slice(3).filter((url) => !url.endsWith("/login"));
    expect(assetFetches).toEqual([...ASSET_URLS, ASSET_URLS[0], ASSET_URLS[0]]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("all 3 hashed assets live"));
  });

  it.each([
    ["a lazily loaded chunk keeps returning 404", { "/assets/createLucideIcon-Xy9.js": { status: 404 } }, "/assets/createLucideIcon-Xy9.js returned 404"],
    ["a script is served as HTML", { "/assets/createLucideIcon-Xy9.js": { status: 200, type: "text/html" } }, "/assets/createLucideIcon-Xy9.js was served as text/html"],
    ["a stylesheet has no content-type", { "/assets/root-Q1.css": { status: 200 } }, "/assets/root-Q1.css was served as no content-type"],
  ])("fails with a clear assets-not-live message when %s", async (_name, broken, reason) => {
    let clock = 0;
    const sleep = vi.fn(async (ms: number) => {
      clock += ms;
    });
    await expect(verify({ env: RUN_ENV, exec: verifyExec().exec, fs: scopedFiles().fs, fetchImpl: site({ ...LIVE, ...broken }), now: () => clock, sleep, log: vi.fn() }))
      .rejects.toThrow(`1 of 3 built assets not live on ${IDENTITY.baseUrl} after ${ASSETS_READY_TIMEOUT_MS / 1000} s: ${reason}.`);
    expect(clock).toBe(ASSETS_READY_TIMEOUT_MS);
  });

  it("lists at most five problems, fetches in bounded batches, and refuses a missing build", async () => {
    const files = scopedFiles();
    const routes: Record<string, Route> = { ...LIVE };
    for (let index = 0; index < 9; index += 1) files.store.set(`${CLIENT_ASSETS_DIR}/chunk-${index}.js`, "");
    let inFlight = 0;
    let peak = 0;
    const live = site(routes);
    const fetchImpl = vi.fn(async (url: string) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return live(url);
    });
    await expect(waitForBuiltAssets({ fs: files.fs, fetchImpl, now: () => 0, sleep: vi.fn(), baseUrl: IDENTITY.baseUrl, timeoutMs: 0 }))
      .rejects.toThrow(/^9 of 12 built assets not live .*chunk-4\.js returned 404; …\.$/);
    expect(peak).toBeLessThanOrEqual(ASSET_FETCH_CONCURRENCY);

    const empty = fakeFs();
    expect(() => builtAssetPaths(empty.fs)).toThrow(`${CLIENT_ASSETS_DIR} has no built assets; run the QA build before verify.`);
    expect(() => builtAssetPaths(fakeFs({ [`${CLIENT_ASSETS_DIR}/only-a-dir/x.js`]: "" }).fs)).toThrow(/no built assets/);
  });

  it("waits for a new hostname to come up", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      calls += 1;
      if (calls === 1) throw new Error("ENOTFOUND");
      if (calls === 2) throw "reset";
      return site(LIVE)(url);
    });
    const sleep = vi.fn(async () => {});
    await verify({ env: RUN_ENV, exec: verifyExec().exec, fs: scopedFiles().fs, fetchImpl, now: Date.now, sleep, log: vi.fn() });
    expect(pollSleeps(sleep)).toHaveLength(2);
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

  it("retries a brand-new Worker that Cloudflare does not know yet, then carries on", async () => {
    const notFound = Object.assign(new Error("Command failed: pnpm exec wrangler secret list"), {
      stderr: `✘ [ERROR] Worker "${IDENTITY.workerName}" (env: qa) not found.\n`,
    });
    const answers = verifyExec();
    const exec = vi.fn(answers.exec)
      .mockRejectedValueOnce(notFound)
      .mockRejectedValueOnce("This Worker does not exist on your account. [code: 10007]");
    const sleep = vi.fn(async () => {});
    await verify({ env: RUN_ENV, exec, fs: scopedFiles().fs, fetchImpl: site(LIVE), now: Date.now, sleep, log: vi.fn() });
    expect(pollSleeps(sleep)).toEqual([READY_POLL_MS, READY_POLL_MS]);
    expect(exec.mock.calls.map(([, args]) => args.slice(2, 4).join(" "))).toEqual([
      "secret list", "secret list", "secret list", "d1 migrations",
    ]);
  });

  it("fails as a setup error when Cloudflare still does not know the Worker after the readiness window", async () => {
    let clock = 0;
    const sleep = vi.fn(async (ms: number) => {
      clock += ms;
    });
    const exec = vi.fn(async (_file: string, args: string[]) => {
      if (args.includes("migrations")) {
        throw Object.assign(new Error("Command failed"), { stdout: "", stderr: `Worker "${IDENTITY.workerName}" (env: qa) not found.\n` });
      }
      return verifyExec().exec(_file, args);
    });
    await expect(verify({ env: RUN_ENV, exec, fs: scopedFiles().fs, fetchImpl: site(LIVE), now: () => clock, sleep, log: vi.fn() }))
      .rejects.toThrow(`Setup error, not a test failure: Cloudflare still did not know ${IDENTITY.workerName} ${READY_TIMEOUT_MS / 1000} s after deploy: Worker "${IDENTITY.workerName}" (env: qa) not found.`);
    expect(clock).toBe(READY_TIMEOUT_MS);
  });

  it("never retries a Cloudflare failure that is not a not-found", async () => {
    const exec = vi.fn(async () => {
      throw new Error("Authentication error [code: 10000]");
    });
    const sleep = vi.fn();
    await expect(verify({ env: RUN_ENV, exec, fs: scopedFiles().fs, fetchImpl: site(LIVE), now: Date.now, sleep, log: vi.fn() }))
      .rejects.toThrow("Authentication error [code: 10000]");
    expect(sleep).not.toHaveBeenCalled();
  });

  it("re-reads the secret list while it is still empty or partial right after deploy", async () => {
    const lists = [[], ["SESSION_SECRET"], REQUIRED_RUN_SECRETS];
    const live = verifyExec();
    const exec = vi.fn(async (file: string, args: string[]) => {
      if (args.slice(2).join(" ").startsWith("secret list")) {
        return { stdout: JSON.stringify(lists.shift()!.map((name) => ({ name, type: "secret_text" }))), stderr: "" };
      }
      return live.exec(file, args);
    });
    const sleep = vi.fn(async () => {});
    await verify({ env: RUN_ENV, exec, fs: scopedFiles().fs, fetchImpl: site(LIVE), now: Date.now, sleep, log: vi.fn() });
    expect(lists).toEqual([]);
    expect(pollSleeps(sleep)).toHaveLength(2);
  });

  it("fails on a missing secret or a pending migration", async () => {
    let clock = 0;
    const late = () => (clock += 10 * 60 * 1000);
    await expect(verify({ env: RUN_ENV, exec: verifyExec({ secrets: ["SESSION_SECRET"] }).exec, fs: scopedFiles().fs, fetchImpl: site(LIVE), now: late, sleep: vi.fn(), log: vi.fn() }))
      .rejects.toThrow("The run's Worker is missing secret(s): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.");
    await expect(verify({ env: RUN_ENV, exec: verifyExec({ migrations: "0029_x.sql pending" }).exec, fs: scopedFiles().fs, fetchImpl: site(LIVE), now: Date.now, log: vi.fn() }))
      .rejects.toThrow(/still has pending migrations/);
    const noJson = fakeExec({ "secret list": "Authentication error" });
    await expect(verify({ env: RUN_ENV, exec: noJson.exec, fs: scopedFiles().fs, fetchImpl: site(LIVE), now: Date.now, log: vi.fn() }))
      .rejects.toThrow(/no JSON results/);
    const nullRows = fakeExec({ "secret list": "[null]" });
    await expect(verify({ env: RUN_ENV, exec: nullRows.exec, fs: scopedFiles().fs, fetchImpl: site(LIVE), now: late, sleep: vi.fn(), log: vi.fn() }))
      .rejects.toThrow(/missing secret/);
  });

  it("refuses when wrangler.json no longer names this run's stack, or the state names a non-run stack", async () => {
    const files = scopedFiles();
    files.store.set(WRANGLER_CONFIG, JSON.stringify(REAL_WRANGLER));
    await expect(verify({ env: RUN_ENV, exec: verifyExec().exec, fs: files.fs, fetchImpl: site(LIVE), log: vi.fn() }))
      .rejects.toThrow(/does not name this run's QA stack/);

    const sharedQueue = scopedFiles();
    const config = JSON.parse(sharedQueue.store.get(WRANGLER_CONFIG) as string);
    config.env.qa.queues.producers[0].queue = "spoonjoy-jobs-qa";
    config.env.qa.queues.consumers[0].queue = "spoonjoy-jobs-qa";
    sharedQueue.store.set(WRANGLER_CONFIG, JSON.stringify(config));
    await expect(verify({ env: RUN_ENV, exec: verifyExec().exec, fs: sharedQueue.fs, fetchImpl: site(LIVE), log: vi.fn() }))
      .rejects.toThrow(/does not name this run's QA stack/);

    const wrongDb = scopedFiles({ databaseId: QA_D1_DATABASE_ID });
    await expect(verify({ env: RUN_ENV, exec: verifyExec().exec, fs: wrongDb.fs, fetchImpl: site(LIVE), log: vi.fn() }))
      .rejects.toThrow(/does not name this run's QA stack/);

    const shared = scopedFiles({ workerName: "spoonjoy-v2-qa" });
    await expect(verify({ env: RUN_ENV, exec: verifyExec().exec, fs: shared.fs, fetchImpl: site(LIVE), log: vi.fn() }))
      .rejects.toThrow(/Refusing to touch spoonjoy-v2-qa/);
  });
});

// Cloudflare's own static file serving answered 500 for a few built files of a freshly deployed run
// Worker, a different few each run, for the whole two-minute window (#1031).
const CF_500: Route = {
  status: 500,
  body: "<html>\n  <title>Worker threw exception</title>  Error 1101\n</html>",
  headers: { "cf-ray": "8f1e2d3c4b5a6979-IAD", "cf-cache-status": "DYNAMIC" },
};
const FRESH = {
  workerName: `${IDENTITY.workerName}-r2`,
  baseUrl: `https://${IDENTITY.workerName}-r2.mendelow-studio.workers.dev`,
};

describe("waitForBuiltAssets and Cloudflare's 500s", () => {
  it("logs each failing file's first answer once, with its cf-ray, cache status and the start of its body", async () => {
    let clock = 0;
    const log = vi.fn();
    const files = scopedFiles();
    await expect(waitForBuiltAssets({
      fs: files.fs,
      fetchImpl: site({ ...LIVE, "/assets/root-Q1.css": CF_500 }),
      now: () => clock,
      sleep: async (ms: number) => {
        clock += ms;
      },
      baseUrl: IDENTITY.baseUrl,
      log,
    })).rejects.toThrow(
      `1 of 3 built assets not live on ${IDENTITY.baseUrl} after ${ASSETS_READY_TIMEOUT_MS / 1000} s: /assets/root-Q1.css returned 500 (cf-ray 8f1e2d3c4b5a6979-IAD).`,
    );
    const notes = log.mock.calls.map(([line]) => line).filter((line) => line.includes("root-Q1.css"));
    expect(notes).toEqual([
      "/assets/root-Q1.css answered 500 (cf-ray 8f1e2d3c4b5a6979-IAD, cf-cache-status DYNAMIC): <html> <title>Worker threw exception</title> Error 1101 </html>",
    ]);
  });

  it("still logs a failing answer whose body cannot be read, and one with no Cloudflare headers", async () => {
    const log = vi.fn();
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("root-Q1.css")) return { status: 500, headers: new Headers(), text: async () => Promise.reject(new Error("aborted")) };
      return site(LIVE)(url);
    });
    await expect(waitForBuiltAssets({ fs: scopedFiles().fs, fetchImpl, now: () => 0, sleep: vi.fn(), baseUrl: IDENTITY.baseUrl, log, timeoutMs: 0 }))
      .rejects.toThrow("/assets/root-Q1.css returned 500.");
    expect(log).toHaveBeenCalledWith("/assets/root-Q1.css answered 500 (cf-ray none): ");
  });

  it("gives up early with the 5xx files once the grace window has passed, so verify can deploy again", async () => {
    let clock = 0;
    const sleep = vi.fn(async (ms: number) => {
      clock += ms;
    });
    const error = await waitForBuiltAssets({
      fs: scopedFiles().fs,
      fetchImpl: site({ ...LIVE, "/assets/root-Q1.css": CF_500 }),
      now: () => clock,
      sleep,
      baseUrl: IDENTITY.baseUrl,
      log: vi.fn(),
      serverErrorGraceMs: ASSET_SERVER_ERROR_GRACE_MS,
    }).catch((caught) => caught);
    expect(error).toBeInstanceOf(AssetServerErrors);
    expect(error.message).toBe(
      `1 of 3 built assets still answered a server error on ${IDENTITY.baseUrl} after ${ASSET_SERVER_ERROR_GRACE_MS / 1000} s: /assets/root-Q1.css returned 500 (cf-ray 8f1e2d3c4b5a6979-IAD).`,
    );
    expect(clock).toBe(ASSET_SERVER_ERROR_GRACE_MS);
  });

  it("keeps waiting the whole window for a 404, which has cleared on its own (#668)", async () => {
    let clock = 0;
    const error = await waitForBuiltAssets({
      fs: scopedFiles().fs,
      fetchImpl: site({ ...LIVE, "/assets/root-Q1.css": { status: 404 } }),
      now: () => clock,
      sleep: async (ms: number) => {
        clock += ms;
      },
      baseUrl: IDENTITY.baseUrl,
      log: vi.fn(),
      serverErrorGraceMs: ASSET_SERVER_ERROR_GRACE_MS,
    }).catch((caught) => caught);
    expect(error).not.toBeInstanceOf(AssetServerErrors);
    expect(clock).toBe(ASSETS_READY_TIMEOUT_MS);
  });

  it("passes when a 500 clears inside the grace window, without deploying again", async () => {
    let tries = 0;
    const live = site(LIVE);
    const broken = site({ ...LIVE, "/assets/root-Q1.css": CF_500 });
    const fetchImpl = vi.fn(async (url: string) => (url.endsWith("root-Q1.css") && ++tries < 3 ? broken(url) : live(url)));
    expect(await waitForBuiltAssets({
      fs: scopedFiles().fs, fetchImpl, now: Date.now, sleep: vi.fn(async () => {}), baseUrl: IDENTITY.baseUrl, log: vi.fn(), serverErrorGraceMs: ASSET_SERVER_ERROR_GRACE_MS,
    })).toBe(3);
  });
});

// The files and answers a verify that deploys again needs: the generated build config and the
// secrets file prepare wrote, the run's queue with its Worker as consumer, and a fetch that
// answers 500 for one built file on the old Worker's URL only.
function redeployFixture({ freshAlsoBroken = 0 } = {}) {
  const files = scopedFiles();
  files.store.set(GENERATED_BUILD_CONFIG, JSON.stringify(scopeGeneratedBuildConfig(generatedBuildConfig(), IDENTITY, RUN_DB_ID)));
  files.store.set(SECRETS_FILE, JSON.stringify({ SESSION_SECRET: "s", VAPID_PUBLIC_KEY: "p", VAPID_PRIVATE_KEY: "k", VAPID_SUBJECT: IDENTITY.baseUrl, POSTHOG_DISABLED: "1" }));
  const api = fakeApi({
    listQueues: vi.fn(async () => [{ queue_name: IDENTITY.queueName, queue_id: "run-queue" }]),
  });
  const broken = { ...LIVE, "/assets/root-Q1.css": CF_500 };
  let freshBroken = freshAlsoBroken;
  const fetchImpl = vi.fn(async (url: string) => {
    const fresh = url.match(/-r(\d)\.mendelow-studio\.workers\.dev/);
    if (!fresh) return site(broken)(url);
    const base = url.slice(0, url.indexOf(".workers.dev") + ".workers.dev".length);
    return site(freshBroken > 0 ? broken : LIVE, base)(url);
  });
  const sleep = vi.fn(async (ms: number) => {
    clock.at += ms;
  });
  const clock = { at: 0 };
  const exec = vi.fn(async (file: string, args: string[]) => {
    if (args[2] === "deploy") {
      freshBroken -= 1;
      return { stdout: "Deployed", stderr: "" };
    }
    return verifyExec().exec(file, args);
  });
  return { files, api, fetchImpl, sleep, exec, now: () => clock.at };
}

describe("verify after Cloudflare keeps answering 500 for a built file", () => {
  it("deploys the build again under a fresh Worker name, points the run at it, and passes", async () => {
    const { files, api, fetchImpl, sleep, exec, now } = redeployFixture();
    const log = vi.fn();
    const state = await verify({ env: RUN_ENV, exec, fs: files.fs, fetchImpl, now, sleep, log, api });

    expect(state).toMatchObject({ ...FRESH, databaseName: IDENTITY.databaseName, queueName: IDENTITY.queueName, retiredWorkers: [IDENTITY.workerName] });
    expect(files.json(STATE_FILE)).toMatchObject(FRESH);
    // The old Worker lets go of the run's queue and is deleted before the fresh one attaches to it.
    expect(api.deleteQueueConsumer.mock.calls).toEqual([["run-queue", "run-queue-consumer"]]);
    expect(api.deleteWorker.mock.calls).toEqual([[IDENTITY.workerName]]);
    const deployCall = exec.mock.calls.findIndex(([, args]) => args[2] === "deploy");
    expect(api.deleteWorker.mock.invocationCallOrder[0]).toBeLessThan(exec.mock.invocationCallOrder[deployCall]);
    expect(exec.mock.calls[deployCall][1]).toEqual(["exec", "wrangler", "deploy", "--env", "qa", "--secrets-file", SECRETS_FILE]);

    // Only the Worker's name and URL change, in both configs and the secrets' VAPID subject.
    const qa = files.json(WRANGLER_CONFIG).env.qa;
    expect(qa.name).toBe(FRESH.workerName);
    expect(qa.vars.SPOONJOY_BASE_URL).toBe(FRESH.baseUrl);
    assertOnlyIdentityChanged(scopeWranglerConfig(REAL_WRANGLER, IDENTITY, RUN_DB_ID).env.qa, qa);
    expect(qa.d1_databases.find((db: { binding: string }) => db.binding === "DB").database_id).toBe(RUN_DB_ID);
    const build = files.json(GENERATED_BUILD_CONFIG);
    expect([build.name, build.vars.SPOONJOY_BASE_URL]).toEqual([FRESH.workerName, FRESH.baseUrl]);
    expect(files.json(SECRETS_FILE)).toMatchObject({ SESSION_SECRET: "s", VAPID_SUBJECT: FRESH.baseUrl });

    // Later steps (the tail, the seed, the suite) read the fresh Worker from GITHUB_ENV.
    expect(files.appended).toEqual([[RUN_ENV.GITHUB_ENV, `SPOONJOY_JOURNEYS_BASE_URL=${FRESH.baseUrl}\nSPOONJOY_QA_RUN_WORKER=${FRESH.workerName}\n`]]);
    expect(fetchImpl.mock.calls.some(([url]) => url === `${FRESH.baseUrl}/assets/root-Q1.css`)).toBe(true);
    expect(log).toHaveBeenCalledWith(
      `::warning::Cloudflare kept answering a server error for built files of ${IDENTITY.workerName}: 1 of 3 built assets still answered a server error on ${IDENTITY.baseUrl} after ${ASSET_SERVER_ERROR_GRACE_MS / 1000} s: /assets/root-Q1.css returned 500 (cf-ray 8f1e2d3c4b5a6979-IAD). Deploying this build again as ${FRESH.workerName}, which uploads every file again.`,
    );
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining(`${FRESH.baseUrl} serves this build`));
  });

  it("still finishes when the old Worker cannot be deleted, leaving it for teardown", async () => {
    const { files, api, fetchImpl, sleep, exec, now } = redeployFixture();
    api.deleteWorker = vi.fn(async () => {
      throw new Error("worker 500");
    });
    const log = vi.fn();
    // A local run (and qa-hang-repro) has no GITHUB_ENV to point.
    const { GITHUB_ENV: _unset, ...env } = RUN_ENV;
    const state = await verify({ env, exec, fs: files.fs, fetchImpl, now, sleep, log, api });
    expect(files.appended).toEqual([]);
    expect(state.workerName).toBe(FRESH.workerName);
    expect(state.retiredWorkers).toEqual([IDENTITY.workerName]);
    expect(log).toHaveBeenCalledWith(`::warning::Could not delete ${IDENTITY.workerName} before deploying again (worker 500); teardown deletes it.`);
  });

  it(`deploys again at most ${MAX_ASSET_REDEPLOYS} times, then fails as a setup error with the files and their cf-ray`, async () => {
    const { files, api, fetchImpl, sleep, exec, now } = redeployFixture({ freshAlsoBroken: 99 });
    await expect(verify({ env: RUN_ENV, exec, fs: files.fs, fetchImpl, now, sleep, log: vi.fn(), api })).rejects.toThrow(
      `Setup error, not a test failure: built files still not served after ${MAX_ASSET_REDEPLOYS} fresh deploys of this build: 1 of 3 built assets not live on https://${IDENTITY.workerName}-r3.mendelow-studio.workers.dev after ${ASSETS_READY_TIMEOUT_MS / 1000} s: /assets/root-Q1.css returned 500 (cf-ray 8f1e2d3c4b5a6979-IAD).`,
    );
    expect(exec.mock.calls.filter(([, args]) => args[2] === "deploy")).toHaveLength(MAX_ASSET_REDEPLOYS);
    expect(api.deleteWorker.mock.calls).toEqual([[IDENTITY.workerName], [`${IDENTITY.workerName}-r2`]]);
    expect(files.json(STATE_FILE).retiredWorkers).toEqual([IDENTITY.workerName, `${IDENTITY.workerName}-r2`]);
  });

  it("never deploys again for a 404 or a wrong content-type", async () => {
    const { files, api, sleep, exec, now } = redeployFixture();
    const fetchImpl = site({ ...LIVE, "/assets/root-Q1.css": { status: 404 } });
    await expect(verify({ env: RUN_ENV, exec, fs: files.fs, fetchImpl, now, sleep, log: vi.fn(), api })).rejects.toThrow(/1 of 3 built assets not live .* returned 404\.$/);
    expect(api.deleteWorker).not.toHaveBeenCalled();
    expect(exec.mock.calls.some(([, args]) => args.includes("deploy"))).toBe(false);
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

  // After a 10007 the script exists with its Durable Object migrations applied, but Cloudflare's
  // reads can lag: the next deploy then sends the migrations again and is refused (code 10079).
  const migrationTagLag = Object.assign(new Error("Command failed: pnpm exec wrangler deploy"), {
    stdout: "",
    stderr: "A request to the Cloudflare API (/accounts/x/workers/scripts/spoonjoy-v2-qa-run-1001-2) failed.\n  Actor migration tag precondition failed, got tag '' when expected tag is 'v1_cook_session'. Please make sure the tags match and try again. [code: 10079]\n",
  });

  it("deploys again when a retry finds the half-made script's migrations already applied (code 10079)", async () => {
    const exec = vi.fn()
      .mockRejectedValueOnce(notFound)
      .mockRejectedValueOnce(migrationTagLag)
      .mockResolvedValueOnce({ stdout: "Deployed\n", stderr: "" });
    const sleep = vi.fn(async () => {});
    const log = vi.fn();
    expect(await deploy({ env: RUN_ENV, exec, fs: scopedFiles().fs, sleep, log })).toBe(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual(DEPLOY_RETRY_DELAYS_MS.slice(0, 2));
    expect(log).toHaveBeenCalledWith(`::warning::Cloudflare had not yet caught up with ${IDENTITY.workerName}'s Durable Object migrations (code 10079); deploying again in 15 s.`);
    expect(log).toHaveBeenLastCalledWith("Deployed\n");
  });

  // Seen on PR Journeys run 45181160164: after a 10007, wrangler failed reading the half-made
  // script's migration tag.
  const migrationTagReadFailure = Object.assign(new Error("Command failed: pnpm exec wrangler deploy"), {
    stdout: "",
    stderr: "✘ [ERROR] Cannot read properties of null (reading 'tag')\n",
  });

  it("deploys again when wrangler cannot yet read the half-made script's migration tag", async () => {
    const exec = vi.fn()
      .mockRejectedValueOnce(notFound)
      .mockRejectedValueOnce(migrationTagReadFailure)
      .mockResolvedValueOnce({ stdout: "Deployed\n", stderr: "" });
    const sleep = vi.fn(async () => {});
    const log = vi.fn();
    expect(await deploy({ env: RUN_ENV, exec, fs: scopedFiles().fs, sleep, log })).toBe(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual(DEPLOY_RETRY_DELAYS_MS.slice(0, 2));
    expect(log).toHaveBeenCalledWith(`::warning::Wrangler could not read ${IDENTITY.workerName}'s Durable Object migration tag while Cloudflare catches up; deploying again in 15 s.`);
    expect(log).toHaveBeenLastCalledWith("Deployed\n");
  });

  it("does not retry a migration tag read failure on a first deploy", async () => {
    const exec = vi.fn().mockRejectedValueOnce(migrationTagReadFailure);
    const sleep = vi.fn(async () => {});
    await expect(deploy({ env: RUN_ENV, exec, fs: scopedFiles().fs, sleep, log: vi.fn() })).rejects.toBe(migrationTagReadFailure);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("does not retry a migration tag refusal on a first deploy", async () => {
    const exec = vi.fn().mockRejectedValueOnce(migrationTagLag);
    const sleep = vi.fn(async () => {});
    await expect(deploy({ env: RUN_ENV, exec, fs: scopedFiles().fs, sleep, log: vi.fn() })).rejects.toBe(migrationTagLag);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  const internalAuthServerError = Object.assign(new Error("Command failed: pnpm exec wrangler deploy"), {
    stdout: "",
    stderr: "A request to the Cloudflare API (/accounts/x/workers/scripts) failed.\n  Internal authentication error: internal server error [code: 10500]\n",
  });

  it("bounds retries of the same run's deploy after the observed internal server response", async () => {
    const exec = vi.fn()
      .mockRejectedValueOnce(internalAuthServerError)
      .mockResolvedValueOnce({ stdout: "Deployed\n", stderr: "" });
    const sleep = vi.fn(async () => {});
    const log = vi.fn();

    expect(await deploy({ env: RUN_ENV, exec, fs: scopedFiles().fs, sleep, log })).toBe(2);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual(DEPLOY_RETRY_DELAYS_MS.slice(0, 1));
    expect(exec.mock.calls).toEqual([
      ["pnpm", ["exec", "wrangler", "deploy", "--env", "qa", "--secrets-file", SECRETS_FILE], { maxBuffer: 64 * 1024 * 1024 }],
      ["pnpm", ["exec", "wrangler", "deploy", "--env", "qa", "--secrets-file", SECRETS_FILE], { maxBuffer: 64 * 1024 * 1024 }],
    ]);
    expect(log).toHaveBeenCalledWith(internalAuthServerError.stderr);
    expect(log).toHaveBeenCalledWith(`::warning::Cloudflare reported an internal authentication server error (code 10500) while deploying ${IDENTITY.workerName}; deploying again in 5 s.`);
    expect(log).toHaveBeenLastCalledWith("Deployed\n");
  });

  const failedDeploy = (stderr: string) =>
    Object.assign(new Error("Command failed: pnpm exec wrangler deploy"), { stdout: "", stderr });

  it.each([
    [
      "a lost API connection",
      "✘ [ERROR] fetch failed\n\n  TypeError: fetch failed\n  [cause]: Error: read ECONNRESET\n",
      `The connection to Cloudflare's API failed while deploying ${IDENTITY.workerName}`,
    ],
    [
      "an API socket that closed",
      "✘ [ERROR] other side closed\n  code: 'UND_ERR_SOCKET'\n",
      `The connection to Cloudflare's API failed while deploying ${IDENTITY.workerName}`,
    ],
    [
      "an API server error page",
      "✘ [ERROR] Received a malformed response from the API\n\n  <html><head><title>502 Bad Gateway</title></head>\n  PUT /accounts/x/workers/scripts/spoonjoy-v2-qa-run-1001-2 -> 502 Bad Gateway\n",
      `Cloudflare's API answered 502 while deploying ${IDENTITY.workerName}`,
    ],
  ])("deploys again after %s, and then accepts the migrations the first try applied", async (_case, stderr, reason) => {
    const exec = vi.fn()
      .mockRejectedValueOnce(failedDeploy(stderr))
      .mockRejectedValueOnce(migrationTagLag)
      .mockResolvedValueOnce({ stdout: "Deployed\n", stderr: "" });
    const sleep = vi.fn(async () => {});
    const log = vi.fn();

    expect(await deploy({ env: RUN_ENV, exec, fs: scopedFiles().fs, sleep, log })).toBe(3);
    expect(log).toHaveBeenCalledWith(`::warning::${reason}; deploying again in 5 s.`);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual(DEPLOY_RETRY_DELAYS_MS.slice(0, 2));
  });

  // Seen on merge-queue Journeys run 45176389392: the script was uploaded, then enabling its
  // workers.dev subdomain failed with Cloudflare's "unknown error".
  const subdomainUnknownError = failedDeploy(
    "✘ [ERROR] A request to the Cloudflare API (/accounts/x/workers/scripts/spoonjoy-v2-qa-run-1001-2/subdomain) failed.\n\n  An unknown error has occurred. If this error persists, please file a report in workers-sdk (https://github.com/cloudflare/workers-sdk/issues) or reach out to your account team. [code: 10013]\n",
  );

  it("deploys again after Cloudflare's unknown error on the subdomain (code 10013), and then accepts the migrations the first try applied", async () => {
    const exec = vi.fn()
      .mockRejectedValueOnce(subdomainUnknownError)
      .mockRejectedValueOnce(migrationTagLag)
      .mockResolvedValueOnce({ stdout: "Deployed\n", stderr: "" });
    const sleep = vi.fn(async () => {});
    const log = vi.fn();

    expect(await deploy({ env: RUN_ENV, exec, fs: scopedFiles().fs, sleep, log })).toBe(3);
    expect(log).toHaveBeenCalledWith(`::warning::Cloudflare answered an unknown error (code 10013) while enabling ${IDENTITY.workerName}'s workers.dev subdomain; deploying again in 5 s.`);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual(DEPLOY_RETRY_DELAYS_MS.slice(0, 2));
  });

  // Seen on #971's Journeys run 45350953066 during a Cloudflare incident: the script was uploaded,
  // then attaching it to its queue as a consumer failed with Cloudflare's "unknown error".
  const queueConsumerUnknownError = failedDeploy(
    "✘ [ERROR] A request to the Cloudflare API (/accounts/x/queues/2607af360573453dae03ba76b8da654f/consumers) failed.\n\n  An unknown error has occurred. If this error persists, please file a report in workers-sdk (https://github.com/cloudflare/workers-sdk/issues) or reach out to your account team. [code: 10013]\n",
  );

  it("deploys again after Cloudflare's unknown error on the queue consumer (code 10013), and then accepts the migrations the first try applied", async () => {
    const exec = vi.fn()
      .mockRejectedValueOnce(queueConsumerUnknownError)
      .mockRejectedValueOnce(migrationTagLag)
      .mockResolvedValueOnce({ stdout: "Deployed\n", stderr: "" });
    const sleep = vi.fn(async () => {});
    const log = vi.fn();

    expect(await deploy({ env: RUN_ENV, exec, fs: scopedFiles().fs, sleep, log })).toBe(3);
    expect(log).toHaveBeenCalledWith(`::warning::Cloudflare answered an unknown error (code 10013) while attaching ${IDENTITY.workerName} to its queue; deploying again in 5 s.`);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual(DEPLOY_RETRY_DELAYS_MS.slice(0, 2));
  });

  // Seen on #1037's Journeys run 45487087615: the script was uploaded, then looking up the
  // account's queues (to find the run's queue by name) failed with Cloudflare's "unknown error".
  const queueLookupUnknownError = failedDeploy(
    "✘ [ERROR] A request to the Cloudflare API (/accounts/x/queues) failed.\n\n  An unknown error has occurred. If this error persists, please file a report in workers-sdk (https://github.com/cloudflare/workers-sdk/issues) or reach out to your account team. [code: 10013]\n",
  );

  it("deploys again after Cloudflare's unknown error while looking up the queues (code 10013), and then accepts the migrations the first try applied", async () => {
    const exec = vi.fn()
      .mockRejectedValueOnce(queueLookupUnknownError)
      .mockRejectedValueOnce(migrationTagLag)
      .mockResolvedValueOnce({ stdout: "Deployed\n", stderr: "" });
    const sleep = vi.fn(async () => {});
    const log = vi.fn();

    expect(await deploy({ env: RUN_ENV, exec, fs: scopedFiles().fs, sleep, log })).toBe(3);
    expect(log).toHaveBeenCalledWith(`::warning::Cloudflare answered an unknown error (code 10013) while looking up ${IDENTITY.workerName}'s queue; deploying again in 5 s.`);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual(DEPLOY_RETRY_DELAYS_MS.slice(0, 2));
  });

  // Seen on #971's Journeys run 45350953066 (attempt 2): uploading the run's script failed with
  // Cloudflare's "unknown error" (code 10002).
  const scriptUploadUnknownError = failedDeploy(
    "✘ [ERROR] A request to the Cloudflare API (/accounts/x/workers/scripts/spoonjoy-v2-qa-run-1001-2) failed.\n\n  An unknown error has occurred. If this error persists, please file a report in the workers-sdk GitHub repository (https://github.com/cloudflare/workers-sdk/issues) or reach out to your account team. [code: 10002]\n",
  );

  it("deploys again after Cloudflare's unknown error on the script upload (code 10002), and then accepts the migrations the first try applied", async () => {
    const exec = vi.fn()
      .mockRejectedValueOnce(scriptUploadUnknownError)
      .mockRejectedValueOnce(migrationTagLag)
      .mockResolvedValueOnce({ stdout: "Deployed\n", stderr: "" });
    const sleep = vi.fn(async () => {});
    const log = vi.fn();

    expect(await deploy({ env: RUN_ENV, exec, fs: scopedFiles().fs, sleep, log })).toBe(3);
    expect(log).toHaveBeenCalledWith(`::warning::Cloudflare answered an unknown error (code 10002) while uploading ${IDENTITY.workerName}; deploying again in 5 s.`);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual(DEPLOY_RETRY_DELAYS_MS.slice(0, 2));
  });

  it("stops deploying again after a bounded number of script upload unknown errors", async () => {
    const exec = vi.fn().mockRejectedValue(scriptUploadUnknownError);
    const sleep = vi.fn(async () => {});

    await expect(deploy({ env: RUN_ENV, exec, fs: scopedFiles().fs, sleep, log: vi.fn() })).rejects.toBe(scriptUploadUnknownError);
    expect(exec).toHaveBeenCalledTimes(DEPLOY_RETRY_DELAYS_MS.length + 1);
  });

  it("stops deploying again after a bounded number of queue lookup unknown errors", async () => {
    const exec = vi.fn().mockRejectedValue(queueLookupUnknownError);
    const sleep = vi.fn(async () => {});

    await expect(deploy({ env: RUN_ENV, exec, fs: scopedFiles().fs, sleep, log: vi.fn() })).rejects.toBe(queueLookupUnknownError);
    expect(exec).toHaveBeenCalledTimes(DEPLOY_RETRY_DELAYS_MS.length + 1);
  });

  it("stops deploying again after a bounded number of subdomain unknown errors", async () => {
    const exec = vi.fn().mockRejectedValue(subdomainUnknownError);
    const sleep = vi.fn(async () => {});

    await expect(deploy({ env: RUN_ENV, exec, fs: scopedFiles().fs, sleep, log: vi.fn() })).rejects.toBe(subdomainUnknownError);
    expect(exec).toHaveBeenCalledTimes(DEPLOY_RETRY_DELAYS_MS.length + 1);
  });

  it.each([
    ["a build error", "✘ [ERROR] Build failed with 1 error:\n  app/entry.ts:1:7: ERROR: Expected \";\" but found \"x\"\n"],
    ["a config error", "✘ [ERROR] Processing wrangler.json configuration:\n  - \"env.qa.d1_databases[0]\" bindings should have a string \"database_id\" field.\n"],
    ["an API error with a JSON answer", "A request to the Cloudflare API (/accounts/x/workers/scripts/spoonjoy-v2-qa-run-1001-2) failed.\n  Script startup exceeded CPU time limit. [code: 10021]\n"],
    ["an unknown error (code 10013) on a request other than the subdomain", "A request to the Cloudflare API (/accounts/x/workers/scripts/spoonjoy-v2-qa-run-1001-2) failed.\n  An unknown error has occurred. [code: 10013]\n"],
    ["another error on the queue consumer", "A request to the Cloudflare API (/accounts/x/queues/q/consumers) failed.\n  Queue not found [code: 11000]\n"],
    ["another error while looking up the queues", "A request to the Cloudflare API (/accounts/x/queues) failed.\n  Authentication error [code: 10000]\n"],
    ["an unknown error (code 10002) on a request other than the script upload", "A request to the Cloudflare API (/accounts/x/workers/scripts/spoonjoy-v2-qa-run-1001-2/secrets) failed.\n  An unknown error has occurred. [code: 10002]\n"],
    ["an unknown error (code 10013) on one queue's own request","A request to the Cloudflare API (/accounts/x/queues/q) failed.\n  An unknown error has occurred. [code: 10013]\n"],
    ["another error on the subdomain", "A request to the Cloudflare API (/accounts/x/workers/scripts/spoonjoy-v2-qa-run-1001-2/subdomain) failed.\n  Forbidden [code: 10001]\n"],
    ["an API client error page", "✘ [ERROR] Received a malformed response from the API\n  PUT /accounts/x/workers/scripts/y -> 413 Payload Too Large\n"],
    ["an API 501", "✘ [ERROR] Received a malformed response from the API\n  PUT /accounts/x/workers/scripts/y -> 501 Not Implemented\n"],
    ["an app log line that mentions a failed fetch", "✘ [ERROR] Uncaught Error: Image fetch failed\n  at app/lib/safe-image-fetch.server.ts\n"],
  ])("never deploys again after %s", async (_case, stderr) => {
    const error = failedDeploy(stderr);
    const exec = vi.fn().mockRejectedValueOnce(error);
    const sleep = vi.fn(async () => {});

    await expect(deploy({ env: RUN_ENV, exec, fs: scopedFiles().fs, sleep, log: vi.fn() })).rejects.toBe(error);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("stops deploying again after a bounded number of lost connections", async () => {
    const error = failedDeploy("TypeError: fetch failed\n");
    const exec = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn(async () => {});

    await expect(deploy({ env: RUN_ENV, exec, fs: scopedFiles().fs, sleep, log: vi.fn() })).rejects.toBe(error);
    expect(exec).toHaveBeenCalledTimes(DEPLOY_RETRY_DELAYS_MS.length + 1);
  });

  it("preserves an exhausted internal server error instead of reporting a successful deploy", async () => {
    const exec = vi.fn().mockRejectedValue(internalAuthServerError);
    const sleep = vi.fn(async () => {});
    const log = vi.fn();

    await expect(deploy({ env: RUN_ENV, exec, fs: scopedFiles().fs, sleep, log })).rejects.toBe(internalAuthServerError);
    expect(exec).toHaveBeenCalledTimes(DEPLOY_RETRY_DELAYS_MS.length + 1);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual(DEPLOY_RETRY_DELAYS_MS);
    expect(log.mock.calls.filter(([line]) => line === internalAuthServerError.stderr)).toHaveLength(DEPLOY_RETRY_DELAYS_MS.length + 1);
  });

  it.each([
    "Authentication error [code: 10000]",
    "Internal authentication error: internal server error [code: 10000]",
    "Authentication error [code: 10500]",
    "Internal authentication error: permission denied [code: 10500]",
    "Internal authentication error: internal server error [code: 10501]",
    "Forbidden [code: 10001]",
    "Build failed",
  ])("does not retry a nonmatching response: %s", async (stderr) => {
    const error = Object.assign(new Error("deploy failed"), { stderr });
    const exec = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn();
    const log = vi.fn();

    await expect(deploy({ env: RUN_ENV, exec, fs: scopedFiles().fs, sleep, log })).rejects.toBe(error);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(stderr);
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

describe("ensureSharedQueue", () => {
  it("creates shared QA's jobs queue only when it is missing", async () => {
    const missing = fakeApi({ listQueues: vi.fn(async () => [{ queue_name: IDENTITY.queueName, queue_id: "a-run" }]) });
    const log = vi.fn();
    expect(await ensureSharedQueue({ env: RUN_ENV, api: missing, log })).toBe(true);
    expect(missing.createQueue.mock.calls).toEqual([[SHARED_QA_QUEUE]]);
    expect(log).toHaveBeenCalledWith(`Created shared QA's jobs queue ${SHARED_QA_QUEUE}.`);

    const present = fakeApi({ listQueues: vi.fn(async () => [{ queue_name: SHARED_QA_QUEUE, queue_id: "shared" }]) });
    const log2 = vi.fn();
    expect(await ensureSharedQueue({ env: RUN_ENV, api: present, log: log2 })).toBe(false);
    expect(present.createQueue).not.toHaveBeenCalled();
    expect(log2).toHaveBeenCalledWith(`Shared QA's jobs queue ${SHARED_QA_QUEUE} is already there.`);
    expect(SHARED_QA_QUEUE).toBe("spoonjoy-jobs-qa");
  });

  it("refuses to run outside GitHub Actions", async () => {
    await expect(ensureSharedQueue({ env: { ...RUN_ENV, GITHUB_ACTIONS: "false" }, api: fakeApi(), log: vi.fn() })).rejects.toThrow(/GitHub Actions/);
  });
});

describe("teardown", () => {
  it("deletes this run's jobs queue, then its Worker and the database prepare recorded, by id, and its local state", async () => {
    const api = fakeApi({
      listQueues: vi.fn(async () => [
        { queue_name: `${IDENTITY.queueName}0`, queue_id: "longer-name" },
        { queue_name: IDENTITY.queueName, queue_id: "run-queue" },
      ]),
    });
    const files = scopedFiles();
    const log = vi.fn();

    expect(await teardown({ env: RUN_ENV, fs: files.fs, api, log })).toBe(true);
    expect(api.deleteWorker.mock.calls).toEqual([[IDENTITY.workerName]]);
    expect(api.deleteDatabase.mock.calls).toEqual([[RUN_DB_ID]]);
    expect(api.deleteQueue.mock.calls).toEqual([["run-queue"]]);
    expect(api.deleteQueueConsumer.mock.calls).toEqual([["run-queue", "run-queue-consumer"]]);
    expect(api.deleteQueueConsumer.mock.invocationCallOrder[0]).toBeLessThan(api.deleteWorker.mock.invocationCallOrder[0]);
    expect(api.deleteWorker.mock.invocationCallOrder[0]).toBeLessThan(api.deleteQueue.mock.invocationCallOrder[0]);
    expect(log).toHaveBeenCalledWith(`Deleted QA run jobs queue ${IDENTITY.queueName}.`);
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
      `::warning::Nothing to delete for part of this run's QA stack: no jobs queue named ${IDENTITY.queueName} existed; no Worker named ${IDENTITY.workerName} existed; no database named ${IDENTITY.databaseName} existed.`,
    );

    const alreadyDeleted = fakeApi({
      deleteDatabase: gone.deleteDatabase,
      deleteQueue: gone.deleteQueue,
      listQueueConsumers: gone.listQueueConsumers,
      listQueues: vi.fn(async () => [{ queue_name: IDENTITY.queueName, queue_id: "run-queue" }]),
    });
    const log2 = vi.fn();
    expect(await teardown({ env: RUN_ENV, fs: scopedFiles().fs, api: alreadyDeleted, log: log2 })).toBe(true);
    expect(log2).toHaveBeenCalledWith(
      `::warning::Nothing to delete for part of this run's QA stack: jobs queue ${IDENTITY.queueName} was already deleted; database ${IDENTITY.databaseName} (${RUN_DB_ID}) was already deleted.`,
    );
  });

  it("warns instead of failing when its queue can't be deleted, after the Worker is gone", async () => {
    const api = fakeApi({
      listQueues: vi.fn(async () => [{ queue_name: IDENTITY.queueName, queue_id: "run-queue" }]),
      deleteQueue: vi.fn(async () => {
        throw new Error("queue 500");
      }),
    });
    const log = vi.fn();
    expect(await teardown({ env: RUN_ENV, fs: scopedFiles().fs, api, log })).toBe(false);
    expect(api.deleteWorker).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Could not fully delete this run's QA stack (queue 500)"));
  });

  it("warns instead of failing when deletion fails, so the sweep can finish it later", async () => {
    const api = fakeApi({
      deleteWorker: vi.fn(async () => {
        throw new Error("worker 500");
      }),
      listDatabases: vi.fn(async () => {
        throw new Error("d1 500");
      }),
      listQueues: vi.fn(async () => {
        throw new Error("queues 500");
      }),
    });
    const log = vi.fn();
    expect(await teardown({ env: RUN_ENV, fs: fakeFs().fs, api, log })).toBe(false);
    expect(log).toHaveBeenCalledWith(
      "::warning::Could not fully delete this run's QA stack (queues 500; worker 500; d1 500). The scheduled sweep deletes it once it is 3 hours old.",
    );
  });

  it("deletes the Worker verify deployed again and any it could not delete, never another run's", async () => {
    const api = fakeApi();
    const files = scopedFiles({ ...FRESH, retiredWorkers: [IDENTITY.workerName, "spoonjoy-v2-qa-run-9-9", "spoonjoy-v2-qa"] });
    const log = vi.fn();
    expect(await teardown({ env: RUN_ENV, fs: files.fs, api, log })).toBe(true);
    expect(api.deleteWorker.mock.calls).toEqual([[FRESH.workerName], [IDENTITY.workerName]]);
    expect(log).toHaveBeenCalledWith(`Deleted QA run Worker ${FRESH.workerName}.`);

    // An old Worker verify already deleted is not worth a warning.
    const gone = notFoundApi();
    const log2 = vi.fn();
    const api2 = fakeApi({ deleteWorker: vi.fn(async (name: string) => (name === FRESH.workerName ? { success: true } : gone.deleteWorker(name))) });
    expect(await teardown({ env: RUN_ENV, fs: scopedFiles({ ...FRESH, retiredWorkers: [IDENTITY.workerName] }).fs, api: api2, log: log2 })).toBe(true);
    expect(log2.mock.calls.flat().join("\n")).not.toContain(`no Worker named ${IDENTITY.workerName}`);

    // A replaced Worker that can't be deleted is left for the sweep, like any other part.
    const api3 = fakeApi({ deleteWorker: vi.fn(async (name: string) => {
      if (name === IDENTITY.workerName) throw new Error("old worker 500");
      return { success: true };
    }) });
    const log3 = vi.fn();
    expect(await teardown({ env: RUN_ENV, fs: scopedFiles({ ...FRESH, retiredWorkers: [IDENTITY.workerName] }).fs, api: api3, log: log3 })).toBe(false);
    expect(log3).toHaveBeenCalledWith(expect.stringContaining("Could not fully delete this run's QA stack (old worker 500)"));

    // A state file it can't read leaves the plain name.
    const api4 = fakeApi({ listDatabases: vi.fn(async () => []) });
    await teardown({ env: RUN_ENV, fs: fakeFs({ [STATE_FILE]: "{not json" }).fs, api: api4, log: vi.fn() });
    expect(api4.deleteWorker.mock.calls).toEqual([[IDENTITY.workerName]]);
  });

  it("refuses to run outside GitHub Actions", async () => {
    await expect(teardown({ env: { ...RUN_ENV, GITHUB_ACTIONS: "false" }, fs: fakeFs().fs, api: fakeApi(), log: vi.fn() })).rejects.toThrow(/GitHub Actions/);
  });
});

describe("local runs (SPOONJOY_QA_LOCAL_RUN=1)", () => {
  const LOCAL_ENV = {
    SPOONJOY_QA_LOCAL_RUN: "1",
    GITHUB_RUN_ID: "1001",
    GITHUB_RUN_ATTEMPT: "2",
    CLOUDFLARE_API_TOKEN: "token",
    CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  };
  const secrets = () => ({ SESSION_SECRET: "s3cret", VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: IDENTITY.baseUrl, POSTHOG_DISABLED: "1" });

  it("prepares and tears down the same per-run stack it would in CI, and exports nothing to GITHUB_ENV", async () => {
    const files = fakeFs(preparedFiles());
    const api = fakeApi();
    const state = await prepare({ env: LOCAL_ENV, fs: files.fs, api, now: Date.now, log: vi.fn(), secrets });

    expect(state).toEqual({ ...IDENTITY, databaseId: RUN_DB_ID });
    expect(files.json(WRANGLER_CONFIG).env.qa.name).toBe(IDENTITY.workerName);
    expect(files.appended).toEqual([]);

    expect(await teardown({ env: LOCAL_ENV, fs: files.fs, api, log: vi.fn() })).toBe(true);
    expect(api.deleteWorker).toHaveBeenCalledWith(IDENTITY.workerName);
    expect(api.deleteDatabase).toHaveBeenCalledWith(RUN_DB_ID);
  });

  it("still refuses a config that does not name shared QA, and a run id that is not a number", async () => {
    const production = structuredClone(REAL_WRANGLER);
    production.env.qa.vars.SPOONJOY_BASE_URL = "https://spoonjoy.app";
    const api = fakeApi();
    await expect(
      prepare({ env: LOCAL_ENV, fs: fakeFs({ ...preparedFiles(), [WRANGLER_CONFIG]: JSON.stringify(production) }).fs, api, now: Date.now, log: vi.fn(), secrets }),
    ).rejects.toThrow(/does not target/);
    await expect(
      prepare({ env: { ...LOCAL_ENV, GITHUB_RUN_ID: "mine" }, fs: fakeFs(preparedFiles()).fs, api, now: Date.now, log: vi.fn(), secrets }),
    ).rejects.toThrow(/whole numbers/);
    expect(api.createDatabase).not.toHaveBeenCalled();
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
    files.store.set(`${CLIENT_ASSETS_DIR}/entry.client-AbC_1.js`, "");
    await main(["verify"], { env: RUN_ENV, exec: verifyExec().exec, fs: files.fs, fetchImpl: site(LIVE), log, sleep: vi.fn(async () => {}) });
    expect(await main(["teardown"], { env: RUN_ENV, fs: files.fs, api, log })).toBe(true);
    expect(await main(["sweep"], { env: RUN_ENV, api, log })).toEqual({ swept: 0, remainingRunWorkers: 0 });
    expect(await main(["shared-queue"], { env: RUN_ENV, api, log })).toBe(true);
    expect(api.createQueue).toHaveBeenLastCalledWith(SHARED_QA_QUEUE);
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
    expect(Object.keys(workflow.jobs).sort()).toEqual(["changes", "deploy-shared-qa", "fork-notice", "journeys", "journeys-result", "queue-tested"]);
    // The only jobs journeys waits for are the cheap scope and merge-queue lookups, never a QA turn or lock.
    expect(journeys.needs).toEqual(["queue-tested", "changes"]);
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
      "Put the sample cover images in QA's photo bucket",
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
    expect(report.run).toContain('node scripts/count-cloudflare-requests.mjs summary "$SPOONJOY_CF_REQUEST_LOG"');
  });

  it("migrates the run's empty database itself and never exports or copies shared QA", () => {
    const text = readFileSync(resolve(ROOT, ".github/workflows/journeys.yml"), "utf8");
    expect(text).not.toMatch(/d1 export/);
    expect(step("Migrate this run's QA database").run).toBe("node scripts/retry-cloudflare.mjs -- pnpm run qa:migrate");
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
      "Put the sample cover images in QA's photo bucket",
      "Show how QA's photo bucket aborts unfinished uploads",
      "Start QA Worker tail",
      "Seed the QA kitchen",
      "Run test suite",
      "Rotate persona passwords",
      "Clean up disposable QA data",
      "Delete this run's QA stack",
    ]);
    // Every one of those steps also logs its Cloudflare API requests, to the log the job's first
    // step points into the container (the job runs in Playwright's image).
    for (const name of withToken) {
      expect(step(name!).env, name).toMatchObject({ NODE_OPTIONS: "${{ env.SPOONJOY_CF_REQUEST_COUNTER }}" });
    }
    expect(steps[1].name).toBe("Point the shared paths into the container");
    expect(steps[1].run).toContain('echo "SPOONJOY_CF_REQUEST_COUNTER=--import $GITHUB_WORKSPACE/scripts/count-cloudflare-requests.mjs"');
    expect(steps[1].run).toContain('echo "SPOONJOY_CF_REQUEST_LOG=$RUNNER_TEMP/cloudflare-requests.log"');
    expect(steps[1].run).toContain('echo "SPOONJOY_QA_CREDENTIALS=$GITHUB_WORKSPACE/.journeys/credentials.json"');
  });

  it("skips a pull request's suite only on an explicit no from the scope check, which never runs outside pull requests", () => {
    // `!= 'false'`: a failed or missing scope answer runs the suite.
    expect(journeys.if).toContain("needs.changes.outputs.journeys != 'false'");
    const changes = workflow.jobs.changes;
    expect(changes.if).toBe("github.event_name == 'pull_request'");
    expect(changes.permissions).toEqual({ contents: "read", "pull-requests": "read" });
    expect(changes.outputs).toEqual({
      journeys: "${{ steps.scope.outputs.journeys }}",
      mode: "${{ steps.scope.outputs.mode }}",
      census: "${{ steps.scope.outputs.census }}",
      specs: "${{ steps.scope.outputs.specs }}",
      parts: "${{ steps.scope.outputs.parts }}",
    });
    // The base branch's copy of the script decides, so a pull request cannot widen the list for its
    // own run, and the job never sees a secret.
    expect(changes.steps).toEqual([
      {
        uses: "actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10",
        with: {
          ref: "${{ github.event.pull_request.base.sha }}",
          "sparse-checkout": "scripts/journeys-scope.mjs",
          "sparse-checkout-cone-mode": false,
          "persist-credentials": false,
        },
      },
      { uses: "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38", with: { "node-version": "22" } },
      {
        name: "Decide whether this pull request needs the suite",
        id: "scope",
        env: {
          GH_TOKEN: "${{ github.token }}",
          PR_NUMBER: "${{ github.event.pull_request.number }}",
          HEAD_SHA: "${{ github.event.pull_request.head.sha }}",
        },
        run: "node scripts/journeys-scope.mjs",
      },
    ]);
    expect(JSON.stringify(changes)).not.toMatch(/secrets\./);
    // Only a pull request's run can be cut down to the affected specs; a missing mode (a base-branch
    // scope script without modes) runs the full suite.
    expect(step("Run test suite").env).toMatchObject({
      MODE: "${{ github.event_name == 'pull_request' && needs.changes.outputs.mode || 'full' }}",
    });
    // A job skipped by its own `if` never evaluates an expression name, so the required check's
    // name must stay a plain string. The required check is journeys-result, which never skips.
    expect(workflow.jobs["journeys-result"].name).toBe("journeys");
    expect(workflow.jobs["journeys-result"].if).toBe("always()");
  });

  it("runs the full suite in two parts, each with its own QA stack, and one part otherwise", () => {
    expect(journeys.name).toBe("journeys part ${{ matrix.part }}");
    // A pull request runs only part 1 unless the scope check says parts=2 (the journeys-full label);
    // the merge queue, main and the schedule run both.
    expect(journeys.strategy).toEqual({
      "fail-fast": false,
      matrix: {
        part: "${{ fromJSON(((github.event_name == 'workflow_dispatch' && inputs.suite == 'explore') || (github.event_name == 'pull_request' && (needs.changes.outputs.mode == 'affected' || needs.changes.outputs.parts != '2'))) && '[1]' || '[1, 2]') }}",
      },
    });
    // runIdentity names part 2's stack apart from part 1's.
    expect(journeys.env).toEqual({ SPOONJOY_QA_RUN_PART: "${{ matrix.part }}" });
    const suite = step("Run test suite");
    // The suite is always split in two, so part 1 alone still runs shard 1 of 2.
    expect(suite.env).toMatchObject({ PART: "${{ matrix.part }}", PARTS: 2 });
    // Part 1 runs the census first, then its shard of the rest without the personas setup the
    // census already ran; a later part signs the personas in, then runs its shard without them.
    // Every shard leaves out the census and the Move in journeys, so the parts split one list.
    expect(suite.run).toContain('pnpm run test:journeys:census || census=$?\n  pnpm run test:journeys:after-census --shard="1/$PARTS"');
    expect(suite.run).toContain(
      'pnpm exec playwright test -c playwright.journeys.config.ts --no-deps \\\n    --project iphone-webkit --project desktop-chrome --grep-invert "@ouro-census|@move-in" --shard="$PART/$PARTS"',
    );
    expect(JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")).scripts["test:journeys:after-census"]).toContain('--grep-invert "@ouro-census|@move-in"');
    const reportUpload = steps.find((candidate) => candidate.name === "Upload journeys report") as unknown as { with: { name: string } };
    expect(reportUpload.with.name).toBe("journeys-report${{ matrix.part != 1 && format('-part-{0}', matrix.part) || '' }}");
  });

  describe("a later part of the full suite", () => {
    // Runs the step's script with stand-ins for node and pnpm that log their arguments and exit
    // with the code set for that command.
    const runPart = (part: string, codes: { personas?: number; shard?: number; moveIn?: number } = {}) => {
      const bin = mkdtempSync(join(tmpdir(), "journeys-part-"));
      const log = join(bin, "calls.log");
      writeFileSync(join(bin, "node"), `#!/bin/bash\necho "node $*" >> "${log}"\ncase "$*" in *"--project personas"*) exit ${codes.personas ?? 0};; *--shard*) sleep 0.2; exit ${codes.shard ?? 0};; esac\n`, { mode: 0o755 });
      // The Move in journeys outlive the shard, so the step must wait for them.
      writeFileSync(join(bin, "pnpm"), `#!/bin/bash\nsleep 0.5\necho "pnpm $*" >> "${log}"\necho "moved in"\nexit ${codes.moveIn ?? 0}\n`, { mode: 0o755 });
      const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", step("Run test suite").run as string], {
        env: { PATH: `${bin}:${process.env.PATH}`, MODE: "full", SUITE: "", PART: part, PARTS: "2", GITHUB_OUTPUT: join(bin, "output") },
        encoding: "utf8",
      });
      const calls = readFileSync(log, "utf8").trim().split("\n");
      rmSync(bin, { recursive: true, force: true });
      return { status: result.status, calls, stdout: result.stdout };
    };

    it("signs the personas in first, then runs the Move in journeys beside its shard without the personas setup", () => {
      const { status, calls, stdout } = runPart("2");
      expect(status).toBe(0);
      expect(calls[0]).toBe("node scripts/warning-gate.ts -- pnpm exec playwright test -c playwright.journeys.config.ts --project personas");
      expect(calls.slice(1).sort()).toEqual([
        'node scripts/warning-gate.ts -- pnpm exec playwright test -c playwright.journeys.config.ts --no-deps --project iphone-webkit --project desktop-chrome --grep-invert @ouro-census|@move-in --shard=2/2',
        "pnpm run test:journeys:move-in",
      ]);
      expect(stdout).toBe("[move-in] moved in\n");
    });

    it("gives the Move in journeys one worker, no setup and their own report and results folders", () => {
      const script: string = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")).scripts["test:journeys:move-in"];
      expect(script).toMatch(/^SPOONJOY_JOURNEYS_REPORT_DIR=move-in-report SPOONJOY_JOURNEYS_RESULTS_DIR=move-in-test-results /);
      for (const flag of ["--no-deps", "--workers 1", "--grep @move-in", "--project iphone-webkit", "--project desktop-chrome"]) expect(script).toContain(flag);
    });

    it("fails when its shard or the Move in journeys fail, after both finish, and stops when the sign-ins fail", () => {
      const shardFails = runPart("2", { shard: 3, moveIn: 5 });
      expect(shardFails.status).toBe(3);
      expect(shardFails.calls).toHaveLength(3);
      expect(runPart("2", { moveIn: 5 }).status).toBe(5);
      const signInFails = runPart("2", { personas: 7 });
      expect(signInFails.status).toBe(7);
      expect(signInFails.calls).toHaveLength(1);
    });

    it("leaves the Move in journeys to part 2", () => {
      const { status, calls } = runPart("3");
      expect(status).toBe(0);
      expect(calls).toHaveLength(2);
      expect(calls.join("\n")).not.toContain("test:journeys:move-in");
    });
  });

  it("reports the required journeys check as passed only when every part passed or the suite was skipped", () => {
    const result = workflow.jobs["journeys-result"];
    expect(result.needs).toEqual(["journeys"]);
    expect(result.env).toBeUndefined();
    expect(JSON.stringify(result)).not.toMatch(/secrets\./);
    const run: string = result.steps[0].run;
    expect(result.steps[0].env).toEqual({ RESULT: "${{ needs.journeys.result }}" });
    const verdict = (value: string) =>
      spawnSync("bash", ["-c", run], { env: { ...process.env, RESULT: value }, encoding: "utf8" }).status;
    expect(verdict("success")).toBe(0);
    expect(verdict("skipped")).toBe(0);
    expect(verdict("failure")).toBe(1);
    expect(verdict("cancelled")).toBe(1);
  });

  it("cancels only a superseded pull-request run, whose teardown still runs", () => {
    expect(workflow.concurrency).toEqual({
      group: "journeys-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || format('run-{0}', github.run_id) }}",
      "cancel-in-progress": "${{ github.event_name == 'pull_request' }}",
    });
    expect(step("Delete this run's QA stack").if).toBe("always()");
    // Bounded, so a hung teardown cannot hold a cancelled run for the whole job timeout.
    for (const name of ["Rotate persona passwords", "Clean up disposable QA data", "Delete this run's QA stack"]) {
      expect([name, step(name)["timeout-minutes"]]).toEqual([name, 5]);
    }
  });

  it("skips main's journeys only when the merge queue's Journeys run of the same commit passed", () => {
    expect(journeys.if).toBe("${{ !cancelled() && needs.queue-tested.outputs.tested != 'true' && (github.event_name != 'pull_request' || (github.event.pull_request.head.repo.full_name == github.repository && needs.changes.outputs.journeys != 'false')) }}");
    const queueTested = workflow.jobs["queue-tested"];
    expect(queueTested.if).toBe("github.event_name == 'push'");
    expect(queueTested.permissions).toEqual({ actions: "read", contents: "read" });
    expect(queueTested.outputs).toEqual({ tested: "${{ steps.lookup.outputs.tested }}" });
    expect(queueTested.steps.at(-1)).toEqual({
      name: "Ask whether the merge queue already tested this commit",
      id: "lookup",
      env: { GH_TOKEN: "${{ github.token }}" },
      run: "node scripts/workflow-security.mjs queue-tested-journeys",
    });
  });

  it("keeps shared QA a mirror of main: deployed only after main's journeys pass, one deploy at a time", () => {
    const deploy = workflow.jobs["deploy-shared-qa"];
    expect(deploy.needs).toEqual(["queue-tested", "journeys"]);
    // After a queue merge, main's journeys skip because the queue's run of the same commit passed;
    // shared QA still mirrors main then, and never after a journeys failure.
    expect(deploy.if).toBe("${{ !cancelled() && github.event_name == 'push' && github.ref == 'refs/heads/main' && (needs.journeys.result == 'success' || (needs.journeys.result == 'skipped' && needs.queue-tested.outputs.tested == 'true')) }}");
    expect(deploy.concurrency).toEqual({ group: "journeys-shared-qa-deploy", "cancel-in-progress": false });
    const deploySteps: Array<{ name?: string; id?: string; if?: string; run?: string; env?: Record<string, string> }> = deploy.steps;
    expect(deploySteps.at(-2)).toMatchObject({
      name: "Deploy main to shared QA",
      if: "steps.tip.outputs.current == 'true'",
      // Shared QA's jobs queue must exist before a deploy can bind it.
      run: "node scripts/qa-run-scope.mjs shared-queue && pnpm run deploy:qa",
    });
    // Then QA's photo bucket gets the rule that aborts unfinished move-in uploads after a day.
    expect(deploySteps.at(-1)).toMatchObject({
      name: "Abort unfinished move-in uploads in QA after a day",
      if: "steps.tip.outputs.current == 'true'",
      "continue-on-error": true,
      run: "node scripts/retry-cloudflare.mjs -- node scripts/ensure-r2-upload-lifecycle.mjs spoonjoy-photos-qa",
    });
    expect(deploySteps.filter((candidate) => candidate.env?.CLOUDFLARE_API_TOKEN)).toHaveLength(2);
  });

  it("never deploys an older main over a newer one", () => {
    const deploySteps: Array<{ name?: string; id?: string; run?: string }> = workflow.jobs["deploy-shared-qa"].steps;
    const tip = deploySteps.at(-3)!;
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
