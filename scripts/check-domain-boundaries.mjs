#!/usr/bin/env node
// The dependency rule for app/domains (docs/domains.md), checked on every pull request through `pnpm lint`:
// - each bounded context is a folder app/domains/<context> with an index.ts, its public surface, and optionally an
//   index.server.ts, its server-only surface;
// - code outside a context imports it only through those ("~/domains/<context>", "~/domains/<context>/index.server"),
//   never its folders;
// - a context's model/ does no I/O: it imports only its own model/, the shared kernel (Food knowledge, through its
//   index) and pure packages, never app code outside it, Node or Cloudflare built-ins, React, Prisma or AI clients.
//
//   node scripts/check-domain-boundaries.mjs [--root <dir>]
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, posix } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

export const CONTEXTS = Object.freeze([
  "kitchen",
  "cooking",
  "planning",
  "pantry-and-shopping",
  "food-knowledge",
  "households-and-identity",
  "move-in",
  "community-and-federation",
  "integrations",
  "platform",
]);

export const SHARED_KERNEL = "food-knowledge";

/** Packages a model may not import: each does I/O or ties the model to a runtime. */
export const IO_PACKAGES = Object.freeze(["react", "react-dom", "react-router", "@prisma", "prisma", "openai", "@google/genai", "web-push", "wrangler"]);

const SOURCE = /\.(?:ts|tsx|mts)$/;
const TEST = /(?:\.test\.|\.spec\.|\/__tests__\/)/;
const INDEX = new Set(["", "index", "index.ts", "index.tsx", "index.server", "index.server.ts"]);

function sourceFiles(root, dir) {
  const full = join(root, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full).sort().flatMap((name) => {
    const path = posix.join(dir, name);
    if (statSync(join(root, path)).isDirectory()) return sourceFiles(root, path);
    return SOURCE.test(path) && !TEST.test(path) ? [path] : [];
  });
}

/** The repository path a specifier points at, or null for a package. */
function target(file, specifier) {
  if (specifier.startsWith("~/")) return posix.normalize(`app/${specifier.slice(2)}`);
  if (specifier.startsWith(".")) return posix.normalize(posix.join(posix.dirname(file), specifier));
  return null;
}

function contextOf(path) {
  const match = /^app\/domains\/([^/]+)(?:\/(.*))?$/.exec(path);
  return match ? { context: match[1], rest: match[2] ?? "" } : null;
}

function isIoPackage(specifier) {
  if (specifier.startsWith("node:") || specifier.startsWith("cloudflare:")) return true;
  const name = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
  return builtinModules.includes(name) || IO_PACKAGES.some((io) => name === io || name.startsWith(`${io}/`));
}

function checkImport(file, specifier) {
  const from = contextOf(file);
  const path = target(file, specifier);
  const to = path === null ? null : contextOf(path);
  if (to && to.context !== from?.context && !INDEX.has(to.rest)) {
    return {
      rule: "context-internals",
      message: `reaches into ${to.context}'s internals; import from "~/domains/${to.context}" (its index.ts) instead.`,
    };
  }
  if (!from || !from.rest.startsWith("model/")) return null;
  const ownModel = to && to.context === from.context && to.rest.startsWith("model/");
  const kernel = to && to.context === SHARED_KERNEL && !to.rest.startsWith("index.server");
  if (path === null ? !isIoPackage(specifier) : ownModel || kernel) return null;
  return {
    rule: "model-purity",
    message: `a model imports only its own model/, the shared kernel ("~/domains/${SHARED_KERNEL}") and pure packages; move this into application/ or adapters/ behind a port.`,
  };
}

/** Every break of the rule under root, as { file, specifier, rule, message }. */
export function findViolations(root) {
  const violations = [];
  for (const context of CONTEXTS) {
    const file = `app/domains/${context}/index.ts`;
    if (!existsSync(join(root, file))) violations.push({ file, specifier: null, rule: "context-index", message: "a context needs an index.ts, its public surface." });
  }
  const domains = join(root, "app/domains");
  for (const name of existsSync(domains) ? readdirSync(domains).sort() : []) {
    if (statSync(join(domains, name)).isDirectory() && !CONTEXTS.includes(name)) {
      violations.push({ file: `app/domains/${name}`, specifier: null, rule: "unknown-context", message: `not a bounded context; use one of ${CONTEXTS.join(", ")} (design in docs/domains.md).` });
    }
  }
  for (const file of sourceFiles(root, "app")) {
    const { importedFiles } = ts.preProcessFile(readFileSync(join(root, file), "utf8"), true, true);
    for (const { fileName: specifier } of importedFiles) {
      const broken = checkImport(file, specifier);
      if (broken) violations.push({ file, specifier, ...broken });
    }
  }
  return violations;
}

export function main(argv, { log = console.log } = {}) {
  const root = argv.includes("--root") ? argv[argv.indexOf("--root") + 1] : process.cwd();
  const violations = findViolations(root);
  for (const { file, specifier, message } of violations) log(specifier === null ? `${file}: ${message}` : `${file} imports "${specifier}": ${message}`);
  log(`domain boundaries: ${CONTEXTS.length} contexts, ${violations.length} violations.`);
  return violations.length ? 1 : 0;
}

/* istanbul ignore if -- @preserve CLI boundary delegates to the tested main above. */
if (import.meta.url === pathToFileURL(String(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
