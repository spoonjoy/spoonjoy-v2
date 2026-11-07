// Where each page's Ouro HX components come from: for every page route in app/routes.ts, the app
// files it imports (followed through the TypeScript import graph, stopping at the installed HX
// under app/components/ouro and app/lib/ouro) and the HX items they render. X-ray's Source links,
// /ouro-provenance.json and /llms.txt read it. `--check` fails when the committed file is stale.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

export const OUTPUT_PATH = "app/generated/ouro-provenance.json";
/** How Spoonjoy builds with Ouro HX, for the people and agents who read the manifest. */
export const GUIDE_URL = "https://github.com/spoonjoy/spoonjoy-v2/blob/main/docs/building-with-ouro-hx.md";
export const ROUTES_PATH = "app/routes.ts";
export const ROOT_PATH = "app/root.tsx";
/** Where the installed HX names its own release: the theme's install command in its dev messages. */
export const TAG_SOURCE_PATH = "app/lib/ouro/dev.ts";
const OURO_COMPONENTS = "app/components/ouro/";
const OURO_LIB = "app/lib/ouro/";
const EXTENSIONS = [".tsx", ".ts", "/index.tsx", "/index.ts"];
// An import written with its file's extension (`./x.css`), as opposed to a module (`./x.server`).
const FILE_EXTENSION = /\.(?:tsx?|jsx?|mjs|json|css|svg|png|jpe?g|webp|gif|txt)$/;
// A component's own files that are parts of it, not items of their own.
const PART_SUFFIXES = ["-parts", "-styles", "-context"];
const USAGE = "Usage: generate-ouro-provenance.mjs [--check]";

export const defaultDeps = {
  readFile: (file) => readFileSync(file, "utf8"),
  exists: (file) => existsSync(file),
  writeFile: (file, contents) => writeFileSync(file, contents),
};

/** The installed HX release tag (`v1.1.0`), read from the installed source itself. */
export function readOuroTag(source) {
  const match = /ouro-base#(v\d+\.\d+\.\d+)/.exec(source);
  if (!match) throw new Error(`${TAG_SOURCE_PATH} names no Ouro HX release (ouro-base#vX.Y.Z)`);
  return match[1];
}

function stringArg(node, file) {
  if (!ts.isStringLiteralLike(node)) throw new Error(`${ROUTES_PATH}: write each route's path and file as a string, not ${node.getText(file)}`);
  return node.text;
}

/**
 * Every route in a React Router `routes.ts`: its full path and its module under `app/`, in file
 * order. Reads `route(path, file, children?)`, `index(file)`, `layout(file, children)` and
 * `...prefix(path, children)`.
 */
export function parseRoutes(source) {
  const file = ts.createSourceFile(ROUTES_PATH, source, ts.ScriptTarget.Latest, true);
  const routes = [];
  const join = (base, segment) => [base, segment].filter(Boolean).join("/");

  function visitList(list, base) {
    for (const element of list.elements) {
      const call = ts.isSpreadElement(element) ? element.expression : element;
      if (ts.isCallExpression(call)) visitCall(call, base);
    }
  }

  function visitCall(call, base) {
    const name = call.expression.getText(file);
    const [first, second, third] = call.arguments;
    const children = (node) => (node && ts.isArrayLiteralExpression(node) ? node : null);
    if (name === "route") {
      const routePath = join(base, stringArg(first, file));
      routes.push({ path: `/${routePath}`, file: `app/${stringArg(second, file)}` });
      const nested = children(third);
      if (nested) visitList(nested, routePath);
    } else if (name === "index") {
      routes.push({ path: `/${base}`, file: `app/${stringArg(first, file)}` });
    } else if (name === "layout") {
      routes.push({ path: `/${base}`, file: `app/${stringArg(first, file)}` });
      const nested = children(second);
      if (nested) visitList(nested, base);
    } else if (name === "prefix") {
      const nested = children(second);
      if (nested) visitList(nested, join(base, stringArg(first, file)));
    }
  }

  function find(node) {
    if (ts.isExportAssignment(node)) {
      let expression = node.expression;
      while (ts.isSatisfiesExpression(expression) || ts.isAsExpression(expression)) expression = expression.expression;
      if (ts.isArrayLiteralExpression(expression)) visitList(expression, "");
    }
    ts.forEachChild(node, find);
  }
  find(file);
  return routes;
}

/** Whether a route module renders a page: it has a default export. */
export function rendersPage(source) {
  return /^export default\b/m.test(source);
}

/** The HX item an installed file belongs to (`checklist/checklist-parts.tsx` is `checklist`), or null outside the components. */
export function itemForOuroFile(file) {
  if (!file.startsWith(OURO_COMPONENTS)) return null;
  let name = path.basename(file).replace(/\.tsx?$/, "");
  for (const suffix of PART_SUFFIXES) if (name.endsWith(suffix)) name = name.slice(0, -suffix.length);
  return name;
}

const isOuro = (file) => file.startsWith(OURO_COMPONENTS) || file.startsWith(OURO_LIB);

/** Resolves an import specifier from an app file to a repository path, or null for a package. Fails on an app import that resolves to nothing. */
export function resolveImport(specifier, from, exists) {
  let base;
  // React Router's generated route types: types only, and absent until `react-router typegen`.
  if (specifier.includes("/+types/")) return null;
  if (specifier.startsWith("~/")) base = `app/${specifier.slice(2)}`;
  else if (specifier.startsWith(".")) base = path.posix.join(path.posix.dirname(from), specifier);
  else return null;
  base = base.replace(/\?.*$/, "");
  const candidates = FILE_EXTENSION.test(base) ? [base] : EXTENSIONS.map((extension) => `${base}${extension}`);
  const found = candidates.find((candidate) => exists(candidate));
  if (found === undefined) throw new Error(`${from} imports ${specifier}, which does not exist`);
  return found;
}

/** The import specifiers of a module, type-only imports included (they cost nothing to list). */
function importsOf(file, source) {
  return ts.preProcessFile(source, true, false).importedFiles.map((reference) => reference.fileName);
}

/**
 * The app files an entry reaches through its imports (the entry first, then sorted) and, for each
 * HX item they render, the app files that import it. Stops at installed HX: an HX component's own
 * imports are HX's business.
 */
export function importGraph(entry, { readFile, exists }) {
  const sources = new Set();
  const renders = new Map();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift();
    if (sources.has(file)) continue;
    sources.add(file);
    for (const specifier of importsOf(file, readFile(file))) {
      const target = resolveImport(specifier, file, exists);
      if (target === null || !/\.tsx?$/.test(target)) continue;
      if (isOuro(target)) {
        const item = itemForOuroFile(target);
        if (item !== null) renders.set(item, new Set([...(renders.get(item) ?? []), file]));
        continue;
      }
      queue.push(target);
    }
  }
  const [first, ...rest] = [...sources];
  return {
    sources: [first, ...rest.sort()],
    renders: Object.fromEntries([...renders.keys()].sort().map((item) => [item, [...renders.get(item)].sort()])),
  };
}

/** The installed HX items: each component file under app/components/ouro that is an item of its own. */
export function installedItems(files) {
  const items = new Set();
  for (const file of files) {
    if (!file.startsWith(OURO_COMPONENTS) || !/\.tsx?$/.test(file) || /\.(test|stories|test-d)\.tsx?$/.test(file)) continue;
    items.add(itemForOuroFile(file));
  }
  return items;
}

function entryFor(file, deps, known) {
  const { sources, renders } = importGraph(file, deps);
  for (const item of Object.keys(renders)) {
    if (!known.has(item)) throw new Error(`${file} imports "${item}", which is not an installed Ouro HX item`);
  }
  return { file, sources, components: Object.keys(renders), renders };
}

/**
 * The provenance manifest: the HX release, the root layout around every page, and each page route
 * with the files it is built from and the HX items they render.
 */
export function buildProvenance({ readFile, exists, ouroFiles }) {
  const known = installedItems(ouroFiles);
  const routes = [];
  for (const route of parseRoutes(readFile(ROUTES_PATH))) {
    if (!exists(route.file)) throw new Error(`${ROUTES_PATH} names ${route.file}, which does not exist`);
    if (!rendersPage(readFile(route.file))) continue;
    routes.push({ path: route.path, ...entryFor(route.file, { readFile, exists }, known) });
  }
  return {
    guide: GUIDE_URL,
    ouroTag: readOuroTag(readFile(TAG_SOURCE_PATH)),
    root: entryFor(ROOT_PATH, { readFile, exists }, known),
    routes,
  };
}

export const serializeProvenance = (provenance) => `${JSON.stringify(provenance, null, 2)}\n`;

/** Every file under a directory, as repository paths. */
export function listFiles(directory, readdir) {
  return readdir(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.posix.join(path.relative(".", entry.parentPath ?? entry.path).split(path.sep).join("/"), entry.name))
    .sort();
}

export function main(argv, deps, io, readdir) {
  const check = argv.includes("--check");
  if (argv.some((arg) => arg !== "--check")) throw new Error(USAGE);
  const ouroFiles = listFiles(OURO_COMPONENTS, readdir);
  const next = serializeProvenance(buildProvenance({ ...deps, ouroFiles }));
  const current = deps.exists(OUTPUT_PATH) ? deps.readFile(OUTPUT_PATH) : null;
  if (check) {
    if (current !== next) throw new Error(`${OUTPUT_PATH} is stale. Run: pnpm provenance:generate`);
    io.log(`${OUTPUT_PATH} is current.`);
    return;
  }
  deps.writeFile(OUTPUT_PATH, next);
  io.log(`Wrote ${OUTPUT_PATH}.`);
}

export function isCliEntry(moduleUrl, argv1 = process.argv[1]) {
  return typeof argv1 === "string" && moduleUrl === pathToFileURL(argv1).href;
}

export async function runCliIfEntry({ moduleUrl = import.meta.url, argv1 = process.argv[1], runMain, io = console } = {}) {
  if (!isCliEntry(moduleUrl, argv1)) return false;
  const run = runMain ?? ((argv) => main(argv, defaultDeps, io, readdirSync));
  try {
    await run(process.argv.slice(2));
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
  return true;
}

await runCliIfEntry();
