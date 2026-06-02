export const API_V1_RESOURCES = [
  { name: "root", path: "/api/v1", methods: ["GET"], auth: "optional", scopes: [] },
  { name: "health", path: "/api/v1/health", methods: ["GET"], auth: "optional", scopes: [] },
  { name: "openapi", path: "/api/v1/openapi.json", methods: ["GET"], auth: "optional", scopes: [] },
  { name: "recipes", path: "/api/v1/recipes", methods: ["GET"], auth: "optional", scopes: ["recipes:read"] },
  { name: "recipe", path: "/api/v1/recipes/{id}", methods: ["GET"], auth: "optional", scopes: ["recipes:read"] },
  { name: "cookbooks", path: "/api/v1/cookbooks", methods: ["GET"], auth: "optional", scopes: ["cookbooks:read"] },
  { name: "cookbook", path: "/api/v1/cookbooks/{id}", methods: ["GET"], auth: "optional", scopes: ["cookbooks:read"] },
  { name: "shopping-list", path: "/api/v1/shopping-list", methods: ["GET"], auth: "bearer", scopes: ["shopping_list:read"] },
  { name: "shopping-list-sync", path: "/api/v1/shopping-list/sync", methods: ["GET"], auth: "bearer", scopes: ["shopping_list:read"] },
  { name: "shopping-list-items", path: "/api/v1/shopping-list/items", methods: ["POST"], auth: "bearer", scopes: ["shopping_list:write"] },
  { name: "shopping-list-item", path: "/api/v1/shopping-list/items/{itemId}", methods: ["PATCH", "DELETE"], auth: "bearer", scopes: ["shopping_list:write"] },
  { name: "tokens", path: "/api/v1/tokens", methods: ["GET", "POST"], auth: "bearer", scopes: ["tokens:read", "tokens:write"] },
  { name: "token", path: "/api/v1/tokens/{credentialId}", methods: ["DELETE"], auth: "bearer", scopes: ["tokens:write"] },
] as const;

export const API_V1_ERROR_STATUS = {
  invalid_json: 400,
  validation_error: 400,
  invalid_cursor: 400,
  invalid_scope: 400,
  authentication_required: 401,
  invalid_token: 401,
  insufficient_scope: 403,
  not_found: 404,
  method_not_allowed: 405,
  idempotency_conflict: 409,
  rate_limited: 429,
  internal_error: 500,
} as const;

export type ApiV1ErrorCode = keyof typeof API_V1_ERROR_STATUS;

export const API_V1_DISCOVERY_DATA = {
  app: "spoonjoy",
  version: "v1",
  status: "ok",
  docsUrl: "https://spoonjoy.app/developers",
  openapiUrl: "/api/v1/openapi.json",
  resources: API_V1_RESOURCES,
  auth: {
    type: "bearer",
    tokenUrl: "/api/v1/tokens",
    oauth: { register: "/oauth/register", authorize: "/oauth/authorize", token: "/oauth/token" },
    mcp: {
      endpoint: "/mcp",
      startAgentConnection: "/api/tools/start_agent_connection",
      pollAgentConnection: "/api/tools/poll_agent_connection",
    },
  },
} as const;
