import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

export const REQUIRED_RUNTIME_SECRETS = [
  "SESSION_SECRET",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
] as const;

export const OPTIONAL_FEATURE_SECRET_GROUPS = [
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
    secrets: ["APPLE_CLIENT_ID", "APPLE_TEAM_ID", "APPLE_KEY_ID", "APPLE_PRIVATE_KEY"],
  },
  {
    name: "OpenAI AI features",
    secrets: ["OPENAI_API_KEY"],
  },
] as const;

export const INTENTIONALLY_DISABLED_FEATURE_GROUPS = ["Google OAuth"] as const;

export const REQUIRED_PWA_ASSETS = [
  "public/manifest.webmanifest",
  "public/sw.js",
  "public/icons/sj-192.png",
  "public/icons/sj-512.png",
] as const;

const CUTOVER_RUNBOOK_TERMS = [
  "data migration",
  "DNS",
  "OAuth",
  "smoke test",
  "rollback",
] as const;

interface SecretReadiness {
  requiredMissing: string[];
  configuredFeatureGroups: string[];
  missingFeatureGroups: string[];
  intentionallyDisabledFeatureGroups: string[];
}

interface CheckResult {
  name: string;
  status: "PASS" | "WARN" | "FAIL";
  message: string;
}

export function evaluateSecretReadiness(secretNames: Iterable<string>): SecretReadiness {
  const names = new Set(secretNames);
  const intentionallyDisabled = new Set<string>(INTENTIONALLY_DISABLED_FEATURE_GROUPS);
  const requiredMissing = REQUIRED_RUNTIME_SECRETS.filter((secret) => !names.has(secret));
  const configuredFeatureGroups: string[] = [];
  const missingFeatureGroups: string[] = [];
  const intentionallyDisabledFeatureGroups: string[] = [];

  for (const group of OPTIONAL_FEATURE_SECRET_GROUPS) {
    const isConfigured = group.secrets.every((secret) => names.has(secret));
    if (isConfigured) {
      configuredFeatureGroups.push(group.name);
    } else if (intentionallyDisabled.has(group.name)) {
      intentionallyDisabledFeatureGroups.push(group.name);
    } else {
      missingFeatureGroups.push(group.name);
    }
  }

  return {
    requiredMissing,
    configuredFeatureGroups,
    missingFeatureGroups,
    intentionallyDisabledFeatureGroups,
  };
}

export function hasUserPhotoUrlColumn(rows: Array<{ name?: unknown }>): boolean {
  return rows.some((row) => row.name === "photoUrl");
}

export function validatePwaAssetSet(paths: Iterable<string>): string[] {
  const present = new Set(paths);
  return REQUIRED_PWA_ASSETS.filter((asset) => !present.has(asset));
}

export function validateCutoverRunbook(content: string): string[] {
  return CUTOVER_RUNBOOK_TERMS.filter((term) => !content.includes(term));
}

function parseJsonArrayFromWranglerOutput(output: string): unknown[] {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Wrangler output did not contain a JSON array.");
  }

  const parsed = JSON.parse(output.slice(start, end + 1)) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Wrangler output JSON was not an array.");
  }

  return parsed;
}

function listWranglerSecrets(): string[] {
  const output = execFileSync("pnpm", ["exec", "wrangler", "secret", "list"], {
    encoding: "utf8",
  });
  const rows = parseJsonArrayFromWranglerOutput(output);

  return rows
    .map((row) => (typeof row === "object" && row !== null && "name" in row ? row.name : null))
    .filter((name): name is string => typeof name === "string");
}

function getRemoteUserColumns(): Array<{ name?: unknown }> {
  const output = execFileSync(
    "pnpm",
    ["exec", "wrangler", "d1", "execute", "DB", "--remote", "--command", "PRAGMA table_info('User');"],
    { encoding: "utf8" }
  );
  const rows = parseJsonArrayFromWranglerOutput(output);
  const first = rows[0];

  if (
    typeof first === "object" &&
    first !== null &&
    "results" in first &&
    Array.isArray(first.results)
  ) {
    return first.results as Array<{ name?: unknown }>;
  }

  return [];
}

function formatCheck(check: CheckResult): string {
  return `${check.status} ${check.name}: ${check.message}`;
}

function runProductionReadiness() {
  const checks: CheckResult[] = [];
  const secretReadiness = evaluateSecretReadiness(listWranglerSecrets());
  checks.push({
    name: "required runtime secrets",
    status: secretReadiness.requiredMissing.length === 0 ? "PASS" : "FAIL",
    message: secretReadiness.requiredMissing.length === 0
      ? "all required runtime secrets are present"
      : `missing ${secretReadiness.requiredMissing.join(", ")}`,
  });
  checks.push({
    name: "optional feature secrets",
    status: secretReadiness.missingFeatureGroups.length === 0 ? "PASS" : "WARN",
    message: secretReadiness.missingFeatureGroups.length === 0
      ? [
          `configured ${secretReadiness.configuredFeatureGroups.join(", ")}`,
          secretReadiness.intentionallyDisabledFeatureGroups.length > 0
            ? `intentionally disabled ${secretReadiness.intentionallyDisabledFeatureGroups.join(", ")}`
            : "",
        ].filter(Boolean).join("; ")
      : `missing ${secretReadiness.missingFeatureGroups.join(", ")}`,
  });

  const pwaMissing = validatePwaAssetSet(REQUIRED_PWA_ASSETS.filter((asset) => existsSync(asset)));
  checks.push({
    name: "PWA assets",
    status: pwaMissing.length === 0 ? "PASS" : "FAIL",
    message: pwaMissing.length === 0 ? "manifest, service worker, and icons exist" : `missing ${pwaMissing.join(", ")}`,
  });

  const runbookPath = "docs/production-cutover.md";
  const runbookMissing = existsSync(runbookPath)
    ? validateCutoverRunbook(readFileSync(runbookPath, "utf8"))
    : ["docs/production-cutover.md"];
  checks.push({
    name: "production cutover runbook",
    status: runbookMissing.length === 0 ? "PASS" : "FAIL",
    message: runbookMissing.length === 0 ? "runbook covers migration, DNS, OAuth, smoke, and rollback" : `missing ${runbookMissing.join(", ")}`,
  });

  const userColumns = getRemoteUserColumns();
  checks.push({
    name: "remote User.photoUrl schema",
    status: hasUserPhotoUrlColumn(userColumns) ? "PASS" : "FAIL",
    message: hasUserPhotoUrlColumn(userColumns) ? "remote User table includes photoUrl" : "remote User table is missing photoUrl",
  });

  for (const check of checks) {
    console.log(formatCheck(check));
  }

  if (checks.some((check) => check.status === "FAIL")) {
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runProductionReadiness();
}
