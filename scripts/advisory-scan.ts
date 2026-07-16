import { execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const OSV_SCANNER = {
  name: "OSV-Scanner",
  version: "v2.3.8",
  tagSha: "408fcd6f8707999a29e7ba45e15809764cf24f67",
  linuxAmd64Sha256: "bc98e15319ed0d515e3f9235287ba53cdc5535d576d24fd573978ecfe9ab92dc",
  sourceDocs: [
    "https://google.github.io/osv-scanner/supported-languages-and-lockfiles/",
    "https://google.github.io/osv-scanner/usage/",
    "https://google.github.io/osv-scanner/output/",
    "https://google.github.io/osv-scanner/configuration/",
  ],
} as const;

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

export interface AdvisoryAllowlistEntry {
  id: string;
  packageName: string;
  ecosystem: string;
  reason: string;
  expiresOn: string;
}

export interface AdvisoryAllowlist {
  allowedVulnerabilities: AdvisoryAllowlistEntry[];
  policy?: string;
}

export interface AdvisoryFinding {
  id: string;
  aliases: string[];
  packageName: string;
  version: string;
  ecosystem: string;
  source: string;
  severity: string;
  summary: string;
}

export interface AdvisoryScanResult {
  ok: boolean;
  vulnerabilities: AdvisoryFinding[];
  actionableVulnerabilities: AdvisoryFinding[];
  allowlist: AdvisoryAllowlist;
}

export interface AdvisoryScanOptions {
  allowlistPath: string;
  outputPath: string;
  runner: CommandRunner;
  scannerPath: string;
  now: Date;
}

export interface AdvisoryScannerCommand {
  command: string;
  args: string[];
}

interface CliIO {
  error(message?: unknown): void;
  log(message?: unknown): void;
}

interface RunCliIfEntryDeps {
  argv1?: string;
  moduleUrl?: string;
  argv?: string[];
  runCli?: (argv: string[]) => Promise<number>;
  setExitCode?: (exitCode: number) => void;
}

interface ExecFileError extends Error {
  code?: number | string | null;
  stdout: string;
  stderr?: string;
}

const DEFAULT_ALLOWLIST_PATH = "security/advisory-allowlist.json";
const DEFAULT_OUTPUT_PATH = ".advisory/osv-results.json";

export function createAdvisoryScannerCommand(options: {
  scannerPath: string;
  outputPath: string;
}): AdvisoryScannerCommand {
  return {
    command: options.scannerPath,
    args: ["scan", "--lockfile=pnpm-lock.yaml", "--format=json", `--output-file=${options.outputPath}`],
  };
}

export async function loadAdvisoryAllowlist(allowlistPath: string, now: Date): Promise<AdvisoryAllowlist> {
  const parsed = parseJson(await readFile(allowlistPath, "utf8"), `allowlist ${allowlistPath}`);
  if (!isRecord(parsed) || !Array.isArray(parsed.allowedVulnerabilities)) {
    throw new Error("Advisory allowlist must contain allowedVulnerabilities array");
  }

  const allowlist: AdvisoryAllowlist = {
    allowedVulnerabilities: parsed.allowedVulnerabilities.map((entry, index) =>
      parseAllowlistEntry(entry, `allowedVulnerabilities[${index}]`, now)
    ),
  };
  if (typeof parsed.policy === "string") {
    allowlist.policy = parsed.policy;
  }
  return allowlist;
}

export async function runAdvisoryScan(options: AdvisoryScanOptions): Promise<AdvisoryScanResult> {
  const allowlist = await loadAdvisoryAllowlist(options.allowlistPath, options.now);
  await mkdir(path.dirname(options.outputPath), { recursive: true });
  const command = createAdvisoryScannerCommand({
    scannerPath: options.scannerPath,
    outputPath: options.outputPath,
  });
  const commandResult = await options.runner(command.command, command.args);

  if (commandResult.exitCode !== 0 && commandResult.exitCode !== 1) {
    throw new Error(formatScannerFailure(commandResult));
  }

  const vulnerabilities = await readScannerFindings(options.outputPath);
  if (commandResult.exitCode === 1 && vulnerabilities.length === 0) {
    throw new Error(formatScannerFailure(commandResult));
  }

  const actionableVulnerabilities = vulnerabilities.filter((finding) => !isFindingAllowed(finding, allowlist));
  return {
    ok: actionableVulnerabilities.length === 0,
    vulnerabilities,
    actionableVulnerabilities,
    allowlist,
  };
}

export async function runAdvisoryScanCli(
  argv: string[],
  runner: CommandRunner,
  io: CliIO,
  now: Date,
): Promise<number> {
  try {
    const options = parseCliArgs(argv);
    const result = await runAdvisoryScan({
      allowlistPath: options.allowlistPath,
      outputPath: options.outputPath,
      runner,
      scannerPath: options.scannerPath,
      now,
    });

    if (result.ok) {
      io.log(`Advisory scan passed: ${result.vulnerabilities.length} finding(s), 0 actionable.`);
      return 0;
    }

    io.error(`Advisory scan found ${result.actionableVulnerabilities.length} actionable vulnerability finding(s):`);
    for (const finding of result.actionableVulnerabilities) {
      io.error(`- ${finding.id} ${finding.packageName}@${finding.version} (${finding.severity}) from ${finding.source}`);
    }
    return 1;
  } catch (error) {
    io.error(String(error));
    return 1;
  }
}

export function isCliEntry(argv1: string | undefined, moduleUrl: string): boolean {
  return argv1 !== undefined && path.resolve(argv1) === fileURLToPath(moduleUrl);
}

export function runCliIfEntry(deps: RunCliIfEntryDeps = {}): boolean {
  const argv1 = deps.argv1 ?? process.argv[1];
  const moduleUrl = deps.moduleUrl ?? import.meta.url;
  if (!isCliEntry(argv1, moduleUrl)) return false;
  const runCli = deps.runCli ?? ((argv: string[]) => runAdvisoryScanCli(argv, defaultCommandRunner, console, new Date()));
  const setExitCode = deps.setExitCode ?? ((exitCode: number) => {
    process.exitCode = exitCode;
  });
  runCli(deps.argv ?? process.argv.slice(2)).then(setExitCode);
  return true;
}

export async function defaultCommandRunner(command: string, args: string[]): Promise<CommandResult> {
  try {
    const result = await execFileAsync(command, args, {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const execError = error as ExecFileError;
    const exitCode = typeof execError.code === "number" ? execError.code : 127;
    return {
      exitCode,
      stdout: execError.stdout,
      stderr: execError.stderr || execError.message,
    };
  }
}

function parseCliArgs(argv: string[]): { allowlistPath: string; outputPath: string; scannerPath: string } {
  return {
    allowlistPath: optionValue(argv, "--allowlist", DEFAULT_ALLOWLIST_PATH),
    outputPath: optionValue(argv, "--output", DEFAULT_OUTPUT_PATH),
    scannerPath: optionValue(argv, "--scanner", "osv-scanner"),
  };
}

function optionValue(argv: string[], name: string, fallback: string): string {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

async function readScannerFindings(outputPath: string): Promise<AdvisoryFinding[]> {
  const report = parseJson(await readFile(outputPath, "utf8"), `OSV output ${outputPath}`);
  if (!isRecord(report) || !Array.isArray(report.results)) return [];

  const findings: AdvisoryFinding[] = [];
  for (const result of report.results) {
    if (!isRecord(result) || !Array.isArray(result.packages)) continue;
    const source = parseSourcePath(result.source);
    for (const packageResult of result.packages) {
      if (!isRecord(packageResult)) continue;
      const packageInfo = isRecord(packageResult.package) ? packageResult.package : {};
      const packageName = stringField(packageInfo, "name", "<unknown>");
      const version = stringField(packageInfo, "version", "<unknown>");
      const ecosystem = stringField(packageInfo, "ecosystem", "<unknown>");
      const vulnerabilities = Array.isArray(packageResult.vulnerabilities) ? packageResult.vulnerabilities : [];
      for (const vulnerability of vulnerabilities) {
        if (!isRecord(vulnerability)) continue;
        findings.push({
          id: stringField(vulnerability, "id", "<unknown>"),
          aliases: stringArray(vulnerability.aliases),
          packageName,
          version,
          ecosystem,
          source,
          severity: summarizeSeverity(vulnerability.severity),
          summary: stringField(vulnerability, "summary", ""),
        });
      }
    }
  }
  return findings;
}

function parseAllowlistEntry(entry: unknown, location: string, now: Date): AdvisoryAllowlistEntry {
  if (!isRecord(entry)) throw new Error(`${location} must be an object`);
  const id = requiredString(entry, "id", location);
  const expiresOn = requiredString(entry, "expiresOn", location);
  const packageName = requiredString(entry, "packageName", location);
  const ecosystem = requiredString(entry, "ecosystem", location);
  const reason = requiredString(entry, "reason", location);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) {
    throw new Error(`${location}.expiresOn must be YYYY-MM-DD`);
  }
  const expiry = new Date(`${expiresOn}T23:59:59.999Z`);
  if (Number.isNaN(expiry.getTime())) {
    throw new Error(`${location}.expiresOn must be a valid date`);
  }
  if (expiry.getTime() < now.getTime()) {
    throw new Error(`${location} expired on ${expiresOn}`);
  }
  return { id, packageName, ecosystem, reason, expiresOn };
}

function isFindingAllowed(finding: AdvisoryFinding, allowlist: AdvisoryAllowlist): boolean {
  const findingIds = new Set([finding.id, ...finding.aliases]);
  return allowlist.allowedVulnerabilities.some(
    (entry) =>
      findingIds.has(entry.id) &&
      entry.packageName === finding.packageName &&
      entry.ecosystem.toLowerCase() === finding.ecosystem.toLowerCase(),
  );
}

function summarizeSeverity(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return "unknown";
  const scores = value
    .map((entry) => (isRecord(entry) && typeof entry.score === "string" ? entry.score : null))
    .filter((score): score is string => score !== null);
  return scores.length === 0 ? "unknown" : scores.join(", ");
}

function parseSourcePath(value: unknown): string {
  if (!isRecord(value)) return "<unknown>";
  return stringField(value, "path", "<unknown>");
}

function parseJson(source: string, label: string): unknown {
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid JSON in ${label}: ${String(error)}`);
  }
}

function requiredString(record: Record<string, unknown>, key: string, location: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${location}.${key} is required`);
  }
  return value;
}

function stringField(record: Record<string, unknown>, key: string, fallback: string): string {
  const value = record[key];
  return typeof value === "string" && value !== "" ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function formatScannerFailure(result: CommandResult): string {
  const detail = result.stderr || result.stdout || "no scanner output";
  return `OSV-Scanner failed closed (exit ${result.exitCode}): ${detail}`;
}

runCliIfEntry();
