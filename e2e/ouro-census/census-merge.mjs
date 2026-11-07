import path from "node:path";
import { pathToFileURL } from "node:url";
import { ACTUAL_FILE, ARTIFACT_NAME, EXPECTED_FILE, mergeActuals, parseWorkerFileName, stringifyCensus, validateExpected } from "./census.mjs";
import { listDirectory, readText, writeText } from "./census-update.mjs";

// node e2e/ouro-census/census-merge.mjs <directory> <output>
//
// CI's merge step, after the census spec ran: each Playwright worker writes
// <directory>/census-actual.<project>.<worker>.json, and the spec writes the projects and states
// the run must cover, from the app's census list, to <directory>/census-expected.json; this merges
// the worker files, deterministically, into <output> (census-actual.json, with the expected set
// under `$expected`), which CI uploads as the run's `ouro-census-actual` artifact for the census
// update. It fails, writing nothing, when the expected set is missing, a file is not a census, a
// journey/state is recorded twice, or any project does not record exactly the expected set.

const USAGE = `Usage: node e2e/ouro-census/census-merge.mjs <directory> <output, such as ${ACTUAL_FILE} for the ${ARTIFACT_NAME} artifact>`;

/**
 * @param {string[]} argv
 * @returns {{ directory: string, output: string }}
 */
export function parseMergeArgs(argv) {
  const option = argv.find((arg) => arg.startsWith("--"));
  if (option !== undefined) throw new Error(`Unknown option ${option}.\n${USAGE}`);
  if (argv.length !== 2) throw new Error(USAGE);
  return { directory: argv[0], output: argv[1] };
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
    const { directory, output } = parseMergeArgs(argv);
    const expectedFile = path.join(directory, EXPECTED_FILE);
    let expectedText;
    try {
      expectedText = readFile(expectedFile);
    } catch (error) {
      throw new Error(
        `Ouro census merge failed: ${expectedFile} could not be read (${error instanceof Error ? error.message : String(error)}): the census spec writes it when it starts, so the census did not run.`,
        { cause: error },
      );
    }
    let expectedData;
    try {
      expectedData = JSON.parse(expectedText);
    } catch (error) {
      throw new Error(`${expectedFile} is not JSON: ${/** @type {SyntaxError} */ (error).message}`, { cause: error });
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
          throw new Error(`${file} is not JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
        }
        return { file, data };
      });
    const merged = mergeActuals(files, expected);
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
