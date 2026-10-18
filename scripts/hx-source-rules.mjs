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
// - uses-hand-rolled-control: a JSX use of an imported app component that is offending, counted at
//   the call site. A component is offending when an offender sits inside it, or it renders an
//   offending component (same file or imported), to a fixed point across modules: a wrapper
//   (`NiceLink` around a raw `<a>`) and every wrapper of it count where they are used. Imports
//   resolve through tsconfig paths, barrels, re-exports and namespace re-exports (`export * as`);
//   a re-exported third-party control counts as third-party-control where it is used.
//
// An element is what it renders: Motion's `<m.button>` and `motion.create("button")`,
// `createElement("button")`, a string-typed tag (`const Tag = "button"`) and an `as="button"` prop
// are buttons. Tags are resolved in every
// category (`@headlessui/react.Button`, `app/components/navigation/app-link#Link`).
//
// Each offender has a fingerprint, `file::component::category::tag::stable props` (props are
// type, name, aria-label and role), never a line number, so moving code keeps it and renaming a
// file changes it. test/scripts/hx-source-rules.baseline.json holds the fingerprint counts; the
// scan must equal it exactly. `pnpm hx:source-rules` checks; with `--base <ref>` it also ratchets:
// no fingerprint may rise against that ref's baseline unless the new baseline lists it under
// `allowedRegressions` with a reason and the count it permits, and that entry is not already on
// the base (an entry is spent by the pull request that adds it; a copy left on the base fails as
// stale). A move is neutral: an added and a removed fingerprint with the same category, tag and
// literal props, in the same file (a renamed component) or the same component (a moved file),
// paired one-to-one. `--write-baseline` rewrites the file, refusing a rise unless
// `--allow-regression <reason>` records why; when the base has no baseline it records nothing.
//
// Known gaps: members of an imported app component (`<Menu.Item>` from an app module) are not
// counted at call sites, and Motion through a namespace import of motion/react
// (`<Motion.motion.div>`) is not treated as the element it renders.
import { spawnSync } from "node:child_process";
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
  "uses-hand-rolled-control",
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
const USAGE = "Usage: hx-source-rules.mjs [--base <ref>] [--write-baseline [--allow-regression <reason>]]";

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
// Motion renders intrinsic elements: `<m.button>` is a button. Its gesture props are handlers.
const MOTION_MODULES = new Set(["motion/react", "motion/react-m", "framer-motion"]);
const MOTION_ELEMENT_NAMESPACE = "motion/react-m";
const MOTION_COMPONENTS = new Set(["motion", "m"]);
const REORDER_TAGS = { Item: "li", Group: "ul" };
const MOTION_HANDLER = /^(?:onTap\w*|onPan\w*|drag\w*|whileTap|whileFocus)$/;
const INTRINSIC_TAG = /^[a-z][\w-]*$/;
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

const valueText = (initializer) =>
  (literalValue(initializer) ?? (ts.isJsxExpression(initializer) ? initializer.getText() : `{${initializer.getText()}}`)).replace(
    /\s+/g,
    " ",
  );

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

// The module index: what a file imports and exports, and the local names its tags resolve through.
function indexScript(file, source) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imports = new Map();
  const exports = new Map();
  const stars = [];
  const aliases = new Map();
  const declarations = new Map();
  const bindingDefaults = new Map();
  const hasModifier = (node, kind) => (node.modifiers ?? []).some((modifier) => modifier.kind === kind);

  const index = (node) => {
    if (ts.isImportDeclaration(node) && node.importClause && !node.importClause.isTypeOnly) {
      const specifier = node.moduleSpecifier.text;
      const { name, namedBindings } = node.importClause;
      if (name) imports.set(name.text, { specifier, imported: "default" });
      if (namedBindings && ts.isNamespaceImport(namedBindings)) {
        imports.set(namedBindings.name.text, { specifier, namespace: true });
      }
      for (const element of namedBindings && ts.isNamedImports(namedBindings) ? namedBindings.elements : []) {
        if (!element.isTypeOnly) imports.set(element.name.text, { specifier, imported: (element.propertyName ?? element.name).text });
      }
    }
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
      const local = node.name?.text ?? "default";
      exports.set(hasModifier(node, ts.SyntaxKind.DefaultKeyword) ? "default" : local, { local });
    }
    if (ts.isVariableStatement(node) && hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) exports.set(declaration.name.text, { local: declaration.name.text });
      }
    }
    if (ts.isExportAssignment(node)) {
      exports.set("default", { local: ts.isIdentifier(node.expression) ? node.expression.text : "default" });
    }
    if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
      const specifier = node.moduleSpecifier?.text;
      if (!node.exportClause) stars.push(specifier);
      if (node.exportClause && ts.isNamespaceExport(node.exportClause)) {
        exports.set(node.exportClause.name.text, { specifier, namespace: true });
      }
      for (const element of node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements : []) {
        const local = (element.propertyName ?? element.name).text;
        if (!element.isTypeOnly) exports.set(element.name.text, specifier ? { specifier, imported: local } : { local });
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      declarations.set(node.name.text, node.initializer);
      if (ts.isIdentifier(node.initializer) || ts.isPropertyAccessExpression(node.initializer)) {
        aliases.set(node.name.text, node.initializer.getText().replace(/\s+/g, ""));
      }
    }
    if (ts.isBindingElement(node) && ts.isIdentifier(node.name) && node.initializer) {
      bindingDefaults.set(node.name.text, node.initializer);
    }
    if (ts.isFunctionDeclaration(node) && node.name) declarations.set(node.name.text, node);
    ts.forEachChild(node, index);
  };
  index(sourceFile);

  // `const Trigger = Menu.Trigger; const Again = Trigger` -> "Menu.Trigger".
  const resolveAlias = (text) => {
    const seen = new Set();
    let current = text;
    for (;;) {
      const [head, ...rest] = current.split(".");
      if (!aliases.has(head) || seen.has(head)) return current;
      seen.add(head);
      current = [aliases.get(head), ...rest].join(".");
    }
  };
  const thirdPartyTagOf = (head, members) => {
    const binding = imports.get(head);
    if (!binding || !isThirdPartyControlModule(binding.specifier)) return undefined;
    if (binding.namespace) return members.length > 0 ? `${binding.specifier}.${members.join(".")}` : undefined;
    return `${binding.specifier}.${[binding.imported, ...members].join(".")}`;
  };
  const localThirdParty = (name) => {
    const [head, ...members] = resolveAlias(name).split(".");
    return thirdPartyTagOf(head, members);
  };

  return { file, sourceFile, imports, exports, stars, declarations, bindingDefaults, resolveAlias, thirdPartyTagOf, localThirdParty };
}

// Resolves an imported name to where it is defined: an app module's local, a third-party control
// (through re-exports and `export *`), or a namespace. Paths come from tsconfig (`~/*`).
function createResolver(modules, paths) {
  const moduleBase = (from, specifier) => {
    if (specifier.startsWith(".")) return path.posix.join(path.posix.dirname(from), specifier);
    for (const [pattern, [target]] of Object.entries(paths)) {
      const prefix = pattern.replace(/\*$/, "");
      const wildcard = prefix !== pattern;
      if (wildcard ? specifier.startsWith(prefix) : specifier === pattern) {
        return path.posix.normalize(target.replace("*", specifier.slice(prefix.length)));
      }
    }
    return undefined;
  };
  const resolveModule = (from, specifier) => {
    const base = moduleBase(from, specifier);
    return base && [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`].find((file) => modules.has(file));
  };
  const namespaceOf = (from, specifier) =>
    isThirdPartyControlModule(specifier) ? { thirdPartyNamespace: specifier } : { namespace: resolveModule(from, specifier) };
  const fromSpecifier = (from, specifier, name, seen) => {
    if (isThirdPartyControlModule(specifier)) return { thirdParty: `${specifier}.${name}` };
    const target = resolveModule(from, specifier);
    return target ? resolveExport(target, name, seen) : undefined;
  };
  const resolveLocal = (file, local, seen) => {
    const module = modules.get(file);
    const thirdParty = module.localThirdParty(local);
    if (thirdParty) return { thirdParty };
    const binding = module.imports.get(local);
    if (binding?.namespace) return namespaceOf(file, binding.specifier);
    if (binding) return fromSpecifier(file, binding.specifier, binding.imported, seen);
    return { file, local };
  };
  const resolveExport = (file, name, seen) => {
    const key = `${file}#${name}`;
    if (seen.has(key)) return undefined;
    seen.add(key);
    const module = modules.get(file);
    const entry = module.exports.get(name);
    if (entry?.namespace) return namespaceOf(file, entry.specifier);
    if (entry?.specifier) return fromSpecifier(file, entry.specifier, entry.imported, seen);
    if (entry) return resolveLocal(file, entry.local, seen);
    for (const specifier of module.stars) {
      const target = resolveModule(file, specifier);
      const found = target && resolveExport(target, name, seen);
      if (found) return found;
    }
    const thirdParty = module.stars.find(isThirdPartyControlModule);
    return thirdParty ? { thirdParty: `${thirdParty}.${name}` } : undefined;
  };

  // An imported tag: `{ thirdParty }`, `{ definition: { file, local }, rest, display }`, or just a
  // display name built from the import when its module is not scanned (HX, packages). Namespaces,
  // imported or re-exported (`export * as Dialog from "@radix-ui/react-dialog"`), resolve by member.
  const resolveImport = (file, head, members) => {
    const binding = modules.get(file).imports.get(head);
    let definition = binding.namespace
      ? namespaceOf(file, binding.specifier)
      : fromSpecifier(file, binding.specifier, binding.imported, new Set());
    let rest = members;
    while (definition?.namespace && rest.length > 0) {
      definition = resolveExport(definition.namespace, rest[0], new Set());
      rest = rest.slice(1);
    }
    if (definition?.thirdPartyNamespace && rest.length > 0) {
      return { thirdParty: [definition.thirdPartyNamespace, ...rest].join(".") };
    }
    if (definition?.thirdParty) return { thirdParty: [definition.thirdParty, ...rest].join(".") };
    if (definition?.file) {
      return { definition, rest, display: [`${definition.file.replace(/\.tsx?$/, "")}#${definition.local}`, ...rest].join(".") };
    }
    const [name, ...tail] = binding.namespace ? members : [binding.imported, ...members];
    if (name === undefined) return undefined;
    const base = moduleBase(file, binding.specifier);
    return { display: [base ? `${base}#${name}` : `${binding.specifier}.${name}`, ...tail].join(".") };
  };
  const displayOf = (file, head, members) => {
    if (!modules.get(file).imports.has(head)) return undefined;
    const resolved = resolveImport(file, head, members);
    return resolved?.thirdParty ?? resolved?.display;
  };
  return { resolveImport, displayOf };
}

function stringCandidates(node) {
  if (!node) return [];
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isJsxExpression(node)
  ) {
    return stringCandidates(node.expression);
  }
  if (ts.isConditionalExpression(node)) return [...stringCandidates(node.whenTrue), ...stringCandidates(node.whenFalse)];
  if (
    ts.isBinaryExpression(node) &&
    [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)
  ) {
    return [...stringCandidates(node.left), ...stringCandidates(node.right)];
  }
  return [];
}

const intrinsicCandidates = (node) => [...new Set(stringCandidates(node).filter((text) => INTRINSIC_TAG.test(text)))];

function isCreateElement(callee) {
  return (
    (ts.isIdentifier(callee) && callee.text === "createElement") ||
    (ts.isPropertyAccessExpression(callee) && callee.name.text === "createElement")
  );
}

// createElement's props are checked with its element, so their data-ouro* keys count once.
function isCreateElementProps(object) {
  return ts.isCallExpression(object.parent) && isCreateElement(object.parent.expression) && object.parent.arguments[1] === object;
}

function objectAttributes(node) {
  const attributes = new Map();
  for (const property of node && ts.isObjectLiteralExpression(node) ? node.properties : []) {
    if (ts.isPropertyAssignment(property) && !ts.isComputedPropertyName(property.name)) {
      attributes.set(property.name.text, property.initializer);
    }
    if (ts.isShorthandPropertyAssignment(property)) attributes.set(property.name.text, property.name);
  }
  return attributes;
}

// Every name a node sits inside: its functions and classes, and `default` for an anonymous
// default export. A component "contains" an offender anywhere inside it.
function ownersOf(node) {
  const owners = [];
  for (let current = node.parent; current; current = current.parent) {
    const anonymousDefault =
      (ts.isArrowFunction(current) && ts.isExportAssignment(current.parent)) ||
      (ts.isFunctionDeclaration(current) && !current.name);
    const name = nameOf(current) ?? (anonymousDefault ? "default" : undefined);
    if (name) owners.push(name);
  }
  return owners;
}

function scanScript(module, resolver) {
  const { file, sourceFile, imports, declarations, bindingDefaults } = module;
  const offenders = [];
  const ownerHits = new Set();
  const renders = [];
  const uses = [];
  const lineOf = (node) => sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  const add = (category, node, tag, props = "") => {
    offenders.push({ category, fingerprint: [file, componentName(node), category, tag, props].join("::"), file, line: lineOf(node) });
    for (const owner of ownersOf(node)) ownerHits.add(owner);
  };
  const stableProps = (attributes) =>
    STABLE_PROPS.filter((name) => attributes.has(name))
      .map((name) => `${name}=${valueText(attributes.get(name))}`)
      .join(",");

  const description = (fields) => ({
    tags: [],
    asTags: [],
    motion: false,
    gesture: false,
    thirdParty: false,
    router: false,
    ref: undefined,
    ...fields,
  });
  const routerAnchorOf = (head, members) => {
    const binding = imports.get(head);
    if (!binding || !ROUTER_MODULES.has(binding.specifier)) return undefined;
    const [name, ...rest] = binding.namespace ? members : [binding.imported, ...members];
    return rest.length === 0 && ROUTER_ANCHORS.has(name) ? name : undefined;
  };
  const motionKindOf = (head) => {
    const binding = imports.get(head);
    if (!binding || !MOTION_MODULES.has(binding.specifier)) return undefined;
    if (binding.namespace) return binding.specifier === MOTION_ELEMENT_NAMESPACE ? "element" : undefined;
    if (MOTION_COMPONENTS.has(binding.imported)) return "element";
    return binding.imported === "Reorder" ? "reorder" : undefined;
  };

  // `const X = motion.create("button")` (or the older `motion("button")`) renders a button.
  const motionCreatedTags = (node) => {
    if (!node || !ts.isCallExpression(node)) return [];
    const callee = node.expression;
    const name = ts.isIdentifier(callee)
      ? callee.text
      : ts.isPropertyAccessExpression(callee) && callee.name.text === "create" && ts.isIdentifier(callee.expression)
        ? callee.expression.text
        : undefined;
    return name !== undefined && motionKindOf(name) === "element" ? intrinsicCandidates(node.arguments[0]) : [];
  };

  // What a tag renders: intrinsic elements (literal, motion's, or a string-typed variable), a
  // React Router anchor, a third-party control, or a component reference.
  const describe = (tagText, asInitializer, literalIntrinsic) => {
    if (literalIntrinsic && INTRINSIC_TAG.test(tagText)) return description({ tags: [tagText], display: tagText });
    const resolved = module.resolveAlias(tagText);
    const [head, ...members] = resolved.split(".");
    const asTags = intrinsicCandidates(asInitializer);
    const thirdParty = module.thirdPartyTagOf(head, members);
    if (thirdParty) return description({ thirdParty: true, display: thirdParty, asTags });
    const router = routerAnchorOf(head, members);
    if (router) return description({ router: true, display: `react-router.${router}`, asTags });
    const motionKind = members.length === 1 ? motionKindOf(head) : undefined;
    if (motionKind === "element" && INTRINSIC_TAG.test(members[0])) {
      return description({ tags: [members[0]], motion: true, display: members[0] });
    }
    if (motionKind === "reorder" && REORDER_TAGS[members[0]]) {
      const tags = asTags.length > 0 ? asTags : [REORDER_TAGS[members[0]]];
      return description({ tags, motion: true, gesture: members[0] === "Item", display: tags.join("|") });
    }
    const dynamic = members.length === 0 ? intrinsicCandidates(declarations.get(head) ?? bindingDefaults.get(head)) : [];
    if (dynamic.length > 0) return description({ tags: dynamic, display: dynamic.join("|") });
    const created = members.length === 0 ? motionCreatedTags(declarations.get(head)) : [];
    if (created.length > 0) return description({ tags: created, motion: true, display: created.join("|") });
    return description({ ref: { head, members }, display: resolver.displayOf(file, head, members) ?? resolved, asTags });
  };

  const checkControl = (node, control, attributes) => {
    const props = stableProps(attributes);
    if (control.ref && imports.has(control.ref.head)) {
      uses.push({ ...control.ref, component: componentName(node), owners: ownersOf(node), line: lineOf(node), props });
    } else if (control.ref) {
      renders.push({ owners: ownersOf(node), head: control.ref.head });
    }
    if (control.tags.length === 1 && control.tags[0] === "input" && literalValue(attributes.get("type")) === "hidden") return;
    if ((control.tags.includes("a") || control.router) && insideLinkAdapter(node)) return;

    for (const tag of [...control.tags, ...control.asTags]) {
      if (RAW_TAGS[tag]) add(RAW_TAGS[tag], node, tag, props);
    }
    if (control.router) add("raw-anchor", node, control.display, props);
    if (control.thirdParty) add("third-party-control", node, control.display, props);
    const plain = control.tags.filter((tag) => !RAW_TAGS[tag]);
    const handles = [...attributes.keys()].some(
      (name) => HANDLER.test(name) || (control.motion && MOTION_HANDLER.test(name)),
    );
    if (plain.length > 0 && (control.gesture || handles)) add("plain-element-handler", node, plain.join("|"), props);
    for (const [name, initializer] of attributes) {
      if (/^contenteditable$/i.test(name) && literalValue(initializer) !== "false") {
        add("contenteditable", node, control.display, props);
      }
      if (/^tabindex$/i.test(name) && initializer && numbersIn(initializer).some((value) => value > 0)) {
        add("positive-tabindex", node, control.display, props);
      }
      if (
        name === "role" &&
        initializer &&
        collectStrings(initializer).some((text) => text.split(/\s+/).some((role) => INTERACTIVE_ROLES.has(role)))
      ) {
        add("interactive-role", node, control.display, props);
      }
      if (name.startsWith("data-ouro")) add("data-ouro-attr", node, `${control.display}[${name}]`, props);
    }
    const classStrings = [...attributes]
      .filter(([name, initializer]) => CLASS_ATTRIBUTE.test(name) && initializer)
      .flatMap(([, initializer]) => collectStrings(initializer, declarations));
    if (hasControlStateClass(classStrings)) add("control-state-style", node, control.display, props);
  };

  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attributes = new Map();
      for (const attribute of node.attributes.properties) {
        if (ts.isJsxAttribute(attribute)) attributes.set(attribute.name.getText(), attribute.initializer);
      }
      checkControl(node, describe(node.tagName.getText(), attributes.get("as"), true), attributes);
    }
    if (ts.isCallExpression(node) && isCreateElement(node.expression) && node.arguments.length > 0) {
      const [first, props] = node.arguments;
      const tags = intrinsicCandidates(first);
      const control =
        ts.isIdentifier(first) || ts.isPropertyAccessExpression(first)
          ? describe(first.getText(), undefined, false)
          : description({ tags, display: tags.join("|") || first.getText() });
      checkControl(node, control, objectAttributes(props));
    }
    if (
      ts.isPropertyAssignment(node) &&
      ts.isStringLiteral(node.name) &&
      node.name.text.startsWith("data-ouro") &&
      !isCreateElementProps(node.parent)
    ) {
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
  return { module, offenders, ownerHits, renders, uses };
}

// Pass two: which components contain an offender (directly or through a same-file component they
// render), then every imported use of one, and of a re-exported third-party control, at its call site.
function analyzeScripts(entries, paths) {
  const modules = new Map(entries.map(({ file, source }) => [file, indexScript(file, source)]));
  const resolver = createResolver(modules, paths);
  const scans = [...modules.values()].map((module) => scanScript(module, resolver));
  for (const scan of scans) scan.module.offending = new Set(scan.ownerHits);
  const calls = scans.flatMap(({ module, uses }) =>
    uses.map((use) => ({ module, use, resolved: resolver.resolveImport(module.file, use.head, use.members) })),
  );
  const categoryOf = ({ resolved }) => {
    if (resolved?.thirdParty) return "third-party-control";
    const definition = resolved?.definition;
    const offending = definition && resolved.rest.length === 0 && modules.get(definition.file).offending.has(definition.local);
    return offending ? "uses-hand-rolled-control" : undefined;
  };
  const mark = (offending, owners) => {
    const fresh = owners.filter((owner) => !offending.has(owner));
    for (const owner of fresh) offending.add(owner);
    return fresh.length > 0;
  };
  // To a fixed point across modules: a component that renders an offending component (from its own
  // file or an import) is offending too, so its callers count. Sets only grow, so cycles end.
  for (let grew = true; grew; ) {
    grew = false;
    for (const { module, renders } of scans) {
      for (const { owners, head } of renders) {
        if (module.offending.has(head)) grew = mark(module.offending, owners) || grew;
      }
    }
    for (const call of calls) {
      if (categoryOf(call)) grew = mark(call.module.offending, call.use.owners) || grew;
    }
  }
  const callSites = calls.flatMap((call) => {
    const category = categoryOf(call);
    if (!category) return [];
    const { module, use, resolved } = call;
    const tag = resolved.thirdParty ?? resolved.display;
    return [{ category, fingerprint: [module.file, use.component, category, tag, use.props].join("::"), file: module.file, line: use.line }];
  });
  return [...scans.flatMap(({ offenders }) => offenders), ...callSites];
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

/** tsconfig's `compilerOptions.paths` (`{ "~/*": ["./app/*"] }`), or none. */
export function loadPaths(root, readFile = defaultDeps.readFile) {
  let text;
  try {
    text = readFile(path.join(root, "tsconfig.json"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
  return ts.parseConfigFileTextToJson("tsconfig.json", text).config?.compilerOptions?.paths ?? {};
}

/**
 * The offenders in one file's source, in source order. `file` is relative to the repository. Its
 * imports are not resolved to other files, so call sites into other modules are not counted.
 */
export function findOffendersInSource(file, source, { paths = {} } = {}) {
  return file.endsWith(".css") ? scanStylesheet(file, source) : analyzeScripts([{ file, source }], paths);
}

/** The offenders in these files (relative to `root`, or absolute), sorted by file, line and fingerprint. */
export function findOffenders(
  files,
  { root = process.cwd(), readFile = defaultDeps.readFile, paths = loadPaths(root, readFile) } = {},
) {
  const entries = files
    .map((file) => (path.isAbsolute(file) ? path.relative(root, file) : file).split(path.sep).join("/"))
    .map((file) => ({ file, source: readFile(path.join(root, file)) }));
  return [
    ...entries.filter(({ file }) => file.endsWith(".css")).flatMap(({ file, source }) => scanStylesheet(file, source)),
    ...analyzeScripts(entries.filter(({ file }) => !file.endsWith(".css")), paths),
  ].sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.fingerprint.localeCompare(b.fingerprint),
  );
}

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function countFingerprints(offenders) {
  const counts = {};
  for (const fingerprint of offenders.map((offender) => offender.fingerprint).sort(byText)) {
    counts[fingerprint] = (counts[fingerprint] ?? 0) + 1;
  }
  return counts;
}

/** The baseline file: fingerprint counts, and this pull request's allowed regressions with their reasons. */
export function serializeBaseline(offenders, allowedRegressions = []) {
  const allowed = [...allowedRegressions].sort((a, b) => byText(a.fingerprint, b.fingerprint));
  const offenderCounts = countFingerprints(offenders);
  const body = allowed.length > 0 ? { allowedRegressions: allowed, offenders: offenderCounts } : { offenders: offenderCounts };
  return `${JSON.stringify(body, null, 2)}\n`;
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

// What a fingerprint keeps when code moves: its category, its tag (without the defining file's
// path; for a call site, any offending app component) and its props with non-literal values
// blanked. Pairing also needs the same file or the same component (see findRegressions).
function moveKey(fingerprint) {
  const parts = fingerprint.split("::");
  const tag = parts[2] === "uses-hand-rolled-control" ? "" : parts.slice(3, -1).join("::").replace(/^app\/[^#]*#/, "#");
  let depth = 0;
  let props = "";
  for (const char of parts.at(-1)) {
    if (char === "{" && depth === 0) props += "{}";
    if (char === "{") depth += 1;
    if (depth === 0) props += char;
    if (char === "}") depth -= 1;
  }
  return [parts[2], tag, props].join("::");
}

/**
 * The fingerprints the scan has more of than `baseline` counts, after pairing each added
 * fingerprint one-to-one with a removed one of the same category, tag and literal props that is
 * in the same file (a renamed component) or the same component (a moved file): a move, which is
 * neutral. A fix elsewhere never pays for a new control.
 */
export function findRegressions(offenders, baseline) {
  const { added, removed } = compareWithBaseline(offenders, baseline);
  const place = (fingerprint) => {
    const [file, component] = fingerprint.split("::");
    return { fingerprint, file, component };
  };
  const pool = new Map();
  for (const { fingerprint, count } of removed) {
    const key = moveKey(fingerprint);
    pool.set(key, [...(pool.get(key) ?? []), ...Array(count).fill(place(fingerprint))]);
  }
  const regressions = [];
  const moves = [];
  for (const entry of added) {
    const { file, component } = place(entry.fingerprint);
    const candidates = pool.get(moveKey(entry.fingerprint)) ?? [];
    let count = entry.count;
    for (; count > 0; count -= 1) {
      const sameFile = candidates.findIndex((candidate) => candidate.file === file);
      const index = sameFile === -1 ? candidates.findIndex((candidate) => candidate.component === component) : sameFile;
      if (index === -1) break;
      moves.push({ from: candidates.splice(index, 1)[0].fingerprint, to: entry.fingerprint });
    }
    if (count > 0) regressions.push({ ...entry, count });
  }
  return { regressions, moves };
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
  // The baseline file at a git ref, or undefined when that commit has none.
  gitShow: (root, ref, file) => {
    const git = (args) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).status !== 0) {
      throw new Error(`hx-source-rules: unknown base ref ${ref}`);
    }
    const shown = git(["show", `${ref}:${file}`]);
    return shown.status === 0 ? shown.stdout : undefined;
  },
};

export function defaultExit(code) {
  process.exitCode = code;
}

function parseArgs(argv) {
  const options = { write: false, reason: undefined, base: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const next = argv[index + 1];
    const hasValue = next !== undefined && !next.startsWith("--");
    if (argv[index] === "--write-baseline") {
      options.write = true;
    } else if (argv[index] === "--allow-regression" && hasValue) {
      options.reason = next;
      index += 1;
    } else if (argv[index] === "--base" && hasValue) {
      options.base = next;
      index += 1;
    } else {
      return undefined;
    }
  }
  return options;
}

function parseBaseline(text) {
  const { offenders, allowedRegressions = [] } = JSON.parse(text);
  return { offenders, allowedRegressions };
}

function readBaseline(file, readFile) {
  try {
    return parseBaseline(readFile(file));
  } catch (error) {
    if (error?.code === "ENOENT") return { offenders: {}, allowedRegressions: [] };
    throw error;
  }
}

const hasReason = (reason) => typeof reason === "string" && reason.trim() !== "";
const entryKey = ({ fingerprint, reason }) => `${fingerprint}\u0000${reason}`;

export function main(argv, deps) {
  const { root, io, exit, readFile, readdir, writeFile, gitShow } = {
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
  const committed = readBaseline(baselineFile, readFile);
  const baseText = options.base === undefined ? undefined : gitShow(root, options.base, BASELINE_PATH);
  const base = baseText === undefined ? undefined : parseBaseline(baseText);

  if (options.write) {
    // Against the base ref's baseline when there is one, keeping this pull request's earlier
    // reasons (entries not already on the base, for a rise no larger than they allowed). Otherwise
    // against the committed baseline, dropping every earlier entry. An entry is one pull request's.
    const { regressions, moves } = findRegressions(offenders, (base ?? committed).offenders);
    const spent = new Set((base?.allowedRegressions ?? []).map(entryKey));
    const earlier = new Map(
      (base ? committed.allowedRegressions : [])
        .filter((entry) => !spent.has(entryKey(entry)))
        .map((entry) => [entry.fingerprint, entry]),
    );
    const allowed = regressions.map(({ fingerprint, count }) => {
      const prior = earlier.get(fingerprint);
      const reason = prior?.count >= count && hasReason(prior.reason) ? prior.reason : options.reason;
      return { fingerprint, count, reason };
    });
    const unexplained = regressions.filter((_, index) => !hasReason(allowed[index].reason));
    if (unexplained.length > 0) {
      for (const line of formatComparison({ added: unexplained, removed: [] })) io.error(line);
      io.error(
        "hx-source-rules: the baseline only shrinks. Replace the new controls with Ouro HX components, or pass --allow-regression <reason> for review.",
      );
      exit(1);
      return;
    }
    // With no baseline at the base ref nothing ratchets, so nothing is recorded.
    const recorded = options.base !== undefined && !base ? [] : allowed;
    const unrecorded = recorded === allowed ? "" : `; ${options.base} has no baseline, so nothing is recorded to ratchet against`;
    writeFile(baselineFile, serializeBaseline(offenders, recorded));
    io.log(
      `hx-source-rules: wrote ${BASELINE_PATH} with ${offenders.length} hand-rolled control(s), ${moves.length} move(s) and ${recorded.length} allowed regression(s)${unrecorded}.`,
    );
    return;
  }

  const lines = formatComparison(compareWithBaseline(offenders, committed.offenders));
  const notes = [];
  if (options.base !== undefined && !base) {
    notes.push(`hx-source-rules: ${options.base} has no baseline; nothing to ratchet against.`);
  }
  if (base) {
    const { regressions, moves } = findRegressions(offenders, base.offenders);
    // An entry already on the base was spent by an earlier pull request: it is never honoured again.
    const spent = new Set(base.allowedRegressions.map(entryKey));
    for (const entry of committed.allowedRegressions.filter((candidate) => spent.has(entryKey(candidate)))) {
      lines.push(
        `Stale allowed regression: ${entry.fingerprint} ("${entry.reason}") is already in ${options.base}'s baseline. Rewrite the baseline: ${UPDATE_COMMAND} --base ${options.base}`,
      );
    }
    const fresh = new Map(
      committed.allowedRegressions
        .filter((entry) => !spent.has(entryKey(entry)) && hasReason(entry.reason))
        .map((entry) => [entry.fingerprint, entry]),
    );
    let allowedCount = 0;
    for (const { fingerprint, count, at } of regressions) {
      const entry = fresh.get(fingerprint);
      if (entry?.count >= count) {
        allowedCount += 1;
        continue;
      }
      const permits = entry ? `, but its allowed regression permits ${entry.count ?? 0}` : "";
      lines.push(
        `Regression against ${options.base}: ${fingerprint} (+${count}) at ${at.join(", ")}${permits}. Use an Ouro HX component instead, or record why: ${UPDATE_COMMAND} --base ${options.base} --allow-regression "<reason>"`,
      );
    }
    notes.push(`hx-source-rules: ratchet against ${options.base}: ${allowedCount} allowed regression(s), ${moves.length} move(s).`);
  }
  for (const line of lines) io.error(line);
  if (lines.length > 0) {
    exit(1);
    return;
  }
  io.log(`hx-source-rules: ${files.length} file(s), ${offenders.length} hand-rolled control(s), all in the baseline.`);
  for (const note of notes) io.log(note);
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
