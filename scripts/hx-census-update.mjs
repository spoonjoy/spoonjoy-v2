#!/usr/bin/env node
// pnpm census:update <run-id | path> [--allow-regression "<reason>"] [--baseline <path>]
//
// Rewrites e2e/journeys/hx-census.baseline.json from a Journeys run's merged census: given a run id,
// it downloads that run's `hx-census-actual` artifact with `gh run download` (into
// .hx-census-download/, which git ignores); given a path, it reads that file. The census must record
// both device projects. A journey's unmarked count may only fall: a rise is refused unless
// --allow-regression gives a reason, which the baseline then records under `$allowedRegressions`
// (review treats it as a finding). See AGENTS.md, "The HX census".
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  ACTUAL_FILE,
  ARTIFACT_NAME,
  BASELINE_PATH,
  stringifyCensus,
  summarizeChanges,
  unmarkedCounts,
  updateBaseline,
} from "./hx-census.mjs";

export const DOWNLOAD_DIRECTORY = ".hx-census-download";
const USAGE = 'Usage: pnpm census:update <run-id | path to hx-census-actual.json> [--allow-regression "<reason>"] [--baseline <path>]';

/**
 * @param {string[]} argv
 * @returns {{ source: string, allowRegression?: string, baseline: string }}
 */
export function parseUpdateArgs(argv) {
  const args = [...argv];
  let source;
  let allowRegression;
  let baseline = BASELINE_PATH;
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--allow-regression" || arg === "--baseline") {
      const value = args.shift();
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a value.\n${USAGE}`);
      if (arg === "--baseline") baseline = value;
      else allowRegression = value;
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
  return { source, allowRegression, baseline };
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

/** A directory's entry names, or none when the directory does not exist. */
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
 * `gh run download` into its own directory under .hx-census-download/; anything else is a path.
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
    const { source, allowRegression, baseline: baselinePath } = parseUpdateArgs(argv);
    const actualPath = await resolveCensusSource(source, { exists, mkdir, run, now, io });
    const actual = JSON.parse(readFile(actualPath));
    const previous = exists(baselinePath) ? JSON.parse(readFile(baselinePath)) : {};
    const { baseline, regressions } = updateBaseline({ previous, actual, allowRegression });
    writeFile(baselinePath, stringifyCensus(baseline));

    const changes = summarizeChanges(previous, baseline);
    io.log(`Wrote ${baselinePath} from ${actualPath}.`);
    io.log(changes.length > 0 ? ["Changes:", ...changes].join("\n") : "No changes.");
    const counts = unmarkedCounts(baseline);
    io.log(
      [
        "Unmarked controls per journey:",
        ...Object.entries(counts).flatMap(([project, journeys]) =>
          Object.entries(journeys).map(([journey, count]) => `  ${project} / ${journey}: ${count}`),
        ),
      ].join("\n"),
    );
    for (const { project, journey, from, to } of regressions) {
      io.log(`Allowed regression (${allowRegression}): ${project} / ${journey} ${from} → ${to} unmarked.`);
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
