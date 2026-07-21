const INTERNAL_ORIGIN = "https://cook-session.internal";
const PROTOCOL_HEADER = "X-Spoonjoy-Cook-Protocol";
const PROBE_HEADER = "X-Spoonjoy-Internal-Probe";
const PROBE_PATH = "/__bootstrap/probe";
const PROBE_BODY = '{"version":1}';

const protocolUnavailableBody = {
  error: {
    code: "cook_session_protocol_unavailable",
    message: "Cook session protocol is temporarily unavailable.",
    retryable: true,
  },
};

type CookSessionSqlValue = string | number | ArrayBuffer | null;

interface CookSessionSqlCursor<T extends Record<string, CookSessionSqlValue>> extends Iterable<T> {
  one(): T;
}

interface CookSessionStorage {
  deleteAlarm(): Promise<void>;
  deleteAll(): Promise<void>;
  sql: {
    exec<T extends Record<string, CookSessionSqlValue> = Record<string, CookSessionSqlValue>>(
      query: string,
    ): CookSessionSqlCursor<T>;
  };
}

interface CookSessionState {
  storage: CookSessionStorage;
}

function protocolUnavailableResponse() {
  return Response.json(protocolUnavailableBody, {
    status: 503,
    headers: {
      "Cache-Control": "private, no-store",
      "Retry-After": "1",
    },
  });
}

function isRecognizedInternalCookRoute(request: Request, url: URL) {
  if (url.origin !== INTERNAL_ORIGIN || url.search || request.headers.get(PROTOCOL_HEADER) !== "1") {
    return false;
  }

  const recipePath = "/api/cook-sessions/[^/]+";
  if (request.method === "GET") {
    return new RegExp(`^${recipePath}(?:/socket)?$`).test(url.pathname);
  }
  if (request.method === "PATCH" || request.method === "DELETE") {
    return new RegExp(`^${recipePath}$`).test(url.pathname);
  }
  if (request.method === "POST") {
    return new RegExp(`^${recipePath}/(?:start|complete|abandon|restart)$`).test(url.pathname);
  }
  return false;
}

async function clearBootstrapProbeStorage(storage: CookSessionStorage) {
  try {
    storage.sql.exec("DROP TABLE IF EXISTS __bootstrap_probe");
  } finally {
    try {
      await storage.deleteAll();
    } finally {
      await storage.deleteAlarm();
    }
  }
}

export class CookSession {
  constructor(
    private readonly state: CookSessionState,
    _env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (isRecognizedInternalCookRoute(request, url)) {
      return protocolUnavailableResponse();
    }

    if (
      url.origin !== INTERNAL_ORIGIN ||
      url.pathname !== PROBE_PATH ||
      url.search ||
      request.method !== "POST" ||
      request.headers.get(PROBE_HEADER) !== "1" ||
      await request.text() !== PROBE_BODY
    ) {
      return new Response(null, { status: 404 });
    }

    const { storage } = this.state;
    await clearBootstrapProbeStorage(storage);
    let storageKind: string;
    try {
      storage.sql.exec(
        "CREATE TABLE __bootstrap_probe (id INTEGER PRIMARY KEY NOT NULL, value TEXT NOT NULL)",
      );
      storage.sql.exec("INSERT INTO __bootstrap_probe (id, value) VALUES (1, 'sqlite')");
      ({ value: storageKind } = storage.sql.exec<{ value: string }>(
        "SELECT value FROM __bootstrap_probe WHERE id = 1",
      ).one());
    } finally {
      await clearBootstrapProbeStorage(storage);
    }
    const residue = Array.from(storage.sql.exec(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('_cf_KV', '_cf_METADATA') ORDER BY name",
    )).length;

    return Response.json({ ok: true, storage: storageKind, residue });
  }
}
