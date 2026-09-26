#!/usr/bin/env node
// Static "house rules" checker for Playwright journeys (e2e/journeys/**/*.journey.ts,
// **/*.setup.ts). Runs in CI, ahead of the journeys themselves, and fails the build when a
// journey hides flakiness (retries, clicking in a loop, clicking inside a .toPass() retry
// callback or an array-iteration callback) or asserts conditionally, when a @mutates test skips
// the post-reload check, or when a journey/describe block is skipped, only'd, fixme'd, or
// marked to fail instead of actually running.
import { readFile as nodeReadFile, readdir as nodeReaddir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

export const JOURNEY_FILE_PATTERN = /\.(?:journey|setup)\.ts$/;

const CLICK_LIKE_METHODS = new Set(["click", "tap", "press", "fill", "check", "dispatchEvent"]);

const ARRAY_ITERATION_METHODS = new Set([
  "forEach",
  "map",
  "flatMap",
  "filter",
  "some",
  "every",
  "reduce",
  "reduceRight",
  "find",
  "findIndex",
]);

// Playwright's `test`/`test.describe` modifiers. `test.<modifier>(...)` is still a real test
// (rule 4 must still check it for a missing reload check), and both `test.<modifier>(...)` and
// `test.describe.<modifier>(...)` are themselves flagged by rule 5 below.
const TEST_MODIFIERS = new Set(["only", "skip", "fixme", "fail"]);

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
}

function propertyAssignmentName(node) {
  if (ts.isShorthandPropertyAssignment(node)) return node.name.text;
  if (!ts.isPropertyAssignment(node)) return undefined;
  const name = node.name;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return undefined;
}

// True for a bare `test` identifier reference, i.e. the `test` in `test(...)` or the base of
// `test.only(...)` / `test.describe.skip(...)`.
function isTestNamespaceIdentifier(node) {
  return ts.isIdentifier(node) && node.text === "test";
}

function isClickLikeCall(node) {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    CLICK_LIKE_METHODS.has(node.expression.name.text)
  );
}

function isInsideLoop(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (
      ts.isForStatement(current) ||
      ts.isForOfStatement(current) ||
      ts.isForInStatement(current) ||
      ts.isWhileStatement(current) ||
      ts.isDoStatement(current)
    ) {
      return true;
    }
  }
  return false;
}

// Matches `expect(async () => { ... }).toPass()`: the click sits inside the function
// expression/arrow function that is passed as an argument to a call, and that call is the
// object of a `.toPass` property access which is itself invoked.
function isInsideToPassCallback(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (!ts.isFunctionExpression(current) && !ts.isArrowFunction(current)) continue;
    const call = current.parent;
    if (!call || !ts.isCallExpression(call) || !call.arguments.includes(current)) continue;
    const propertyAccess = call.parent;
    if (
      propertyAccess &&
      ts.isPropertyAccessExpression(propertyAccess) &&
      propertyAccess.expression === call &&
      propertyAccess.name.text === "toPass"
    ) {
      return true;
    }
  }
  return false;
}

// Matches `rows.forEach(async (row) => { ... })` and the other Array iteration methods: the
// click sits inside the function expression/arrow function passed as the callback argument.
function isInsideArrayIterationCallback(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (!ts.isFunctionExpression(current) && !ts.isArrowFunction(current)) continue;
    const call = current.parent;
    if (!call || !ts.isCallExpression(call) || !call.arguments.includes(current)) continue;
    if (ts.isPropertyAccessExpression(call.expression) && ARRAY_ITERATION_METHODS.has(call.expression.name.text)) {
      return true;
    }
  }
  return false;
}

function isExpectCall(node) {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "expect";
}

// Walks upward: at the point the walk reaches an IfStatement (or ConditionalExpression),
// `child` is the previous node in the walk, i.e. the direct then/else branch (or ternary
// branch) that actually contains `node`.
function isInsideIfOrConditionalBranch(node) {
  let child = node;
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isIfStatement(current) && (child === current.thenStatement || child === current.elseStatement)) {
      return true;
    }
    if (ts.isConditionalExpression(current) && (child === current.whenTrue || child === current.whenFalse)) {
      return true;
    }
    child = current;
  }
  return false;
}

// Matches `test(...)` and `test.only(...)` / `test.skip(...)` / `test.fixme(...)` /
// `test.fail(...)`: all of these run (or, for skip/fixme, are declared as) an actual test whose
// `@mutates` title still needs a reload check. `test.describe(...)` and its own modifiers are
// deliberately excluded here — a describe block's "body" holds nested tests, not a single
// page-object callback to check for `verifyAfterReload(...)`.
function isTestCall(node) {
  if (!ts.isCallExpression(node) || node.arguments.length < 1) return false;
  if (isTestNamespaceIdentifier(node.expression)) return true;
  return (
    ts.isPropertyAccessExpression(node.expression) &&
    isTestNamespaceIdentifier(node.expression.expression) &&
    TEST_MODIFIERS.has(node.expression.name.text)
  );
}

// Finds the test body: the last function-like argument, regardless of position. Covers both
// `test(title, body)` and Playwright's 3-argument `test(title, options, body)` form.
function testBodyArgument(node) {
  for (let index = node.arguments.length - 1; index >= 0; index -= 1) {
    const candidate = node.arguments[index];
    if (ts.isFunctionExpression(candidate) || ts.isArrowFunction(candidate)) return candidate;
  }
  return undefined;
}

// Reads a call/property-name's static string content. For a template literal with
// interpolations (e.g. `` `adds ${item} @mutates` ``), only the literal text of the head and
// each span is read — the interpolated expressions themselves are not statically known — which
// is enough to detect a literal `@mutates` tag regardless of what is interpolated around it.
function literalTextOf(node) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return node.templateSpans.reduce((text, span) => text + span.literal.text, node.head.text);
  }
  return undefined;
}

// Matches `test.skip(...)`, `test.only(...)`, `test.fixme(...)`, `test.fail(...)`, and the same
// modifiers chained off `test.describe` (`test.describe.skip(...)`, etc.), anywhere in the file.
function isSkippedJourneyCall(node) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
  const { expression: object, name } = node.expression;
  if (!TEST_MODIFIERS.has(name.text)) return false;
  if (isTestNamespaceIdentifier(object)) return true;
  return (
    ts.isPropertyAccessExpression(object) &&
    object.name.text === "describe" &&
    isTestNamespaceIdentifier(object.expression)
  );
}

function containsVerifyAfterReloadCall(node) {
  let found = false;
  function walk(current) {
    if (found) return;
    if (
      ts.isCallExpression(current) &&
      ts.isIdentifier(current.expression) &&
      current.expression.text === "verifyAfterReload"
    ) {
      found = true;
      return;
    }
    ts.forEachChild(current, walk);
  }
  walk(node);
  return found;
}

/**
 * Walks a journey/setup file's AST and returns every house-rule violation it contains.
 * @param {string} fileName
 * @param {string} source
 * @returns {Array<{
 *   file: string,
 *   line: number,
 *   rule: "no-retry-config" | "no-click-in-loop" | "no-assertion-in-if" | "no-skipped-journeys" | "mutation-needs-reload-check",
 *   message: string,
 * }>}
 */
export function checkJourneySource(fileName, source) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const violations = [];

  function report(node, rule, message) {
    violations.push({ file: fileName, line: lineOf(sourceFile, node), rule, message });
  }

  function visit(node) {
    const propertyName = propertyAssignmentName(node);
    if (propertyName === "retries") {
      report(
        node,
        "no-retry-config",
        "Journeys must not configure retries; fix the flaky step instead of hiding it.",
      );
    }

    if (
      isClickLikeCall(node) &&
      (isInsideLoop(node) || isInsideToPassCallback(node) || isInsideArrayIterationCallback(node))
    ) {
      report(
        node,
        "no-click-in-loop",
        `"${node.expression.name.text}" must not run inside a loop, a .toPass() retry callback, or an array-iteration callback; loops and auto-retry hide flakiness.`,
      );
    }

    if (isExpectCall(node) && isInsideIfOrConditionalBranch(node)) {
      report(node, "no-assertion-in-if", "Assertions must not be conditional; branch on setup, not on expect(...).");
    }

    if (isSkippedJourneyCall(node)) {
      report(
        node,
        "no-skipped-journeys",
        `"${node.expression.getText(sourceFile)}" must not appear in a journey; a skipped, only'd, fixme'd, or fail-marked journey hides a real failure instead of surfacing it.`,
      );
    }

    if (isTestCall(node)) {
      const title = literalTextOf(node.arguments[0]);
      if (title !== undefined && title.includes("@mutates")) {
        const body = testBodyArgument(node);
        if (!body || !containsVerifyAfterReloadCall(body)) {
          report(
            node,
            "mutation-needs-reload-check",
            `Mutating test "${title}" must call verifyAfterReload(...) to confirm the mutation survives a reload.`,
          );
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

async function defaultReaddir(directory) {
  return nodeReaddir(directory, { withFileTypes: true, recursive: true });
}

async function defaultReadFile(file) {
  return nodeReadFile(file, "utf8");
}

/**
 * @param {string[]} argv
 * @param {{ readdir?: Function, readFile?: Function, io?: { log: Function, error: Function }, exit?: Function }} deps
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const {
    readdir = defaultReaddir,
    readFile = defaultReadFile,
    io = console,
    exit = (code) => {
      process.exitCode = code;
    },
  } = deps;

  const directory = argv[0];
  if (!directory) {
    io.error("Usage: check-journey-rules.mjs <directory>");
    exit(1);
    return;
  }

  let entries;
  try {
    entries = await readdir(directory);
  } catch (error) {
    io.error(
      `check-journey-rules: cannot read directory "${directory}": ${error instanceof Error ? error.message : String(error)}`,
    );
    exit(1);
    return;
  }

  const files = entries
    .filter((entry) => entry.isFile() && JOURNEY_FILE_PATTERN.test(entry.name))
    .map((entry) => path.join(entry.parentPath ?? entry.path ?? directory, entry.name));

  const violations = [];
  for (const file of files) {
    const source = await readFile(file);
    violations.push(...checkJourneySource(file, source));
  }

  for (const violation of violations) {
    io.log(`${violation.file}:${violation.line} ${violation.rule} ${violation.message}`);
  }

  io.log(`Checked ${files.length} journey file(s), ${violations.length} violation(s).`);

  if (violations.length > 0) {
    exit(1);
  }
}

export function isCliEntry(moduleUrl, argv1 = process.argv[1]) {
  return typeof argv1 === "string" && moduleUrl === pathToFileURL(argv1).href;
}

export function defaultCliErrorHandler(error, io = console) {
  io.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

export function runCliIfEntry({
  moduleUrl = import.meta.url,
  argv1 = process.argv[1],
  runMain = main,
  onError = defaultCliErrorHandler,
} = {}) {
  if (!isCliEntry(moduleUrl, argv1)) return false;
  runMain(process.argv.slice(2)).catch(onError);
  return true;
}

runCliIfEntry();
