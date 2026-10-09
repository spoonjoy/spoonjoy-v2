// What an agent connection may grant. Shared by the server and the approval page, so it must stay
// free of server-only imports.

/**
 * The only scopes an agent connection can grant. Anyone can start a request and send the link to a
 * chef, so a connection never grants account-level access (email, password, tokens): those stay
 * with the chef's own signed-in session and OAuth apps they authorize directly.
 */
export const AGENT_CONNECTION_SCOPES = [
  "public:read",
  "recipes:read",
  "cookbooks:read",
  "shopping_list:read",
  "shopping_list:write",
  "kitchen:read",
  "kitchen:write",
] as const;

const AGENT_CONNECTION_SCOPE_SET = new Set<string>(AGENT_CONNECTION_SCOPES);

/** Scopes that let the agent change the chef's data. The approval page warns about each one. */
export const AGENT_CONNECTION_WRITE_SCOPES = ["shopping_list:write", "kitchen:write"] as const;

/** How long a token from an approved agent connection lasts. The chef connects again after this. */
export const AGENT_CONNECTION_TOKEN_TTL_DAYS = 90;


/** True when every scope on the request is one an agent connection may grant. */
export function isGrantableAgentConnectionScope(scopes: string): boolean {
  return scopes.trim().split(/\s+/).filter(Boolean).every((scope) => AGENT_CONNECTION_SCOPE_SET.has(scope));
}
