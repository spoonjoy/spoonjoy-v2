import { describe, expect, it } from "vitest";
import {
  collectProductionReadinessChecks,
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
  validateCspHeaderSet,
  validatePwaAssetSet,
  validateCutoverRunbook,
} from "../../scripts/production-readiness";

describe("production readiness helpers", () => {
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
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'nonce-live' https://us-assets.i.posthog.com; report-uri /csp-report; report-to csp-endpoint",
      "Reporting-Endpoints": 'csp-endpoint="/csp-report"',
      "X-Spoonjoy-Worker-Version": "22222222-2222-4222-8222-222222222222",
    });
    expect(validateCspHeaderSet(enforced, {
      expectedWorkerVersionId: "22222222-2222-4222-8222-222222222222",
      requireNonce: true,
    })).toEqual([]);

    const reportOnly = new Headers({
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'nonce-live'; report-uri /csp-report; report-to csp-endpoint",
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
      "Content-Security-Policy": "default-src 'self'; script-src 'self'",
      "X-Spoonjoy-Worker-Version": "22222222-2222-4222-8222-222222222222",
    });
    expect(validateCspHeaderSet(missingTelemetry)).toEqual([
      "CSP violation reporting",
    ]);
  });

  it("validates candidate CSP version and nonce contract failure modes", () => {
    const missingNonce = new Headers({
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; report-uri /csp-report; report-to csp-endpoint",
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
});
