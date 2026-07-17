import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolvePostHogCspOrigins } from "../app/lib/security-headers.server";

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
    secrets: ["APPLE_CLIENT_ID", "APPLE_NATIVE_CLIENT_IDS", "APPLE_TEAM_ID", "APPLE_KEY_ID", "APPLE_PRIVATE_KEY"],
  },
  {
    name: "OpenAI AI features",
    secrets: ["OPENAI_API_KEY"],
  },
] as const;

export const INTENTIONALLY_DISABLED_FEATURE_GROUPS = [] as const;

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

export interface CheckResult {
  name: string;
  status: "PASS" | "WARN" | "FAIL";
  message: string;
}

export interface ValidateCspHeaderOptions {
  expectedWorkerVersionId?: string;
  postHogHost?: string | null;
  requireNonce?: boolean;
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

interface ParsedCspDirectives {
  directives: Map<string, string[]>;
  duplicates: string[];
}

function parseCspDirectives(csp: string): ParsedCspDirectives {
  const directives = new Map<string, string[]>();
  const duplicates: string[] = [];
  for (const segment of csp.split(";")) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    const [directive, ...sources] = tokens;
    if (!directive) continue;
    const name = directive.toLowerCase();
    if (directives.has(name)) duplicates.push(name);
    else directives.set(name, sources);
  }
  return { directives, duplicates };
}

function directiveEquals(
  directives: Map<string, string[]>,
  name: string,
  expected: readonly string[],
): boolean {
  const sources = directives.get(name);
  return Boolean(
    sources &&
      sources.length === expected.length &&
      new Set(sources).size === sources.length &&
      expected.every((source) => sources.includes(source)),
  );
}

const NONCE_SOURCE_PATTERN = /^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/;

function isValidNonceSource(source: string): boolean {
  const match = source.match(NONCE_SOURCE_PATTERN);
  if (!match) return false;
  const encoded = match[1];
  const payload = encoded.replace(/=+$/, "");
  if (payload.length < 22) return false;
  return encoded.length % 4 !== 1;
}

function expectedCspDirectives(postHogHost?: string | null): Map<string, readonly string[]> {
  const postHog = resolvePostHogCspOrigins({ VITE_POSTHOG_HOST: postHogHost });
  return new Map([
    ["default-src", ["'self'"]],
    ["base-uri", ["'self'"]],
    ["object-src", ["'none'"]],
    ["frame-ancestors", ["'none'"]],
    ["form-action", ["'self'"]],
    ["script-src", Array.from(new Set(["'self'", postHog.assetsOrigin]))],
    ["style-src", ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"]],
    ["font-src", ["'self'", "https://fonts.gstatic.com"]],
    ["img-src", ["'self'", "data:", "blob:", "https:"]],
    ["connect-src", Array.from(new Set(["'self'", postHog.ingestOrigin, postHog.assetsOrigin]))],
    ["report-uri", ["/csp-report"]],
    ["report-to", ["csp-endpoint"]],
  ]);
}

function validateCspDirectiveLockdown(
  csp: string,
  options: ValidateCspHeaderOptions,
): string[] {
  const missing: string[] = [];
  const parsed = parseCspDirectives(csp);
  const { directives } = parsed;
  const expected = expectedCspDirectives(options.postHogHost);

  for (const duplicate of parsed.duplicates) {
    missing.push(`CSP duplicate directive: ${duplicate}`);
  }
  for (const name of directives.keys()) {
    if (!expected.has(name)) missing.push(`CSP unknown directive: ${name}`);
  }

  for (const [name, sources, failure] of [
    ["default-src", ["'self'"], "CSP default-src lockdown"],
    ["base-uri", ["'self'"], "CSP base-uri lockdown"],
    ["object-src", ["'none'"], "CSP object-src lockdown"],
    ["frame-ancestors", ["'none'"], "CSP frame-ancestors lockdown"],
    ["form-action", ["'self'"], "CSP form-action lockdown"],
  ] as const) {
    if (!directiveEquals(directives, name, sources)) {
      missing.push(failure);
    }
  }

  const scriptSources = directives.get("script-src") ?? [];
  const nonceSources = scriptSources.filter((source) => source.startsWith("'nonce-"));
  const validNonceSources = nonceSources.filter(isValidNonceSource);
  if (
    nonceSources.length !== validNonceSources.length ||
    nonceSources.length > 1 ||
    (options.requireNonce && validNonceSources.length !== 1)
  ) {
    missing.push("CSP nonce contract");
  }
  const scriptSourcesWithoutNonce = scriptSources.filter(
    (source) => !source.startsWith("'nonce-"),
  );
  if (
    !directiveEquals(
      new Map([["script-src", scriptSourcesWithoutNonce]]),
      "script-src",
      expected.get("script-src")!,
    ) ||
    nonceSources.length > 1
  ) {
    missing.push("CSP script-src exact sources");
  }

  for (const name of ["style-src", "font-src", "img-src", "connect-src", "report-uri", "report-to"] as const) {
    if (!directiveEquals(directives, name, expected.get(name)!)) {
      missing.push(`CSP ${name} exact sources`);
    }
  }

  return missing;
}

export function validateCspHeaderSet(
  headers: Pick<Headers, "get">,
  options: ValidateCspHeaderOptions = {},
): string[] {
  const missing: string[] = [];
  const csp = headers.get("Content-Security-Policy");
  if (!csp) {
    missing.push("Content-Security-Policy");
  }
  if (headers.get("Content-Security-Policy-Report-Only")) {
    missing.push("Content-Security-Policy-Report-Only");
  }
  const workerVersion = headers.get("X-Spoonjoy-Worker-Version");
  if (!workerVersion) {
    missing.push("X-Spoonjoy-Worker-Version");
  } else if (
    options.expectedWorkerVersionId &&
    workerVersion.toLowerCase() !== options.expectedWorkerVersionId.toLowerCase()
  ) {
    missing.push("X-Spoonjoy-Worker-Version exact candidate");
  }
  if (csp && headers.get("Reporting-Endpoints")?.trim() !== 'csp-endpoint="/csp-report"') {
    missing.push("CSP violation reporting");
  }
  if (csp) {
    missing.push(...validateCspDirectiveLockdown(csp, options));
  }
  return missing;
}

export function parseJsonArrayFromWranglerOutput(output: string): unknown[] {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Wrangler output did not contain a JSON array.");
  }

  return JSON.parse(output.slice(start, end + 1)) as unknown[];
}

type ExecFileSyncLike = typeof execFileSync;

export function createWranglerSecretsLister(
  execFile: ExecFileSyncLike,
): () => string[] {
  return () => {
    const output = execFile("pnpm", ["exec", "wrangler", "secret", "list"], {
      encoding: "utf8",
    }) as string;
    const rows = parseJsonArrayFromWranglerOutput(output);

    return rows
      .map((row) => (typeof row === "object" && row !== null && "name" in row ? row.name : null))
      .filter((name): name is string => typeof name === "string");
  };
}

export function createRemoteUserColumnsReader(
  execFile: ExecFileSyncLike,
): () => Array<{ name?: unknown }> {
  return () => {
    const output = execFile(
      "pnpm",
      ["exec", "wrangler", "d1", "execute", "DB", "--remote", "--command", "PRAGMA table_info('User');"],
      { encoding: "utf8" }
    ) as string;
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
  };
}

export function formatCheck(check: CheckResult): string {
  return `${check.status} ${check.name}: ${check.message}`;
}

export interface ProductionReadinessDeps {
  listWranglerSecrets: () => string[];
  getRemoteUserColumns: () => Array<{ name?: unknown }>;
  exists: (path: string) => boolean;
  readText: (path: string) => string;
  log?: (message: string) => void;
}

export interface ProductionReadinessDefaultDepsOptions {
  execFile?: ExecFileSyncLike;
  exists?: (path: string) => boolean;
  readText?: (path: string) => string;
  log?: (message: string) => void;
}

function readTextFile(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

export function createProductionReadinessDeps(
  options: ProductionReadinessDefaultDepsOptions = {},
): ProductionReadinessDeps {
  const execFile = options.execFile ?? execFileSync;
  return {
    listWranglerSecrets: createWranglerSecretsLister(execFile),
    getRemoteUserColumns: createRemoteUserColumnsReader(execFile),
    exists: options.exists ?? existsSync,
    readText: options.readText ?? readTextFile,
    log: options.log ?? console.log,
  };
}

export function collectProductionReadinessChecks(deps: ProductionReadinessDeps): CheckResult[] {
  const checks: CheckResult[] = [];
  const secretReadiness = evaluateSecretReadiness(deps.listWranglerSecrets());
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

  const pwaMissing = validatePwaAssetSet(REQUIRED_PWA_ASSETS.filter((asset) => deps.exists(asset)));
  checks.push({
    name: "PWA assets",
    status: pwaMissing.length === 0 ? "PASS" : "FAIL",
    message: pwaMissing.length === 0 ? "manifest, service worker, and icons exist" : `missing ${pwaMissing.join(", ")}`,
  });

  const runbookPath = "docs/production-cutover.md";
  const runbookMissing = deps.exists(runbookPath)
    ? validateCutoverRunbook(deps.readText(runbookPath))
    : ["docs/production-cutover.md"];
  checks.push({
    name: "production cutover runbook",
    status: runbookMissing.length === 0 ? "PASS" : "FAIL",
    message: runbookMissing.length === 0 ? "runbook covers migration, DNS, OAuth, smoke, and rollback" : `missing ${runbookMissing.join(", ")}`,
  });

  const userColumns = deps.getRemoteUserColumns();
  checks.push({
    name: "remote User.photoUrl schema",
    status: hasUserPhotoUrlColumn(userColumns) ? "PASS" : "FAIL",
    message: hasUserPhotoUrlColumn(userColumns) ? "remote User table includes photoUrl" : "remote User table is missing photoUrl",
  });

  return checks;
}

export function runProductionReadiness(deps: ProductionReadinessDeps): number {
  const checks = collectProductionReadinessChecks(deps);
  for (const check of checks) {
    (deps.log ?? console.log)(formatCheck(check));
  }
  return checks.some((check) => check.status === "FAIL") ? 1 : 0;
}

export function runProductionReadinessCli(deps: ProductionReadinessDeps): void {
  process.exitCode = runProductionReadiness(deps);
}

/* istanbul ignore if -- @preserve CLI boundary constructs real Wrangler/file-system side-effect deps. */
if (import.meta.url === `file://${process.argv[1]}`) {
  runProductionReadinessCli(createProductionReadinessDeps());
}
