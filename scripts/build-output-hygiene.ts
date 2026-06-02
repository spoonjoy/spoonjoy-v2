const SERVER_ONLY_ROUTE_CHUNKS = new Set([
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
  "health",
  "mcp",
  "oauth.register",
  "oauth.token",
  "og.cookbooks._id.png",
  "og.recipes._id.png",
  "photos._",
  "recipes._id.fork",
  "well-known.oauth-authorization-server",
  "well-known.oauth-protected-resource",
]);

function emptyBundleChunkNames(log: { message?: string; names?: readonly string[] }) {
  if (log.names?.length) return log.names;
  const match = /^Generated an empty chunk: "(.+)"\.$/.exec(log.message ?? "");
  return match ? [match[1]] : [];
}

export function shouldLogRollupBuildMessage(
  level: "warn" | "info" | "debug",
  log: { code?: string; message?: string; names?: readonly string[] }
) {
  if (level !== "warn" || log.code !== "EMPTY_BUNDLE") return true;
  const names = emptyBundleChunkNames(log);
  return names.length === 0 || !names.every((name) => SERVER_ONLY_ROUTE_CHUNKS.has(name));
}
