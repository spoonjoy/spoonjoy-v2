import { execFile as nodeExecFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { parseDocument } from "yaml";
import { z } from "zod";
import { createReactRouterBuildPlan } from "./react-router-build-runner";

export type PreflightSeverity = "error" | "warning";

export interface PreflightCheck {
  name: string;
  ok: boolean;
  severity: PreflightSeverity;
  message: string;
}

export interface DeploymentPreflightInputs {
  wrangler: Record<string, unknown>;
  packageJson: Record<string, unknown>;
  ciWorkflow: string;
  productionDeployWorkflow: string;
  qaImageCoverSmokeWorkflow: string;
  storybookWorkflow: string;
  gitignore: string;
  pnpmWorkspace: string;
  cloudflareEnvDts: string;
  reactRouterBuild: string;
  readme: string;
  deploymentDoc: string;
  vitestConfig: string;
  tsconfigScripts: string;
  migrationFiles: string[];
  cspReportOnlyBreakGlass?: string;
}

export interface DeploymentPreflightResult {
  checks: PreflightCheck[];
  errors: PreflightCheck[];
  warnings: PreflightCheck[];
}

const REQUIRED_SECRET_NAMES = [
  "SESSION_SECRET",
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
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
] as const;

const TELEMETRY_SERVER_ENV_NAMES = [
  "POSTHOG_KEY",
  "POSTHOG_HOST",
  "POSTHOG_DISABLED",
] as const;

const TELEMETRY_CLIENT_ENV_NAMES = [
  "VITE_POSTHOG_KEY",
  "VITE_POSTHOG_HOST",
  "VITE_POSTHOG_DISABLED",
] as const;

const IMAGE_PROVIDER_ENV_NAMES = [
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "GEMINI_IMAGE_MODEL",
  "GEMINI_IMAGE_TIMEOUT_MS",
  "IMAGE_PROVIDER_PRIMARY",
  "IMAGE_PROVIDER_FALLBACKS",
] as const;

const REQUIRED_PACKAGE_SCRIPTS = [
  "build",
  "deploy",
  "deploy:auto",
  "deploy:preflight",
  "typecheck",
  "test:coverage",
  "test:e2e",
  "smoke:api",
  "db:seed",
] as const;

const REQUIRED_QA_PACKAGE_SCRIPTS = [
  "qa:preflight",
  "qa:migrate",
  "qa:seed",
  "deploy:qa",
  "smoke:qa",
  "smoke:qa:image-cover",
] as const;

const REQUIRED_BUILD_PACKAGE_SCRIPT =
  "pnpm run api:playground:generate && tsx scripts/react-router-build.ts";
const REQUIRED_QA_DEPLOY_PACKAGE_SCRIPT =
  "SPOONJOY_PREFLIGHT_SKIP_REMOTE=1 pnpm run qa:preflight && node scripts/warning-gate.ts -- env CLOUDFLARE_ENV=qa pnpm run build && pnpm run qa:migrate && SPOONJOY_QA_PREFLIGHT_EXPECT_BUILD_CONFIG=1 pnpm run qa:preflight && pnpm exec wrangler deploy --env qa";

const REQUIRED_CLEANUP_PACKAGE_SCRIPTS = {
  "cleanup:qa": "node scripts/cleanup-local-qa-data.mjs --target-env local",
  "cleanup:local": "node scripts/cleanup-local-qa-data.mjs --target-env local",
  "cleanup:local:apply": "node scripts/cleanup-local-qa-data.mjs --target-env local --apply",
  "cleanup:remote:qa": "node scripts/cleanup-local-qa-data.mjs --target-env qa",
  "cleanup:remote:qa:apply": "node scripts/cleanup-local-qa-data.mjs --target-env qa --apply",
  "cleanup:production": "node scripts/cleanup-local-qa-data.mjs --target-env production",
} as const;

const REQUIRED_SCRIPT_COVERAGE_INCLUDES = [
  "workers/app.ts",
  "scripts/script-environment.mjs",
  "scripts/cleanup-local-qa-data.mjs",
  "scripts/smoke-api-live.mjs",
  "scripts/qa-preflight.ts",
  "scripts/deployment-preflight.ts",
  "scripts/deploy-production-canary.ts",
  "scripts/production-readiness.ts",
  "scripts/posthog-build-metadata.ts",
  "scripts/react-router-build-runner.ts",
  "scripts/warning-gate.ts",
  "scripts/workflow-security.mjs",
] as const;

const REQUIRED_SCRIPT_TYPECHECK_INCLUDES = [
  "scripts/build-output-hygiene.ts",
  "scripts/deployment-preflight.ts",
  "scripts/deploy-production-canary.ts",
  "scripts/production-readiness.ts",
  "scripts/posthog-build-metadata.ts",
  "scripts/qa-preflight.ts",
  "scripts/react-router-build.ts",
  "scripts/react-router-build-runner.ts",
  "scripts/warning-gate.ts",
  "scripts/workflow-security.mjs",
] as const;
const CSP_REPORT_ONLY_BREAK_GLASS_ACK = "ACK_REPORT_ONLY_CSP_ROLLBACK";

const REQUIRED_RATE_LIMIT_BINDINGS = [
  "API_TOKEN_RATE_LIMITER",
  "API_IP_RATE_LIMITER",
  "AUTH_IP_RATE_LIMITER",
] as const;

const STORYBOOK_PAGES_DEPLOY_DIR = "storybook-pages-deploy";
const STORYBOOK_PAGES_OUTPUT_DIR = "storybook-static";
const STORYBOOK_PAGES_PROJECT_NAME = "spoonjoy-storybook";
const STORYBOOK_PAGES_DEPLOY_COMMAND =
  "pages deploy --project-name=spoonjoy-storybook --branch=${{ github.ref_name }} --commit-hash=${{ github.sha }} --commit-dirty=true";
const STORYBOOK_REQUIRED_JOB_NAME =
  "${{ github.event_name == 'workflow_dispatch' && 'manual-build-storybook' || 'build-storybook' }}";
const REQUIRED_PNPM_PACKAGE_MANAGER = "pnpm@10.28.1";
const PINNED_CHECKOUT_ACTION = "actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10";
const PINNED_SETUP_NODE_ACTION = "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38";
const PINNED_UPLOAD_ARTIFACT_ACTION = "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a";
const PINNED_DOWNLOAD_ARTIFACT_ACTION = "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c";
const PINNED_WRANGLER_ACTION = "cloudflare/wrangler-action@ebbaa1584979971c8614a24965b4405ff95890e0";
const REQUIRED_IGNORED_BUILD_PACKAGES = [
  "@prisma/client",
  "@prisma/engines",
  "@swc/core",
  "core-js",
  "esbuild",
  "prisma",
  "protobufjs",
  "sharp",
  "unrs-resolver",
  "workerd",
] as const;

function hasBinding(
  bindings: unknown,
  bindingName: string,
  requiredKeys: string[]
): boolean {
  if (!Array.isArray(bindings)) return false;
  return bindings.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const record = entry as Record<string, unknown>;
    return record.binding === bindingName && requiredKeys.every((key) => typeof record[key] === "string" && record[key] !== "");
  });
}

function bindingRecord(bindings: unknown, bindingName: string): Record<string, unknown> | null {
  if (!Array.isArray(bindings)) return null;
  for (const entry of bindings) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (record.binding === bindingName) return record;
  }
  return null;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function parsedWorkflow(workflow: string): Record<string, unknown> | null {
  const document = parseDocument(workflow, { uniqueKeys: true });
  if (document.errors.length > 0) return null;
  const value = document.toJS({ maxAliasCount: 0 }) as unknown;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactObjectKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function exactWorkflowRecord(
  value: unknown,
  expected: Readonly<Record<string, unknown>>,
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return exactObjectKeys(record, Object.keys(expected)) &&
    Object.entries(expected).every(([key, expectedValue]) => record[key] === expectedValue);
}

function allowedObjectKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => key in value) && keys.every((key) => allowed.has(key));
}

function exactStringArray(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) &&
    value.length === expected.length &&
    value.every((entry, index) => entry === expected[index]);
}

function workflowStepRecords(value: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(value)) return null;
  const steps = value.filter(
    (step): step is Record<string, unknown> => Boolean(step) && typeof step === "object" && !Array.isArray(step),
  );
  return steps.length === value.length ? steps : null;
}

function normalizedHttpsOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value || value !== value.trim() || /\s/.test(value) || !URL.canParse(value)) return null;

  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !url.hostname ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    return null;
  }
  return url.origin;
}

function reactRouterBuildEntrypointIsCanonical(source: string): boolean {
  const file = ts.createSourceFile(
    "react-router-build.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if (file.statements.length !== 2) return false;
  const [importStatement, invocationStatement] = file.statements;
  if (
    !ts.isImportDeclaration(importStatement) ||
    !ts.isStringLiteral(importStatement.moduleSpecifier) ||
    importStatement.moduleSpecifier.text !== "./react-router-build-runner" ||
    !importStatement.importClause ||
    importStatement.importClause.isTypeOnly ||
    importStatement.importClause.name ||
    !importStatement.importClause.namedBindings ||
    !ts.isNamedImports(importStatement.importClause.namedBindings) ||
    importStatement.importClause.namedBindings.elements.length !== 1
  ) return false;
  const [imported] = importStatement.importClause.namedBindings.elements;
  if (
    imported.isTypeOnly ||
    imported.propertyName ||
    imported.name.text !== "runReactRouterBuildCli" ||
    !ts.isExpressionStatement(invocationStatement) ||
    !ts.isVoidExpression(invocationStatement.expression) ||
    !ts.isCallExpression(invocationStatement.expression.expression)
  ) return false;
  const call = invocationStatement.expression.expression;
  return call.arguments.length === 0 &&
    ts.isIdentifier(call.expression) &&
    call.expression.text === "runReactRouterBuildCli";
}

function namespaceIds(ratelimits: unknown): string[] {
  if (!Array.isArray(ratelimits)) return [];
  return ratelimits
    .map((entry) => (entry && typeof entry === "object" ? (entry as Record<string, unknown>).namespace_id : null))
    .filter((namespaceId): namespaceId is string => typeof namespaceId === "string" && namespaceId !== "");
}

function hasExpectedRateLimitBindings(ratelimits: unknown): boolean {
  if (!Array.isArray(ratelimits)) return false;
  const names = ratelimits
    .map((entry) => (entry && typeof entry === "object" ? (entry as Record<string, unknown>).name : null))
    .filter((name): name is string => typeof name === "string" && name !== "");
  const namespaceIdList = namespaceIds(ratelimits);

  return (
    names.length === REQUIRED_RATE_LIMIT_BINDINGS.length &&
    namespaceIdList.length === REQUIRED_RATE_LIMIT_BINDINGS.length &&
    new Set(names).size === REQUIRED_RATE_LIMIT_BINDINGS.length &&
    new Set(namespaceIdList).size === REQUIRED_RATE_LIMIT_BINDINGS.length &&
    REQUIRED_RATE_LIMIT_BINDINGS.every((name) => names.includes(name))
  );
}

function packageScripts(packageJson: Record<string, unknown>): Record<string, string> {
  const scripts = packageJson.scripts;
  if (!scripts || typeof scripts !== "object") return {};
  return Object.fromEntries(
    Object.entries(scripts as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function check(name: string, ok: boolean, message: string, severity: PreflightSeverity = "error"): PreflightCheck {
  return { name, ok, severity, message };
}

interface WorkflowLine {
  indent: number;
  text: string;
}

function stripYamlComment(raw: string): string {
  const commentIndex = raw.indexOf("#");
  return (commentIndex === -1 ? raw : raw.slice(0, commentIndex)).trimEnd();
}

function workflowLines(workflow: string): WorkflowLine[] {
  return workflow
    .split(/\r?\n/)
    .map(stripYamlComment)
    .filter((line) => line.trim() !== "")
    .map((line) => ({
      indent: line.search(/\S/),
      text: line.trim(),
    }));
}

function blockEnd(lines: WorkflowLine[], start: number): number {
  const parentIndent = lines[start].indent;
  let index = start + 1;
  while (index < lines.length && lines[index].indent > parentIndent) {
    index += 1;
  }
  return index;
}

function childBlock(lines: WorkflowLine[], start: number, end: number, key: string): [number, number] | null {
  const childIndent = lines[start].indent + 2;
  for (let index = start + 1; index < end; index += 1) {
    if (lines[index].indent !== childIndent) continue;
    if (yamlMappingKey(lines[index].text) === key) {
      return [index, blockEnd(lines, index)];
    }
  }
  return null;
}

function yamlMappingKey(text: string): string | null {
  const key = text.match(/^(['"]?)([A-Za-z0-9_-]+)\1:/);
  return key ? key[2] : null;
}

function immediateChildKeys(lines: WorkflowLine[], start: number, end: number): string[] {
  const childIndent = lines[start].indent + 2;
  const keys: string[] = [];
  for (let index = start + 1; index < end; index += 1) {
    if (lines[index].indent !== childIndent) continue;
    const key = yamlMappingKey(lines[index].text);
    if (key) keys.push(key);
  }
  return keys;
}

function blockHasMainBranch(lines: WorkflowLine[], branchesStart: number, branchesEnd: number): boolean {
  const branchesLine = lines[branchesStart].text;
  const inlineBranches = branchesLine.match(/^branches:\s*\[([^\]]*)\]\s*$/);
  if (inlineBranches) {
    return inlineBranches[1]
      .split(",")
      .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
      .some((item) => item === "main");
  }
  for (let index = branchesStart + 1; index < branchesEnd; index += 1) {
    if (lines[index].text === "- main") return true;
  }
  return false;
}

function workflowTriggerTargetsMain(lines: WorkflowLine[], onIndex: number, onEnd: number, trigger: string): boolean {
  const triggerBlock = childBlock(lines, onIndex, onEnd, trigger)!;
  const branches = childBlock(lines, triggerBlock[0], triggerBlock[1], "branches");
  return branches ? blockHasMainBranch(lines, branches[0], branches[1]) : false;
}

const WARNING_GATE_COMMAND_PATTERN = /^(?:[A-Z_][A-Z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)*node scripts\/warning-gate\.ts -- (.+)$/;
const WARNING_GATE_COMMAND_PREFIX = "node scripts/warning-gate.ts -- ";
const CI_INVOCATION_VALIDATION_COMMAND =
  `${WARNING_GATE_COMMAND_PREFIX}node scripts/workflow-security.mjs validate-ci-invocation`;
const PLAYWRIGHT_MAN_DB_PRESEED_COMMAND =
  `sudo sh -c 'printf "%s\\n" "man-db man-db/auto-update boolean true" | debconf-set-selections'`;
const PLAYWRIGHT_APT_INSTALL_COMMAND = "sudo env DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1 apt-get -o Dpkg::Use-Pty=0 install -y --no-install-recommends xvfb fonts-noto-color-emoji fonts-unifont libfontconfig1 libfreetype6 xfonts-cyrillic xfonts-scalable fonts-liberation fonts-ipafont-gothic fonts-wqy-zenhei fonts-tlwg-loma-otf fonts-freefont-ttf libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libatspi2.0-0t64 libcairo2 libcups2t64 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0t64 libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2";
function actionStepSignature(action: string): string {
  return `action:${action}`;
}

function commandStepSignature(...commands: string[]): string {
  return `run:${commands.join("\u0000")}`;
}

const CI_STEP_SIGNATURES_BY_JOB = new Map<string, readonly string[]>([
  ["advisory", [
    actionStepSignature(PINNED_CHECKOUT_ACTION),
    actionStepSignature(PINNED_SETUP_NODE_ACTION),
    commandStepSignature(CI_INVOCATION_VALIDATION_COMMAND),
    commandStepSignature(
      `${WARNING_GATE_COMMAND_PREFIX}corepack enable`,
      `${WARNING_GATE_COMMAND_PREFIX}corepack prepare ${REQUIRED_PNPM_PACKAGE_MANAGER} --activate`,
    ),
    commandStepSignature(
      `${WARNING_GATE_COMMAND_PREFIX}mkdir -p .cache/osv-scanner`,
      `${WARNING_GATE_COMMAND_PREFIX}curl -fsSL --retry 3 --retry-delay 2 "https://api.github.com/repos/google/osv-scanner/git/ref/tags/\${OSV_SCANNER_VERSION}" -o .cache/osv-scanner/tag.json`,
      `${WARNING_GATE_COMMAND_PREFIX}jq -e --arg expected "$OSV_SCANNER_TAG_SHA" '.object | select(.type == "commit" and .sha == $expected)' .cache/osv-scanner/tag.json`,
      `${WARNING_GATE_COMMAND_PREFIX}curl -fsSL --retry 3 --retry-delay 2 "https://github.com/google/osv-scanner/releases/download/\${OSV_SCANNER_VERSION}/osv-scanner_linux_amd64" -o .cache/osv-scanner/osv-scanner`,
      'printf \'%s  %s\\n\' "$OSV_SCANNER_LINUX_AMD64_SHA256" ".cache/osv-scanner/osv-scanner" > .cache/osv-scanner/checksums.txt',
      `${WARNING_GATE_COMMAND_PREFIX}sha256sum -c .cache/osv-scanner/checksums.txt`,
      `${WARNING_GATE_COMMAND_PREFIX}chmod +x .cache/osv-scanner/osv-scanner`,
      `${WARNING_GATE_COMMAND_PREFIX}.cache/osv-scanner/osv-scanner --version`,
    ),
    commandStepSignature(`${WARNING_GATE_COMMAND_PREFIX}pnpm install --frozen-lockfile --ignore-scripts`),
    commandStepSignature(
      `${WARNING_GATE_COMMAND_PREFIX}pnpm run advisory:scan -- --scanner .cache/osv-scanner/osv-scanner --output .advisory/osv-results.json`,
    ),
  ]],
  ["coverage", [
    actionStepSignature(PINNED_CHECKOUT_ACTION),
    actionStepSignature(PINNED_SETUP_NODE_ACTION),
    commandStepSignature(CI_INVOCATION_VALIDATION_COMMAND),
    commandStepSignature(
      `${WARNING_GATE_COMMAND_PREFIX}corepack enable`,
      `${WARNING_GATE_COMMAND_PREFIX}corepack prepare ${REQUIRED_PNPM_PACKAGE_MANAGER} --activate`,
    ),
    commandStepSignature(`${WARNING_GATE_COMMAND_PREFIX}pnpm install --frozen-lockfile`),
    commandStepSignature(`${WARNING_GATE_COMMAND_PREFIX}pnpm prisma:generate`),
    commandStepSignature(
      `${WARNING_GATE_COMMAND_PREFIX}pnpm why blake3-wasm`,
      `${WARNING_GATE_COMMAND_PREFIX}pnpm why @c4312/blake3-internal`,
    ),
    commandStepSignature(`${WARNING_GATE_COMMAND_PREFIX}pnpm exec wrangler d1 migrations apply DB --local`),
    commandStepSignature(
      `DATABASE_URL="file:./test.db" ${WARNING_GATE_COMMAND_PREFIX}pnpm exec prisma db push --skip-generate`,
    ),
    commandStepSignature(
      `${WARNING_GATE_COMMAND_PREFIX}pnpm exec wrangler d1 migrations list DB --local`,
      `${WARNING_GATE_COMMAND_PREFIX}pnpm exec wrangler d1 execute DB --local --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"`,
    ),
    commandStepSignature(`${WARNING_GATE_COMMAND_PREFIX}pnpm db:seed`),
    commandStepSignature(`${WARNING_GATE_COMMAND_PREFIX}pnpm run typecheck`),
    commandStepSignature("pnpm test:coverage"),
    commandStepSignature(`${WARNING_GATE_COMMAND_PREFIX}pnpm build`),
  ]],
  ["e2e", [
    actionStepSignature(PINNED_CHECKOUT_ACTION),
    actionStepSignature(PINNED_SETUP_NODE_ACTION),
    commandStepSignature(CI_INVOCATION_VALIDATION_COMMAND),
    commandStepSignature(
      `${WARNING_GATE_COMMAND_PREFIX}corepack enable`,
      `${WARNING_GATE_COMMAND_PREFIX}corepack prepare ${REQUIRED_PNPM_PACKAGE_MANAGER} --activate`,
    ),
    commandStepSignature(`${WARNING_GATE_COMMAND_PREFIX}pnpm install --frozen-lockfile`),
    commandStepSignature(`${WARNING_GATE_COMMAND_PREFIX}pnpm prisma:generate`),
    commandStepSignature(
      `${WARNING_GATE_COMMAND_PREFIX}pnpm why blake3-wasm`,
      `${WARNING_GATE_COMMAND_PREFIX}pnpm why @c4312/blake3-internal`,
    ),
    commandStepSignature(
      `${WARNING_GATE_COMMAND_PREFIX}pnpm exec playwright install-deps --dry-run chromium`,
      `${WARNING_GATE_COMMAND_PREFIX}sudo apt-get update`,
      `${WARNING_GATE_COMMAND_PREFIX}${PLAYWRIGHT_MAN_DB_PRESEED_COMMAND}`,
      `${WARNING_GATE_COMMAND_PREFIX}sudo touch /var/lib/man-db/auto-update`,
      `${WARNING_GATE_COMMAND_PREFIX}${PLAYWRIGHT_APT_INSTALL_COMMAND}`,
      `${WARNING_GATE_COMMAND_PREFIX}pnpm exec playwright install chromium`,
    ),
    commandStepSignature(`${WARNING_GATE_COMMAND_PREFIX}pnpm exec wrangler d1 migrations apply DB --local`),
    commandStepSignature(`${WARNING_GATE_COMMAND_PREFIX}pnpm db:seed`),
    commandStepSignature('printf \'SESSION_SECRET=%s\\nNODE_ENV=development\\n\' "$SESSION_SECRET" > .dev.vars'),
    commandStepSignature("pnpm test:e2e"),
    actionStepSignature(PINNED_UPLOAD_ARTIFACT_ACTION),
  ]],
]);

function workflowStepSignature(step: Record<string, unknown>): string | null {
  if (typeof step.uses === "string") return actionStepSignature(step.uses);
  if (typeof step.run === "string") return commandStepSignature(...runCommandLines(step.run));
  return null;
}

const CI_WORKFLOW_ENV = Object.freeze({
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "init.defaultBranch",
  GIT_CONFIG_VALUE_0: "main",
  PRISMA_HIDE_UPDATE_MESSAGE: "1",
  CI_SOURCE_SHA: "${{ github.event_name == 'workflow_dispatch' && inputs.source_sha || github.sha }}",
  SPOONJOY_CSP_REPORT_ONLY_BREAK_GLASS:
    "${{ github.event_name == 'workflow_dispatch' && inputs.csp_report_only_break_glass || '' }}",
});

const CI_JOB_CONTRACTS = Object.freeze({
  advisory: Object.freeze({
    name: "${{ github.event_name == 'workflow_dispatch' && 'report-only-advisory' || 'advisory' }}",
    timeoutMinutes: 15,
    env: undefined,
  }),
  coverage: Object.freeze({
    name: "${{ github.event_name == 'workflow_dispatch' && 'report-only-coverage' || 'coverage' }}",
    timeoutMinutes: 90,
    env: undefined,
  }),
  e2e: Object.freeze({
    name: "${{ github.event_name == 'workflow_dispatch' && 'report-only-e2e' || 'e2e' }}",
    timeoutMinutes: 10,
    env: Object.freeze({
      NODE_ENV: "development",
      SESSION_SECRET: "ci-e2e-session-secret",
    }),
  }),
});

const CI_OSV_SCANNER_ENV = Object.freeze({
  OSV_SCANNER_VERSION: "v2.3.8",
  OSV_SCANNER_TAG_SHA: "408fcd6f8707999a29e7ba45e15809764cf24f67",
  OSV_SCANNER_LINUX_AMD64_SHA256: "bc98e15319ed0d515e3f9235287ba53cdc5535d576d24fd573978ecfe9ab92dc",
});

function requiredDispatchStringInput(value: unknown): boolean {
  const input = objectRecord(value);
  return input.required === true &&
    input.type === "string" &&
    allowedObjectKeys(input, ["required", "type"], ["description"]);
}

function parsedCiWorkflowIsCanonical(workflow: string): boolean {
  const root = parsedWorkflow(workflow);
  if (!root || !exactObjectKeys(root, ["name", "on", "defaults", "env", "jobs"])) return false;
  if (root.name !== "CI" || !exactWorkflowRecord(root.env, CI_WORKFLOW_ENV)) return false;

  const triggers = objectRecord(root.on);
  const push = objectRecord(triggers.push);
  const pullRequest = objectRecord(triggers.pull_request);
  const dispatch = objectRecord(triggers.workflow_dispatch);
  const inputs = objectRecord(dispatch.inputs);
  if (
    !exactObjectKeys(triggers, ["push", "pull_request", "workflow_dispatch"]) ||
    !exactObjectKeys(push, ["branches"]) ||
    !exactObjectKeys(pullRequest, ["branches"]) ||
    !exactStringArray(push.branches, ["main"]) ||
    !exactStringArray(pullRequest.branches, ["main"]) ||
    !exactObjectKeys(dispatch, ["inputs"]) ||
    !exactObjectKeys(inputs, ["source_sha", "csp_report_only_break_glass"]) ||
    !requiredDispatchStringInput(inputs.source_sha) ||
    !requiredDispatchStringInput(inputs.csp_report_only_break_glass)
  ) return false;

  const defaults = objectRecord(root.defaults);
  const runDefaults = objectRecord(defaults.run);
  if (!exactObjectKeys(defaults, ["run"]) || !exactObjectKeys(runDefaults, ["shell"]) || runDefaults.shell !== "bash") {
    return false;
  }

  const jobs = objectRecord(root.jobs);
  if (!exactObjectKeys(jobs, Object.keys(CI_JOB_CONTRACTS))) return false;

  for (const [jobName, rawJob] of Object.entries(jobs)) {
    const job = objectRecord(rawJob);
    const contract = CI_JOB_CONTRACTS[jobName as keyof typeof CI_JOB_CONTRACTS];
    const expectedJobKeys = contract.env
      ? ["name", "runs-on", "timeout-minutes", "env", "steps"]
      : ["name", "runs-on", "timeout-minutes", "steps"];
    if (
      !exactObjectKeys(job, expectedJobKeys) ||
      job.name !== contract.name ||
      job["runs-on"] !== "ubuntu-latest" ||
      job["timeout-minutes"] !== contract.timeoutMinutes ||
      (contract.env ? !exactWorkflowRecord(job.env, contract.env) : job.env !== undefined)
    ) return false;

    const steps = workflowStepRecords(job.steps);
    if (!steps) return false;
    const expectedStepSignatures = CI_STEP_SIGNATURES_BY_JOB.get(jobName)!;
    const stepSignatures = steps.map(workflowStepSignature);
    if (
      stepSignatures.length !== expectedStepSignatures.length ||
      !stepSignatures.every((signature, index) => signature === expectedStepSignatures[index])
    ) return false;
    for (const step of steps) {
      if (typeof step.uses === "string") {
        const withValues = objectRecord(step.with);
        if (step.uses === PINNED_CHECKOUT_ACTION) {
          if (
            !exactObjectKeys(step, ["uses", "with"]) ||
            !exactWorkflowRecord(withValues, {
              ref: "${{ env.CI_SOURCE_SHA }}",
              "persist-credentials": false,
            })
          ) return false;
        } else if (step.uses === PINNED_SETUP_NODE_ACTION) {
          if (
            !exactObjectKeys(step, ["name", "uses", "with"]) ||
            typeof step.name !== "string" ||
            !exactWorkflowRecord(withValues, { "node-version": "22" })
          ) return false;
        } else {
          if (
            !exactObjectKeys(step, ["name", "uses", "if", "with"]) ||
            typeof step.name !== "string" ||
            step.if !== "${{ !cancelled() }}" ||
            !exactWorkflowRecord(withValues, {
              name: "playwright-report",
              path: "playwright-report/",
              "retention-days": 30,
            })
          ) return false;
        }
        continue;
      }

      const commands = runCommandLines(step.run as string);
      const isOsvInstallStep = jobName === "advisory" &&
        commands.includes(`${WARNING_GATE_COMMAND_PREFIX}mkdir -p .cache/osv-scanner`);
      if (
        !exactObjectKeys(step, isOsvInstallStep ? ["name", "env", "run"] : ["name", "run"]) ||
        (isOsvInstallStep && !exactWorkflowRecord(step.env, CI_OSV_SCANNER_ENV)) ||
        commands.length === 0
      ) return false;
    }
  }

  return true;
}

const PRODUCTION_DEPLOY_JOB_CONDITION =
  "(github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push' && github.event.workflow_run.head_branch == 'main' && github.event.workflow_run.path == '.github/workflows/ci.yml') || (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main')";
const PRODUCTION_VALIDATION_COMMAND =
  "node scripts/workflow-security.mjs validate-production-deploy-source";
const PRODUCTION_DEPLOY_COMMAND = "node scripts/workflow-security.mjs run-production-deploy";
const PRODUCTION_WORKFLOW_ENV = Object.freeze({
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "init.defaultBranch",
  GIT_CONFIG_VALUE_0: "main",
  SOURCE_SHA: "${{ github.event_name == 'workflow_run' && github.event.workflow_run.head_sha || inputs.source_sha }}",
  ROLLBACK_VERSION_ID: "${{ github.event_name == 'workflow_dispatch' && inputs.rollback_version_id || '' }}",
  SPOONJOY_CSP_REPORT_ONLY_BREAK_GLASS:
    "${{ github.event_name == 'workflow_dispatch' && inputs.csp_report_only_break_glass || '' }}",
});

const PRODUCTION_DEPLOY_STEPS: readonly Record<string, unknown>[] = [
  {
    name: "Checkout approved source SHA",
    if: "env.ROLLBACK_VERSION_ID == ''",
    uses: PINNED_CHECKOUT_ACTION,
    with: {
      ref: "${{ env.SOURCE_SHA }}",
      "fetch-depth": 0,
      "persist-credentials": false,
    },
  },
  {
    name: "Checkout trusted rollback tooling",
    if: "env.ROLLBACK_VERSION_ID != ''",
    uses: PINNED_CHECKOUT_ACTION,
    with: {
      ref: "${{ github.workflow_sha }}",
      "fetch-depth": 0,
      "persist-credentials": false,
    },
  },
  {
    name: "Validate release source",
    env: {
      GH_TOKEN: "${{ github.token }}",
      WORKFLOW_RUN_CONCLUSION: "${{ github.event.workflow_run.conclusion }}",
      WORKFLOW_RUN_EVENT: "${{ github.event.workflow_run.event }}",
      WORKFLOW_RUN_HEAD_BRANCH: "${{ github.event.workflow_run.head_branch }}",
      WORKFLOW_RUN_HEAD_SHA: "${{ github.event.workflow_run.head_sha }}",
      WORKFLOW_RUN_PATH: "${{ github.event.workflow_run.path }}",
    },
    run: PRODUCTION_VALIDATION_COMMAND,
  },
  {
    name: "Setup Node.js",
    uses: PINNED_SETUP_NODE_ACTION,
    with: { "node-version": "22" },
  },
  {
    name: "Activate pnpm",
    run: `corepack enable\ncorepack prepare ${REQUIRED_PNPM_PACKAGE_MANAGER} --activate\n`,
  },
  { name: "Install dependencies", run: "pnpm install --frozen-lockfile" },
  { name: "Generate Prisma client", run: "pnpm prisma:generate" },
  { name: "Install Playwright Chromium", run: "pnpm exec playwright install --with-deps chromium" },
  {
    name: "Deploy staged release to Cloudflare Workers",
    env: {
      CLOUDFLARE_ACCOUNT_ID: "${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
      CLOUDFLARE_D1_API_TOKEN: "${{ secrets.CLOUDFLARE_D1_API_TOKEN }}",
      CLOUDFLARE_WORKERS_API_TOKEN: "${{ secrets.CLOUDFLARE_WORKERS_API_TOKEN }}",
      SPOONJOY_RELEASE_SHA: "${{ env.SOURCE_SHA }}",
      SPOONJOY_MCP_CANARY_BASE_URL: "https://spoonjoy.app",
      SPOONJOY_CSP_REPORT_ONLY_BREAK_GLASS: "${{ env.SPOONJOY_CSP_REPORT_ONLY_BREAK_GLASS }}",
    },
    run: PRODUCTION_DEPLOY_COMMAND,
  },
  {
    name: "Record release source",
    if: "always()",
    run: "# Markdown backticks are intentional literals in the step summary.\n# shellcheck disable=SC2016\nprintf 'Source SHA: `%s`\\n' \"$SOURCE_SHA\" >> \"$GITHUB_STEP_SUMMARY\"\n",
  },
  {
    name: "Ensure release artifact exists",
    if: "always()",
    run: "set -euo pipefail\numask 077\nmkdir -p mcp-oauth-canary-artifacts\nif [ ! -f mcp-oauth-canary-artifacts/production-release.json ]; then\n  jq -n --arg source_sha \"$SOURCE_SHA\" \\\n    '{status: \"failed_before_stage\", sourceSha: $source_sha, phase: \"validate\", reviewedMigrations: [], migrationApply: \"not_started\", databaseRollbackSupported: false, failure: \"Release workflow failed before the orchestrator wrote an artifact.\"}' \\\n    > mcp-oauth-canary-artifacts/production-release.json\nfi\n",
  },
  {
    name: "Upload MCP OAuth canary artifacts",
    if: "always()",
    uses: PINNED_UPLOAD_ARTIFACT_ACTION,
    with: {
      name: "mcp-oauth-canary-artifacts",
      path: "mcp-oauth-canary-artifacts/",
      "if-no-files-found": "error",
      "retention-days": 14,
    },
  },
];

const PRODUCTION_REPORT_STEPS: readonly Record<string, unknown>[] = [
  {
    name: "Checkout released source SHA",
    uses: PINNED_CHECKOUT_ACTION,
    with: {
      ref: "${{ github.workflow_sha }}",
      "persist-credentials": false,
    },
  },
  {
    name: "Setup Node.js",
    uses: PINNED_SETUP_NODE_ACTION,
    with: { "node-version": "22" },
  },
  {
    name: "Activate pnpm",
    run: `corepack enable\ncorepack prepare ${REQUIRED_PNPM_PACKAGE_MANAGER} --activate\n`,
  },
  {
    name: "Download MCP OAuth canary artifacts",
    uses: PINNED_DOWNLOAD_ARTIFACT_ACTION,
    "continue-on-error": true,
    with: {
      name: "mcp-oauth-canary-artifacts",
      path: "mcp-oauth-canary-artifacts",
    },
  },
  {
    name: "Report MCP OAuth canary",
    if: "always()",
    env: {
      GITHUB_TOKEN: "${{ github.token }}",
      MCP_CANARY_STATUS: "${{ needs.deploy.result }}",
      MCP_CANARY_WORKFLOW_RUN_URL:
        "https://github.com/${{ github.repository }}/actions/runs/${{ github.run_id }}",
      MCP_CANARY_ARTIFACT_URL:
        "https://github.com/${{ github.repository }}/actions/runs/${{ github.run_id }}#artifacts",
    },
    run: "node scripts/report-mcp-oauth-canary.mjs --artifact-dir mcp-oauth-canary-artifacts --status \"$MCP_CANARY_STATUS\" --workflow-run-url \"$MCP_CANARY_WORKFLOW_RUN_URL\" --artifact-url \"$MCP_CANARY_ARTIFACT_URL\" --manage-issue",
  },
];

function optionalDispatchStringInput(value: unknown): boolean {
  const input = objectRecord(value);
  return input.required === false &&
    input.default === "" &&
    input.type === "string" &&
    allowedObjectKeys(input, ["required", "default", "type"], ["description"]);
}

export function parsedProductionWorkflowIsCanonical(workflow: string): boolean {
  const root = parsedWorkflow(workflow);
  if (
    !root ||
    !allowedObjectKeys(root, ["name", "on", "permissions", "env", "jobs"], ["concurrency"]) ||
    root.name !== "Production Deploy" ||
    !exactWorkflowRecord(root.env, PRODUCTION_WORKFLOW_ENV)
  ) return false;

  const triggers = objectRecord(root.on);
  const workflowRun = objectRecord(triggers.workflow_run);
  const dispatch = objectRecord(triggers.workflow_dispatch);
  const inputs = objectRecord(dispatch.inputs);
  if (
    !exactObjectKeys(triggers, ["workflow_run", "workflow_dispatch"]) ||
    !exactObjectKeys(workflowRun, ["workflows", "branches", "types"]) ||
    !exactStringArray(workflowRun.workflows, ["CI"]) ||
    !exactStringArray(workflowRun.branches, ["main"]) ||
    !exactStringArray(workflowRun.types, ["completed"]) ||
    !exactObjectKeys(dispatch, ["inputs"]) ||
    !exactObjectKeys(inputs, ["source_sha", "rollback_version_id", "csp_report_only_break_glass"]) ||
    !requiredDispatchStringInput(inputs.source_sha) ||
    !optionalDispatchStringInput(inputs.rollback_version_id) ||
    !optionalDispatchStringInput(inputs.csp_report_only_break_glass)
  ) return false;

  const permissions = objectRecord(root.permissions);
  const concurrency = objectRecord(root.concurrency);
  if (
    !exactObjectKeys(permissions, ["actions", "contents"]) ||
    permissions.actions !== "read" ||
    permissions.contents !== "read" ||
    !exactWorkflowRecord(concurrency, {
      group: "production-deploy",
      "cancel-in-progress": false,
    })
  ) return false;

  const jobs = objectRecord(root.jobs);
  if (!exactObjectKeys(jobs, ["deploy", "report-canary"])) return false;
  const deploy = objectRecord(jobs.deploy);
  const report = objectRecord(jobs["report-canary"]);
  if (
    !exactObjectKeys(deploy, ["name", "if", "runs-on", "timeout-minutes", "environment", "steps"]) ||
    deploy.name !== "deploy" ||
    deploy.if !== PRODUCTION_DEPLOY_JOB_CONDITION ||
    deploy["runs-on"] !== "ubuntu-latest" ||
    deploy["timeout-minutes"] !== 40 ||
    deploy.environment !== "production" ||
    !exactObjectKeys(report, ["name", "if", "needs", "runs-on", "timeout-minutes", "permissions", "steps"]) ||
    report.name !== "report-canary" ||
    report.if !== "always() && needs.deploy.result != 'skipped'" ||
    report.needs !== "deploy" ||
    report["runs-on"] !== "ubuntu-latest" ||
    report["timeout-minutes"] !== 10
  ) return false;
  const reportPermissions = objectRecord(report.permissions);
  if (
    !exactObjectKeys(reportPermissions, ["contents", "issues"]) ||
    reportPermissions.contents !== "read" ||
    reportPermissions.issues !== "write"
  ) return false;

  const deploySteps = workflowStepRecords(deploy.steps);
  const reportSteps = workflowStepRecords(report.steps);
  if (!deploySteps || !reportSteps) return false;
  return JSON.stringify(deploySteps) === JSON.stringify(PRODUCTION_DEPLOY_STEPS) &&
    JSON.stringify(reportSteps) === JSON.stringify(PRODUCTION_REPORT_STEPS);
}

function warningGatedPayload(command: string): string | null {
  return command.match(WARNING_GATE_COMMAND_PATTERN)?.[1] ?? null;
}

function workflowHasOnlyTriggers(lines: WorkflowLine[], onIndex: number, onEnd: number, allowed: string[]): boolean {
  const triggers = immediateChildKeys(lines, onIndex, onEnd);
  const uniqueTriggers = new Set(triggers);
  return (
    triggers.length === allowed.length &&
    uniqueTriggers.size === allowed.length &&
    allowed.every((trigger) => uniqueTriggers.has(trigger))
  );
}

function workflowBuildsPullRequestsAndDeploysPushesToMain(workflow: string): boolean {
  const lines = workflowLines(workflow);
  const onIndex = lines.findIndex((line) => line.indent === 0 && line.text === "on:");
  if (onIndex === -1) return false;
  const onEnd = blockEnd(lines, onIndex);
  const workflowDispatch = childBlock(lines, onIndex, onEnd, "workflow_dispatch");
  return (
    workflowHasOnlyTriggers(lines, onIndex, onEnd, ["push", "pull_request", "workflow_dispatch"]) &&
    Boolean(workflowDispatch) &&
    workflowTriggerTargetsMain(lines, onIndex, onEnd, "push") &&
    workflowTriggerTargetsMain(lines, onIndex, onEnd, "pull_request")
  );
}

function stepBlocks(lines: WorkflowLine[], stepsStart: number, stepsEnd: number): Array<[number, number]> {
  const stepIndent = lines[stepsStart].indent + 2;
  const blocks: Array<[number, number]> = [];
  for (let index = stepsStart + 1; index < stepsEnd; index += 1) {
    if (lines[index].indent === stepIndent && lines[index].text.startsWith("- ")) {
      blocks.push([index, blockEnd(lines, index)]);
    }
  }
  return blocks;
}

function workflowJobBlocks(lines: WorkflowLine[]): Array<[number, number]> {
  const jobsIndex = lines.findIndex((line) => line.indent === 0 && line.text === "jobs:");
  if (jobsIndex === -1) return [];
  const jobsEnd = blockEnd(lines, jobsIndex);
  const jobIndent = lines[jobsIndex].indent + 2;
  const jobKey = /^(?:[A-Za-z0-9_-]+|"[A-Za-z0-9_-]+"|'[A-Za-z0-9_-]+'):/;
  const blocks: Array<[number, number]> = [];
  for (let index = jobsIndex + 1; index < jobsEnd; index += 1) {
    if (lines[index].indent === jobIndent && jobKey.test(lines[index].text)) {
      blocks.push([index, blockEnd(lines, index)]);
    }
  }
  return blocks;
}

function stepPropertyValue(lines: WorkflowLine[], stepStart: number, stepEnd: number, key: string): string | null {
  const inline = lines[stepStart].text.match(new RegExp(`^-\\s+${key}:\\s*(.*)$`));
  if (inline) return unquoteYamlScalar(inline[1]);

  const propertyIndent = lines[stepStart].indent + 2;
  for (let index = stepStart + 1; index < stepEnd; index += 1) {
    if (lines[index].indent !== propertyIndent) continue;
    const value = lines[index].text.match(new RegExp(`^${key}:\\s*(.*)$`));
    if (value) return unquoteYamlScalar(value[1]);
  }
  return null;
}

function unquoteYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function blockScalarChildValue(lines: WorkflowLine[], blockStart: number, blockEnd: number, key: string): string | null {
  const childIndent = lines[blockStart].indent + 2;
  for (let index = blockStart + 1; index < blockEnd; index += 1) {
    if (lines[index].indent !== childIndent) continue;
    const value = lines[index].text.match(new RegExp(`^${key}:\\s*(.*)$`));
    if (value) return unquoteYamlScalar(value[1]);
  }
  return null;
}

function blockScalarChildMap(lines: WorkflowLine[], blockStart: number, blockEnd: number): Map<string, string> {
  const childIndent = lines[blockStart].indent + 2;
  const values = new Map<string, string>();
  for (let index = blockStart + 1; index < blockEnd; index += 1) {
    if (lines[index].indent !== childIndent) continue;
    const separator = lines[index].text.indexOf(":");
    if (separator === -1) continue;
    const key = unquoteYamlScalar(lines[index].text.slice(0, separator));
    const value = unquoteYamlScalar(lines[index].text.slice(separator + 1));
    values.set(key, value);
  }
  return values;
}

function stepWithValue(lines: WorkflowLine[], stepStart: number, stepEnd: number, key: string): string | null {
  const withBlock = childBlock(lines, stepStart, stepEnd, "with");
  if (!withBlock) return null;
  return blockScalarChildValue(lines, withBlock[0], withBlock[1], key);
}

function stepRunText(lines: WorkflowLine[], stepStart: number, stepEnd: number): string {
  const inlineRun = lines[stepStart].text.match(/^-\s+run:\s*(.+)$/);
  if (inlineRun) return inlineRun[1].trim();

  const runIndent = lines[stepStart].indent + 2;
  for (let index = stepStart + 1; index < stepEnd; index += 1) {
    if (lines[index].indent !== runIndent) continue;
    const run = lines[index].text.match(/^run:\s*(.*)$/);
    if (!run) continue;

    const value = run[1].trim();
    if (value !== "|" && value !== ">") return value;

    const commands: string[] = [];
    for (let commandIndex = index + 1; commandIndex < stepEnd; commandIndex += 1) {
      if (lines[commandIndex].indent <= lines[index].indent) break;
      commands.push(lines[commandIndex].text);
    }
    return commands.join("\n");
  }
  return "";
}

function stepHasEnvKeys(lines: WorkflowLine[], stepStart: number, stepEnd: number, keys: string[]): boolean {
  const env = childBlock(lines, stepStart, stepEnd, "env");
  if (!env) return false;

  const envIndent = lines[env[0]].indent + 2;
  const found = new Set<string>();
  for (let index = env[0] + 1; index < env[1]; index += 1) {
    if (lines[index].indent !== envIndent) continue;
    const key = lines[index].text.match(/^([A-Za-z0-9_]+):/);
    if (key) found.add(key[1]);
  }
  return keys.every((key) => found.has(key));
}

function workflowHasGitDefaultBranchConfig(workflow: string): boolean {
  const lines = workflowLines(workflow);
  const envIndex = lines.findIndex((line) => line.indent === 0 && line.text === "env:");
  if (envIndex === -1) return false;
  const envEnd = blockEnd(lines, envIndex);
  return (
    blockScalarChildValue(lines, envIndex, envEnd, "GIT_CONFIG_COUNT") === "1" &&
    blockScalarChildValue(lines, envIndex, envEnd, "GIT_CONFIG_KEY_0") === "init.defaultBranch" &&
    blockScalarChildValue(lines, envIndex, envEnd, "GIT_CONFIG_VALUE_0") === "main"
  );
}

function corepackPnpmRunIsClean(run: string): boolean {
  const commands = runCommandLines(run);
  return commandLinesEqual(run, [
    "corepack enable",
    `corepack prepare ${REQUIRED_PNPM_PACKAGE_MANAGER} --activate`,
  ]) || (
    commands.length === 2 &&
    warningGatedPayload(commands[0]) === "corepack enable" &&
    warningGatedPayload(commands[1]) === `corepack prepare ${REQUIRED_PNPM_PACKAGE_MANAGER} --activate`
  );
}

function workflowUsesCorepackPnpmSetup(workflow: string): boolean {
  const lines = workflowLines(workflow);
  const activeText = lines.map((line) => line.text).join("\n").toLowerCase();
  if (activeText.includes("pnpm/action-setup@")) return false;

  const jobs = workflowJobBlocks(lines);
  for (const [jobStart, jobEnd] of jobs) {
    const steps = childBlock(lines, jobStart, jobEnd, "steps");
    if (!steps) return false;

    let nodeSetupStep = -1;
    let corepackStep = -1;

    for (const [stepStart, stepEnd] of stepBlocks(lines, steps[0], steps[1])) {
      if (
        (stepUsesExactly(lines, stepStart, stepEnd, "actions/setup-node@v6") ||
          stepUsesExactly(lines, stepStart, stepEnd, PINNED_SETUP_NODE_ACTION)) &&
        stepWithValue(lines, stepStart, stepEnd, "node-version") === "22"
      ) {
        nodeSetupStep = stepStart;
      }

      if (corepackPnpmRunIsClean(stepRunText(lines, stepStart, stepEnd))) {
        corepackStep = stepStart;
      }
    }

    if (nodeSetupStep < 0 || corepackStep <= nodeSetupStep) return false;
  }

  return jobs.length > 0;
}

function workflowTriggersOnlyDispatchAndSchedule(workflow: string): boolean {
  const lines = workflowLines(workflow);
  const onIndex = lines.findIndex((line) => line.indent === 0 && line.text === "on:");
  if (onIndex === -1) return false;
  const onEnd = blockEnd(lines, onIndex);
  return workflowHasOnlyTriggers(lines, onIndex, onEnd, ["workflow_dispatch", "schedule"]);
}

function normalizedWorkflowCondition(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function stepIfEquals(lines: WorkflowLine[], stepStart: number, stepEnd: number, expected: string): boolean {
  const value = stepPropertyValue(lines, stepStart, stepEnd, "if");
  return typeof value === "string" && normalizedWorkflowCondition(value) === expected;
}

function stepUses(lines: WorkflowLine[], stepStart: number, stepEnd: number, action: string): boolean {
  const value = stepPropertyValue(lines, stepStart, stepEnd, "uses");
  return typeof value === "string" && value.toLowerCase().startsWith(action.toLowerCase());
}

function stepUsesExactly(lines: WorkflowLine[], stepStart: number, stepEnd: number, action: string): boolean {
  const value = stepPropertyValue(lines, stepStart, stepEnd, "uses");
  return typeof value === "string" && value.toLowerCase() === action.toLowerCase();
}

function stepHasId(lines: WorkflowLine[], stepStart: number, stepEnd: number, id: string): boolean {
  return stepPropertyValue(lines, stepStart, stepEnd, "id") === id;
}

function workflowHasForbiddenQaSmokeTerms(lines: WorkflowLine[]): boolean {
  const activeText = lines.map((line) => line.text).join("\n");
  return ["deploy:auto", "wrangler deploy", "--target-env production"].some((term) => activeText.includes(term));
}

function qaSmokeStepOrderIsValid(order: Record<string, number>): boolean {
  return (
    order.cloudflare >= 0 &&
    order.checkout > order.cloudflare &&
    order.install > order.checkout &&
    order.prisma > order.install &&
    order.providerSecrets > order.prisma &&
    order.smoke > order.providerSecrets &&
    order.artifact > order.smoke
  );
}

function runCommandLines(run: string): string[] {
  return run
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function commandLinesEqual(run: string, expected: string[]): boolean {
  const commands = runCommandLines(run);
  return commands.length === expected.length && commands.every((command, index) => command === expected[index]);
}

function cloudflareGateRunIsSafe(run: string): boolean {
  return commandLinesEqual(run, [
    'if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] || [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then',
    'echo "ready=false" >> "$GITHUB_OUTPUT"',
    'echo "Skipping QA image-cover smoke because Cloudflare GitHub secrets are not configured."',
    "exit 0",
    "fi",
    'echo "ready=true" >> "$GITHUB_OUTPUT"',
  ]);
}

function qaProviderGateRunIsSafe(run: string): boolean {
  return commandLinesEqual(run, [
    'secrets_json="$(pnpm exec wrangler secret list --env qa)"',
    'echo "$secrets_json"',
    `if ! printf '%s' "$secrets_json" | grep -Eq '"(OPENAI_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY)"'; then`,
    'echo "ready=false" >> "$GITHUB_OUTPUT"',
    'echo "Skipping QA image-cover smoke because no QA image-provider secret is configured."',
    "exit 0",
    "fi",
    'echo "ready=true" >> "$GITHUB_OUTPUT"',
  ]);
}

function workflowHasQaImageCoverSmokeGuards(workflow: string): boolean {
  const lines = workflowLines(workflow);
  if (workflowHasForbiddenQaSmokeTerms(lines)) return false;
  const cloudflareReady = "steps.cloudflare.outputs.ready == 'true'";
  const cloudflareAndProviderReady =
    "steps.cloudflare.outputs.ready == 'true' && steps.qa-secrets.outputs.ready == 'true'";
  const artifactReady =
    "always() && steps.cloudflare.outputs.ready == 'true' && steps.qa-secrets.outputs.ready == 'true'";

  for (const [jobStart, jobEnd] of workflowJobBlocks(lines)) {
    const steps = childBlock(lines, jobStart, jobEnd, "steps");
    if (!steps) continue;

    const order = {
      cloudflare: -1,
      checkout: -1,
      install: -1,
      prisma: -1,
      providerSecrets: -1,
      smoke: -1,
      artifact: -1,
    };

    for (const [stepStart, stepEnd] of stepBlocks(lines, steps[0], steps[1])) {
      const run = stepRunText(lines, stepStart, stepEnd);

      if (
        stepHasId(lines, stepStart, stepEnd, "cloudflare") &&
        stepHasEnvKeys(lines, stepStart, stepEnd, ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) &&
        cloudflareGateRunIsSafe(run)
      ) {
        order.cloudflare = stepStart;
      }

      if (
        stepUses(lines, stepStart, stepEnd, "actions/checkout@") &&
        stepIfEquals(lines, stepStart, stepEnd, cloudflareReady)
      ) {
        order.checkout = stepStart;
      }

      if (
        run === "pnpm install --frozen-lockfile" &&
        stepIfEquals(lines, stepStart, stepEnd, cloudflareReady)
      ) {
        order.install = stepStart;
      }

      if (
        run === "pnpm prisma:generate" &&
        stepIfEquals(lines, stepStart, stepEnd, cloudflareReady)
      ) {
        order.prisma = stepStart;
      }

      if (
        stepHasId(lines, stepStart, stepEnd, "qa-secrets") &&
        stepHasEnvKeys(lines, stepStart, stepEnd, ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) &&
        stepIfEquals(lines, stepStart, stepEnd, cloudflareReady) &&
        qaProviderGateRunIsSafe(run)
      ) {
        order.providerSecrets = stepStart;
      }

      if (
        run === "pnpm run smoke:qa:image-cover" &&
        stepHasEnvKeys(lines, stepStart, stepEnd, [
          "CLOUDFLARE_API_TOKEN",
          "CLOUDFLARE_ACCOUNT_ID",
          "SPOONJOY_QA_SMOKE_BASE_URL",
          "SPOONJOY_QA_SMOKE_TARGET",
        ]) &&
        stepIfEquals(lines, stepStart, stepEnd, cloudflareAndProviderReady)
      ) {
        order.smoke = stepStart;
      }

      if (
        stepUses(lines, stepStart, stepEnd, "actions/upload-artifact@") &&
        stepIfEquals(lines, stepStart, stepEnd, artifactReady)
      ) {
        const withBlock = childBlock(lines, stepStart, stepEnd, "with");
        if (withBlock) {
          const withText = lines
            .slice(withBlock[0], withBlock[1])
            .map((line) => line.text)
            .join("\n");
          if (withText.includes("qa-image-cover-smoke-artifacts/")) {
            order.artifact = stepStart;
          }
        }
      }
    }

    if (qaSmokeStepOrderIsValid(order)) return true;
  }

  return false;
}

function storybookDeployPrepRunIsClean(run: string): boolean {
  return commandLinesEqual(run, [
    `rm -rf ${STORYBOOK_PAGES_DEPLOY_DIR}`,
    `mkdir -p ${STORYBOOK_PAGES_DEPLOY_DIR}`,
    `mv ${STORYBOOK_PAGES_OUTPUT_DIR} ${STORYBOOK_PAGES_DEPLOY_DIR}/${STORYBOOK_PAGES_OUTPUT_DIR}`,
    `printf '%s\\n' '{' '  "name": "${STORYBOOK_PAGES_PROJECT_NAME}",' '  "pages_build_output_dir": "${STORYBOOK_PAGES_OUTPUT_DIR}"' '}' > ${STORYBOOK_PAGES_DEPLOY_DIR}/wrangler.json`,
  ]);
}

function storybookWranglerDeployStepIsClean(lines: WorkflowLine[], stepStart: number, stepEnd: number): boolean {
  return (
    (stepUsesExactly(lines, stepStart, stepEnd, "cloudflare/wrangler-action@v4") ||
      stepUsesExactly(lines, stepStart, stepEnd, PINNED_WRANGLER_ACTION)) &&
    stepWithValue(lines, stepStart, stepEnd, "apiToken") === "${{ secrets.CLOUDFLARE_API_TOKEN }}" &&
    stepWithValue(lines, stepStart, stepEnd, "accountId") === "${{ secrets.CLOUDFLARE_ACCOUNT_ID }}" &&
    stepWithValue(lines, stepStart, stepEnd, "workingDirectory") === STORYBOOK_PAGES_DEPLOY_DIR &&
    stepWithValue(lines, stepStart, stepEnd, "packageManager") === "npm" &&
    stepWithValue(lines, stepStart, stepEnd, "command") === STORYBOOK_PAGES_DEPLOY_COMMAND &&
    stepWithValue(lines, stepStart, stepEnd, "gitHubToken") === "${{ secrets.GITHUB_TOKEN }}"
  );
}

function runTextIncludesPagesDeploy(runText: string): boolean {
  const joinedContinuations = runText.replace(/\\\s*\r?\n\s*/g, " ");
  return /(?:^|\s)["']?pages["']?\s+["']?deploy["']?(?:\s|$)/.test(joinedContinuations);
}

function gitignoreIgnoresStorybookPagesDeployDir(gitignore: string): boolean {
  return gitignore
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => line.replace(/^\//, ""))
    .some((line) => line === `${STORYBOOK_PAGES_DEPLOY_DIR}/`);
}

function pnpmWorkspaceHasIgnoredBuildPolicy(pnpmWorkspace: string): boolean {
  const lines = workflowLines(pnpmWorkspace);
  const allowBuildsStart = lines.findIndex((line) => line.indent === 0 && line.text === "allowBuilds:");
  if (allowBuildsStart === -1) return false;
  const allowBuilds = blockScalarChildMap(lines, allowBuildsStart, blockEnd(lines, allowBuildsStart));
  return REQUIRED_IGNORED_BUILD_PACKAGES.every((packageName) => allowBuilds.get(packageName) === "false");
}

function workflowHasStorybookDeployContract(workflow: string): boolean {
  const lines = workflowLines(workflow);
  const activeText = lines.map((line) => line.text).join("\n").toLowerCase();
  if (
    activeText.includes("cloudflare/pages-action@") ||
    activeText.includes("actions/upload-artifact@") ||
    activeText.includes("actions/download-artifact@")
  ) {
    return false;
  }
  if (!workflowBuildsPullRequestsAndDeploysPushesToMain(workflow)) return false;
  if (!workflowHasGitDefaultBranchConfig(workflow)) return false;

  const jobs = workflowJobBlocks(lines);
  if (jobs.length !== 1) return false;

  for (const [jobStart, jobEnd] of jobs) {
    if (lines[jobStart].text !== "build-storybook:") continue;
    if (blockScalarChildValue(lines, jobStart, jobEnd, "name") !== STORYBOOK_REQUIRED_JOB_NAME) {
      return false;
    }
    const permissions = childBlock(lines, jobStart, jobEnd, "permissions");
    if (!permissions || blockScalarChildValue(lines, permissions[0], permissions[1], "deployments") !== "write") {
      return false;
    }

    const steps = childBlock(lines, jobStart, jobEnd, "steps");
    if (!steps) return false;

    let storybookBuildStep = -1;
    let prepareDeployDirStep = -1;
    let prepareDeployDirStepCount = 0;
    let wranglerDeployStep = -1;
    let wranglerDeployStepCount = 0;

    for (const [stepStart, stepEnd] of stepBlocks(lines, steps[0], steps[1])) {
      const runText = stepRunText(lines, stepStart, stepEnd);
      if (runTextIncludesPagesDeploy(runText)) return false;

      if (runText === "pnpm build-storybook") {
        storybookBuildStep = stepStart;
      }

      if (
        stepIfEquals(lines, stepStart, stepEnd, "github.ref == 'refs/heads/main'") &&
        storybookDeployPrepRunIsClean(runText)
      ) {
        prepareDeployDirStepCount += 1;
        prepareDeployDirStep = stepStart;
      }

      if (!stepUses(lines, stepStart, stepEnd, "cloudflare/wrangler-action@")) continue;
      if (!stepIfEquals(lines, stepStart, stepEnd, "github.ref == 'refs/heads/main'")) return false;
      if (!storybookWranglerDeployStepIsClean(lines, stepStart, stepEnd)) return false;
      wranglerDeployStepCount += 1;
      wranglerDeployStep = stepStart;
    }

    return (
      storybookBuildStep >= 0 &&
      prepareDeployDirStepCount === 1 &&
      wranglerDeployStepCount === 1 &&
      prepareDeployDirStep > storybookBuildStep &&
      wranglerDeployStep > prepareDeployDirStep &&
      workflowUsesCorepackPnpmSetup(workflow)
    );
  }

  return false;
}

export function validateDeploymentConfig(inputs: DeploymentPreflightInputs): DeploymentPreflightResult {
  const scripts = packageScripts(inputs.packageJson);
  const readmeAndDeploymentDoc = `${inputs.readme}\n${inputs.deploymentDoc}`;
  const productionVars = objectRecord(inputs.wrangler.vars);
  const envConfig = objectRecord(inputs.wrangler.env);
  const qaConfig = objectRecord(envConfig.qa);
  const qaVars = objectRecord(qaConfig.vars);
  const productionDb = bindingRecord(inputs.wrangler.d1_databases, "DB");
  const qaDb = bindingRecord(qaConfig.d1_databases, "DB");
  const productionPhotos = bindingRecord(inputs.wrangler.r2_buckets, "PHOTOS");
  const qaPhotos = bindingRecord(qaConfig.r2_buckets, "PHOTOS");
  const productionNamespaceIds = new Set(namespaceIds(inputs.wrangler.ratelimits));
  const qaNamespaceIds = namespaceIds(qaConfig.ratelimits);
  const productionCspMode = productionVars.SPOONJOY_CSP_MODE;
  const qaCspMode = qaVars.SPOONJOY_CSP_MODE;
  const cspModesAreValid = (
    (productionCspMode === "enforce" || productionCspMode === "report-only") &&
    (qaCspMode === "enforce" || qaCspMode === "report-only")
  );
  const cspIsEnforcing = productionCspMode === "enforce" && qaCspMode === "enforce";
  const cspIsReportOnlyRollback = (
    cspModesAreValid &&
    (productionCspMode === "report-only" || qaCspMode === "report-only")
  );
  const hasCspBreakGlass = inputs.cspReportOnlyBreakGlass === CSP_REPORT_ONLY_BREAK_GLASS_ACK;
  const productionPostHogOrigin = normalizedHttpsOrigin(productionVars.VITE_POSTHOG_HOST);
  const qaPostHogOrigin = normalizedHttpsOrigin(qaVars.VITE_POSTHOG_HOST);
  const postHogOriginsMatch = Boolean(
    productionPostHogOrigin &&
    qaPostHogOrigin &&
    productionPostHogOrigin === qaPostHogOrigin,
  );
  const productionBuildPlan = postHogOriginsMatch
    ? createReactRouterBuildPlan(inputs.wrangler, {})
    : null;
  const qaBuildPlan = postHogOriginsMatch
    ? createReactRouterBuildPlan(inputs.wrangler, { CLOUDFLARE_ENV: "qa" })
    : null;
  const ciWorkflowIsCanonical = parsedCiWorkflowIsCanonical(inputs.ciWorkflow);

  const checks: PreflightCheck[] = [
    check(
      "wrangler app entry",
      typeof inputs.wrangler.name === "string" &&
        typeof inputs.wrangler.main === "string" &&
        typeof (inputs.wrangler.assets as Record<string, unknown> | undefined)?.directory === "string",
      "wrangler.json must define app name, Worker entrypoint, and built asset directory."
    ),
    check(
      "node compatibility",
      Array.isArray(inputs.wrangler.compatibility_flags) && inputs.wrangler.compatibility_flags.includes("nodejs_compat"),
      "wrangler.json must keep nodejs_compat enabled for Prisma, OAuth, and MCP runtime compatibility."
    ),
    check(
      "D1 binding",
      hasBinding(inputs.wrangler.d1_databases, "DB", ["database_name", "database_id"]),
      "wrangler.json must bind Cloudflare D1 as DB with database_name and database_id."
    ),
    check(
      "R2 photos binding",
      hasBinding(inputs.wrangler.r2_buckets, "PHOTOS", ["bucket_name"]),
      "wrangler.json must bind the recipe/profile photo bucket as PHOTOS."
    ),
    check(
      "Worker version metadata",
      objectRecord(inputs.wrangler.version_metadata).binding === "CF_VERSION_METADATA",
      "wrangler.json must bind Worker version metadata as CF_VERSION_METADATA for exact-version canary verification."
    ),
    check(
      "QA Worker version metadata",
      objectRecord(qaConfig.version_metadata).binding === "CF_VERSION_METADATA",
      "wrangler.json env.qa must bind Worker version metadata as CF_VERSION_METADATA for exact-version QA canary verification."
    ),
    check(
      "QA environment",
      hasBinding(qaConfig.d1_databases, "DB", ["database_name", "database_id"]) &&
        hasBinding(qaConfig.r2_buckets, "PHOTOS", ["bucket_name"]) &&
        hasExpectedRateLimitBindings(qaConfig.ratelimits) &&
        qaVars.NODE_ENV === "production" &&
        qaVars.SPOONJOY_BASE_URL === "https://spoonjoy-v2-qa.mendelow-studio.workers.dev",
      "wrangler.json must define env.qa with DB, PHOTOS, rate limits, NODE_ENV=production, and the QA Worker base URL."
    ),
    check(
      "CSP enforcement config",
      cspModesAreValid && (cspIsEnforcing || (cspIsReportOnlyRollback && hasCspBreakGlass)),
      `wrangler.json must set SPOONJOY_CSP_MODE=enforce for production and QA; report-only requires SPOONJOY_CSP_REPORT_ONLY_BREAK_GLASS=${CSP_REPORT_ONLY_BREAK_GLASS_ACK}.`
    ),
    check(
      "CSP report-only break-glass",
      !cspIsReportOnlyRollback,
      `report-only CSP rollback is break-glass acknowledged with ${CSP_REPORT_ONLY_BREAK_GLASS_ACK}; restore SPOONJOY_CSP_MODE=enforce after the rollback.`,
      "warning",
    ),
    check(
      "PostHog CSP host config",
      postHogOriginsMatch,
      "wrangler.json production/QA vars must set the same origin-only HTTPS VITE_POSTHOG_HOST; QA preflight validates the generated Worker config and structured client build metadata after each build."
    ),
    check(
      "React Router build contract",
      scripts.build === REQUIRED_BUILD_PACKAGE_SCRIPT &&
        reactRouterBuildEntrypointIsCanonical(inputs.reactRouterBuild) &&
        Boolean(
          productionBuildPlan &&
          qaBuildPlan &&
          Object.isFrozen(productionBuildPlan) &&
          Object.isFrozen(qaBuildPlan) &&
          Object.isFrozen(productionBuildPlan.contract) &&
          Object.isFrozen(qaBuildPlan.contract) &&
          productionBuildPlan.env.VITE_POSTHOG_HOST === productionPostHogOrigin &&
          productionBuildPlan.contract.postHogHost === productionPostHogOrigin &&
          productionBuildPlan.contract.metadata.publicEnv.VITE_POSTHOG_HOST === productionPostHogOrigin &&
          qaBuildPlan.env.VITE_POSTHOG_HOST === qaPostHogOrigin &&
          qaBuildPlan.contract.postHogHost === qaPostHogOrigin &&
          qaBuildPlan.contract.metadata.publicEnv.VITE_POSTHOG_HOST === qaPostHogOrigin,
        ),
      "scripts/react-router-build.ts must invoke only the checked runner, which must derive one immutable PostHog host contract for the child build environment and metadata.",
    ),
    check(
      "QA resource isolation",
      qaDb?.database_name === "spoonjoy-qa" &&
        qaDb.database_id === "c6c99e80-bd51-4cf2-b7c7-b7a6e27d3f34" &&
        qaDb.database_id !== productionDb?.database_id &&
        qaPhotos?.bucket_name === "spoonjoy-photos-qa" &&
        qaPhotos.bucket_name !== productionPhotos?.bucket_name &&
        hasExpectedRateLimitBindings(qaConfig.ratelimits) &&
        qaNamespaceIds.every((namespaceId) => !productionNamespaceIds.has(namespaceId)),
      "wrangler.json env.qa must use separate D1, R2, and rate-limit namespaces from production."
    ),
    check(
      "production node env",
      productionVars.NODE_ENV === "production",
      "wrangler.json vars should set NODE_ENV=production for deploy builds.",
      "warning"
    ),
    check(
      "package scripts",
      REQUIRED_PACKAGE_SCRIPTS.every((script) => script in scripts),
      `package.json must include scripts: ${REQUIRED_PACKAGE_SCRIPTS.join(", ")}.`
    ),
    check(
      "QA package scripts",
      REQUIRED_QA_PACKAGE_SCRIPTS.every((script) => script in scripts) &&
        scripts["qa:preflight"] === "tsx scripts/qa-preflight.ts" &&
        scripts["qa:migrate"] === "pnpm exec wrangler d1 migrations apply DB --remote --env qa" &&
        scripts["qa:seed"] === "node scripts/seed-qa.mjs --target-env qa" &&
        scripts["deploy:qa"] === REQUIRED_QA_DEPLOY_PACKAGE_SCRIPT &&
        typeof scripts["smoke:qa"] === "string" &&
        scripts["smoke:qa"].includes("--target-env qa") &&
        scripts["smoke:qa"].includes("spoonjoy-v2-qa.mendelow-studio.workers.dev") &&
        typeof scripts["smoke:qa:image-cover"] === "string" &&
        scripts["smoke:qa:image-cover"].includes("--target-env qa") &&
        scripts["smoke:qa:image-cover"].includes("spoonjoy-v2-qa.mendelow-studio.workers.dev") &&
        scripts["smoke:qa:image-cover"].includes("--include-image-cover-smoke"),
      `package.json must include QA scripts: ${REQUIRED_QA_PACKAGE_SCRIPTS.join(", ")}.`
    ),
    check(
      "cleanup package scripts",
      Object.entries(REQUIRED_CLEANUP_PACKAGE_SCRIPTS).every(([script, command]) => scripts[script] === command),
      "package.json must expose explicit local, QA, and production cleanup scripts with --target-env; cleanup:qa must remain a local alias."
    ),
    check(
      "script typecheck",
      scripts["typecheck:scripts"] === "tsc -p tsconfig.scripts.json" &&
        REQUIRED_SCRIPT_TYPECHECK_INCLUDES.every((file) => inputs.tsconfigScripts.includes(file)),
      "package.json must expose typecheck:scripts and tsconfig.scripts.json must include modified TypeScript scripts."
    ),
    check(
      "deploy script",
      typeof scripts.deploy === "string" && scripts.deploy.includes("pnpm run build") && scripts.deploy.includes("wrangler deploy"),
      "package.json deploy script must build first and deploy with wrangler. Use pnpm run deploy; bare pnpm deploy is pnpm's workspace deploy command."
    ),
    check(
      "deploy:auto script",
      scripts["deploy:auto"] === "tsx scripts/deploy-production-canary.ts",
      "package.json deploy:auto must run the staged production canary orchestrator."
    ),
    check(
      "output gate scripts",
      scripts["test:coverage"] === "tsx scripts/warning-gate.ts -- pnpm run api:playground:generate --then pnpm exec vitest run --coverage --fileParallelism=false" &&
        scripts["test:e2e"] === "env -u FORCE_COLOR -u NO_COLOR PLAYWRIGHT_FORCE_TTY=0 tsx scripts/warning-gate.ts -- pnpm exec playwright test --reporter=list,html",
      "package.json test:coverage and test:e2e must run through scripts/warning-gate.ts so unexpected output fails CI."
    ),
    check(
      "preflight script",
      typeof scripts["deploy:preflight"] === "string" && scripts["deploy:preflight"].includes("deployment-preflight"),
      "package.json must expose deploy:preflight for local and CI production-readiness checks."
    ),
    check(
      "CI workflow",
      ciWorkflowIsCanonical,
      ".github/workflows/ci.yml must validate pushes and pull requests to main with checkout output suppression, Corepack pnpm activation, and output-gated seed/typecheck/build/test paths."
    ),
    check(
      "production deploy workflow",
      parsedProductionWorkflowIsCanonical(inputs.productionDeployWorkflow),
      ".github/workflows/production-deploy.yml must deploy only an exact successful main-branch CI SHA, validate exact-SHA manual dispatches, pin every action, run deploy:auto with Cloudflare credentials, and record the released SHA."
    ),
    check(
      "QA image-cover smoke workflow",
      workflowTriggersOnlyDispatchAndSchedule(inputs.qaImageCoverSmokeWorkflow) &&
        workflowHasQaImageCoverSmokeGuards(inputs.qaImageCoverSmokeWorkflow) &&
        workflowHasGitDefaultBranchConfig(inputs.qaImageCoverSmokeWorkflow) &&
        workflowUsesCorepackPnpmSetup(inputs.qaImageCoverSmokeWorkflow),
      ".github/workflows/qa-image-cover-smoke.yml must run only on schedule/manual dispatch, guard Cloudflare and QA image-provider credentials, suppress checkout warnings, use Corepack pnpm activation, and run the QA-only image-cover smoke without deploy commands."
    ),
    check(
      "Storybook deploy workflow",
      workflowHasStorybookDeployContract(inputs.storybookWorkflow),
      ".github/workflows/storybook.yml must build Storybook and deploy main-branch Pages from a clean generated deploy directory through cloudflare/wrangler-action@v4 with npm package manager, commit metadata, dirty-state intent, Cloudflare credentials, deployments: write, and GITHUB_TOKEN wiring."
    ),
    check(
      "Storybook generated deploy ignore",
      gitignoreIgnoresStorybookPagesDeployDir(inputs.gitignore),
      `.gitignore must ignore the generated ${STORYBOOK_PAGES_DEPLOY_DIR}/ directory used for Storybook Pages deploys.`
    ),
    check(
      "pnpm build script policy",
      pnpmWorkspaceHasIgnoredBuildPolicy(inputs.pnpmWorkspace),
      `pnpm-workspace.yaml must set allowBuilds false for intentionally ignored dependency build scripts: ${REQUIRED_IGNORED_BUILD_PACKAGES.join(", ")}.`
    ),
    check(
      "Cloudflare Env typing",
      ["DB", "PHOTOS", "CF_VERSION_METADATA", "SPOONJOY_CSP_MODE", ...REQUIRED_SECRET_NAMES, ...IMAGE_PROVIDER_ENV_NAMES].every((name) => inputs.cloudflareEnvDts.includes(`${name}?`)),
      "app/cloudflare-env.d.ts must type all Cloudflare bindings and documented secrets."
    ),
    check(
      "secret documentation",
      REQUIRED_SECRET_NAMES.every((name) => readmeAndDeploymentDoc.includes(name)),
      `README/deployment docs must mention every secret: ${REQUIRED_SECRET_NAMES.join(", ")}.`
    ),
    check(
      "deployment commands",
      [
        "pnpm run deploy:preflight",
        "wrangler d1 migrations apply DB --remote",
        "wrangler r2 bucket create spoonjoy-photos",
        "wrangler secret put SESSION_SECRET",
      ].every((command) => readmeAndDeploymentDoc.includes(command)),
      "Deployment docs must include preflight, D1 migration, R2 bucket, and secret commands."
    ),
    check(
      "telemetry env typing",
      TELEMETRY_SERVER_ENV_NAMES.every((name) => inputs.cloudflareEnvDts.includes(`${name}?`)),
      `app/cloudflare-env.d.ts must type optional telemetry runtime env: ${TELEMETRY_SERVER_ENV_NAMES.join(", ")}.`
    ),
    check(
      "telemetry documentation",
      [
        ...TELEMETRY_CLIENT_ENV_NAMES,
        ...TELEMETRY_SERVER_ENV_NAMES,
        "docs/analytics-privacy.md",
        "server lifecycle telemetry",
      ].every((item) => readmeAndDeploymentDoc.includes(item)),
      "README/deployment docs must explain optional PostHog client and server lifecycle telemetry setup."
    ),
    check(
      "telemetry deployment commands",
      [
        "wrangler secret put POSTHOG_KEY",
        "VITE_POSTHOG_KEY",
        "POSTHOG_DISABLED",
      ].every((item) => readmeAndDeploymentDoc.includes(item)),
      "Deployment docs must show how to enable or intentionally disable PostHog without printing secret values."
    ),
    check(
      "CSP rollback documentation",
      [
        "SPOONJOY_CSP_MODE",
        "Content-Security-Policy-Report-Only",
        "one-commit rollback",
        "SPOONJOY_CSP_REPORT_ONLY_BREAK_GLASS",
        CSP_REPORT_ONLY_BREAK_GLASS_ACK,
      ].every((item) => readmeAndDeploymentDoc.includes(item)),
      "README/deployment docs must document CSP enforcement and the report-only break-glass rollback."
    ),
    check(
      "cleanup documentation",
      [
        "cleanup:local",
        "cleanup:local:apply",
        "cleanup:remote:qa",
        "cleanup:remote:qa:apply",
        "cleanup:production",
        "target-env local",
        "target-env qa",
        "target-env production",
        "broad production cleanup is read-only",
      ].every((item) => readmeAndDeploymentDoc.includes(item)),
      "README/deployment docs must document explicit cleanup target scripts and production broad-cleanup refusal."
    ),
    check(
      "image provider documentation",
      [
        ...IMAGE_PROVIDER_ENV_NAMES,
        "IMAGE_PROVIDER_PRIMARY",
        "IMAGE_PROVIDER_FALLBACKS",
        "gemini-3.1-flash-image",
      ].every((item) => readmeAndDeploymentDoc.includes(item)),
      "README/deployment docs must explain image provider fallback env and Gemini setup."
    ),
    check(
      "script coverage instrumentation",
      REQUIRED_SCRIPT_COVERAGE_INCLUDES.every((file) => inputs.vitestConfig.includes(file)),
      `vitest.config.ts coverage include must cover script harness files: ${REQUIRED_SCRIPT_COVERAGE_INCLUDES.join(", ")}.`
    ),
    check(
      "migration files",
      inputs.migrationFiles.some((file) => /^\d{4}_.+\.sql$/.test(file)),
      "migrations/ must contain numbered SQL migrations before production deploy."
    ),
  ];

  return {
    checks,
    errors: checks.filter((item) => !item.ok && item.severity === "error"),
    warnings: checks.filter((item) => !item.ok && item.severity === "warning"),
  };
}

export interface WranglerRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type RunWrangler = (args: string[]) => Promise<WranglerRunResult>;

export interface RemoteMigrationCheckDeps {
  runWrangler: RunWrangler;
  env?: NodeJS.ProcessEnv;
}

type ExecFileLike = (
  command: string,
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv },
  callback: (
    error: (Error & { code?: number | string }) | null,
    stdout: string,
    stderr: string,
  ) => void,
) => unknown;

export function createWranglerRunner(
  execFileImpl: ExecFileLike = nodeExecFile as unknown as ExecFileLike,
): RunWrangler {
  return (args) =>
    new Promise<WranglerRunResult>((resolve, reject) => {
      execFileImpl("pnpm", ["exec", "wrangler", ...args], {}, (error, stdout, stderr) => {
        if (error) {
          if (typeof error.code === "number") {
            resolve({ stdout, stderr, exitCode: error.code });
            return;
          }
          reject(error);
          return;
        }
        resolve({ stdout, stderr, exitCode: 0 });
      });
    });
}

const RemoteMigrationListSchema = z.array(z.object({ Name: z.string() }));

const AUTH_ERROR_PATTERN = /auth|oauth|login|unauthenticated|api token|10000/i;
const NO_PENDING_MIGRATIONS_PATTERN = /no migrations to apply/i;
const MIGRATION_FILE_PATTERN = /\b\d{4}_[A-Za-z0-9_.-]+\.sql\b/g;

function parseRemoteMigrationList(stdout: string): { migrations: { Name: string }[]; error?: string } {
  const trimmed = stdout.trim();

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(stdout);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { migrations: [], error: `Could not parse wrangler JSON output: ${message}` };
    }

    const shape = RemoteMigrationListSchema.safeParse(parsedJson);
    if (!shape.success) {
      return {
        migrations: [],
        error: `Unexpected wrangler JSON shape: ${shape.error.issues.map((issue) => issue.message).join("; ")}`,
      };
    }

    return { migrations: shape.data };
  }

  if (NO_PENDING_MIGRATIONS_PATTERN.test(stdout)) {
    return { migrations: [] };
  }

  const names = Array.from(new Set(stdout.match(MIGRATION_FILE_PATTERN) ?? []));
  if (names.length > 0) {
    return { migrations: names.map((Name) => ({ Name })) };
  }

  return {
    migrations: [],
    error: "Could not parse wrangler migration output: expected JSON, a no-migrations message, or migration filenames.",
  };
}

export async function checkRemoteMigrations(deps: RemoteMigrationCheckDeps): Promise<PreflightCheck> {
  const env = deps.env ?? process.env;
  if (env.SPOONJOY_PREFLIGHT_SKIP_REMOTE === "1") {
    return check(
      "remote D1 migrations",
      true,
      "Skipped remote D1 migration check (SPOONJOY_PREFLIGHT_SKIP_REMOTE=1).",
      "warning",
    );
  }

  let result: WranglerRunResult;
  try {
    result = await deps.runWrangler(["d1", "migrations", "list", "DB", "--remote"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return check("remote D1 migrations", false, `Failed to invoke wrangler: ${message}`);
  }

  if (result.exitCode !== 0) {
    if (AUTH_ERROR_PATTERN.test(result.stderr)) {
      return check(
        "remote D1 migrations",
        false,
        `Could not verify remote D1 migrations (wrangler auth error): ${result.stderr.trim()}`,
        "warning",
      );
    }
    return check(
      "remote D1 migrations",
      false,
      `wrangler exited with code ${result.exitCode}: ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }

  const parsed = parseRemoteMigrationList(result.stdout);
  if (parsed.error) {
    return check("remote D1 migrations", false, parsed.error);
  }

  const pending = parsed.migrations;
  if (pending.length === 0) {
    return check("remote D1 migrations", true, "Remote D1 is up to date — no pending migrations.");
  }

  const names = pending.map((migration) => migration.Name).join(", ");
  return check(
    "remote D1 migrations",
    false,
    `Remote D1 has ${pending.length} pending migration(s): ${names}. Run \`pnpm exec wrangler d1 migrations apply DB --remote\` (or use \`pnpm deploy:auto\`).`,
  );
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
}

export interface RunDeploymentPreflightDeps {
  runWrangler?: RunWrangler;
  env?: NodeJS.ProcessEnv;
}

export async function runDeploymentPreflight(
  rootDir = process.cwd(),
  deps: RunDeploymentPreflightDeps = {},
): Promise<DeploymentPreflightResult> {
  const [
    wrangler,
    packageJson,
    ciWorkflow,
    productionDeployWorkflow,
    qaImageCoverSmokeWorkflow,
    storybookWorkflow,
    gitignore,
    pnpmWorkspace,
    cloudflareEnvDts,
    reactRouterBuild,
    readme,
    deploymentDoc,
    vitestConfig,
    tsconfigScripts,
    migrationFiles,
  ] = await Promise.all([
    readJsonFile(path.join(rootDir, "wrangler.json")),
    readJsonFile(path.join(rootDir, "package.json")),
    readFile(path.join(rootDir, ".github/workflows/ci.yml"), "utf8"),
    readFile(path.join(rootDir, ".github/workflows/production-deploy.yml"), "utf8"),
    readFile(path.join(rootDir, ".github/workflows/qa-image-cover-smoke.yml"), "utf8"),
    readFile(path.join(rootDir, ".github/workflows/storybook.yml"), "utf8"),
    readFile(path.join(rootDir, ".gitignore"), "utf8"),
    readFile(path.join(rootDir, "pnpm-workspace.yaml"), "utf8"),
    readFile(path.join(rootDir, "app/cloudflare-env.d.ts"), "utf8"),
    readFile(path.join(rootDir, "scripts/react-router-build.ts"), "utf8"),
    readFile(path.join(rootDir, "README.md"), "utf8"),
    readFile(path.join(rootDir, "docs/deployment.md"), "utf8"),
    readFile(path.join(rootDir, "vitest.config.ts"), "utf8"),
    readFile(path.join(rootDir, "tsconfig.scripts.json"), "utf8"),
    readdir(path.join(rootDir, "migrations")),
  ]);

  const baseResult = validateDeploymentConfig({
    wrangler,
    packageJson,
    ciWorkflow,
    productionDeployWorkflow,
    qaImageCoverSmokeWorkflow,
    storybookWorkflow,
    gitignore,
    pnpmWorkspace,
    cloudflareEnvDts,
    reactRouterBuild,
    readme,
    deploymentDoc,
    vitestConfig,
    tsconfigScripts,
    migrationFiles,
    cspReportOnlyBreakGlass: deps.env?.SPOONJOY_CSP_REPORT_ONLY_BREAK_GLASS ?? process.env.SPOONJOY_CSP_REPORT_ONLY_BREAK_GLASS,
  });

  const runWrangler = deps.runWrangler ?? createWranglerRunner();
  const remoteCheck = await checkRemoteMigrations({ runWrangler, env: deps.env });

  const checks = [...baseResult.checks, remoteCheck];
  return {
    checks,
    errors: checks.filter((item) => !item.ok && item.severity === "error"),
    warnings: checks.filter((item) => !item.ok && item.severity === "warning"),
  };
}

export function formatCheck(item: PreflightCheck): string {
  const prefix = item.ok ? "PASS" : item.severity === "warning" ? "WARN" : "FAIL";
  return `${prefix} ${item.name}: ${item.message}`;
}

export interface CliIO {
  log: (message: string) => void;
  error: (message: string) => void;
  exit: (code: number) => void;
}

export interface MainDeps extends RunDeploymentPreflightDeps {
  io?: CliIO;
}

export async function main(deps: MainDeps = {}): Promise<void> {
  const io: CliIO = deps.io ?? {
    log: (message) => {
      console.log(message);
    },
    error: (message) => {
      console.error(message);
    },
    exit: (code) => {
      process.exit(code);
    },
  };

  const result = await runDeploymentPreflight(process.cwd(), {
    runWrangler: deps.runWrangler,
    env: deps.env,
  });
  for (const item of result.checks) {
    io.log(formatCheck(item));
  }

  if (result.errors.length > 0) {
    io.error(`Deployment preflight failed with ${result.errors.length} error(s).`);
    io.exit(1);
    return;
  }

  const warningSuffix = result.warnings.length > 0 ? ` with ${result.warnings.length} warning(s)` : "";
  io.log(`Deployment preflight passed${warningSuffix}.`);
}

export function isCliEntry(argv1: string | undefined, moduleUrl: string): boolean {
  if (!argv1) return false;
  return path.resolve(argv1) === fileURLToPath(moduleUrl);
}

export interface RunCliIfEntryDeps {
  argv1?: string;
  moduleUrl: string;
  runMain?: () => Promise<void>;
  onError?: (error: unknown) => void;
}

export function runCliIfEntry(deps: RunCliIfEntryDeps): boolean {
  if (!isCliEntry(deps.argv1, deps.moduleUrl)) {
    return false;
  }
  const runMain = deps.runMain ?? main;
  const onError =
    deps.onError ??
    ((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Deployment preflight failed: ${message}`);
      process.exit(1);
    });
  runMain().catch(onError);
  return true;
}

runCliIfEntry({ argv1: process.argv[1], moduleUrl: import.meta.url });
