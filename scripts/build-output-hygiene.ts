const SERVER_ONLY_ROUTE_CHUNKS = new Set([
  "account.export",
  "api._",
  "api.developer",
  "api.developer._",
  "api.developers",
  "api.developers._",
  "api.docs",
  "api.docs._",
  "api.openapi",
  "api.openapi-json",
  "api.openapi-spec",
  "api.playground",
  "api.push.preferences",
  "api.push.public-key",
  "api.push.subscriptions",
  "api.try",
  "api.v1._",
  "auth.webauthn.authenticate.options",
  "auth.webauthn.authenticate.verify",
  "auth.webauthn.register.options",
  "auth.webauthn.register.verify",
  "csp-report",
  "health",
  "health.ready",
  "mcp",
  "oauth.register",
  "oauth.revoke",
  "oauth.token",
  "og.cookbooks._id.png",
  "og.pages._slug.png",
  "og.recipes._id.png",
  "photos._",
  "recipes._id.fork",
  "robots.txt",
  "sitemap.xml",
  "well-known.apple-app-site-association",
  "well-known.oauth-authorization-server",
  "well-known.oauth-protected-resource",
  "well-known.oauth-protected-resource.mcp",
]);

function emptyBundleChunkNames(log: { message?: string; names?: readonly string[] }) {
  if (log.names?.length) return log.names;
  const match = /^Generated an empty chunk: "(.+)"\.$/.exec(log.message ?? "");
  return match ? [match[1]] : [];
}

// Stopgap for an Ouro UI defect: its files start with `"use client";`, with a semicolon, which
// shadcn's installer does not strip for an app that is not on React Server Components
// (components.json "rsc": false), so every copied-in Ouro UI file keeps the line. Rollup leaves it
// out of the bundle and says so twice per file: the directive notice, and a sourcemap notice
// about that first line. Both are noise for those files only; Spoonjoy's own source stays held
// to "no client directives" by test/build-output-hygiene.test.ts.
const OURO_UI_SOURCE = /\/app\/(?:components|lib)\/ouro\//;

function isOuroUiClientDirectiveNotice(log: { code?: string; message?: string; id?: string; loc?: { line?: number } }) {
  if (!log.id || !OURO_UI_SOURCE.test(log.id.replaceAll("\\", "/"))) return false;
  if (log.code === "MODULE_LEVEL_DIRECTIVE") return /["']use client["']/.test(log.message ?? "");
  return log.code === "SOURCEMAP_ERROR" && log.loc?.line === 1;
}

export function shouldLogRollupBuildMessage(
  level: "warn" | "info" | "debug",
  log: { code?: string; message?: string; names?: readonly string[]; id?: string; loc?: { line?: number } }
) {
  if (level === "warn" && isOuroUiClientDirectiveNotice(log)) return false;
  if (level !== "warn" || log.code !== "EMPTY_BUNDLE") return true;
  const names = emptyBundleChunkNames(log);
  return names.length === 0 || !names.every((name) => SERVER_ONLY_ROUTE_CHUNKS.has(name));
}

function stripAnsi(value: string) {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

export function shouldLogViteBuildErrorMessage(message: string) {
  return stripAnsi(message).trim() !== "✘ [ERROR] The build was canceled";
}

export function filterViteBuildErrorOutput(output: string) {
  const lines = output.match(/[^\r\n]*(?:\r?\n|$)/g) ?? [];
  return lines
    .filter((line) => {
      if (line === "") return false;
      const message = line.replace(/\r?\n$/, "");
      return stripAnsi(message).trim() !== "" && shouldLogViteBuildErrorMessage(message);
    })
    .join("");
}
