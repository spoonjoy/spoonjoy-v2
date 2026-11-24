// Collects the flag files in ./flags into one list, wherever the app's code runs.
//
// Under Vite (the Worker and client builds, the dev server and vitest), import.meta.glob is a compile-time feature
// that bundles every file in the folder, so a new flag file needs no edit anywhere else. Plain Node scripts run under
// tsx (the MCP bridge, the stdio MCP server, the API playground generator) import the same code, and there
// import.meta.glob does not exist. Calling it throws a TypeError, and the files are read from disk with require,
// which tsx compiles synchronously.

import type { FlagDeclaration } from "./define-flag";

type Declarations = Record<string, FlagDeclaration<string>>;

/** The default exports of the .ts files in the ./flags folder next to `moduleUrl`, loaded with Node's require. */
export function readFlagFiles(moduleUrl: string): Declarations {
  const { createRequire } = process.getBuiltinModule("node:module");
  const { readdirSync } = process.getBuiltinModule("node:fs");
  const { fileURLToPath } = process.getBuiltinModule("node:url");
  const folderUrl = new URL("./flags/", moduleUrl).href;
  const folder = fileURLToPath(folderUrl);
  const require = createRequire(folderUrl);
  const declared: Declarations = {};
  for (const file of readdirSync(folder).filter((name) => name.endsWith(".ts")).sort()) {
    declared[file] = (require(`./${file}`) as { default: FlagDeclaration<string> }).default;
  }
  return declared;
}

/** The flags in `glob()`'s files, or in the ./flags folder next to `moduleUrl` when the code runs without Vite. */
export function collectFlags(glob: () => Declarations, moduleUrl: string): Record<string, { description: string }> {
  let declared: Declarations;
  try {
    declared = glob();
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    declared = readFlagFiles(moduleUrl);
  }
  return Object.fromEntries(Object.values(declared).map(({ name, description }) => [name, { description }]));
}
