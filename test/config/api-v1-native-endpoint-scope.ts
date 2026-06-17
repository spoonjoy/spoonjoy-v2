export type NativeRestMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
export type NativeRestAuth = "optional" | "bearer";

export interface NativeRestEndpointScopeRow {
  method: NativeRestMethod;
  path: string;
  auth: NativeRestAuth;
  scopes: readonly string[];
}

export const NATIVE_REST_ENDPOINT_SCOPE = [
  { method: "GET", path: "/api/v1", auth: "optional", scopes: [] },
  { method: "GET", path: "/api/v1/health", auth: "optional", scopes: [] },
  { method: "GET", path: "/api/v1/openapi.json", auth: "optional", scopes: [] },
  { method: "GET", path: "/api/v1/openapi.sdk.json", auth: "optional", scopes: [] },
  { method: "GET", path: "/api/v1/openapi.connector.json", auth: "optional", scopes: [] },
  { method: "GET", path: "/api/v1/recipes", auth: "optional", scopes: ["recipes:read"] },
  { method: "GET", path: "/api/v1/recipes/{id}", auth: "optional", scopes: ["recipes:read"] },
  { method: "POST", path: "/api/v1/recipes", auth: "bearer", scopes: ["kitchen:write"] },
  { method: "PATCH", path: "/api/v1/recipes/{id}", auth: "bearer", scopes: ["kitchen:write"] },
  { method: "DELETE", path: "/api/v1/recipes/{id}", auth: "bearer", scopes: ["kitchen:write"] },
  { method: "POST", path: "/api/v1/recipes/{id}/fork", auth: "bearer", scopes: ["kitchen:write"] },
  { method: "POST", path: "/api/v1/recipes/{id}/steps", auth: "bearer", scopes: ["kitchen:write"] },
  { method: "PATCH", path: "/api/v1/recipes/{id}/steps/{stepId}", auth: "bearer", scopes: ["kitchen:write"] },
  { method: "DELETE", path: "/api/v1/recipes/{id}/steps/{stepId}", auth: "bearer", scopes: ["kitchen:write"] },
  { method: "POST", path: "/api/v1/recipes/{id}/steps/reorder", auth: "bearer", scopes: ["kitchen:write"] },
  { method: "POST", path: "/api/v1/recipes/{id}/steps/{stepId}/ingredients", auth: "bearer", scopes: ["kitchen:write"] },
  { method: "DELETE", path: "/api/v1/recipes/{id}/steps/{stepId}/ingredients/{ingredientId}", auth: "bearer", scopes: ["kitchen:write"] },
  { method: "PUT", path: "/api/v1/recipes/{id}/step-output-uses", auth: "bearer", scopes: ["kitchen:write"] },
  { method: "POST", path: "/api/v1/recipes/{id}/image", auth: "bearer", scopes: ["kitchen:write"] },
  { method: "GET", path: "/api/v1/recipes/{id}/covers", auth: "bearer", scopes: ["kitchen:write"] },
  { method: "POST", path: "/api/v1/recipes/{id}/covers", auth: "bearer", scopes: ["kitchen:write"] },
  { method: "PATCH", path: "/api/v1/recipes/{id}/covers/{coverId}", auth: "bearer", scopes: ["kitchen:write"] },
  { method: "DELETE", path: "/api/v1/recipes/{id}/covers/{coverId}", auth: "bearer", scopes: ["kitchen:write"] },
  { method: "POST", path: "/api/v1/recipes/{id}/covers/regenerate", auth: "bearer", scopes: ["kitchen:write"] },
  { method: "POST", path: "/api/v1/recipes/{id}/covers/from-spoon/{spoonId}", auth: "bearer", scopes: ["kitchen:write"] },
  { method: "GET", path: "/api/v1/recipes/{id}/spoons", auth: "optional", scopes: ["recipes:read"] },
  { method: "POST", path: "/api/v1/recipes/{id}/spoons", auth: "bearer", scopes: ["kitchen:write"] },
  { method: "PATCH", path: "/api/v1/recipes/{id}/spoons/{spoonId}", auth: "bearer", scopes: ["kitchen:write"] },
  { method: "DELETE", path: "/api/v1/recipes/{id}/spoons/{spoonId}", auth: "bearer", scopes: ["kitchen:write"] },
  { method: "GET", path: "/api/v1/cookbooks", auth: "optional", scopes: ["cookbooks:read"] },
  { method: "GET", path: "/api/v1/cookbooks/{id}", auth: "optional", scopes: ["cookbooks:read"] },
  { method: "POST", path: "/api/v1/cookbooks", auth: "bearer", scopes: ["kitchen:write"] },
  { method: "PATCH", path: "/api/v1/cookbooks/{id}", auth: "bearer", scopes: ["kitchen:write"] },
  { method: "DELETE", path: "/api/v1/cookbooks/{id}", auth: "bearer", scopes: ["kitchen:write"] },
  { method: "POST", path: "/api/v1/cookbooks/{id}/recipes/{recipeId}", auth: "bearer", scopes: ["kitchen:write"] },
  { method: "DELETE", path: "/api/v1/cookbooks/{id}/recipes/{recipeId}", auth: "bearer", scopes: ["kitchen:write"] },
  { method: "GET", path: "/api/v1/shopping-list", auth: "bearer", scopes: ["shopping_list:read"] },
  { method: "GET", path: "/api/v1/shopping-list/sync", auth: "bearer", scopes: ["shopping_list:read"] },
  { method: "POST", path: "/api/v1/shopping-list/items", auth: "bearer", scopes: ["shopping_list:write"] },
  { method: "PATCH", path: "/api/v1/shopping-list/items/{itemId}", auth: "bearer", scopes: ["shopping_list:write"] },
  { method: "DELETE", path: "/api/v1/shopping-list/items/{itemId}", auth: "bearer", scopes: ["shopping_list:write"] },
  { method: "POST", path: "/api/v1/shopping-list/add-from-recipe", auth: "bearer", scopes: ["shopping_list:write"] },
  { method: "POST", path: "/api/v1/shopping-list/clear-completed", auth: "bearer", scopes: ["shopping_list:write"] },
  { method: "POST", path: "/api/v1/shopping-list/clear-all", auth: "bearer", scopes: ["shopping_list:write"] },
  { method: "GET", path: "/api/v1/me", auth: "bearer", scopes: ["kitchen:read"] },
  { method: "PATCH", path: "/api/v1/me", auth: "bearer", scopes: ["kitchen:write"] },
  { method: "POST", path: "/api/v1/me/photo", auth: "bearer", scopes: ["kitchen:write"] },
  { method: "DELETE", path: "/api/v1/me/photo", auth: "bearer", scopes: ["kitchen:write"] },
  { method: "GET", path: "/api/v1/me/kitchen", auth: "bearer", scopes: ["kitchen:read"] },
  { method: "GET", path: "/api/v1/me/notification-preferences", auth: "bearer", scopes: ["kitchen:read"] },
  { method: "PATCH", path: "/api/v1/me/notification-preferences", auth: "bearer", scopes: ["kitchen:write"] },
  { method: "POST", path: "/api/v1/me/apns-devices", auth: "bearer", scopes: ["kitchen:write"] },
  { method: "DELETE", path: "/api/v1/me/apns-devices/{deviceId}", auth: "bearer", scopes: ["kitchen:write"] },
  { method: "GET", path: "/api/v1/me/connections", auth: "bearer", scopes: ["kitchen:read"] },
  { method: "DELETE", path: "/api/v1/me/connections/{connectionId}", auth: "bearer", scopes: ["kitchen:write"] },
  { method: "GET", path: "/api/v1/tokens", auth: "bearer", scopes: ["tokens:read"] },
  { method: "POST", path: "/api/v1/tokens", auth: "bearer", scopes: ["tokens:write"] },
  { method: "DELETE", path: "/api/v1/tokens/{credentialId}", auth: "bearer", scopes: ["tokens:write"] },
  { method: "GET", path: "/api/v1/me/sync", auth: "bearer", scopes: ["kitchen:read"] },
  { method: "GET", path: "/api/v1/users/{identifier}", auth: "optional", scopes: ["public:read"] },
  { method: "GET", path: "/api/v1/users/{identifier}/fellow-chefs", auth: "optional", scopes: ["public:read"] },
  { method: "GET", path: "/api/v1/users/{identifier}/kitchen-visitors", auth: "optional", scopes: ["public:read"] },
  { method: "GET", path: "/api/v1/search", auth: "optional", scopes: ["public:read"] },
  { method: "POST", path: "/api/v1/recipes/import", auth: "bearer", scopes: ["kitchen:write"] },
] as const satisfies readonly NativeRestEndpointScopeRow[];

export const NON_REST_ENDPOINT_SCOPE = [
  { method: "GET", path: "/agent/connect" },
  { method: "GET", path: "/agent/connect/{requestId}" },
  { method: "GET", path: "/.well-known/apple-app-site-association" },
  { method: "GET", path: "/.well-known/appspecific/com.chrome.devtools.json" },
] as const;

export function endpointKey(row: Pick<NativeRestEndpointScopeRow, "method" | "path">) {
  return `${row.method} ${row.path}`;
}

export function nativeRestOperationScopes() {
  return Object.fromEntries(
    NATIVE_REST_ENDPOINT_SCOPE.map((row) => [endpointKey(row), [...row.scopes]]),
  ) as Record<string, string[]>;
}
