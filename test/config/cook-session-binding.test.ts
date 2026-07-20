import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

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
      "CREATE TABLE __bootstrap_probe (id INTEGER PRIMARY KEY NOT NULL, value TEXT NOT NULL)",
      "INSERT INTO __bootstrap_probe (id, value) VALUES (1, 'sqlite')",
      "SELECT value FROM __bootstrap_probe WHERE id = 1",
      "DROP TABLE __bootstrap_probe",
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ]);
    expect(storageMethodCalls(classSource, "deleteAll")).toHaveLength(1);
    expect(appSource).toMatch(/export\s*\{\s*CookSession\s*\}/);
    expect(envTypes).toMatch(/COOK_SESSIONS\??:\s*DurableObjectNamespace/);
    expect(envTypes).toContain("COOK_SESSION_BOOTSTRAP_MODE?: string;");
  });
});
