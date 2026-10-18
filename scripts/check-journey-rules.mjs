#!/usr/bin/env node
// Static "house rules" checker for Playwright journeys (e2e/journeys/**/*.journey.ts,
// **/*.setup.ts) and their helpers (e2e/journeys/support/**/*.ts). Runs in CI, ahead of the
// journeys themselves, and fails the build when a journey hides flakiness (retries, clicking in
// a loop, clicking inside a .toPass() retry callback or an array-iteration callback) or asserts
// conditionally, when a @mutates test skips the post-reload check, or when a journey/describe
// block is skipped, only'd, fixme'd, or marked to fail instead of actually running. It also fails
// when a file other than support/secret.ts crosses the secret boundary (see
// SECRET_BOUNDARY_IDENTIFIERS below), and when anything is typed into a password field with
// fill()/type()/pressSequentially() instead of fillSecret.
//
// With --census <file> --routes <file> (as `pnpm run check:journeys` passes them), it also requires
// every page a *.journey.ts visits to have a journey in the HX census (rule census-missing-page);
// see checkCensusCoverage below for how "visits" is read from the source.
//
// Support helpers run inside journeys, so they get the same retry, click-in-loop, skipped,
// @mutates and secret-boundary rules; only the conditional-assertion rule is journey-only. `test` and `setup` are
// both recognised as the test function, as is any local alias of `test` imported from
// `@playwright/test` or from the journeys' own `support/journey` module
// (`import { test as t } from "./support/journey"`).
import { readFile as nodeReadFile, readdir as nodeReaddir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

export const JOURNEY_FILE_PATTERN = /\.(?:journey|setup)\.ts$/;

// Directory, relative to the scanned journeys directory, whose .ts files are journey helpers.
export const SUPPORT_DIRECTORY = "support";

// Modules whose `test` export is the Playwright test function: Playwright itself, and the
// journeys' own extended `test` in support/journey.ts, imported by relative path.
const TEST_MODULE_PATTERN = /^(?:@playwright\/test|\.{1,2}\/(?:.*\/)?journey(?:\.[cm]?[jt]s)?)$/;

// Names that always mean the test function: Playwright's own `test`, and `setup`, the
// conventional alias used by setup projects.
const DEFAULT_TEST_NAMES = ["test", "setup"];

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

// The secret boundary (e2e/journeys/support/secret.ts): passwords are Secret values, which
// fill(), type() and toHaveValue() don't accept, so the typecheck (tsconfig.e2e.json) stops a
// password reaching a step title or an assertion message. This rule is the backstop for the ways
// around that type: outside the Secret module, nothing may call its private reveal function, use
// a raw password source (the disposable-user factory and readers in e2e/support/disposable-auth,
// which the Secret module wraps), or JSON.parse the QA credentials file (parseCredentialsJson
// turns its passwords into Secrets).
const SECRET_MODULE_SUFFIX = "support/secret.ts";
const SECRET_BOUNDARY_IDENTIFIERS = new Set([
  "revealSecret",
  "createDisposableE2EUser",
  "readDisposableE2EUsers",
  "readLatestDisposableE2EUser",
]);
const CREDENTIALS_FILE_MARKERS = /SPOONJOY_QA_CREDENTIALS|credentials\.json/;

// The field-side backstop: a password created as a plain string (not a Secret) would still
// typecheck with fill(). Typing anything into a field whose own locator text names a password (a
// label, placeholder or role name, a type=password / name=password selector, or a variable named
// for one) must go through fillSecret. For page.fill(selector, value) / frame.type(...) the
// selector is the first argument. Only the field is judged, never the value.
const TYPING_METHODS = new Set(["fill", "type", "pressSequentially"]);
const PASSWORD_FIELD_PATTERN = /passw(?:or)?d/i;

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

/**
 * Classifies a file by its path relative to the scanned journeys directory: "journey" for
 * *.journey.ts / *.setup.ts files, "support" for other .ts files under support/, otherwise
 * undefined (not checked).
 * @param {string} relativePath
 * @returns {"journey" | "support" | undefined}
 */
export function journeyFileKind(relativePath) {
  const posixPath = relativePath.split(path.sep).join("/");
  if (JOURNEY_FILE_PATTERN.test(posixPath)) return "journey";
  if (posixPath.startsWith(`${SUPPORT_DIRECTORY}/`) && posixPath.endsWith(".ts")) return "support";
  return undefined;
}

// Every local name bound to the test function in this file: `test`, `setup`, and each alias of
// a `test` import from a TEST_MODULE_PATTERN module.
function collectTestNames(sourceFile) {
  const names = new Set(DEFAULT_TEST_NAMES);
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !TEST_MODULE_PATTERN.test(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if ((element.propertyName ?? element.name).text === "test") names.add(element.name.text);
    }
  }
  return names;
}

// True for a bare test-function identifier reference, i.e. the `test` in `test(...)` or the
// base of `test.only(...)` / `setup.skip(...)` / `t.describe.skip(...)`.
function isTestNamespaceIdentifier(node, testNames) {
  return ts.isIdentifier(node) && testNames.has(node.text);
}

function isClickLikeCall(node) {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    CLICK_LIKE_METHODS.has(node.expression.name.text)
  );
}

function isSecretModule(fileName) {
  return fileName.split(path.sep).join("/").endsWith(SECRET_MODULE_SUFFIX);
}

function isPasswordFieldTypingCall(node, sourceFile) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
  if (!TYPING_METHODS.has(node.expression.name.text)) return false;
  if (PASSWORD_FIELD_PATTERN.test(node.expression.expression.getText(sourceFile))) return true;
  const selector = node.arguments.length >= 2 ? node.arguments[0] : undefined;
  return Boolean(selector && PASSWORD_FIELD_PATTERN.test(selector.getText(sourceFile)));
}

function isJsonParseCall(node) {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "JSON" &&
    node.expression.name.text === "parse"
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
function isTestCall(node, testNames) {
  if (!ts.isCallExpression(node) || node.arguments.length < 1) return false;
  if (isTestNamespaceIdentifier(node.expression, testNames)) return true;
  return (
    ts.isPropertyAccessExpression(node.expression) &&
    isTestNamespaceIdentifier(node.expression.expression, testNames) &&
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
function isSkippedJourneyCall(node, testNames) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
  const { expression: object, name } = node.expression;
  if (!TEST_MODIFIERS.has(name.text)) return false;
  if (isTestNamespaceIdentifier(object, testNames)) return true;
  return (
    ts.isPropertyAccessExpression(object) &&
    object.name.text === "describe" &&
    isTestNamespaceIdentifier(object.expression, testNames)
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
 * Walks a journey/setup or support file's AST and returns every house-rule violation it
 * contains. Support files (kind "support") skip only the no-assertion-in-if rule.
 * @param {string} fileName
 * @param {string} source
 * @param {{ kind?: "journey" | "support" }} [options]
 * @returns {Array<{
 *   file: string,
 *   line: number,
 *   rule: "no-retry-config" | "no-click-in-loop" | "no-assertion-in-if" | "no-skipped-journeys" | "mutation-needs-reload-check" | "secret-boundary" | "no-password-field-fill" | "census-missing-page",
 *   message: string,
 * }>}
 */
export function checkJourneySource(fileName, source, { kind = "journey" } = {}) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const testNames = collectTestNames(sourceFile);
  const checkSecretBoundary = !isSecretModule(fileName);
  const readsCredentialsFile = CREDENTIALS_FILE_MARKERS.test(source);
  const checkConditionalAssertions = kind === "journey";
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

    if (isPasswordFieldTypingCall(node, sourceFile)) {
      report(
        node,
        "no-password-field-fill",
        `"${node.expression.name.text}" must not type into a password field; Playwright puts the typed value in the public report and job log. Type a Secret with fillSecret(locator, secret) from support/secret.ts.`,
      );
    }

    if (checkSecretBoundary && ts.isIdentifier(node) && SECRET_BOUNDARY_IDENTIFIERS.has(node.text)) {
      report(
        node,
        "secret-boundary",
        `"${node.text}" is a raw password source; only support/secret.ts may use it. Passwords are Secret values typed with fillSecret (support/secret.ts).`,
      );
    }

    if (checkSecretBoundary && readsCredentialsFile && isJsonParseCall(node)) {
      report(
        node,
        "secret-boundary",
        "Parse the QA credentials file with parseCredentialsJson (support/secret.ts), which turns its passwords into Secret values, not JSON.parse.",
      );
    }

    if (checkConditionalAssertions && isExpectCall(node) && isInsideIfOrConditionalBranch(node)) {
      report(node, "no-assertion-in-if", "Assertions must not be conditional; branch on setup, not on expect(...).");
    }

    if (isSkippedJourneyCall(node, testNames)) {
      report(
        node,
        "no-skipped-journeys",
        `"${node.expression.getText(sourceFile)}" must not appear in a journey; a skipped, only'd, fixme'd, or fail-marked journey hides a real failure instead of surfacing it.`,
      );
    }

    if (isTestCall(node, testNames)) {
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

// ---------------------------------------------------------------------------------------------
// Census coverage (rule census-missing-page). The HX census (e2e/journeys/support/hx-census.ts)
// must list every page the journeys visit. "Visits" is read statically and pragmatically:
//   - a visit is a `<anything>.goto(arg)` call in a *.journey.ts file (the census journey itself,
//     which visits the census, is skipped);
//   - `arg` is a string literal, a template literal, or an identifier naming a `const` declared once
//     in the same file with one of those as its value (resolved recursively, also inside template
//     interpolations); any other interpolation (`${id}`) is a wildcard that fills a whole path
//     segment, and an argument that does not start with a literal "/" (`${recipePath}/edit`, a
//     variable from the page) is not read at all;
//   - the query and hash are dropped, and the path is matched to the most specific route in
//     app/routes.ts the way React Router ranks them (static over :param over *), with a wildcard
//     segment matching only a :param or *;
//   - only routes whose module has a default export render a page; resource routes are skipped.
// The census's own `path:` properties are read the same way, and every visited page route must be
// one of the census's routes. Navigation by clicking is not read.

const WILDCARD = "\u0000";
export const CENSUS_JOURNEY_PATTERN = /(?:^|\/)hx-census\.journey\.ts$/;

function stringConstants(sourceFile) {
  const counts = new Map();
  const values = new Map();
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      counts.set(node.name.text, (counts.get(node.name.text) ?? 0) + 1);
      values.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return new Map([...values].filter(([name]) => counts.get(name) === 1));
}

// The node's static text with WILDCARD for each unknown interpolation, or undefined when the node
// is not a string at all.
function staticPathText(node, constants, depth = 0) {
  if (depth > 8) return undefined;
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
    return staticPathText(node.expression, constants, depth + 1);
  }
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isIdentifier(node)) {
    const value = constants.get(node.text);
    return value ? staticPathText(value, constants, depth + 1) : undefined;
  }
  if (ts.isTemplateExpression(node)) {
    return node.templateSpans.reduce((text, span) => {
      const inner = staticPathText(span.expression, constants, depth + 1);
      return text + (inner ?? WILDCARD) + span.literal.text;
    }, node.head.text);
  }
  return undefined;
}

/**
 * A path's segments, each with WILDCARD standing for unknown text, or undefined when the path does
 * not start with a literal "/".
 * @param {string | undefined} text
 * @returns {string[] | undefined}
 */
export function pathSegments(text) {
  if (text === undefined || !text.startsWith("/")) return undefined;
  const pathOnly = text.split(/[?#]/, 1)[0];
  return pathOnly.split("/").filter((segment) => segment !== "");
}

/**
 * The leaf routes of an app/routes.ts source: each route() or index() call's URL pattern and module
 * file, with layout routes (those with children) marked.
 * @param {string} source
 * @returns {Array<{ pattern: string, file: string, layout: boolean }>}
 */
export function parseRouteConfig(source) {
  const sourceFile = ts.createSourceFile("routes.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const routes = [];
  function readCalls(elements, prefix) {
    for (const element of elements) {
      if (!ts.isCallExpression(element) || !ts.isIdentifier(element.expression)) continue;
      const [first, second, third] = element.arguments;
      if (element.expression.text === "index" && first && ts.isStringLiteralLike(first)) {
        routes.push({ pattern: prefix, file: first.text, layout: false });
      } else if (element.expression.text === "route" && first && second && ts.isStringLiteralLike(first) && ts.isStringLiteralLike(second)) {
        const pattern = [prefix, first.text].filter(Boolean).join("/");
        const children = third && ts.isArrayLiteralExpression(third) ? third.elements : undefined;
        routes.push({ pattern, file: second.text, layout: Boolean(children) });
        if (children) readCalls(children, pattern);
      }
    }
  }
  function visit(node) {
    if (ts.isExportAssignment(node)) {
      let expression = node.expression;
      while (ts.isSatisfiesExpression(expression) || ts.isAsExpression(expression) || ts.isParenthesizedExpression(expression)) {
        expression = expression.expression;
      }
      if (ts.isArrayLiteralExpression(expression)) readCalls(expression.elements, "");
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return routes;
}

/**
 * The most specific non-layout route for a path's segments, ranked as React Router ranks them
 * (a static segment 10, a :param 3, a splat -2), or undefined.
 * @param {string[]} segments
 * @param {Array<{ pattern: string, file: string, layout: boolean }>} routes
 */
export function matchRoute(segments, routes) {
  let best;
  let bestScore = -Infinity;
  for (const route of routes) {
    if (route.layout) continue;
    const parts = route.pattern.split("/").filter((part) => part !== "");
    let score = 0;
    let matched = true;
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      if (part === "*") {
        score -= 2;
        break;
      }
      const segment = segments[index];
      if (segment === undefined) {
        matched = false;
        break;
      }
      if (part.startsWith(":")) score += 3;
      else if (!segment.includes(WILDCARD) && segment.toLowerCase() === part.toLowerCase()) score += 10;
      else {
        matched = false;
        break;
      }
    }
    const hasSplat = parts.at(-1) === "*";
    if (!hasSplat && segments.length !== parts.length) matched = false;
    if (matched && score > bestScore) {
      best = route;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Every visit (`.goto(...)`) whose path can be read: its line, its text and its segments.
 * @param {string} fileName
 * @param {string} source
 */
export function journeyVisits(fileName, source) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const constants = stringConstants(sourceFile);
  const visits = [];
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "goto" &&
      node.arguments.length > 0
    ) {
      const text = staticPathText(node.arguments[0], constants);
      const segments = pathSegments(text);
      if (segments) visits.push({ line: lineOf(sourceFile, node), text: text.replaceAll(WILDCARD, "${…}"), segments });
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return visits;
}

/**
 * The segments of every census journey's `path:` that can be read.
 * @param {string} source
 * @returns {string[][]}
 */
export function censusPaths(source) {
  const sourceFile = ts.createSourceFile("hx-census.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const constants = stringConstants(sourceFile);
  const paths = [];
  function visit(node) {
    if (ts.isPropertyAssignment(node) && propertyAssignmentName(node) === "path") {
      const segments = pathSegments(staticPathText(node.initializer, constants));
      if (segments) paths.push(segments);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return paths;
}

/**
 * census-missing-page violations: pages the journeys visit that the census does not list.
 * @param {{
 *   journeys: Array<{ file: string, source: string }>,
 *   censusFile: string,
 *   censusSource: string,
 *   routes: Array<{ pattern: string, file: string, layout: boolean }>,
 *   pageFiles: Set<string>,
 * }} options
 */
export function checkCensusCoverage({ journeys, censusFile, censusSource, routes, pageFiles }) {
  const censused = new Set(censusPaths(censusSource).map((segments) => matchRoute(segments, routes)).filter(Boolean));
  const violations = [];
  for (const { file, source } of journeys) {
    if (CENSUS_JOURNEY_PATTERN.test(file.split(path.sep).join("/"))) continue;
    for (const visit of journeyVisits(file, source)) {
      const route = matchRoute(visit.segments, routes);
      if (!route || !pageFiles.has(route.file) || censused.has(route)) continue;
      violations.push({
        file,
        line: visit.line,
        rule: "census-missing-page",
        message: `"${visit.text}" opens the page /${route.pattern} (${route.file}), which has no journey in the HX census (${censusFile}); add one.`,
      });
    }
  }
  return violations;
}

/**
 * @param {string[]} argv
 * @returns {{ directory?: string, census?: string, routes?: string }}
 */
export function parseRulesArgs(argv) {
  const options = {};
  const args = [...argv];
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--census" || arg === "--routes") {
      const value = args.shift();
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a file.`);
      options[arg.slice(2)] = value;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option ${arg}.`);
    } else if (options.directory === undefined) {
      options.directory = arg;
    } else {
      throw new Error(`Unexpected argument ${arg}.`);
    }
  }
  if ((options.census === undefined) !== (options.routes === undefined)) throw new Error("--census and --routes go together.");
  return options;
}

const DEFAULT_EXPORT_PATTERN = /^export default\b/m;

async function censusViolations({ census, routes: routesFile }, journeys, readFile) {
  const routes = parseRouteConfig(await readFile(routesFile));
  const pageFiles = new Set();
  for (const route of routes.filter((candidate) => !candidate.layout)) {
    if (DEFAULT_EXPORT_PATTERN.test(await readFile(path.join(path.dirname(routesFile), route.file)))) pageFiles.add(route.file);
  }
  return checkCensusCoverage({ journeys, censusFile: census, censusSource: await readFile(census), routes, pageFiles });
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

  let options;
  try {
    options = parseRulesArgs(argv);
  } catch (error) {
    io.error(`check-journey-rules: ${error.message}`);
    options = {};
  }
  const { directory } = options;
  if (!directory) {
    io.error("Usage: check-journey-rules.mjs <directory> [--census <census file> --routes <app/routes.ts>]");
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
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath ?? entry.path ?? directory, entry.name))
    .map((file) => ({ file, kind: journeyFileKind(path.relative(directory, file)) }))
    .filter(({ kind }) => kind !== undefined);

  const violations = [];
  const journeys = [];
  for (const { file, kind } of files) {
    const source = await readFile(file);
    violations.push(...checkJourneySource(file, source, { kind }));
    if (file.endsWith(".journey.ts")) journeys.push({ file, source });
  }

  if (options.census) {
    try {
      violations.push(...(await censusViolations(options, journeys, readFile)));
    } catch (error) {
      io.error(`check-journey-rules: cannot check the HX census: ${error instanceof Error ? error.message : String(error)}`);
      exit(1);
      return;
    }
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
