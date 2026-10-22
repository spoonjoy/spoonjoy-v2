import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  ACTUAL_FILE,
  ARTIFACT_NAME,
  BASELINE_PATH,
  regressionLabel,
  stringifyCensus,
  summarizeChanges,
  unmarkedCounts,
  updateBaseline,
  UPDATE_COMMAND,
} from "./census.mjs";

// node e2e/ouro-census/census-update.mjs <run-id | path> [--allow-regression "<reason>"] [--remove <journey | project/journey/state>]... [--remove-reason "<reason>"] [--baseline <path>]
//
// Rewrites the census baseline (e2e/ouro-census/census.baseline.json) from one run's merged census:
// given a GitHub Actions run id, it downloads that run's `ouro-census-actual` artifact with
// `gh run download` (into .ouro-census-download/, which your .gitignore should list); given a
// path, it reads that file. The census must cover its expected set (`$expected`: every state of
// the census list on every project in `$projects`). It refuses to drop a project/journey/state the
// baseline has unless --remove names it and --remove-reason says why (the baseline records each
// removal, with its unmarked count, under `$removed`; a renamed journey is a drop plus a new
// journey). Each state's unmarked count may only fall, and a renamed journey or state may not hold
// more unmarked controls than the one it replaces: a rise is refused unless --allow-regression
// gives a reason, which the baseline then records under `$allowedRegressions` (review treats both
// as findings).

/** Where a run's artifact is downloaded. */
export const DOWNLOAD_DIRECTORY = ".ouro-census-download";
const USAGE = `Usage: ${UPDATE_COMMAND.replace("<run-id>", `<run-id | path to ${ACTUAL_FILE}>`)} [--allow-regression "<reason>"] [--remove <journey | project/journey/state>]... [--remove-reason "<reason>"] [--baseline <path>]`;

/**
 * @param {string[]} argv
 * @returns {{ source: string, allowRegression?: string, remove: string[], removeReason?: string, baseline: string }}
 */
export function parseUpdateArgs(argv) {
  const args = [...argv];
  let source;
  let allowRegression;
  let removeReason;
  const remove = [];
  let baseline = BASELINE_PATH;
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--allow-regression" || arg === "--baseline" || arg === "--remove" || arg === "--remove-reason") {
      const value = args.shift();
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a value.\n${USAGE}`);
      if (arg === "--baseline") baseline = value;
      else if (arg === "--remove-reason") removeReason = value;
      else if (arg === "--remove") {
        if (![1, 3].includes(value.split("/").length) || value.split("/").some((part) => part === "")) {
          throw new Error(`--remove takes <journey> or <project/journey/state>, not ${value}.\n${USAGE}`);
        }
        remove.push(value);
      } else allowRegression = value;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option ${arg}.\n${USAGE}`);
    } else if (source === undefined) {
      source = arg;
    } else {
      throw new Error(`Unexpected argument ${arg}.\n${USAGE}`);
    }
  }
  if (source === undefined) throw new Error(USAGE);
  if (allowRegression !== undefined && allowRegression.trim() === "") throw new Error(`--allow-regression needs a reason.\n${USAGE}`);
  if (removeReason !== undefined && removeReason.trim() === "") throw new Error(`--remove-reason needs a reason.\n${USAGE}`);
  if (remove.length > 0 && removeReason === undefined) throw new Error(`--remove needs --remove-reason "<reason>".\n${USAGE}`);
  if (remove.length === 0 && removeReason !== undefined) throw new Error(`--remove-reason needs a --remove.\n${USAGE}`);
  return { source, allowRegression, remove, removeReason, baseline };
}

const execFileAsync = promisify(execFile);

// File system and process defaults, exported so tests can run each one against something harmless.
export function readText(file) {
  return readFileSync(file, "utf8");
}

export function writeText(file, text) {
  writeFileSync(file, text);
}

export function makeDirectory(directory) {
  mkdirSync(directory, { recursive: true });
}

/**
 * A directory's entry names, or none when the directory does not exist.
 *
 * @claim "or none when the directory does not exist" scripts/kits/census-update.test.mjs verify:testExists(scripts/kits/census-update.test.mjs::census-merge.mjs > treats a missing directory as no census, and uses the console and exit code by default)
 */
export function listDirectory(directory) {
  try {
    return readdirSync(directory);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return [];
    throw error;
  }
}

export async function runCommand(file, args) {
  await execFileAsync(file, args, { encoding: "utf8" });
}

/**
 * The path of a run's merged census: a run id (that is not also a file) is downloaded with
 * `gh run download` into its own directory under .ouro-census-download/; anything else is a path.
 * @param {string} source
 * @param {{
 *   exists: (file: string) => boolean,
 *   mkdir: (directory: string) => void,
 *   run: (file: string, args: string[]) => Promise<void>,
 *   now: () => number,
 *   io: { log: (message: string) => void },
 * }} deps
 * @returns {Promise<string>}
 */
export async function resolveCensusSource(source, { exists, mkdir, run, now, io }) {
  if (!/^\d+$/.test(source) || exists(source)) return source;
  const directory = path.join(DOWNLOAD_DIRECTORY, `${source}-${now()}`);
  mkdir(directory);
  io.log(`Downloading ${ARTIFACT_NAME} from run ${source}…`);
  await run("gh", ["run", "download", source, "--name", ARTIFACT_NAME, "--dir", directory]);
  return path.join(directory, ACTUAL_FILE);
}

/**
 * @param {string[]} [argv]
 * @param {{
 *   readFile?: (file: string) => string,
 *   writeFile?: (file: string, text: string) => void,
 *   exists?: (file: string) => boolean,
 *   mkdir?: (directory: string) => void,
 *   run?: (file: string, args: string[]) => Promise<void>,
 *   now?: () => number,
 *   io?: { log: (message: string) => void, error: (message: string) => void },
 *   exit?: (code: number) => void,
 * }} [deps]
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const {
    readFile = readText,
    writeFile = writeText,
    exists = existsSync,
    mkdir = makeDirectory,
    run = runCommand,
    now = Date.now,
    io = console,
    exit = (code) => {
      process.exitCode = code;
    },
  } = deps;

  try {
    const { source, allowRegression, remove, removeReason, baseline: baselinePath } = parseUpdateArgs(argv);
    const actualPath = await resolveCensusSource(source, { exists, mkdir, run, now, io });
    const actual = JSON.parse(readFile(actualPath));
    const previous = exists(baselinePath) ? JSON.parse(readFile(baselinePath)) : {};
    const { baseline, regressions, removed } = updateBaseline({ previous, actual, allowRegression, remove, removeReason });
    writeFile(baselinePath, stringifyCensus(baseline));

    const changes = summarizeChanges(previous, baseline);
    io.log(`Wrote ${baselinePath} from ${actualPath}.`);
    io.log(changes.length > 0 ? ["Changes:", ...changes].join("\n") : "No changes.");
    const counts = unmarkedCounts(baseline);
    io.log(
      [
        "Unmarked controls per state:",
        ...Object.entries(counts).flatMap(([project, journeys]) =>
          Object.entries(journeys).flatMap(([journey, states]) =>
            Object.entries(states).map(([state, count]) => `  ${project} / ${journey} / ${state}: ${count}`),
          ),
        ),
      ].join("\n"),
    );
    for (const { project, journey, state } of removed) {
      io.log(`Removed (${removeReason}): ${project} / ${journey} / ${state}.`);
    }
    for (const regression of regressions) {
      io.log(`Allowed regression (${allowRegression}): ${regressionLabel(regression)} ${regression.from} → ${regression.to} unmarked.`);
    }
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    exit(1);
  }
}

export function isCliEntry(moduleUrl, argv1 = process.argv[1]) {
  return typeof argv1 === "string" && moduleUrl === pathToFileURL(argv1).href;
}

export function runCliIfEntry({ moduleUrl = import.meta.url, argv1 = process.argv[1], runMain = main } = {}) {
  if (!isCliEntry(moduleUrl, argv1)) return false;
  void runMain(process.argv.slice(2));
  return true;
}

runCliIfEntry();
