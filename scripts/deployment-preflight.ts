import { execFile as nodeExecFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

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
  productionDeployWorkflow: string;
  qaImageCoverSmokeWorkflow: string;
  storybookWorkflow: string;
  gitignore: string;
  pnpmWorkspace: string;
  cloudflareEnvDts: string;
  readme: string;
  deploymentDoc: string;
  migrationFiles: string[];
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
  const triggerBlock = childBlock(lines, onIndex, onEnd, trigger);
  if (!triggerBlock) return false;
  const branches = childBlock(lines, triggerBlock[0], triggerBlock[1], "branches");
  return branches ? blockHasMainBranch(lines, branches[0], branches[1]) : false;
}

function workflowDeploysPushesToMain(workflow: string): boolean {
  const lines = workflowLines(workflow);
  const onIndex = lines.findIndex((line) => line.indent === 0 && line.text === "on:");
  if (onIndex === -1) return false;
  const onEnd = blockEnd(lines, onIndex);
  const workflowDispatch = childBlock(lines, onIndex, onEnd, "workflow_dispatch");
  return Boolean(workflowDispatch) && workflowTriggerTargetsMain(lines, onIndex, onEnd, "push");
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

function stepRunsDeployAuto(lines: WorkflowLine[], stepStart: number, stepEnd: number): boolean {
  const inlineRun = lines[stepStart].text.match(/^-\s+run:\s*(.+)$/);
  if (inlineRun && inlineRun[1].trim() === "pnpm run deploy:auto") return true;

  const runIndent = lines[stepStart].indent + 2;
  for (let index = stepStart + 1; index < stepEnd; index += 1) {
    if (lines[index].indent !== runIndent) continue;
    const run = lines[index].text.match(/^run:\s*(.*)$/);
    if (!run) continue;

    const value = run[1].trim();
    if (value === "pnpm run deploy:auto") return true;
    if (value !== "|" && value !== ">") continue;

    for (let commandIndex = index + 1; commandIndex < stepEnd; commandIndex += 1) {
      if (lines[commandIndex].indent <= lines[index].indent) break;
      if (lines[commandIndex].text === "pnpm run deploy:auto") return true;
    }
  }
  return false;
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

function workflowHasCloudflareDeployAutoStep(workflow: string): boolean {
  const lines = workflowLines(workflow);
  for (const [jobStart, jobEnd] of workflowJobBlocks(lines)) {
    const steps = childBlock(lines, jobStart, jobEnd, "steps");
    if (!steps) continue;

    for (const [stepStart, stepEnd] of stepBlocks(lines, steps[0], steps[1])) {
      if (
        stepRunsDeployAuto(lines, stepStart, stepEnd) &&
        stepHasEnvKeys(lines, stepStart, stepEnd, ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"])
      ) {
        return true;
      }
    }
  }
  return false;
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

function workflowHasStorybookGitDefaultBranchConfig(lines: WorkflowLine[]): boolean {
  const envIndex = lines.findIndex((line) => line.indent === 0 && line.text === "env:");
  if (envIndex === -1) return false;
  const envEnd = blockEnd(lines, envIndex);
  return (
    blockScalarChildValue(lines, envIndex, envEnd, "GIT_CONFIG_COUNT") === "1" &&
    blockScalarChildValue(lines, envIndex, envEnd, "GIT_CONFIG_KEY_0") === "init.defaultBranch" &&
    blockScalarChildValue(lines, envIndex, envEnd, "GIT_CONFIG_VALUE_0") === "main"
  );
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
    stepUsesExactly(lines, stepStart, stepEnd, "cloudflare/wrangler-action@v4") &&
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
  if (!workflowHasStorybookGitDefaultBranchConfig(lines)) return false;

  const jobs = workflowJobBlocks(lines);
  if (jobs.length !== 1) return false;

  for (const [jobStart, jobEnd] of jobs) {
    if (lines[jobStart].text !== "build-storybook:") continue;
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
      wranglerDeployStep > prepareDeployDirStep
    );
  }

  return false;
}

export function validateDeploymentConfig(inputs: DeploymentPreflightInputs): DeploymentPreflightResult {
  const scripts = packageScripts(inputs.packageJson);
  const readmeAndDeploymentDoc = `${inputs.readme}\n${inputs.deploymentDoc}`;
  const envConfig = objectRecord(inputs.wrangler.env);
  const qaConfig = objectRecord(envConfig.qa);
  const qaVars = objectRecord(qaConfig.vars);
  const productionDb = bindingRecord(inputs.wrangler.d1_databases, "DB");
  const qaDb = bindingRecord(qaConfig.d1_databases, "DB");
  const productionPhotos = bindingRecord(inputs.wrangler.r2_buckets, "PHOTOS");
  const qaPhotos = bindingRecord(qaConfig.r2_buckets, "PHOTOS");
  const productionNamespaceIds = new Set(namespaceIds(inputs.wrangler.ratelimits));
  const qaNamespaceIds = namespaceIds(qaConfig.ratelimits);

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
      "QA environment",
      hasBinding(qaConfig.d1_databases, "DB", ["database_name", "database_id"]) &&
        hasBinding(qaConfig.r2_buckets, "PHOTOS", ["bucket_name"]) &&
        hasExpectedRateLimitBindings(qaConfig.ratelimits) &&
        qaVars.NODE_ENV === "production" &&
        qaVars.SPOONJOY_BASE_URL === "https://spoonjoy-v2-qa.mendelow-studio.workers.dev",
      "wrangler.json must define env.qa with DB, PHOTOS, rate limits, NODE_ENV=production, and the QA Worker base URL."
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
      (inputs.wrangler.vars as Record<string, unknown> | undefined)?.NODE_ENV === "production",
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
        typeof scripts["deploy:qa"] === "string" &&
        scripts["deploy:qa"].includes("pnpm run qa:preflight") &&
        scripts["deploy:qa"].includes("CLOUDFLARE_ENV=qa pnpm run build") &&
        scripts["deploy:qa"].includes("pnpm run qa:migrate") &&
        scripts["deploy:qa"].includes("SPOONJOY_QA_PREFLIGHT_EXPECT_BUILD_CONFIG=1 pnpm run qa:preflight") &&
        scripts["deploy:qa"].includes("wrangler deploy --env qa") &&
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
      "deploy script",
      typeof scripts.deploy === "string" && scripts.deploy.includes("pnpm run build") && scripts.deploy.includes("wrangler deploy"),
      "package.json deploy script must build first and deploy with wrangler. Use pnpm run deploy; bare pnpm deploy is pnpm's workspace deploy command."
    ),
    check(
      "deploy:auto script",
      typeof scripts["deploy:auto"] === "string" &&
        scripts["deploy:auto"].includes("SPOONJOY_PREFLIGHT_SKIP_REMOTE=1 pnpm run deploy:preflight") &&
        scripts["deploy:auto"].includes("pnpm run build") &&
        scripts["deploy:auto"].includes("pnpm exec wrangler d1 migrations apply DB --remote") &&
        scripts["deploy:auto"].includes("pnpm exec wrangler deploy") &&
        scripts["deploy:auto"].indexOf("pnpm exec wrangler d1 migrations apply DB --remote") <
          scripts["deploy:auto"].lastIndexOf("pnpm run deploy:preflight"),
      "package.json deploy:auto must skip only the initial remote preflight, apply D1 migrations, rerun full preflight, then deploy."
    ),
    check(
      "preflight script",
      typeof scripts["deploy:preflight"] === "string" && scripts["deploy:preflight"].includes("deployment-preflight"),
      "package.json must expose deploy:preflight for local and CI production-readiness checks."
    ),
    check(
      "production deploy workflow",
      workflowDeploysPushesToMain(inputs.productionDeployWorkflow) && workflowHasCloudflareDeployAutoStep(inputs.productionDeployWorkflow),
      ".github/workflows/production-deploy.yml must auto-deploy pushes to main with deploy:auto while keeping manual dispatch and Cloudflare credentials wired."
    ),
    check(
      "QA image-cover smoke workflow",
      workflowTriggersOnlyDispatchAndSchedule(inputs.qaImageCoverSmokeWorkflow) &&
        workflowHasQaImageCoverSmokeGuards(inputs.qaImageCoverSmokeWorkflow),
      ".github/workflows/qa-image-cover-smoke.yml must run only on schedule/manual dispatch, guard Cloudflare and QA image-provider credentials, and run the QA-only image-cover smoke without deploy commands."
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
      ["DB", "PHOTOS", ...REQUIRED_SECRET_NAMES, ...IMAGE_PROVIDER_ENV_NAMES].every((name) => inputs.cloudflareEnvDts.includes(`${name}?`)),
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
    productionDeployWorkflow,
    qaImageCoverSmokeWorkflow,
    storybookWorkflow,
    gitignore,
    pnpmWorkspace,
    cloudflareEnvDts,
    readme,
    deploymentDoc,
    migrationFiles,
  ] = await Promise.all([
    readJsonFile(path.join(rootDir, "wrangler.json")),
    readJsonFile(path.join(rootDir, "package.json")),
    readFile(path.join(rootDir, ".github/workflows/production-deploy.yml"), "utf8"),
    readFile(path.join(rootDir, ".github/workflows/qa-image-cover-smoke.yml"), "utf8"),
    readFile(path.join(rootDir, ".github/workflows/storybook.yml"), "utf8"),
    readFile(path.join(rootDir, ".gitignore"), "utf8"),
    readFile(path.join(rootDir, "pnpm-workspace.yaml"), "utf8"),
    readFile(path.join(rootDir, "app/cloudflare-env.d.ts"), "utf8"),
    readFile(path.join(rootDir, "README.md"), "utf8"),
    readFile(path.join(rootDir, "docs/deployment.md"), "utf8"),
    readdir(path.join(rootDir, "migrations")),
  ]);

  const baseResult = validateDeploymentConfig({
    wrangler,
    packageJson,
    productionDeployWorkflow,
    qaImageCoverSmokeWorkflow,
    storybookWorkflow,
    gitignore,
    pnpmWorkspace,
    cloudflareEnvDts,
    readme,
    deploymentDoc,
    migrationFiles,
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
