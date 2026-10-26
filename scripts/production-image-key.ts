// Sets production's image-generation key from GitHub without a Cloudflare login, and reports
// whether production's AI covers are working. The Production Image Key workflow runs it from main.
//
//   report   the production Worker's secret names (never values), and the last 45 days of AI
//            cover outcomes from production D1, by day, kind, status and failure reason.
//   set-key  stores OPENAI_API_KEY (read from this process's environment, passed to wrangler on
//            stdin, never on a command line), IMAGE_PROVIDER_PRIMARY=openai and
//            IMAGE_PROVIDER_FALLBACKS=gemini in one new Worker version, then deploys it. The version
//            copies the one production runs and carries its source tag, because Production Deploy
//            refuses to release over an untagged version (a plain `wrangler secret put` deploys one).
import { spawn } from "node:child_process";
import { selectCurrentProductionVersion, selectExactVersionSourceSha } from "./deploy-production-canary";

export const IMAGE_KEY_SECRETS = ["OPENAI_API_KEY", "IMAGE_PROVIDER_PRIMARY", "IMAGE_PROVIDER_FALLBACKS"] as const;
/** How many times set-key reads the version list for the version it just made. */
export const VERSION_LIST_ATTEMPTS = 4;
export const VERSION_LIST_RETRY_MS = 5_000;

export const COVER_REPORT_SQL = `SELECT day, source, status, reason, COUNT(*) AS covers FROM (
  SELECT
    CASE WHEN typeof("createdAt") = 'integer' THEN date("createdAt" / 1000, 'unixepoch') ELSE substr("createdAt", 1, 10) END AS day,
    "sourceType" AS source,
    "generationStatus" AS status,
    substr(COALESCE("failureReason", ''), 1, 160) AS reason
  FROM "RecipeCover"
  WHERE "sourceType" IN ('ai-placeholder', 'spoon', 'chef-upload') AND "generationStatus" <> 'none'
) WHERE day >= date('now', '-45 days')
GROUP BY day, source, status, reason
ORDER BY day DESC, source, status, reason`;

/** Runs `pnpm exec wrangler <args>` and resolves with its stdout. */
export type WranglerRunner = (
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; input?: string },
) => Promise<string>;

export interface CoverReportRow {
  day: string;
  source: string;
  status: string;
  reason: string;
  covers: number;
}

function parseJson(payload: string, context: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    throw new Error(`${context} was not valid JSON.`);
  }
}

function rows(value: unknown, context: string): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new Error(`${context} was not a list of rows.`);
  }
  return value as Array<Record<string, unknown>>;
}

export function secretNames(payload: string): string[] {
  return rows(parseJson(payload, "Wrangler secret list"), "Wrangler secret list")
    .map((row) => row.name)
    .filter((name): name is string => typeof name === "string")
    .sort();
}

/** The ids of the Worker's versions made after `versionId`, oldest first. */
export function versionsAfter(payload: string, versionId: string): string[] {
  const versions = rows(parseJson(payload, "Wrangler versions list"), "Wrangler versions list").map((row) => {
    const metadata = row.metadata as { created_on?: unknown } | undefined;
    const createdOn = Date.parse(String(metadata?.created_on));
    if (typeof row.id !== "string" || Number.isNaN(createdOn)) {
      throw new Error("Wrangler versions list had a version without an id or creation time.");
    }
    return { id: row.id, createdOn };
  });
  const reference = versions.find((version) => version.id === versionId);
  if (!reference) throw new Error(`Wrangler versions list does not include version ${versionId}.`);
  return versions
    .filter((version) => version.createdOn > reference.createdOn)
    .sort((left, right) => left.createdOn - right.createdOn)
    .map((version) => version.id);
}

export function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createdVersionId(output: string): string {
  const match = /Created version ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(output);
  if (!match) throw new Error("wrangler versions secret bulk did not report the version it created.");
  return match[1];
}

/** A failure reason short enough for a public log, with addresses and long ids taken out. */
export function sanitizeReason(reason: string): string {
  return reason
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "<id>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export function coverReportRows(payload: string): CoverReportRow[] {
  const statements = rows(parseJson(payload, "Wrangler d1 execute"), "Wrangler d1 execute");
  return rows(statements[0]?.results, "Wrangler d1 execute results").map((row) => ({
    day: String(row.day),
    source: String(row.source),
    status: String(row.status),
    reason: sanitizeReason(String(row.reason ?? "")),
    covers: Number(row.covers),
  }));
}

export function formatCoverReport(report: readonly CoverReportRow[]): string[] {
  if (report.length === 0) return ["No AI cover generations in the last 45 days."];
  return report.map((row) =>
    `${row.day}  ${row.source.padEnd(14)} ${row.status.padEnd(10)} ${String(row.covers).padStart(4)}${row.reason ? `  ${row.reason}` : ""}`);
}

export interface ImageKeyDeps {
  run: WranglerRunner;
  workersEnv: NodeJS.ProcessEnv;
  d1Env: NodeJS.ProcessEnv;
  log: (line: string) => void;
  sleep: (ms: number) => Promise<void>;
}

export async function report({ run, workersEnv, d1Env, log }: ImageKeyDeps): Promise<{ names: string[]; covers: CoverReportRow[] }> {
  const names = secretNames(await run(["secret", "list", "--format", "json"], { env: workersEnv }));
  log(`Production Worker secrets (names only): ${names.join(", ") || "none"}.`);
  const missing = IMAGE_KEY_SECRETS.filter((name) => !names.includes(name));
  log(missing.length === 0 ? `Production has ${IMAGE_KEY_SECRETS.join(", ")}.` : `Production lacks: ${missing.join(", ")}.`);
  const covers = coverReportRows(
    await run(["d1", "execute", "DB", "--remote", "--json", "--command", COVER_REPORT_SQL], { env: d1Env }),
  );
  log("AI cover outcomes, last 45 days (day, kind, status, covers, failure reason):");
  for (const line of formatCoverReport(covers)) log(line);
  return { names, covers };
}

export async function setImageKey(
  { run, workersEnv, log, sleep }: ImageKeyDeps,
  openAiKey: string | undefined,
): Promise<string> {
  const key = openAiKey?.trim() ?? "";
  if (key === "") throw new Error("OPENAI_API_KEY is empty: set the GitHub production environment secret first.");
  const env = { env: workersEnv };

  const activeId = selectCurrentProductionVersion(await run(["deployments", "list", "--json"], env));
  // A new secret version copies the newest version, so it must be the one production runs: after a
  // rolled-back release, or while a release is uploading, the newest version is a candidate.
  const pending = versionsAfter(await run(["versions", "list", "--json"], env), activeId);
  if (pending.length > 0) {
    throw new Error(
      `Worker version ${pending.at(-1)} is newer than the one production runs (${activeId}), so a new secret version would not copy production's code. Release with Production Deploy first.`,
    );
  }
  const sourceSha = selectExactVersionSourceSha(await run(["versions", "view", activeId, "--json"], env), activeId);
  log(`Production runs version ${activeId}, built from ${sourceSha}.`);

  // One version holds all three values, so production never runs with only some of them.
  const values: Record<(typeof IMAGE_KEY_SECRETS)[number], string> = {
    OPENAI_API_KEY: key,
    IMAGE_PROVIDER_PRIMARY: "openai",
    IMAGE_PROVIDER_FALLBACKS: "gemini",
  };
  const versionId = createdVersionId(
    await run(["versions", "secret", "bulk", "--tag", sourceSha], { env: workersEnv, input: JSON.stringify(values) }),
  );
  log(`Stored ${IMAGE_KEY_SECRETS.join(", ")} in new version ${versionId}.`);

  // Deploy only if the new version is the only one made since production's, so it copied
  // production's code and no release started meanwhile. The list can lag a just-made version.
  for (let attempt = 1; ; attempt += 1) {
    const made = versionsAfter(await run(["versions", "list", "--json"], env), activeId);
    if (made.length === 1 && made[0] === versionId) break;
    if (made.some((id) => id !== versionId)) {
      throw new Error(`Other Worker versions (${made.filter((id) => id !== versionId).join(", ")}) appeared next to ${versionId}; not deploying it.`);
    }
    if (attempt === VERSION_LIST_ATTEMPTS) throw new Error(`Wrangler versions list never showed ${versionId}; not deploying it.`);
    await sleep(VERSION_LIST_RETRY_MS);
  }

  await run(["versions", "deploy", `${versionId}@100%`, "-y"], env);
  const deployedId = selectCurrentProductionVersion(await run(["deployments", "list", "--json"], env));
  if (deployedId !== versionId) {
    throw new Error(`Production runs ${deployedId} after the deploy, not the new version ${versionId}.`);
  }
  if (selectExactVersionSourceSha(await run(["versions", "view", versionId, "--json"], env), versionId) !== sourceSha) {
    throw new Error(`Version ${versionId} does not carry production's source tag ${sourceSha}.`);
  }
  const names = secretNames(await run(["secret", "list", "--format", "json"], env));
  const missing = IMAGE_KEY_SECRETS.filter((name) => !names.includes(name));
  if (missing.length > 0) throw new Error(`Production runs ${versionId} but lacks ${missing.join(", ")}.`);
  log(`Production now runs ${versionId}, built from ${sourceSha}, with ${IMAGE_KEY_SECRETS.join(", ")}.`);
  return versionId;
}

/** Wrangler's environment for one Cloudflare token, without any secret it does not need. */
export function wranglerEnv(env: NodeJS.ProcessEnv, tokenName: string): NodeJS.ProcessEnv {
  const token = env[tokenName];
  if (!token || !env.CLOUDFLARE_ACCOUNT_ID) throw new Error(`${tokenName} and CLOUDFLARE_ACCOUNT_ID are required.`);
  const {
    OPENAI_API_KEY: _openAiKey,
    CLOUDFLARE_WORKERS_API_TOKEN: _workersToken,
    CLOUDFLARE_D1_API_TOKEN: _d1Token,
    ...rest
  } = env;
  return { ...rest, CLOUDFLARE_API_TOKEN: token };
}

export function createWranglerRunner(spawnImpl: typeof spawn = spawn): WranglerRunner {
  return (args, { env, input }) => new Promise((resolve, reject) => {
    const child = spawnImpl("pnpm", ["exec", "wrangler", ...args], { env, stdio: ["pipe", "pipe", "inherit"] });
    let stdout = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`wrangler ${args.slice(0, 3).join(" ")} exited with code ${code}.`));
    });
    child.stdin?.end(input ?? "");
  });
}

export async function main(
  argv: readonly string[],
  {
    env = process.env,
    run = createWranglerRunner(),
    log = console.log,
    sleep = waitMs,
  }: { env?: NodeJS.ProcessEnv; run?: WranglerRunner; log?: (line: string) => void; sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const [command] = argv;
  if (command !== "report" && command !== "set-key") {
    throw new Error("Usage: production-image-key.ts <report|set-key>");
  }
  const deps: ImageKeyDeps = {
    run,
    workersEnv: wranglerEnv(env, "CLOUDFLARE_WORKERS_API_TOKEN"),
    d1Env: wranglerEnv(env, "CLOUDFLARE_D1_API_TOKEN"),
    log,
    sleep,
  };
  if (command === "set-key") await setImageKey(deps, env.OPENAI_API_KEY);
  await report(deps);
}

/* istanbul ignore if -- @preserve the CLI boundary delegates to the tested main above. */
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
