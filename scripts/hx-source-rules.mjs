#!/usr/bin/env node
// The HX source rule. Anything reusable in Spoonjoy is an Ouro HX component, installed under
// app/components/ouro/**; this rule finds the controls app code still builds by hand, so their
// number can only fall.
//
// It reads app/**/*.{ts,tsx} with the TypeScript compiler API (skipping the HX installs in
// app/components/ouro/** and app/lib/ouro/**, generated code, tests, stories and declarations)
// and app/styles/*.css with PostCSS, and reports each offender by category:
//
// - raw-button, raw-anchor, raw-input, raw-select, raw-textarea, details-summary: the intrinsic
//   element, and React Router's Link/NavLink as raw anchors. `<input type="hidden">` is exempt,
//   and so is the anchor HX Link renders through OuroProvider's linkComponent (a function typed
//   with OuroLinkComponent).
// - contenteditable, positive-tabindex, interactive-role (any element, HX calls included).
// - plain-element-handler: click, key, pointer or touch handlers on a non-control intrinsic element.
// - data-ouro-attr: any data-ouro* attribute app code writes (JSX, props objects, setAttribute).
// - third-party-control: a JSX element from a UI-control library other than HX
//   (THIRD_PARTY_CONTROL_PACKAGES), by named, default or namespace import or a same-file alias of
//   one; app code reaches those libraries only through HX. Type-only imports and hooks are not
//   elements, so they never count.
// - control-state-style: class utilities for focus, press, selection, open/close or gesture state
//   (focus:, active:, aria-pressed:, data-[state=open]:, group-data-[checked]: ...) in a className,
//   followed through same-file constants and helpers; and stylesheet rules (or @apply) whose
//   selector puts that state on a .sj-* class or a [data-sj-*] hook. Hover-only decoration and
//   page motion are not control state.
//
// Each offender has a fingerprint, `file::component::category::tag::stable props` (props are
// type, name, aria-label and role), never a line number, so moving code keeps it and renaming a
// file changes it. test/scripts/hx-source-rules.baseline.json holds the fingerprint counts; the
// scan must equal it exactly. `pnpm hx:source-rules` checks; `--write-baseline` rewrites it, and
// refuses to add an offender unless `--allow-regression <reason>` says why.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import postcss from "postcss";
import ts from "typescript";

export const CATEGORIES = [
  "raw-button",
  "raw-anchor",
  "raw-input",
  "raw-select",
  "raw-textarea",
  "details-summary",
  "contenteditable",
  "positive-tabindex",
  "interactive-role",
  "plain-element-handler",
  "data-ouro-attr",
  "control-state-style",
  "third-party-control",
];

// UI-control libraries other than HX. A trailing `/*` is a whole npm scope; any other entry is the
// package and its subpaths. HX itself builds on Base UI, but only inside its installed paths,
// which this rule does not scan.
export const THIRD_PARTY_CONTROL_PACKAGES = [
  "@headlessui/react",
  "@radix-ui/*",
  "@base-ui-components/*",
  "@base-ui/*",
  "react-aria-components",
  "react-aria",
  "@ariakit/*",
  "@mui/*",
  "@chakra-ui/*",
  "vaul",
  "cmdk",
  "sonner",
];

export const BASELINE_PATH = "test/scripts/hx-source-rules.baseline.json";
const UPDATE_COMMAND = "pnpm hx:source-rules --write-baseline";
const USAGE = "Usage: hx-source-rules.mjs [--write-baseline [--allow-regression <reason>]]";

const SCANNED = [/^app\/.+\.tsx?$/, /^app\/styles\/[^/]+\.css$/];
const EXCLUDED = [
  /^app\/components\/ouro\//,
  /^app\/lib\/ouro\//,
  /^app\/lib\/generated\//,
  /(?:^|\/)__tests__\//,
  /\.(?:test|spec|stories)\.tsx?$/,
  /\.d\.ts$/,
];

const RAW_TAGS = {
  button: "raw-button",
  a: "raw-anchor",
  input: "raw-input",
  select: "raw-select",
  textarea: "raw-textarea",
  details: "details-summary",
  summary: "details-summary",
};
const ROUTER_MODULES = new Set(["react-router", "react-router-dom"]);
const ROUTER_ANCHORS = new Set(["Link", "NavLink"]);
const INTERACTIVE_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "grid",
  "gridcell",
  "link",
  "listbox",
  "menu",
  "menubar",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "radiogroup",
  "scrollbar",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "tablist",
  "textbox",
  "tree",
  "treegrid",
  "treeitem",
]);
const HANDLER = /^on(?:Click|DoubleClick|AuxClick|ContextMenu|Key(?:Down|Up|Press)|Pointer[A-Z]\w*|Touch[A-Z]\w*|Mouse(?:Down|Up))(?:Capture)?$/;
const CLASS_ATTRIBUTE = /^(?:class|className|\w+ClassName)$/;
const STABLE_PROPS = ["type", "name", "aria-label", "role"];
const LINK_ADAPTER_TYPE = "OuroLinkComponent";

// Control state as a selector: focus, press, checked/selected/expanded/current, open/close and
// gesture state, as a pseudo-class or an aria/data attribute. Shared by class utilities (each
// variant is turned into the selector it compiles to) and stylesheet rules.
const STATE_NAME =
  "(?:state|checked|unchecked|indeterminate|open|closed|selected|highlighted|pressed|expanded|current|active|popup-open|panel-open|starting-style|ending-style|swip[\\w-]*|dragging|focus[\\w-]*)";
const STATE_SELECTOR = new RegExp(
  `:(?:focus(?:-visible|-within)?|active|checked|indeterminate|open)(?![\\w-])|\\[(?:aria-(?:checked|pressed|expanded|selected|current)|data-${STATE_NAME}|open)(?![\\w-])`,
);
const SJ_HOOK = /\.sj-|\[data-sj-/;

export function isThirdPartyControlModule(specifier) {
  return THIRD_PARTY_CONTROL_PACKAGES.some((entry) =>
    entry.endsWith("/*")
      ? specifier.startsWith(entry.slice(0, -1))
      : specifier === entry || specifier.startsWith(`${entry}/`),
  );
}

export function isScannedFile(file) {
  return SCANNED.some((pattern) => pattern.test(file)) && !EXCLUDED.some((pattern) => pattern.test(file));
}

export function listSourceFiles(root, readdir = defaultDeps.readdir) {
  return readdir(path.join(root, "app"))
    .map((entry) => `app/${String(entry).split(path.sep).join("/")}`)
    .filter(isScannedFile)
    .sort();
}

function splitVariants(token) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const char of token) {
    if (char === "[" || char === "(") depth += 1;
    if (char === "]" || char === ")") depth -= 1;
    if (char === ":" && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

function variantSelector(variant) {
  const bare = variant.replace(/^(?:(?:group|peer|in|not|has)-)+/, "").replace(/\/[\w-]+$/, "");
  const attribute = bare.match(/^(aria|data)-(?:\[(.*)\]|(.+))$/);
  if (attribute) return `[${attribute[1]}-${attribute[2] ?? attribute[3]}]`;
  if (bare.startsWith("[")) return bare.slice(1, -1);
  return `:${bare}`;
}

/** Whether one class token applies a utility under a control-state variant. */
export function isControlStateClass(token) {
  const parts = splitVariants(token);
  const utility = parts.pop();
  return utility !== "" && parts.some((variant) => STATE_SELECTOR.test(variantSelector(variant)));
}

const hasControlStateClass = (strings) =>
  strings.some((text) => text.split(/\s+/).some(isControlStateClass));

function collectStrings(node, declarations = new Map(), seen = new Set()) {
  const strings = [];
  const walk = (current) => {
    if (ts.isStringLiteralLike(current) || ts.isTemplateLiteralToken(current)) strings.push(current.text);
    if (ts.isIdentifier(current) && declarations.has(current.text) && !seen.has(current.text)) {
      seen.add(current.text);
      walk(declarations.get(current.text));
    }
    ts.forEachChild(current, walk);
  };
  walk(node);
  return strings;
}

// The declaration a function is assigned to, through wrappers: `const Row = memo(forwardRef(() => ...))`.
function declarationOf(fn) {
  let node = fn.parent;
  while (ts.isCallExpression(node) || ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) {
    node = node.parent;
  }
  return ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node) ? node : undefined;
}

function nameOf(node) {
  if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isMethodDeclaration(node)) {
    return node.name?.getText();
  }
  if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
    return node.name?.getText() ?? declarationOf(node)?.name.getText();
  }
  return undefined;
}

function componentName(node) {
  const names = [];
  for (let current = node.parent; current; current = current.parent) {
    const name = nameOf(current);
    if (name) names.push(name);
  }
  return names.find((name) => /^[A-Z]/.test(name)) ?? names[0] ?? "(module)";
}

function isFunctionLike(node) {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node);
}

function insideLinkAdapter(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (!isFunctionLike(current)) continue;
    const typed = [...current.parameters.map((parameter) => parameter.type), declarationOf(current)?.type];
    if (typed.some((type) => type?.getText().includes(LINK_ADAPTER_TYPE))) return true;
  }
  return false;
}

function literalValue(initializer) {
  if (!initializer) return "true";
  const value = ts.isJsxExpression(initializer) ? initializer.expression : initializer;
  if (!value) return undefined;
  if (ts.isStringLiteralLike(value) || ts.isNumericLiteral(value)) return value.text;
  if (value.kind === ts.SyntaxKind.TrueKeyword) return "true";
  if (value.kind === ts.SyntaxKind.FalseKeyword) return "false";
  return undefined;
}

const valueText = (initializer) => literalValue(initializer) ?? initializer.getText().replace(/\s+/g, " ");

function numbersIn(initializer) {
  if (ts.isStringLiteral(initializer)) return [Number(initializer.text)];
  const numbers = [];
  const walk = (node) => {
    if (ts.isNumericLiteral(node)) {
      const negative = ts.isPrefixUnaryExpression(node.parent) && node.parent.operator === ts.SyntaxKind.MinusToken;
      numbers.push(negative ? -Number(node.text) : Number(node.text));
    }
    ts.forEachChild(node, walk);
  };
  walk(initializer);
  return numbers;
}

function scanScript(file, source) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const offenders = [];
  const add = (category, node, tag, props = "") => {
    offenders.push({
      category,
      fingerprint: [file, componentName(node), category, tag, props].join("::"),
      file,
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
    });
  };

  // React Router's anchors by local name (`Link as RouterLink`) and namespace (`Router.Link`).
  const routerAnchors = new Map();
  const routerNamespaces = new Set();
  // Third-party control imports: named or default bindings (local name -> package and imported
  // name), namespaces (local name -> package), and same-file aliases (`const Trigger = Menu.Button`).
  const thirdPartyBindings = new Map();
  const thirdPartyNamespaces = new Map();
  const aliases = new Map();
  const declarations = new Map();
  const index = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      isThirdPartyControlModule(node.moduleSpecifier.text) &&
      node.importClause &&
      !node.importClause.isTypeOnly
    ) {
      const module = node.moduleSpecifier.text;
      const { name, namedBindings } = node.importClause;
      if (name) thirdPartyBindings.set(name.text, { module, imported: "default" });
      if (namedBindings && ts.isNamespaceImport(namedBindings)) thirdPartyNamespaces.set(namedBindings.name.text, module);
      for (const element of namedBindings && ts.isNamedImports(namedBindings) ? namedBindings.elements : []) {
        if (!element.isTypeOnly) {
          thirdPartyBindings.set(element.name.text, { module, imported: (element.propertyName ?? element.name).text });
        }
      }
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isIdentifier(node.initializer) || ts.isPropertyAccessExpression(node.initializer))
    ) {
      aliases.set(node.name.text, node.initializer.getText().replace(/\s+/g, ""));
    }
    if (ts.isImportDeclaration(node) && ROUTER_MODULES.has(node.moduleSpecifier.text)) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) routerNamespaces.add(bindings.name.text);
      for (const element of bindings && ts.isNamedImports(bindings) ? bindings.elements : []) {
        const imported = (element.propertyName ?? element.name).text;
        if (ROUTER_ANCHORS.has(imported)) routerAnchors.set(element.name.text, imported);
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      declarations.set(node.name.text, node.initializer);
    }
    if (ts.isFunctionDeclaration(node) && node.name) declarations.set(node.name.text, node);
    ts.forEachChild(node, index);
  };
  index(sourceFile);

  const routerAnchorOf = (tagName) => {
    const [namespace, member] = tagName.split(".");
    if (member === undefined) return routerAnchors.get(namespace);
    return routerNamespaces.has(namespace) && ROUTER_ANCHORS.has(member) ? member : undefined;
  };

  const thirdPartyTagOf = (tagName, seen = new Set()) => {
    const [head, ...members] = tagName.split(".");
    const binding = thirdPartyBindings.get(head);
    if (binding) return `${binding.module}.${[binding.imported, ...members].join(".")}`;
    const namespace = thirdPartyNamespaces.get(head);
    if (namespace) return members.length > 0 ? `${namespace}.${members.join(".")}` : undefined;
    if (!aliases.has(head) || seen.has(head)) return undefined;
    seen.add(head);
    return thirdPartyTagOf([aliases.get(head), ...members].join("."), seen);
  };

  const checkElement = (element) => {
    const tag = element.tagName.getText();
    const intrinsic = /^[a-z][\w-]*$/.test(tag);
    const attributes = new Map();
    for (const attribute of element.attributes.properties) {
      if (ts.isJsxAttribute(attribute)) attributes.set(attribute.name.getText(), attribute.initializer);
    }
    const props = STABLE_PROPS.filter((name) => attributes.has(name))
      .map((name) => `${name}=${valueText(attributes.get(name))}`)
      .join(",");
    const rawCategory = intrinsic ? RAW_TAGS[tag] : undefined;

    if (tag === "input" && literalValue(attributes.get("type")) === "hidden") return;
    const routerAnchor = routerAnchorOf(tag);
    if ((tag === "a" || routerAnchor) && insideLinkAdapter(element)) return;

    if (rawCategory) add(rawCategory, element, tag, props);
    if (routerAnchor) add("raw-anchor", element, `react-router.${routerAnchor}`, props);
    const thirdPartyTag = thirdPartyTagOf(tag);
    if (thirdPartyTag) add("third-party-control", element, thirdPartyTag, props);
    if (intrinsic && !rawCategory && [...attributes.keys()].some((name) => HANDLER.test(name))) {
      add("plain-element-handler", element, tag, props);
    }
    for (const [name, initializer] of attributes) {
      if (/^contenteditable$/i.test(name) && literalValue(initializer) !== "false") {
        add("contenteditable", element, tag, props);
      }
      if (/^tabindex$/i.test(name) && initializer && numbersIn(initializer).some((value) => value > 0)) {
        add("positive-tabindex", element, tag, props);
      }
      if (
        name === "role" &&
        initializer &&
        collectStrings(initializer).some((text) => text.split(/\s+/).some((role) => INTERACTIVE_ROLES.has(role)))
      ) {
        add("interactive-role", element, tag, props);
      }
      if (name.startsWith("data-ouro")) add("data-ouro-attr", element, `${tag}[${name}]`, props);
    }
    const classStrings = [...attributes]
      .filter(([name, initializer]) => CLASS_ATTRIBUTE.test(name) && initializer)
      .flatMap(([, initializer]) => collectStrings(initializer, declarations));
    if (hasControlStateClass(classStrings)) add("control-state-style", element, tag, props);
  };

  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) checkElement(node);
    if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name) && node.name.text.startsWith("data-ouro")) {
      add("data-ouro-attr", node, "object");
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      /^(?:set|toggle)Attribute$/.test(node.expression.name.text) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      node.arguments[0].text.startsWith("data-ouro")
    ) {
      add("data-ouro-attr", node, "setAttribute");
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return offenders;
}

function scanStylesheet(file, source) {
  const offenders = [];
  const add = (node, scope, context) => {
    offenders.push({
      category: "control-state-style",
      fingerprint: [file, "(stylesheet)", "control-state-style", scope, context.join(" ")].join("::"),
      file,
      line: node.source.start.line,
    });
  };
  const ancestors = (node) => {
    const rules = [];
    const atRules = [];
    for (let current = node.parent; current.type !== "root"; current = current.parent) {
      if (current.type === "rule") rules.unshift(current.selector.replace(/\s+/g, " "));
      if (current.type === "atrule") atRules.unshift(`@${current.name} ${current.params}`);
    }
    return { rules, atRules };
  };

  const root = postcss.parse(source, { from: file });
  root.walk((node) => {
    const { rules, atRules } = ancestors(node);
    if (node.type === "rule") {
      for (const selector of node.selectors) {
        const scope = [...rules, selector.replace(/\s+/g, " ")].join(" ");
        if (SJ_HOOK.test(scope) && STATE_SELECTOR.test(selector)) add(node, scope, atRules);
      }
    }
    if (node.type === "atrule" && node.name === "apply") {
      const scope = rules.join(" ");
      if (SJ_HOOK.test(scope) && hasControlStateClass([node.params])) add(node, scope, [...atRules, "@apply"]);
    }
  });
  return offenders;
}

/** The offenders in one file's source, in source order. `file` is relative to the repository. */
export function findOffendersInSource(file, source) {
  return file.endsWith(".css") ? scanStylesheet(file, source) : scanScript(file, source);
}

/** The offenders in these files (relative to `root`, or absolute), sorted by file, line and fingerprint. */
export function findOffenders(files, { root = process.cwd(), readFile = defaultDeps.readFile } = {}) {
  return files
    .map((file) => (path.isAbsolute(file) ? path.relative(root, file) : file).split(path.sep).join("/"))
    .flatMap((file) => findOffendersInSource(file, readFile(path.join(root, file))))
    .sort(
      (a, b) =>
        a.file.localeCompare(b.file) || a.line - b.line || a.fingerprint.localeCompare(b.fingerprint),
    );
}

export function countFingerprints(offenders) {
  const counts = {};
  for (const { fingerprint } of [...offenders].sort((a, b) => (a.fingerprint < b.fingerprint ? -1 : 1))) {
    counts[fingerprint] = (counts[fingerprint] ?? 0) + 1;
  }
  return counts;
}

export function serializeBaseline(offenders) {
  return `${JSON.stringify({ offenders: countFingerprints(offenders) }, null, 2)}\n`;
}

/** The fingerprints the scan has more of (added) or fewer of (removed) than the baseline counts. */
export function compareWithBaseline(offenders, baseline) {
  const actual = countFingerprints(offenders);
  const fingerprints = [...new Set([...Object.keys(actual), ...Object.keys(baseline)])].sort();
  const added = [];
  const removed = [];
  for (const fingerprint of fingerprints) {
    const difference = (actual[fingerprint] ?? 0) - (baseline[fingerprint] ?? 0);
    if (difference > 0) {
      const at = offenders
        .filter((offender) => offender.fingerprint === fingerprint)
        .map((offender) => `${offender.file}:${offender.line}`);
      added.push({ fingerprint, count: difference, at });
    }
    if (difference < 0) removed.push({ fingerprint, count: -difference });
  }
  return { added, removed };
}

export function formatComparison({ added, removed }) {
  return [
    ...added.map(
      ({ fingerprint, count, at }) =>
        `New hand-rolled control: ${fingerprint} (+${count}) at ${at.join(", ")}. Use an Ouro HX component instead (grow HX if it lacks one).`,
    ),
    ...removed.map(
      ({ fingerprint, count }) => `Fixed: ${fingerprint} (-${count}); remove it from the baseline: ${UPDATE_COMMAND}`,
    ),
  ];
}

export const defaultDeps = {
  readFile: (file) => readFileSync(file, "utf8"),
  readdir: (directory) => readdirSync(directory, { recursive: true }),
  writeFile: (file, text) => writeFileSync(file, text),
};

export function defaultExit(code) {
  process.exitCode = code;
}

function parseArgs(argv) {
  const options = { write: false, reason: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const next = argv[index + 1];
    if (argv[index] === "--write-baseline") {
      options.write = true;
    } else if (argv[index] === "--allow-regression" && next && !next.startsWith("--")) {
      options.reason = next;
      index += 1;
    } else {
      return undefined;
    }
  }
  return options;
}

function readBaseline(file, readFile) {
  try {
    return JSON.parse(readFile(file)).offenders;
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

export function main(argv, deps) {
  const { root, io, exit, readFile, readdir, writeFile } = {
    root: process.cwd(),
    io: console,
    exit: defaultExit,
    ...defaultDeps,
    ...deps,
  };
  const options = parseArgs(argv);
  if (!options) {
    io.error(USAGE);
    exit(1);
    return;
  }

  const files = listSourceFiles(root, readdir);
  const offenders = findOffenders(files, { root, readFile });
  const baselineFile = path.join(root, BASELINE_PATH);
  const comparison = compareWithBaseline(offenders, readBaseline(baselineFile, readFile));

  if (options.write) {
    if (comparison.added.length > 0 && !options.reason) {
      for (const line of formatComparison({ added: comparison.added, removed: [] })) io.error(line);
      io.error(
        "hx-source-rules: the baseline only shrinks. Replace the new controls with Ouro HX components, or pass --allow-regression <reason> for review.",
      );
      exit(1);
      return;
    }
    writeFile(baselineFile, serializeBaseline(offenders));
    const allowed = options.reason ? `; regression allowed: ${options.reason}` : "";
    io.log(`hx-source-rules: wrote ${BASELINE_PATH} with ${offenders.length} hand-rolled control(s)${allowed}.`);
    return;
  }

  const lines = formatComparison(comparison);
  for (const line of lines) io.error(line);
  if (lines.length > 0) {
    exit(1);
    return;
  }
  io.log(`hx-source-rules: ${files.length} file(s), ${offenders.length} hand-rolled control(s), all in the baseline.`);
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
  try {
    runMain(process.argv.slice(2));
  } catch (error) {
    onError(error);
  }
  return true;
}

runCliIfEntry();
