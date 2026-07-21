import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { CookSession } from "../../workers/cook-session";

interface DurableObjectBinding {
  class_name?: string;
  name?: string;
}

interface DurableObjectMigration {
  new_sqlite_classes?: string[];
  tag?: string;
}

interface WranglerEnvironment {
  durable_objects?: { bindings?: DurableObjectBinding[] };
  migrations?: DurableObjectMigration[];
  ratelimits?: Array<{ name?: string }>;
  vars?: Record<string, string>;
  version_metadata?: { binding?: string };
}

interface WranglerConfig extends WranglerEnvironment {
  env?: { qa?: WranglerEnvironment };
}

function readConfig(path: string): WranglerConfig {
  return JSON.parse(readFileSync(path, "utf8")) as WranglerConfig;
}

function expectCookSessionLifecycle(config: WranglerEnvironment) {
  expect((config.durable_objects?.bindings ?? []).filter(({ name }) => name === "COOK_SESSIONS")).toEqual([{
    name: "COOK_SESSIONS",
    class_name: "CookSession",
  }]);
  expect((config.migrations ?? []).filter(({ tag }) => tag === "v1_cook_session")).toEqual([{
    tag: "v1_cook_session",
    new_sqlite_classes: ["CookSession"],
  }]);
}

function storageMethodCalls(source: string, method: string) {
  const sourceFile = ts.createSourceFile(
    "workers/cook-session.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const calls: Array<{ argument?: string }> = [];

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === method &&
      node.expression.expression.getText(sourceFile).split(".").includes("storage")) {
      const argument = node.arguments[0];
      calls.push({
        argument: argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))
          ? argument.text.replace(/\s+/g, " ").trim()
          : undefined,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls;
}

type ProbeFailurePoint = {
  occurrence: number;
  operation: string;
};

function sqlCursor<T extends Record<string, string | number | ArrayBuffer | null>>(rows: T[]) {
  return Object.assign(rows, { one: () => rows[0] });
}

class FailureInjectingStorage {
  alarm = true;
  kv = true;
  table = true;
  private readonly counts = new Map<string, number>();

  constructor(private readonly failure: ProbeFailurePoint) {}

  private failOnce(operation: string) {
    const occurrence = (this.counts.get(operation) ?? 0) + 1;
    this.counts.set(operation, occurrence);
    if (operation === this.failure.operation && occurrence === this.failure.occurrence) {
      throw new Error(`injected ${operation} failure`);
    }
  }

  sql = {
    exec: (query: string) => {
      const operation = query.startsWith("DROP TABLE")
        ? "drop"
        : query.startsWith("CREATE TABLE")
          ? "create"
          : query.startsWith("INSERT INTO")
            ? "insert"
            : query.startsWith("SELECT value")
              ? "read-value"
              : "read-residue";
      this.failOnce(operation);
      if (operation === "drop") this.table = false;
      if (operation === "create") this.table = true;
      if (operation === "read-value") return sqlCursor([{ value: "sqlite" }]);
      if (operation === "read-residue") {
        return sqlCursor(this.table ? [{ name: "__bootstrap_probe" }] : []);
      }
      return sqlCursor([]);
    },
  };

  async deleteAll() {
    this.failOnce("delete-all");
    this.kv = false;
    this.table = false;
  }

  async deleteAlarm() {
    this.failOnce("delete-alarm");
    this.alarm = false;
  }
}

function bootstrapProbeRequest() {
  return new Request("https://cook-session.internal/__bootstrap/probe", {
    method: "POST",
    headers: { "X-Spoonjoy-Internal-Probe": "1" },
    body: JSON.stringify({ version: 1 }),
  });
}

describe("CookSession namespace configuration", () => {
  it("binds the SQLite Durable Object lifecycle in production and QA", () => {
    const config = readConfig("wrangler.json");

    expectCookSessionLifecycle(config);
    expectCookSessionLifecycle(config.env?.qa ?? {});
    expect(config.vars?.COOK_SESSION_BOOTSTRAP_MODE).toBe("1");
    expect(config.env?.qa?.vars?.COOK_SESSION_BOOTSTRAP_MODE).toBe("1");
    expect(config.version_metadata).toEqual({ binding: "CF_VERSION_METADATA" });
    expect(config.env?.qa?.version_metadata).toEqual({ binding: "CF_VERSION_METADATA" });
  });

  it("runs the official Workers lane with the same SQLite namespace", () => {
    const config = readConfig("wrangler.workers-test.json");
    const vitestSource = readFileSync("vitest.workers.config.ts", "utf8");

    expectCookSessionLifecycle(config);
    expect(config.vars?.COOK_SESSION_BOOTSTRAP_MODE).toBe("1");
    expect(config.vars?.SESSION_SECRET).toBe("spoonjoy-workers-cook-session-test-secret");
    expect(config.ratelimits).toContainEqual(expect.objectContaining({ name: "AUTH_IP_RATE_LIMITER" }));
    expect(config.version_metadata).toEqual({ binding: "CF_VERSION_METADATA" });
    expect(vitestSource).toContain('"~": appDirectory');
    expect(vitestSource).toContain('"@": componentsDirectory');
    expect(vitestSource).toContain('".prisma/client/default": prismaWasmClient');
  });

  it("exports the class and types every Worker environment binding", () => {
    expect(existsSync("workers/cook-session.ts")).toBe(true);
    const classSource = existsSync("workers/cook-session.ts")
      ? readFileSync("workers/cook-session.ts", "utf8")
      : "";
    const appSource = readFileSync("workers/app.ts", "utf8");
    const envTypes = readFileSync("app/cloudflare-env.d.ts", "utf8");

    expect(classSource).toMatch(/export\s+class\s+CookSession\b/);
    expect(storageMethodCalls(classSource, "exec").map(({ argument }) => argument)).toEqual([
      "DROP TABLE IF EXISTS __bootstrap_probe",
      "CREATE TABLE __bootstrap_probe (id INTEGER PRIMARY KEY NOT NULL, value TEXT NOT NULL)",
      "INSERT INTO __bootstrap_probe (id, value) VALUES (1, 'sqlite')",
      "SELECT value FROM __bootstrap_probe WHERE id = 1",
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('_cf_KV', '_cf_METADATA') ORDER BY name",
    ]);
    expect(storageMethodCalls(classSource, "deleteAll")).toHaveLength(1);
    expect(appSource).toMatch(/export\s*\{\s*CookSession\s*\}/);
    expect(envTypes).toMatch(/COOK_SESSIONS\??:\s*DurableObjectNamespace/);
    expect(envTypes).toContain("COOK_SESSION_BOOTSTRAP_MODE?: string;");
  });

  it("documents the bootstrap binding lifecycle and managed E2E server accurately", () => {
    const deployment = readFileSync("docs/deployment.md", "utf8");
    const readme = readFileSync("README.md", "utf8");

    expect(deployment).toContain("`COOK_SESSIONS`");
    expect(deployment).toContain("`v1_cook_session`");
    expect(readme).toContain("http://localhost:5197");
    expect(readme).toContain("automatically managed ephemeral Wrangler server");
    expect(readme).not.toContain("Start the dev server first with `pnpm dev`.");
  });

  it.each([
    { operation: "drop", occurrence: 1 },
    { operation: "delete-all", occurrence: 1 },
    { operation: "delete-alarm", occurrence: 1 },
    { operation: "create", occurrence: 1 },
    { operation: "insert", occurrence: 1 },
    { operation: "read-value", occurrence: 1 },
    { operation: "drop", occurrence: 2 },
    { operation: "delete-all", occurrence: 2 },
    { operation: "delete-alarm", occurrence: 2 },
    { operation: "read-residue", occurrence: 1 },
  ] satisfies ProbeFailurePoint[])(
    "recovers on retry after an injected $operation failure at occurrence $occurrence",
    async (failure) => {
      const storage = new FailureInjectingStorage(failure);
      const session = new CookSession(
        { storage } as unknown as DurableObjectState,
        {} as Env,
      );

      await expect(session.fetch(bootstrapProbeRequest())).rejects.toThrow(
        `injected ${failure.operation} failure`,
      );
      const retry = await session.fetch(bootstrapProbeRequest());

      expect(retry.status).toBe(200);
      await expect(retry.json()).resolves.toEqual({ ok: true, storage: "sqlite", residue: 0 });
      expect(storage).toMatchObject({ alarm: false, kv: false, table: false });
    },
  );
});
