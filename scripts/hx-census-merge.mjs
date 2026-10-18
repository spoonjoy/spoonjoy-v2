#!/usr/bin/env node
// node scripts/hx-census-merge.mjs <directory> <output> [--project <name>]...
//
// The Journeys workflow's merge step: each Playwright worker of the census journey writes
// <directory>/hx-census-actual.<project>.<worker>.json, and the journey writes the states it should
// cover, from its census list, to <directory>/hx-census-expected.json; this merges the worker files,
// deterministically, into <output> (hx-census-actual.json, with the expected set under `$expected`,
// uploaded as the run's `hx-census-actual` artifact for `pnpm census:update <run-id>`). It fails,
// writing nothing, when the expected set is missing, a file is not a census, a journey/state is
// recorded twice, or any project (iphone-webkit and desktop-chrome unless --project names others)
// does not record exactly the expected set.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CENSUS_PROJECTS, EXPECTED_FILE, mergeActuals, parseWorkerFileName, stringifyCensus, validateExpected } from "./hx-census.mjs";
import { listDirectory, readText, writeText } from "./hx-census-update.mjs";

const USAGE = "Usage: node scripts/hx-census-merge.mjs <directory> <output> [--project <name>]...";

/**
 * @param {string[]} argv
 * @returns {{ directory: string, output: string, projects: readonly string[] }}
 */
export function parseMergeArgs(argv) {
  const args = [...argv];
  const positional = [];
  const projects = [];
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--project") {
      const value = args.shift();
      if (value === undefined || value.startsWith("--")) throw new Error(`--project needs a value.\n${USAGE}`);
      projects.push(value);
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option ${arg}.\n${USAGE}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 2) throw new Error(USAGE);
  return { directory: positional[0], output: positional[1], projects: projects.length > 0 ? projects : CENSUS_PROJECTS };
}

/**
 * @param {string[]} [argv]
 * @param {{
 *   readdir?: (directory: string) => string[],
 *   readFile?: (file: string) => string,
 *   writeFile?: (file: string, text: string) => void,
 *   io?: { log: (message: string) => void, error: (message: string) => void },
 *   exit?: (code: number) => void,
 * }} [deps]
 */
export function main(argv = process.argv.slice(2), deps = {}) {
  const {
    readdir = listDirectory,
    readFile = readText,
    writeFile = writeText,
    io = console,
    exit = (code) => {
      process.exitCode = code;
    },
  } = deps;

  try {
    const { directory, output, projects } = parseMergeArgs(argv);
    const expectedFile = path.join(directory, EXPECTED_FILE);
    let expectedText;
    try {
      expectedText = readFile(expectedFile);
    } catch (error) {
      throw new Error(
        `HX census merge failed: ${expectedFile} could not be read (${error instanceof Error ? error.message : String(error)}): the census journey writes it when it starts, so the census did not run.`,
      );
    }
    let expectedData;
    try {
      expectedData = JSON.parse(expectedText);
    } catch (error) {
      throw new Error(`${expectedFile} is not JSON: ${/** @type {SyntaxError} */ (error).message}`);
    }
    const expected = validateExpected(expectedData, expectedFile);
    const files = readdir(directory)
      .filter((name) => parseWorkerFileName(name) !== null)
      .map((name) => {
        const file = path.join(directory, name);
        let data;
        try {
          data = JSON.parse(readFile(file));
        } catch (error) {
          throw new Error(`${file} is not JSON: ${error instanceof Error ? error.message : String(error)}`);
        }
        return { file, data };
      });
    const merged = mergeActuals(files, expected, projects);
    writeFile(output, stringifyCensus(merged));
    io.log(`Merged ${files.length} census file(s) from ${directory} into ${output}.`);
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
  runMain(process.argv.slice(2));
  return true;
}

runCliIfEntry();
