import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build, transformWithEsbuild } from "vite";

const args = process.argv.slice(2);
const sourcePath = args.shift();
let durableObjectPath;
let minify = false;
let outputPath;

while (args.length > 0) {
  const option = args.shift();
  if (option === "--durable-object") {
    durableObjectPath = args.shift();
  } else if (option === "--minify") {
    minify = true;
  } else if (option === "--output") {
    outputPath = args.shift();
  } else {
    throw new Error(`Unknown or incomplete option: ${option ?? "<missing>"}`);
  }
}

function repositoryPath(value, label) {
  if (!value || path.isAbsolute(value) || value.split(path.sep).includes("..")) {
    throw new Error(`Expected a repository-relative ${label}.`);
  }
  return path.resolve(value);
}

const inputPath = repositoryPath(sourcePath, "runtime source path");
const inputSource = await readFile(inputPath, "utf8");
const resolvedDurableObjectPath = durableObjectPath
  ? repositoryPath(durableObjectPath, "Durable Object source path")
  : undefined;

const virtualModules = new Map([
  ["react-router", `
    export function createRequestHandler() {
      return async function fixtureReactRouterHandler() {
        return new Response(null, { status: 418 });
      };
    }
  `],
  ["../app/lib/canonical-host.server", `
    export function canonicalizeRequestUrlForHost() { return null; }
  `],
  ["../app/lib/api-auth.server", `
    export class ApiAuthError extends Error {
      constructor(status = 401) { super("fixture auth error"); this.status = status; }
    }
    export async function authenticateApiRequest(_db, _request, env) {
      return env.__fixturePrincipal ?? null;
    }
  `],
  ["../app/lib/db.server", `
    export async function getDb({ DB }) { return DB; }
  `],
  ["../app/lib/mcp/http-mcp-route.server", `
    export async function handleMcpPostRouteRequest() {
      return new Response(null, { status: 404 });
    }
  `],
  ["../app/lib/oauth-cors.server", `
    export function oauthCorsPreflightResponse() { return null; }
  `],
  ["../app/lib/security-headers.server", `
    export function generateNonce() { return "fixture-nonce"; }
    export function withSecurityHeaders(response) { return response; }
  `],
  ["../app/lib/analytics-server", `
    export async function captureException() {}
    export function resolvePostHogServerConfig() { return { enabled: false }; }
  `],
  ["virtual:react-router/server-build", "export default {};"],
]);

const historicalRuntimeStubs = {
  name: "historical-runtime-stubs",
  enforce: "pre",
  resolveId(id) {
    if (id === "historical-runtime-entry") return "\0historical-runtime-entry.ts";
    if (virtualModules.has(id)) return `\0historical:${id}`;
    if (id === "./cook-session") {
      if (!resolvedDurableObjectPath) {
        throw new Error("Worker fixture requires --durable-object.");
      }
      return resolvedDurableObjectPath;
    }
    return null;
  },
  load(id) {
    if (id === "\0historical-runtime-entry.ts") return inputSource;
    const prefix = "\0historical:";
    return id.startsWith(prefix) ? virtualModules.get(id.slice(prefix.length)) : null;
  },
  async transform(code, id) {
    if (id !== "\0historical-runtime-entry.ts") return null;
    return transformWithEsbuild(code, "historical-runtime-entry.ts", {
      loader: "ts",
      target: "es2022",
    });
  },
};

const result = await build({
  configFile: false,
  logLevel: "silent",
  define: {
    "import.meta.env.MODE": JSON.stringify("production"),
  },
  plugins: [historicalRuntimeStubs],
  build: {
    write: false,
    target: "es2022",
    minify,
    rollupOptions: {
      input: "historical-runtime-entry",
      preserveEntrySignatures: "strict",
      output: {
        entryFileNames: "runtime.mjs",
        format: "es",
        inlineDynamicImports: true,
      },
    },
  },
});

const outputs = Array.isArray(result) ? result.flatMap(({ output }) => output) : result.output;
const chunks = outputs.filter((output) => output.type === "chunk");
if (chunks.length !== 1) throw new Error("Expected exactly one executable runtime chunk.");

const bytes = Buffer.from(chunks[0].code, "utf8");
if (outputPath) await writeFile(path.resolve(outputPath), bytes);
process.stdout.write(`${JSON.stringify({
  bundleSha256: createHash("sha256").update(bytes).digest("hex"),
})}\n`);
