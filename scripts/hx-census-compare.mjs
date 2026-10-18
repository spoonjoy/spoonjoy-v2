#!/usr/bin/env node
// pnpm census:compare <run-id | path> <run-id | path>
//
// Compares two Journeys runs' merged censuses (each a run id, downloaded like `pnpm census:update`
// does, or a local hx-census-actual.json) and fails, naming every difference, unless every
// (project, journey, state) recorded the same multiset in both. Run it on two runs of the same
// commit before baselining: any difference is nondeterminism (a run-specific name, a time, data
// another journey changed) that would fail the census on its next run. See AGENTS.md, "The HX census".
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { compareCensuses, validateCensus } from "./hx-census.mjs";
import { makeDirectory, readText, resolveCensusSource, runCommand } from "./hx-census-update.mjs";

const USAGE = "Usage: pnpm census:compare <run-id | path> <run-id | path>";

/**
 * @param {string[]} argv
 * @returns {{ a: string, b: string }}
 */
export function parseCompareArgs(argv) {
  const option = argv.find((arg) => arg.startsWith("--"));
  if (option !== undefined) throw new Error(`Unknown option ${option}.\n${USAGE}`);
  if (argv.length !== 2) throw new Error(USAGE);
  return { a: argv[0], b: argv[1] };
}

/**
 * @param {string[]} [argv]
 * @param {{
 *   readFile?: (file: string) => string,
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
    const { a, b } = parseCompareArgs(argv);
    const load = async (source) => {
      const file = await resolveCensusSource(source, { exists, mkdir, run, now, io });
      return validateCensus(JSON.parse(readFile(file)), file);
    };
    const left = await load(a);
    const right = await load(b);
    const lines = compareCensuses(left, right, { a, b });
    if (lines.length > 0) {
      io.error([`HX census: ${a} and ${b} recorded different censuses:`, ...lines].join("\n"));
      exit(1);
      return;
    }
    io.log(`HX census: ${a} and ${b} recorded identical censuses.`);
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
