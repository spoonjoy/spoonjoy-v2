import { afterEach, describe, expect, it, vi } from "vitest";
import { buildContentSecurityPolicy } from "../../app/lib/security-headers.server";
import {
  collectProductionReadinessChecks,
  createProductionReadinessDeps,
  createRemoteUserColumnsReader,
  createWranglerSecretsLister,
  formatCheck,
  REQUIRED_RUNTIME_SECRETS,
  OPTIONAL_FEATURE_SECRET_GROUPS,
  INTENTIONALLY_DISABLED_FEATURE_GROUPS,
  evaluateSecretReadiness,
  hasUserPhotoUrlColumn,
  parseJsonArrayFromWranglerOutput,
  runProductionReadiness,
  runProductionReadinessCli,
  validateCspHeaderSet,
  validatePwaAssetSet,
  validateCutoverRunbook,
} from "../../scripts/production-readiness";

describe("production readiness helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("passes required runtime secrets and reports missing optional feature groups", () => {
    const result = evaluateSecretReadiness([
      ...REQUIRED_RUNTIME_SECRETS,
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET",
    ]);

    expect(result.requiredMissing).toEqual([]);
    expect(result.configuredFeatureGroups).toEqual(["Google OAuth", "GitHub OAuth"]);
    expect(result.missingFeatureGroups).toEqual(["Apple OAuth", "OpenAI AI features"]);
    expect(result.intentionallyDisabledFeatureGroups).toEqual([]);
  });

  it("can classify an intentionally disabled optional feature group", () => {
    (INTENTIONALLY_DISABLED_FEATURE_GROUPS as unknown as string[]).push("Google OAuth");
    try {
      const result = evaluateSecretReadiness([
        ...REQUIRED_RUNTIME_SECRETS,
        "GITHUB_CLIENT_ID",
        "GITHUB_CLIENT_SECRET",
        "APPLE_CLIENT_ID",
        "APPLE_NATIVE_CLIENT_IDS",
        "APPLE_TEAM_ID",
        "APPLE_KEY_ID",
        "APPLE_PRIVATE_KEY",
        "OPENAI_API_KEY",
      ]);

      expect(result.requiredMissing).toEqual([]);
      expect(result.configuredFeatureGroups).toEqual([
        "GitHub OAuth",
        "Apple OAuth",
        "OpenAI AI features",
      ]);
      expect(result.missingFeatureGroups).toEqual([]);
      expect(result.intentionallyDisabledFeatureGroups).toEqual(["Google OAuth"]);

      const checks = collectProductionReadinessChecks({
        listWranglerSecrets: () => [
          ...REQUIRED_RUNTIME_SECRETS,
          "GITHUB_CLIENT_ID",
          "GITHUB_CLIENT_SECRET",
          "APPLE_CLIENT_ID",
          "APPLE_NATIVE_CLIENT_IDS",
          "APPLE_TEAM_ID",
          "APPLE_KEY_ID",
          "APPLE_PRIVATE_KEY",
          "OPENAI_API_KEY",
        ],
        getRemoteUserColumns: () => [{ name: "photoUrl" }],
        exists: () => true,
        readText: () => "data migration\nDNS\nOAuth\nsmoke test\nrollback\n",
      });
      expect(checks).toContainEqual(expect.objectContaining({
        name: "optional feature secrets",
        status: "PASS",
        message: "configured GitHub OAuth, Apple OAuth, OpenAI AI features; intentionally disabled Google OAuth",
      }));
    } finally {
      (INTENTIONALLY_DISABLED_FEATURE_GROUPS as unknown as string[]).pop();
    }
  });

  it("reports missing Google OAuth when its production secrets are absent", () => {
    const result = evaluateSecretReadiness([
      ...REQUIRED_RUNTIME_SECRETS,
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET",
      "APPLE_CLIENT_ID",
      "APPLE_NATIVE_CLIENT_IDS",
      "APPLE_TEAM_ID",
      "APPLE_KEY_ID",
      "APPLE_PRIVATE_KEY",
      "OPENAI_API_KEY",
    ]);

    expect(result.requiredMissing).toEqual([]);
    expect(result.configuredFeatureGroups).toEqual([
      "GitHub OAuth",
      "Apple OAuth",
      "OpenAI AI features",
    ]);
    expect(result.missingFeatureGroups).toEqual(["Google OAuth"]);
    expect(result.intentionallyDisabledFeatureGroups).toEqual([]);
  });

  it("reports missing required runtime secrets", () => {
    const result = evaluateSecretReadiness(["SESSION_SECRET"]);

    expect(result.requiredMissing).toEqual([
      "VAPID_PUBLIC_KEY",
      "VAPID_PRIVATE_KEY",
      "VAPID_SUBJECT",
    ]);
  });

  it("keeps optional feature group definitions complete", () => {
    expect(OPTIONAL_FEATURE_SECRET_GROUPS).toEqual([
      {
        name: "Google OAuth",
        secrets: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
      },
      {
        name: "GitHub OAuth",
        secrets: ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"],
      },
      {
        name: "Apple OAuth",
        secrets: ["APPLE_CLIENT_ID", "APPLE_NATIVE_CLIENT_IDS", "APPLE_TEAM_ID", "APPLE_KEY_ID", "APPLE_PRIVATE_KEY"],
      },
      {
        name: "OpenAI AI features",
        secrets: ["OPENAI_API_KEY"],
      },
    ]);
    expect(INTENTIONALLY_DISABLED_FEATURE_GROUPS).toEqual([]);
  });

  it("detects the remote User.photoUrl column from pragma rows", () => {
    expect(hasUserPhotoUrlColumn([{ name: "id" }, { name: "photoUrl" }])).toBe(true);
    expect(hasUserPhotoUrlColumn([{ name: "id" }, { name: "email" }])).toBe(false);
  });

  it("validates the required PWA asset set", () => {
    expect(validatePwaAssetSet(["public/manifest.webmanifest", "public/sw.js", "public/icons/sj-192.png", "public/icons/sj-512.png"])).toEqual([]);
    expect(validatePwaAssetSet(["public/manifest.webmanifest"])).toEqual([
      "public/sw.js",
      "public/icons/sj-192.png",
      "public/icons/sj-512.png",
    ]);
  });

  it("validates production cutover runbook coverage", () => {
    const validRunbook = [
      "spoonjoy.app",
      "data migration",
      "DNS",
      "OAuth",
      "smoke test",
      "rollback",
    ].join("\n");

    expect(validateCutoverRunbook(validRunbook)).toEqual([]);
    expect(validateCutoverRunbook("spoonjoy.app")).toEqual([
      "data migration",
      "DNS",
      "OAuth",
      "smoke test",
      "rollback",
    ]);
  });

  it("validates production CSP enforcement headers without printing live evidence", () => {
    const enforced = new Headers({
      "Content-Security-Policy": buildContentSecurityPolicy("live"),
      "Reporting-Endpoints": 'csp-endpoint="/csp-report"',
      "X-Spoonjoy-Worker-Version": "22222222-2222-4222-8222-222222222222",
    });
    expect(validateCspHeaderSet(enforced, {
      expectedWorkerVersionId: "22222222-2222-4222-8222-222222222222",
      requireNonce: true,
    })).toEqual([]);

    const reportOnly = new Headers({
      "Content-Security-Policy": buildContentSecurityPolicy("live"),
      "Content-Security-Policy-Report-Only": "default-src 'self'; report-uri /csp-report",
      "Reporting-Endpoints": 'csp-endpoint="/csp-report"',
    });
    expect(validateCspHeaderSet(reportOnly, {
      expectedWorkerVersionId: "22222222-2222-4222-8222-222222222222",
      requireNonce: true,
    })).toEqual([
      "Content-Security-Policy-Report-Only",
      "X-Spoonjoy-Worker-Version",
    ]);

    const missingTelemetry = new Headers({
      "Content-Security-Policy": buildContentSecurityPolicy(),
      "X-Spoonjoy-Worker-Version": "22222222-2222-4222-8222-222222222222",
    });
    expect(validateCspHeaderSet(missingTelemetry)).toEqual([
      "CSP violation reporting",
    ]);

    expect(validateCspHeaderSet(new Headers())).toEqual([
      "Content-Security-Policy",
      "X-Spoonjoy-Worker-Version",
    ]);
  });

  it("validates candidate CSP version and nonce contract failure modes", () => {
    const missingNonce = new Headers({
      "Content-Security-Policy": buildContentSecurityPolicy(),
      "Reporting-Endpoints": 'csp-endpoint="/csp-report"',
      "X-Spoonjoy-Worker-Version": "33333333-3333-4333-8333-333333333333",
    });

    expect(validateCspHeaderSet(missingNonce, {
      expectedWorkerVersionId: "22222222-2222-4222-8222-222222222222",
      requireNonce: true,
    })).toEqual([
      "X-Spoonjoy-Worker-Version exact candidate",
      "CSP nonce contract",
    ]);

    const missingScriptDirective = new Headers({
      "Content-Security-Policy": buildContentSecurityPolicy("live").replace(/script-src[^;]+; /, ""),
      "Reporting-Endpoints": 'csp-endpoint="/csp-report"',
      "X-Spoonjoy-Worker-Version": "22222222-2222-4222-8222-222222222222",
    });
    expect(validateCspHeaderSet(missingScriptDirective, { requireNonce: true })).toEqual([
      "CSP nonce contract",
      "CSP script-src exact sources",
    ]);
  });

  it("rejects duplicate directives even when the first occurrence is secure", () => {
    const csp = [
      buildContentSecurityPolicy("live"),
      "",
      "default-src *",
      "",
      "object-src *",
    ].join("; ");
    const headers = new Headers({
      "Content-Security-Policy": csp,
      "Reporting-Endpoints": 'csp-endpoint="/csp-report"',
      "X-Spoonjoy-Worker-Version": "22222222-2222-4222-8222-222222222222",
    });

    expect(validateCspHeaderSet(headers, {
      expectedWorkerVersionId: "22222222-2222-4222-8222-222222222222",
      requireNonce: true,
    })).toEqual([
      "CSP duplicate directive: default-src",
      "CSP duplicate directive: object-src",
    ]);
  });

  it.each([
    ["style-src", "style-src 'self' https://evil.example"],
    ["font-src", "font-src 'self' https://evil.example"],
    ["img-src", "img-src 'self' data: blob: https: https://evil.example"],
    ["connect-src", "connect-src 'self' https://us.i.posthog.com https://us-assets.i.posthog.com https://evil.example"],
  ])("rejects a weakened %s directive", (directive, replacement) => {
    const csp = buildContentSecurityPolicy("live").replace(
      new RegExp(`${directive}[^;]+`),
      replacement,
    );
    const headers = new Headers({
      "Content-Security-Policy": csp,
      "Reporting-Endpoints": 'csp-endpoint="/csp-report"',
      "X-Spoonjoy-Worker-Version": "22222222-2222-4222-8222-222222222222",
    });

    expect(validateCspHeaderSet(headers, { requireNonce: true })).toContain(
      `CSP ${directive} exact sources`,
    );
  });

  it("rejects extra script origins, forged reporting tokens, and unknown directives", () => {
    const base = buildContentSecurityPolicy("live");
    const hostilePolicies = [
      [
        base.replace(
          "script-src 'self' 'nonce-live' https://us-assets.i.posthog.com",
          "script-src 'self' 'nonce-live' https://us-assets.i.posthog.com https://evil.example",
        ),
        "CSP script-src exact sources",
      ],
      [
        base.replace("report-uri /csp-report", "report-uri /csp-report-evil"),
        "CSP report-uri exact sources",
      ],
      [
        base.replace("report-to csp-endpoint", "report-to csp-endpoint-evil"),
        "CSP report-to exact sources",
      ],
      [`${base}; upgrade-insecure-requests`, "CSP unknown directive: upgrade-insecure-requests"],
    ] as const;

    for (const [csp, expectedFailure] of hostilePolicies) {
      const headers = new Headers({
        "Content-Security-Policy": csp,
        "Reporting-Endpoints": 'csp-endpoint="/csp-report"',
        "X-Spoonjoy-Worker-Version": "22222222-2222-4222-8222-222222222222",
      });
      expect(validateCspHeaderSet(headers, { requireNonce: true })).toContain(expectedFailure);
    }
  });

  it("validates PostHog script and connection origins against the configured host only", () => {
    const customHost = "https://analytics.example.com";
    const valid = new Headers({
      "Content-Security-Policy": buildContentSecurityPolicy("live", {
        VITE_POSTHOG_HOST: customHost,
      }),
      "Reporting-Endpoints": 'csp-endpoint="/csp-report"',
      "X-Spoonjoy-Worker-Version": "22222222-2222-4222-8222-222222222222",
    });
    expect(validateCspHeaderSet(valid, {
      postHogHost: customHost,
      requireNonce: true,
    })).toEqual([]);

    expect(validateCspHeaderSet(valid, {
      postHogHost: "https://eu.i.posthog.com",
      requireNonce: true,
    })).toEqual(expect.arrayContaining([
      "CSP script-src exact sources",
      "CSP connect-src exact sources",
    ]));
  });

  it("rejects wildcard and unsafe CSP directives before production promotion", () => {
    const hostile = new Headers({
      "Content-Security-Policy": "default-src *; script-src * 'unsafe-inline' 'unsafe-eval' 'nonce-x'; object-src *; frame-ancestors *; base-uri *; form-action *; report-uri /csp-report; report-to csp-endpoint",
      "Reporting-Endpoints": 'csp-endpoint="/csp-report"',
      "X-Spoonjoy-Worker-Version": "22222222-2222-4222-8222-222222222222",
    });

    expect(validateCspHeaderSet(hostile, {
      expectedWorkerVersionId: "22222222-2222-4222-8222-222222222222",
      requireNonce: true,
    })).toEqual([
      "CSP default-src lockdown",
      "CSP base-uri lockdown",
      "CSP object-src lockdown",
      "CSP frame-ancestors lockdown",
      "CSP form-action lockdown",
      "CSP script-src exact sources",
      "CSP style-src exact sources",
      "CSP font-src exact sources",
      "CSP img-src exact sources",
      "CSP connect-src exact sources",
    ]);
  });

  it("parses Wrangler JSON arrays and rejects malformed command output", () => {
    expect(parseJsonArrayFromWranglerOutput("prefix\n[{\"name\":\"SESSION_SECRET\"}]\n")).toEqual([
      { name: "SESSION_SECRET" },
    ]);
    expect(() => parseJsonArrayFromWranglerOutput("no json here")).toThrow(/JSON array/);
    expect(() => parseJsonArrayFromWranglerOutput("{\"not\":\"array\"}")).toThrow(/JSON array/);
  });

  it("builds default Wrangler readers from injected execFileSync adapters", () => {
    const execFile = ((command: string, args: readonly string[]) => {
      if (command !== "pnpm") throw new Error("wrong command");
      if (args.join(" ") === "exec wrangler secret list") {
        return JSON.stringify([{ name: "SESSION_SECRET" }, { name: 12 }, {}]);
      }
      if (args.join(" ").includes("PRAGMA table_info")) {
        return JSON.stringify([{ results: [{ name: "id" }, { name: "photoUrl" }] }]);
      }
      throw new Error("unexpected args");
    }) as unknown as typeof import("node:child_process").execFileSync;

    expect(createWranglerSecretsLister(execFile)()).toEqual(["SESSION_SECRET"]);
    expect(createRemoteUserColumnsReader(execFile)()).toEqual([{ name: "id" }, { name: "photoUrl" }]);

    const emptyColumnsExecFile = (() => JSON.stringify([{ noResults: [] }])) as unknown as typeof import("node:child_process").execFileSync;
    expect(createRemoteUserColumnsReader(emptyColumnsExecFile)()).toEqual([]);
  });

  it("constructs injectable and default production readiness side-effect adapters", () => {
    const logs: string[] = [];
    const execFile = ((command: string, args: readonly string[]) => {
      if (command !== "pnpm") throw new Error("wrong command");
      if (args.join(" ") === "exec wrangler secret list") {
        return JSON.stringify([{ name: "SESSION_SECRET" }]);
      }
      return JSON.stringify([{ results: [{ name: "photoUrl" }] }]);
    }) as unknown as typeof import("node:child_process").execFileSync;

    const injected = createProductionReadinessDeps({
      execFile,
      exists: (filePath) => filePath === "docs/production-cutover.md",
      readText: () => "data migration\nDNS\nOAuth\nsmoke test\nrollback\n",
      log: (message) => logs.push(message),
    });

    expect(injected.listWranglerSecrets()).toEqual(["SESSION_SECRET"]);
    expect(injected.getRemoteUserColumns()).toEqual([{ name: "photoUrl" }]);
    expect(injected.exists("docs/production-cutover.md")).toBe(true);
    expect(injected.readText("docs/production-cutover.md")).toContain("rollback");
    injected.log?.("ready");
    expect(logs).toEqual(["ready"]);

    const defaults = createProductionReadinessDeps();
    expect(defaults.exists("package.json")).toBe(true);
    expect(defaults.readText("package.json")).toContain("spoonjoy-v2");
    expect(defaults.log).toBe(console.log);
  });

  it("collects and prints production readiness checks through injectable side effects", () => {
    const logs: string[] = [];
    const deps = {
      listWranglerSecrets: () => [...REQUIRED_RUNTIME_SECRETS, "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
      getRemoteUserColumns: () => [{ name: "id" }, { name: "photoUrl" }],
      exists: (asset: string) => asset !== "public/sw.js",
      readText: () => "data migration\nDNS\nOAuth\nsmoke test\nrollback\n",
      log: (message: string) => logs.push(message),
    };

    const checks = collectProductionReadinessChecks(deps);
    expect(checks.map((check) => [check.name, check.status])).toEqual([
      ["required runtime secrets", "PASS"],
      ["optional feature secrets", "WARN"],
      ["PWA assets", "FAIL"],
      ["production cutover runbook", "PASS"],
      ["remote User.photoUrl schema", "PASS"],
    ]);
    expect(formatCheck(checks[2])).toBe("FAIL PWA assets: missing public/sw.js");

    expect(runProductionReadiness(deps)).toBe(1);
    expect(logs).toContain("FAIL PWA assets: missing public/sw.js");
  });

  it("passes and logs through the console fallback when every readiness check is healthy", () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const deps = {
      listWranglerSecrets: () => [
        ...REQUIRED_RUNTIME_SECRETS,
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "GITHUB_CLIENT_ID",
        "GITHUB_CLIENT_SECRET",
        "APPLE_CLIENT_ID",
        "APPLE_NATIVE_CLIENT_IDS",
        "APPLE_TEAM_ID",
        "APPLE_KEY_ID",
        "APPLE_PRIVATE_KEY",
        "OPENAI_API_KEY",
      ],
      getRemoteUserColumns: () => [{ name: "photoUrl" }],
      exists: () => true,
      readText: () => "data migration\nDNS\nOAuth\nsmoke test\nrollback\n",
    };

    expect(collectProductionReadinessChecks(deps).map((check) => check.status)).toEqual([
      "PASS",
      "PASS",
      "PASS",
      "PASS",
      "PASS",
    ]);
    expect(runProductionReadiness(deps)).toBe(0);
    expect(consoleLog).toHaveBeenCalledWith("PASS required runtime secrets: all required runtime secrets are present");

    runProductionReadinessCli({ ...deps, log: () => undefined });
    expect(process.exitCode).toBe(0);
  });

  it("fails readiness when the runbook or remote schema evidence is absent", () => {
    const deps = {
      listWranglerSecrets: () => ["SESSION_SECRET"],
      getRemoteUserColumns: () => [{ name: "id" }],
      exists: () => false,
      readText: () => "",
      log: () => undefined,
    };

    const checks = collectProductionReadinessChecks(deps);
    expect(checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "required runtime secrets",
        status: "FAIL",
        message: "missing VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT",
      }),
      expect.objectContaining({
        name: "production cutover runbook",
        status: "FAIL",
        message: "missing docs/production-cutover.md",
      }),
      expect.objectContaining({
        name: "remote User.photoUrl schema",
        status: "FAIL",
        message: "remote User table is missing photoUrl",
      }),
    ]));
  });
});
