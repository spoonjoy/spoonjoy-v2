import {
  SELF,
  createExecutionContext,
  env,
  listDurableObjectIds,
  runInDurableObject,
} from "cloudflare:test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createUserSessionCookie } from "../../app/lib/session.server";

interface TestD1Statement {
  bind(...values: unknown[]): TestD1Statement;
  run(): Promise<unknown>;
}

interface TestD1Database {
  exec(sql: string): Promise<unknown>;
  prepare(sql: string): TestD1Statement;
}

interface TestWorkerEnvironment {
  CF_VERSION_METADATA?: { id: string; tag: string; timestamp: string };
  COOK_SESSIONS?: DurableObjectNamespace;
  COOK_SESSION_BOOTSTRAP_MODE?: string;
  DB: TestD1Database;
  NODE_ENV?: string;
  SESSION_SECRET?: string;
  SPOONJOY_BASE_URL?: string;
}

interface PublicCookRoute {
  method: string;
  path: string;
  scope: "read" | "write";
  upgrade?: boolean;
}

const TEST_ORIGIN = "https://spoonjoy.test";
const TEST_SESSION_SECRET = "spoonjoy-workers-cook-session-test-secret";
const TEST_USER_ID = "cook-session-user";
const READ_TOKEN = "sj_cook_session_read_test";
const WRITE_TOKEN = "sj_cook_session_write_test";
const WRONG_SCOPE_TOKEN = "sj_cook_session_wrong_scope_test";
const ACCOUNT_DELETE_INTENT_RESOURCE = "urn:spoonjoy:account-delete-intent:v1";
const DELETE_INTENT_TOKEN = "sj_cook_session_delete_intent_test";
const DELETE_INTENT_MISSING_RESOURCE_TOKEN = "sj_cook_session_delete_missing_resource_test";
const DELETE_INTENT_WRONG_RESOURCE_TOKEN = "sj_cook_session_delete_wrong_resource_test";
const DELETE_INTENT_WRONG_SCOPE_TOKEN = "sj_cook_session_delete_wrong_scope_test";
const DELETE_INTENT_EXPIRED_TOKEN = "sj_cook_session_delete_expired_test";
const DELETE_INTENT_REVOKED_TOKEN = "sj_cook_session_delete_revoked_test";
const protocolUnavailableBody = {
  error: {
    code: "cook_session_protocol_unavailable",
    message: "Cook session protocol is temporarily unavailable.",
    retryable: true,
  },
};

const publicCookRoutes: PublicCookRoute[] = [
  { method: "GET", path: "/api/cook-sessions", scope: "read" },
  { method: "POST", path: "/api/cook-sessions/recipe-start/start", scope: "write" },
  { method: "GET", path: "/api/cook-sessions/recipe-detail", scope: "read" },
  { method: "PATCH", path: "/api/cook-sessions/recipe-patch", scope: "write" },
  { method: "DELETE", path: "/api/cook-sessions/recipe-delete", scope: "write" },
  { method: "POST", path: "/api/cook-sessions/recipe-complete/complete", scope: "write" },
  { method: "POST", path: "/api/cook-sessions/recipe-abandon/abandon", scope: "write" },
  { method: "POST", path: "/api/cook-sessions/recipe-restart/restart", scope: "write" },
  { method: "GET", path: "/api/cook-sessions/recipe-socket/socket", scope: "read", upgrade: true },
];

const internalCookRoutes = publicCookRoutes.filter(({ path }) => path !== "/api/cook-sessions");

function testEnvironment(): TestWorkerEnvironment {
  return env as unknown as TestWorkerEnvironment;
}

function itWithCookSessionNamespace(
  name: string,
  test: (namespace: DurableObjectNamespace) => void | Promise<void>,
) {
  const namespace = testEnvironment().COOK_SESSIONS;
  it(name, namespace
    ? () => test(namespace)
    : () => expect(namespace, "COOK_SESSIONS must exist before this contract can run").toBeDefined());
}

async function tokenHash(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function insertCredential(
  id: string,
  token: string,
  scopes: string,
  options: {
    expiresAt?: string | null;
    oauthResource?: string | null;
    revokedAt?: string | null;
  } = {},
) {
  const now = "2026-07-20T00:00:00.000Z";
  await testEnvironment().DB.prepare(`
    INSERT INTO ApiCredential (
      id, userId, name, tokenHash, tokenPrefix, scopes, lastUsedAt, revokedAt,
      oauthClientId, oauthResource, expiresAt, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, ?)
  `).bind(
    id,
    TEST_USER_ID,
    id,
    await tokenHash(token),
    token.slice(0, 12),
    scopes,
    options.revokedAt ?? null,
    options.oauthResource ?? null,
    options.expiresAt ?? null,
    now,
    now,
  ).run();
}

async function execStatements(database: TestD1Database, statements: string[]) {
  for (const statement of statements) await database.exec(statement);
}

function requestForRoute(
  route: PublicCookRoute,
  token: string | null,
  options: { cookie?: string; origin?: string | null } = {},
) {
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.cookie) headers.set("Cookie", options.cookie);
  const origin = options.origin === undefined ? TEST_ORIGIN : options.origin;
  if ((route.scope === "write" || route.upgrade) && origin) headers.set("Origin", origin);
  if (route.upgrade) {
    headers.set("Connection", "Upgrade");
    headers.set("Upgrade", "websocket");
  }
  return new Request(`${TEST_ORIGIN}${route.path}`, {
    method: route.method,
    headers,
    body: route.method === "POST" || route.method === "PATCH" ? "{}" : undefined,
  });
}

function ownerDeleteRequest(
  token: string | null,
  options: { body?: string; cookie?: string; origin?: string | null; suffix?: string } = {},
) {
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.cookie) headers.set("Cookie", options.cookie);
  const origin = options.origin === undefined ? TEST_ORIGIN : options.origin;
  if (origin) headers.set("Origin", origin);
  return new Request(`${TEST_ORIGIN}/api/cook-sessions${options.suffix ?? ""}`, {
    method: "DELETE",
    headers,
    body: options.body,
  });
}

async function expectProtocolUnavailable(response: Response) {
  expect(response.status).toBe(503);
  expect(response.headers.get("Retry-After")).toBe("1");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  await expect(response.json()).resolves.toEqual(protocolUnavailableBody);
}

async function expectCookError(
  response: Response,
  status: number,
  code: string,
  message: string,
) {
  expect(response.status).toBe(status);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  await expect(response.json()).resolves.toEqual({
    error: { code, message, retryable: false },
  });
}

async function seedDurableObjectStorage(stub: DurableObjectStub) {
  await runInDurableObject(stub, async (_instance, state) => {
    state.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS __test_sentinel (id INTEGER PRIMARY KEY NOT NULL, value TEXT NOT NULL)",
    );
    state.storage.sql.exec("DELETE FROM __test_sentinel");
    state.storage.sql.exec("INSERT INTO __test_sentinel (id, value) VALUES (1, 'preserved')");
    await state.storage.put("__test_sentinel", { value: "preserved" });
  });
}

async function readDurableObjectStorageSnapshot(stub: DurableObjectStub) {
  return runInDurableObject(stub, async (_instance, state) => {
    await state.storage.sync();
    const kvEntries = Array.from((await state.storage.list()).entries());
    await state.storage.sync();
    const schema = Array.from(state.storage.sql.exec(
      "SELECT type, name, tbl_name AS tableName, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT IN ('_cf_KV', '_cf_METADATA') ORDER BY type, name",
    )) as Array<{ type: string; name: string; tableName: string; sql: string | null }>;
    const sentinelRows = schema.some(({ type, name }) => type === "table" && name === "__test_sentinel")
      ? Array.from(state.storage.sql.exec(
        "SELECT id, value FROM __test_sentinel ORDER BY id",
      )) as Array<{ id: number; value: string }>
      : [];
    return {
      schema,
      sentinelRows,
      kvEntries,
      alarm: await state.storage.getAlarm(),
    };
  });
}

async function durableObjectStorageSnapshot(stub: DurableObjectStub) {
  await readDurableObjectStorageSnapshot(stub);
  return readDurableObjectStorageSnapshot(stub);
}

const emptyDurableObjectStorage = {
  schema: [],
  sentinelRows: [],
  kvEntries: [],
  alarm: null,
};

async function expectDurableObjectStorageEmpty(stub: DurableObjectStub) {
  await expect(durableObjectStorageSnapshot(stub)).resolves.toEqual(emptyDurableObjectStorage);
}

function createCapturingNamespace() {
  const names: string[] = [];
  const ids: DurableObjectId[] = [];
  const getOptions: Array<DurableObjectNamespaceGetDurableObjectOptions | undefined> = [];
  const requests: Request[] = [];
  const objectId = {
    equals(other: DurableObjectId) {
      return other === objectId;
    },
    toString() {
      return "captured-bootstrap-object";
    },
  } as DurableObjectId;
  const stub = {
    id: objectId,
    async fetch(input: RequestInfo | URL, init?: RequestInit) {
      const request = input instanceof Request ? input : new Request(input, init);
      requests.push(request.clone());
      return Response.json({ ok: true, storage: "captured-sqlite", residue: 7 });
    },
  } as DurableObjectStub;
  const namespace = {
    idFromName(name: string) {
      names.push(name);
      return objectId;
    },
    get(id: DurableObjectId, options?: DurableObjectNamespaceGetDurableObjectOptions) {
      ids.push(id);
      getOptions.push(options);
      return stub;
    },
  } as DurableObjectNamespace;

  return { namespace, names, ids, getOptions, requests, objectId };
}

describe("CookSession lifecycle bootstrap", () => {
  let sessionCookie = "";

  beforeAll(async () => {
    const { DB } = testEnvironment();
    await execStatements(DB, [
      "PRAGMA foreign_keys = ON",
      "DROP TABLE IF EXISTS ApiCredential",
      "DROP TABLE IF EXISTS User",
      "CREATE TABLE User (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, username TEXT NOT NULL UNIQUE)",
      "CREATE TABLE ApiCredential (id TEXT PRIMARY KEY, userId TEXT NOT NULL, name TEXT NOT NULL, tokenHash TEXT NOT NULL UNIQUE, tokenPrefix TEXT NOT NULL, scopes TEXT NOT NULL, lastUsedAt DATETIME, revokedAt DATETIME, oauthClientId TEXT, oauthResource TEXT, expiresAt DATETIME, createdAt DATETIME NOT NULL, updatedAt DATETIME NOT NULL, FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE)",
      "INSERT INTO User (id, email, username) VALUES ('cook-session-user', 'cook-session@example.com', 'cook_session_user')",
    ]);
    await insertCredential("cook-read", READ_TOKEN, "kitchen:read");
    await insertCredential("cook-write", WRITE_TOKEN, "kitchen:write");
    await insertCredential("cook-wrong", WRONG_SCOPE_TOKEN, "public:read");
    await insertCredential(
      "cook-delete-intent",
      DELETE_INTENT_TOKEN,
      "account:write",
      { oauthResource: ACCOUNT_DELETE_INTENT_RESOURCE },
    );
    await insertCredential(
      "cook-delete-missing-resource",
      DELETE_INTENT_MISSING_RESOURCE_TOKEN,
      "account:write",
    );
    await insertCredential(
      "cook-delete-wrong-resource",
      DELETE_INTENT_WRONG_RESOURCE_TOKEN,
      "account:write",
      { oauthResource: `${ACCOUNT_DELETE_INTENT_RESOURCE}:wrong` },
    );
    await insertCredential(
      "cook-delete-wrong-scope",
      DELETE_INTENT_WRONG_SCOPE_TOKEN,
      "kitchen:write",
      { oauthResource: ACCOUNT_DELETE_INTENT_RESOURCE },
    );
    await insertCredential(
      "cook-delete-expired",
      DELETE_INTENT_EXPIRED_TOKEN,
      "account:write",
      {
        expiresAt: "2000-01-01T00:00:00.000Z",
        oauthResource: ACCOUNT_DELETE_INTENT_RESOURCE,
      },
    );
    await insertCredential(
      "cook-delete-revoked",
      DELETE_INTENT_REVOKED_TOKEN,
      "account:write",
      {
        oauthResource: ACCOUNT_DELETE_INTENT_RESOURCE,
        revokedAt: "2026-07-20T00:00:00.000Z",
      },
    );
    sessionCookie = (await createUserSessionCookie(
      TEST_USER_ID,
      {
        NODE_ENV: "test",
        SESSION_SECRET: TEST_SESSION_SECRET,
        SPOONJOY_BASE_URL: TEST_ORIGIN,
      },
      new Request(`${TEST_ORIGIN}/login`),
    )).split(";", 1)[0];
  });

  afterAll(async () => {
    await execStatements(testEnvironment().DB, [
      "DROP TABLE IF EXISTS ApiCredential",
      "DROP TABLE IF EXISTS User",
    ]);
  });

  itWithCookSessionNamespace("returns the frozen retryable response for every authenticated future public route", async (namespace) => {
    const beforeIds = await listDurableObjectIds(namespace);

    for (const route of publicCookRoutes) {
      const token = route.scope === "read" ? READ_TOKEN : WRITE_TOKEN;
      const response = await SELF.fetch(requestForRoute(route, token));
      await expectProtocolUnavailable(response);
      expect(response.headers.get("X-Spoonjoy-Worker-Version")).toBe(
        testEnvironment().CF_VERSION_METADATA?.id,
      );
      if (route.upgrade) {
        expect((response as Response & { webSocket?: unknown }).webSocket).toBeNull();
      }
    }

    const afterIds = await listDurableObjectIds(namespace);
    expect(afterIds.map(String)).toEqual(beforeIds.map(String));
  });

  itWithCookSessionNamespace("never derives or mutates a Durable Object for inert public cook routes", async () => {
    const worker = (await import("../../workers/app")).default;
    const captured = createCapturingNamespace();
    const environment = {
      ...testEnvironment(),
      COOK_SESSIONS: captured.namespace,
    } as unknown as CloudflareEnvironment;

    for (const route of publicCookRoutes) {
      const token = route.scope === "read" ? READ_TOKEN : WRITE_TOKEN;
      const response = await worker.fetch(
        requestForRoute(route, token),
        environment,
        createExecutionContext(),
      );
      await expectProtocolUnavailable(response);
    }

    expect(captured.names).toEqual([]);
    expect(captured.ids).toEqual([]);
    expect(captured.getOptions).toEqual([]);
    expect(captured.requests).toEqual([]);
  });

  itWithCookSessionNamespace("allows the first-party session principal without bearer scopes", async () => {
    for (const route of publicCookRoutes) {
      const response = await SELF.fetch(requestForRoute(route, null, { cookie: sessionCookie }));
      await expectProtocolUnavailable(response);
    }
  });

  itWithCookSessionNamespace("accepts only the exact bearer account-deletion intent without deriving a Durable Object", async (namespace) => {
    const worker = (await import("../../workers/app")).default;
    const captured = createCapturingNamespace();
    const beforeIds = await listDurableObjectIds(namespace);
    const response = await worker.fetch(
      ownerDeleteRequest(DELETE_INTENT_TOKEN),
      {
        ...testEnvironment(),
        COOK_SESSIONS: captured.namespace,
      } as unknown as CloudflareEnvironment,
      createExecutionContext(),
    );

    expect(captured.names).toEqual([]);
    expect(captured.ids).toEqual([]);
    expect(captured.getOptions).toEqual([]);
    expect(captured.requests).toEqual([]);
    expect((await listDurableObjectIds(namespace)).map(String)).toEqual(beforeIds.map(String));
    await expectProtocolUnavailable(response);
  });

  it.each([
    [
      "missing credentials",
      null,
      false,
      401,
      "authentication_required",
      "Authentication required.",
    ],
    [
      "an invalid bearer token",
      "sj_cook_session_delete_invalid_test",
      false,
      401,
      "authentication_required",
      "Authentication required.",
    ],
    [
      "an expired bearer token",
      DELETE_INTENT_EXPIRED_TOKEN,
      false,
      401,
      "authentication_required",
      "Authentication required.",
    ],
    [
      "a revoked bearer token",
      DELETE_INTENT_REVOKED_TOKEN,
      false,
      401,
      "authentication_required",
      "Authentication required.",
    ],
    [
      "a first-party session",
      null,
      true,
      403,
      "insufficient_scope",
      "This credential does not include the required cook-session scope.",
    ],
    [
      "a bearer token without the deletion-intent resource",
      DELETE_INTENT_MISSING_RESOURCE_TOKEN,
      false,
      403,
      "insufficient_scope",
      "This credential does not include the required cook-session scope.",
    ],
    [
      "a bearer token with the wrong deletion-intent resource",
      DELETE_INTENT_WRONG_RESOURCE_TOKEN,
      false,
      403,
      "insufficient_scope",
      "This credential does not include the required cook-session scope.",
    ],
    [
      "a deletion-intent bearer token without account write scope",
      DELETE_INTENT_WRONG_SCOPE_TOKEN,
      false,
      403,
      "insufficient_scope",
      "This credential does not include the required cook-session scope.",
    ],
  ])("rejects owner DELETE for %s before checking Origin without Durable Object access", async (
    _case,
    token,
    useSession,
    status,
    code,
    message,
  ) => {
    const worker = (await import("../../workers/app")).default;
    const captured = createCapturingNamespace();
    const environment = {
      ...testEnvironment(),
      COOK_SESSIONS: captured.namespace,
    } as unknown as CloudflareEnvironment;
    const response = await worker.fetch(
      ownerDeleteRequest(token, {
        cookie: useSession ? sessionCookie : undefined,
        origin: "https://attacker.example",
      }),
      environment,
      createExecutionContext(),
    );

    expect(captured.names).toEqual([]);
    expect(captured.ids).toEqual([]);
    expect(captured.getOptions).toEqual([]);
    expect(captured.requests).toEqual([]);
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({
      error: { code, message, retryable: false },
    });
  });

  itWithCookSessionNamespace("checks owner-deletion Origin after the complete bearer intent", async () => {
    await expectCookError(
      await SELF.fetch(ownerDeleteRequest(DELETE_INTENT_TOKEN, {
        origin: "https://attacker.example",
      })),
      403,
      "origin_forbidden",
      "Request origin is not allowed.",
    );
  });

  itWithCookSessionNamespace("rejects an owner DELETE query before authentication without Durable Object access", async (namespace) => {
    const worker = (await import("../../workers/app")).default;
    const captured = createCapturingNamespace();
    const beforeIds = await listDurableObjectIds(namespace);
    const response = await worker.fetch(
      ownerDeleteRequest(null, { suffix: "?unexpected=1" }),
      {
        ...testEnvironment(),
        COOK_SESSIONS: captured.namespace,
      } as unknown as CloudflareEnvironment,
      createExecutionContext(),
    );

    await expectCookError(
      response,
      400,
      "invalid_request",
      "Cook session request is invalid.",
    );
    expect(captured.names).toEqual([]);
    expect(captured.ids).toEqual([]);
    expect(captured.getOptions).toEqual([]);
    expect(captured.requests).toEqual([]);
    expect((await listDurableObjectIds(namespace)).map(String)).toEqual(beforeIds.map(String));
  });

  itWithCookSessionNamespace("rejects an owner DELETE body after the complete bearer intent without Durable Object access", async (namespace) => {
    const worker = (await import("../../workers/app")).default;
    const captured = createCapturingNamespace();
    const beforeIds = await listDurableObjectIds(namespace);
    const response = await worker.fetch(
      ownerDeleteRequest(DELETE_INTENT_TOKEN, { body: "{}" }),
      {
        ...testEnvironment(),
        COOK_SESSIONS: captured.namespace,
      } as unknown as CloudflareEnvironment,
      createExecutionContext(),
    );

    await expectCookError(
      response,
      400,
      "invalid_request",
      "Cook session request is invalid.",
    );
    expect(captured.names).toEqual([]);
    expect(captured.ids).toEqual([]);
    expect(captured.getOptions).toEqual([]);
    expect(captured.requests).toEqual([]);
    expect((await listDurableObjectIds(namespace)).map(String)).toEqual(beforeIds.map(String));
  });

  itWithCookSessionNamespace("enforces authentication, bearer scopes, and origin checks before the stub response", async () => {
    for (const route of publicCookRoutes) {
      await expectCookError(
        await SELF.fetch(requestForRoute(route, null)),
        401,
        "authentication_required",
        "Authentication required.",
      );
    }

    for (const route of publicCookRoutes) {
      const wrongScopeToken = route.scope === "read" ? WRITE_TOKEN : READ_TOKEN;
      await expectCookError(
        await SELF.fetch(requestForRoute(route, wrongScopeToken)),
        403,
        "insufficient_scope",
        "This credential does not include the required cook-session scope.",
      );
    }

    await expectCookError(
      await SELF.fetch(requestForRoute(publicCookRoutes[0], WRONG_SCOPE_TOKEN)),
      403,
      "insufficient_scope",
      "This credential does not include the required cook-session scope.",
    );

    for (const route of publicCookRoutes.filter(({ scope, upgrade }) => scope === "write" || upgrade)) {
      for (const origin of [null, "https://attacker.example"]) {
        await expectCookError(
          await SELF.fetch(requestForRoute(route, null, { origin })),
          401,
          "authentication_required",
          "Authentication required.",
        );

        const wrongScopeToken = route.scope === "read" ? WRITE_TOKEN : READ_TOKEN;
        await expectCookError(
          await SELF.fetch(requestForRoute(route, wrongScopeToken, { origin })),
          403,
          "insufficient_scope",
          "This credential does not include the required cook-session scope.",
        );

        const token = route.scope === "read" ? READ_TOKEN : WRITE_TOKEN;
        await expectCookError(
          await SELF.fetch(requestForRoute(route, token, { origin })),
          403,
          "origin_forbidden",
          "Request origin is not allowed.",
        );

        await expectCookError(
          await SELF.fetch(requestForRoute(route, null, { cookie: sessionCookie, origin })),
          403,
          "origin_forbidden",
          "Request origin is not allowed.",
        );
      }
    }
  });

  itWithCookSessionNamespace("returns 404 for malformed or unrecognized public cook paths before authentication", async () => {
    for (const [method, path] of [
      ["POST", "/api/cook-sessions"],
      ["DELETE", "/api/cook-sessions/"],
      ["GET", "/api/cook-sessions/recipe-1/start"],
      ["PUT", "/api/cook-sessions/recipe-1"],
      ["GET", "/api/cook-sessions/recipe-1/complete"],
      ["POST", "/api/cook-sessions/recipe-1/socket"],
      ["GET", "/api/cook-sessions/recipe-1/unknown"],
      ["GET", "/api/cook-sessions/"],
      ["HEAD", "/api/cook-sessions"],
      ["GET", "/api/cook-sessions//socket"],
      ["GET", "/api/cook-sessions/recipe-1/extra/path"],
      ["GET", "/api/cook-sessions-other/recipe-1"],
    ]) {
      const response = await SELF.fetch(new Request(`${TEST_ORIGIN}${path}`, { method }));
      expect(response.status).toBe(404);
    }
  });

  itWithCookSessionNamespace("returns the frozen response for every recognized internal protocol request without storage mutation", async (namespace) => {
    const stub = namespace.get(namespace.idFromName("internal-contract"));
    await seedDurableObjectStorage(stub);
    const storageBefore = await durableObjectStorageSnapshot(stub);

    for (const route of internalCookRoutes) {
      const headers = new Headers({ "X-Spoonjoy-Cook-Protocol": "1" });
      if (route.upgrade) {
        headers.set("Connection", "Upgrade");
        headers.set("Upgrade", "websocket");
      }
      const response = await stub.fetch(new Request(`https://cook-session.internal${route.path}`, {
        method: route.method,
        headers,
        body: route.method === "POST" || route.method === "PATCH" ? "{}" : undefined,
      }));
      await expectProtocolUnavailable(response);
      if (route.upgrade) {
        expect((response as Response & { webSocket?: unknown }).webSocket).toBeNull();
      }
      await expect(durableObjectStorageSnapshot(stub)).resolves.toEqual(storageBefore);
    }
  });

  itWithCookSessionNamespace("keeps the legacy internal owner DELETE storage-inert", async (namespace) => {
    const stub = namespace.get(namespace.idFromName("legacy-owner-delete"));
    await seedDurableObjectStorage(stub);
    const storageBefore = await durableObjectStorageSnapshot(stub);

    const response = await stub.fetch(new Request(
      "https://cook-session.internal/api/cook-sessions/__owner__",
      {
        method: "DELETE",
        headers: {
          "X-Spoonjoy-Cook-Protocol": "1",
          "X-Spoonjoy-Cook-Operation": "owner-delete",
        },
      },
    ));

    await expectProtocolUnavailable(response);
    await expect(durableObjectStorageSnapshot(stub)).resolves.toEqual(storageBefore);
  });

  itWithCookSessionNamespace("requires the internal protocol header and recognizes only frozen internal paths", async (namespace) => {
    const stub = namespace.get(namespace.idFromName("internal-rejection"));
    await seedDurableObjectStorage(stub);
    const storageBefore = await durableObjectStorageSnapshot(stub);

    for (const request of [
      new Request("https://cook-session.internal/api/cook-sessions/recipe-1"),
      new Request("https://cook-session.internal/api/cook-sessions/recipe-1", {
        headers: { "X-Spoonjoy-Cook-Protocol": "2" },
      }),
      new Request("https://cook-session.internal/api/cook-sessions/recipe-1", {
        method: "PUT",
        headers: { "X-Spoonjoy-Cook-Protocol": "1" },
      }),
      new Request("https://cook-session.internal/api/cook-sessions", {
        headers: { "X-Spoonjoy-Cook-Protocol": "1" },
      }),
      new Request("https://cook-session.internal/not-a-cook-route", {
        headers: { "X-Spoonjoy-Cook-Protocol": "1" },
      }),
      new Request("https://attacker.example/api/cook-sessions/recipe-1", {
        headers: { "X-Spoonjoy-Cook-Protocol": "1" },
      }),
      new Request("https://cook-session.internal/api/cook-sessions/recipe-1?unexpected=1", {
        headers: { "X-Spoonjoy-Cook-Protocol": "1" },
      }),
    ]) {
      expect((await stub.fetch(request)).status).toBe(404);
      await expect(durableObjectStorageSnapshot(stub)).resolves.toEqual(storageBefore);
    }
  });

  itWithCookSessionNamespace("runs the exact private SQLite probe and leaves zero user tables", async (namespace) => {
    const stub = namespace.get(namespace.idFromName("private-probe"));
    const request = () => new Request("https://cook-session.internal/__bootstrap/probe", {
      method: "POST",
      headers: { "X-Spoonjoy-Internal-Probe": "1" },
      body: JSON.stringify({ version: 1 }),
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await seedDurableObjectStorage(stub);
      await runInDurableObject(stub, async (_instance, state) => {
        await state.storage.setAlarm(Date.now() + 60_000);
      });
      const response = await stub.fetch(request());
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true, storage: "sqlite", residue: 0 });
      await expectDurableObjectStorageEmpty(stub);
    }
  });

  itWithCookSessionNamespace("recovers a partial probe left by an interrupted cleanup", async (namespace) => {
    const stub = namespace.get(namespace.idFromName("private-probe-recovery"));
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        "CREATE TABLE __bootstrap_probe (id INTEGER PRIMARY KEY NOT NULL, value TEXT NOT NULL)",
      );
      state.storage.sql.exec("INSERT INTO __bootstrap_probe (id, value) VALUES (1, 'partial')");
      await state.storage.put("__bootstrap_probe_partial", true);
      await state.storage.setAlarm(Date.now() + 60_000);
    });

    const response = await stub.fetch(new Request(
      "https://cook-session.internal/__bootstrap/probe",
      {
        method: "POST",
        headers: { "X-Spoonjoy-Internal-Probe": "1" },
        body: JSON.stringify({ version: 1 }),
      },
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, storage: "sqlite", residue: 0 });
    await expectDurableObjectStorageEmpty(stub);
  });

  itWithCookSessionNamespace("returns 404 for malformed private probe requests without storage residue", async (namespace) => {
    const stub = namespace.get(namespace.idFromName("private-probe-rejections"));
    await seedDurableObjectStorage(stub);
    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    const storageBefore = await durableObjectStorageSnapshot(stub);

    for (const request of [
      new Request("https://cook-session.internal/__bootstrap/probe", {
        method: "GET",
        headers: { "X-Spoonjoy-Internal-Probe": "1" },
      }),
      new Request("https://cook-session.internal/__bootstrap/probe", {
        method: "POST",
        body: JSON.stringify({ version: 1 }),
      }),
      new Request("https://cook-session.internal/__bootstrap/probe", {
        method: "POST",
        headers: { "X-Spoonjoy-Internal-Probe": "2" },
        body: JSON.stringify({ version: 1 }),
      }),
      new Request("https://cook-session.internal/__bootstrap/probe", {
        method: "POST",
        headers: { "X-Spoonjoy-Internal-Probe": "1" },
        body: JSON.stringify({ version: 2 }),
      }),
      new Request("https://cook-session.internal/__bootstrap/probe", {
        method: "POST",
        headers: { "X-Spoonjoy-Internal-Probe": "1" },
        body: `${JSON.stringify({ version: 1 })}\n`,
      }),
      new Request("https://cook-session.internal/__bootstrap/unknown", {
        method: "POST",
        headers: { "X-Spoonjoy-Internal-Probe": "1" },
        body: JSON.stringify({ version: 1 }),
      }),
      new Request("https://cook-session.internal/__bootstrap/probe?unexpected=1", {
        method: "POST",
        headers: { "X-Spoonjoy-Internal-Probe": "1" },
        body: JSON.stringify({ version: 1 }),
      }),
      new Request("https://attacker.example/__bootstrap/probe", {
        method: "POST",
        headers: { "X-Spoonjoy-Internal-Probe": "1" },
        body: JSON.stringify({ version: 1 }),
      }),
    ]) {
      const response = await stub.fetch(request);
      expect(response.status).toBe(404);
      expect(response.headers.get("Retry-After")).toBeNull();
      expect((response as Response & { webSocket?: unknown }).webSocket).toBeNull();
      await expect(durableObjectStorageSnapshot(stub)).resolves.toEqual(storageBefore);
    }
  });

  itWithCookSessionNamespace("constructs the exact public-to-private bootstrap request and handles its response separately", async () => {
    const worker = (await import("../../workers/app")).default;
    const captured = createCapturingNamespace();
    const versionId = "33333333-3333-4333-8333-333333333333";
    const response = await worker.fetch(
      new Request(`${TEST_ORIGIN}/.well-known/spoonjoy-cook-session-bootstrap`, {
        method: "POST",
        headers: { "CF-Connecting-IP": "203.0.113.50" },
      }),
      {
        ...testEnvironment(),
        CF_VERSION_METADATA: {
          id: versionId,
          tag: "bootstrap-contract",
          timestamp: "2026-07-20T00:00:00Z",
        },
        COOK_SESSIONS: captured.namespace,
        COOK_SESSION_BOOTSTRAP_MODE: "1",
      } as unknown as CloudflareEnvironment,
      createExecutionContext(),
    );

    expect(captured.names).toEqual([`bootstrap:${versionId}`]);
    expect(captured.ids).toEqual([captured.objectId]);
    expect(captured.getOptions).toEqual([undefined]);
    expect(captured.requests).toHaveLength(1);
    const outbound = captured.requests[0];
    expect(outbound.url).toBe("https://cook-session.internal/__bootstrap/probe");
    expect(outbound.method).toBe("POST");
    expect(outbound.headers.get("X-Spoonjoy-Internal-Probe")).toBe("1");
    expect(outbound.headers.get("Content-Type")).toBeNull();
    await expect(outbound.text()).resolves.toBe('{"version":1}');

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Spoonjoy-Worker-Version")).toBe(versionId);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      storage: "captured-sqlite",
      residue: 7,
      workerVersionId: versionId,
    });
  });

  itWithCookSessionNamespace("runs the public bootstrap probe twice against one version-derived object", async (namespace) => {
    const environment = testEnvironment();
    const versionId = environment.CF_VERSION_METADATA?.id;
    if (!versionId) throw new Error("CF_VERSION_METADATA binding is required for the bootstrap probe.");

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await SELF.fetch(new Request(
        `${TEST_ORIGIN}/.well-known/spoonjoy-cook-session-bootstrap`,
        {
          method: "POST",
          headers: { "CF-Connecting-IP": "203.0.113.51" },
        },
      ));
      expect(response.status).toBe(200);
      expect(response.headers.get("X-Spoonjoy-Worker-Version")).toBe(versionId);
      await expect(response.json()).resolves.toEqual({
        ok: true,
        storage: "sqlite",
        residue: 0,
        workerVersionId: versionId,
      });
    }

    const expectedId = namespace.idFromName(`bootstrap:${versionId}`);
    const ids = await listDurableObjectIds(namespace);
    expect(ids.some((id) => id.equals(expectedId))).toBe(true);
    await expectDurableObjectStorageEmpty(namespace.get(expectedId));
  });

  itWithCookSessionNamespace("returns 404 for malformed or bootstrap-disabled public probes", async () => {
    const worker = (await import("../../workers/app")).default;
    const captured = createCapturingNamespace();
    const baseEnvironment = {
      ...testEnvironment(),
      COOK_SESSIONS: captured.namespace,
    };

    for (const request of [
      new Request(`${TEST_ORIGIN}/.well-known/spoonjoy-cook-session-bootstrap`),
      new Request(`${TEST_ORIGIN}/.well-known/spoonjoy-cook-session-bootstrap`, {
        method: "POST",
        body: "{}",
      }),
      new Request(`${TEST_ORIGIN}/.well-known/spoonjoy-cook-session-bootstrap`, {
        method: "POST",
        body: " ",
      }),
      new Request(`${TEST_ORIGIN}/.well-known/spoonjoy-cook-session-bootstrap/`, {
        method: "POST",
      }),
      new Request(`${TEST_ORIGIN}/.well-known/spoonjoy-cook-session-bootstrap?unexpected=1`, {
        method: "POST",
      }),
    ]) {
      const response = await worker.fetch(
        request,
        baseEnvironment as unknown as CloudflareEnvironment,
        createExecutionContext(),
      );
      expect(response.status).toBe(404);
      expect(response.headers.get("Retry-After")).toBeNull();
      expect((response as Response & { webSocket?: unknown }).webSocket).toBeNull();
    }

    for (const mode of [undefined, "0", "2", "true"]) {
      const response = await worker.fetch(
        new Request(`${TEST_ORIGIN}/.well-known/spoonjoy-cook-session-bootstrap`, {
          method: "POST",
        }),
        {
          ...baseEnvironment,
          COOK_SESSION_BOOTSTRAP_MODE: mode,
        } as unknown as CloudflareEnvironment,
        createExecutionContext(),
      );
      expect(response.status).toBe(404);
      expect(response.headers.get("Retry-After")).toBeNull();
    }

    const missingVersionResponse = await worker.fetch(
      new Request(`${TEST_ORIGIN}/.well-known/spoonjoy-cook-session-bootstrap`, {
        method: "POST",
      }),
      {
        ...baseEnvironment,
        CF_VERSION_METADATA: undefined,
        COOK_SESSION_BOOTSTRAP_MODE: "1",
      } as unknown as CloudflareEnvironment,
      createExecutionContext(),
    );
    expect(missingVersionResponse.status).toBe(404);
    expect(missingVersionResponse.headers.get("Retry-After")).toBeNull();

    expect(captured.names).toEqual([]);
    expect(captured.ids).toEqual([]);
    expect(captured.getOptions).toEqual([]);
    expect(captured.requests).toEqual([]);
  });
});
