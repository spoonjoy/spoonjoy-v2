import { describe, expect, it } from "vitest";
import { buildApiV1ConnectorOpenApiDocument, buildApiV1OpenApiDocument, buildApiV1SdkOpenApiDocument } from "~/lib/api-v1-openapi.server";
import { API_V1_ERROR_STATUS, API_V1_RESOURCES } from "~/lib/api-v1-contract.server";

const RESOURCE_PATHS = Array.from(new Set(API_V1_RESOURCES.map((resource) => resource.path))).sort();
const AUTH_PATHS = [
  "/api/tools/poll_agent_connection",
  "/api/tools/start_agent_connection",
  "/mcp",
  "/oauth/authorize",
  "/oauth/register",
  "/oauth/revoke",
  "/oauth/token",
];
const OPERATION_SCOPES = {
  "GET /api/v1": [],
  "GET /api/v1/health": [],
  "GET /api/v1/openapi.json": [],
  "GET /api/v1/openapi.sdk.json": [],
  "GET /api/v1/openapi.connector.json": [],
  "POST /api/v1/auth/apple/native": [],
  "POST /api/v1/auth/password/native": [],
  "POST /api/v1/native/telemetry": [],
  "GET /api/v1/search": [],
  "GET /api/v1/recipes": ["recipes:read"],
  "POST /api/v1/recipes": ["kitchen:write"],
  "POST /api/v1/recipes/import": ["kitchen:write"],
  "GET /api/v1/recipes/{id}": ["recipes:read"],
  "PATCH /api/v1/recipes/{id}": ["kitchen:write"],
  "DELETE /api/v1/recipes/{id}": ["kitchen:write"],
  "POST /api/v1/recipes/{id}/fork": ["kitchen:write"],
  "POST /api/v1/recipes/{id}/steps": ["kitchen:write"],
  "PATCH /api/v1/recipes/{id}/steps/{stepId}": ["kitchen:write"],
  "DELETE /api/v1/recipes/{id}/steps/{stepId}": ["kitchen:write"],
  "POST /api/v1/recipes/{id}/steps/reorder": ["kitchen:write"],
  "POST /api/v1/recipes/{id}/steps/{stepId}/ingredients": ["kitchen:write"],
  "DELETE /api/v1/recipes/{id}/steps/{stepId}/ingredients/{ingredientId}": ["kitchen:write"],
  "PUT /api/v1/recipes/{id}/step-output-uses": ["kitchen:write"],
  "GET /api/v1/recipes/{id}/spoons": ["recipes:read"],
  "POST /api/v1/recipes/{id}/spoons": ["kitchen:write"],
  "PATCH /api/v1/recipes/{id}/spoons/{spoonId}": ["kitchen:write"],
  "DELETE /api/v1/recipes/{id}/spoons/{spoonId}": ["kitchen:write"],
  "GET /api/v1/recipes/{id}/covers": ["kitchen:write"],
  "PATCH /api/v1/recipes/{id}/covers": ["kitchen:write"],
  "PATCH /api/v1/recipes/{id}/covers/{coverId}": ["kitchen:write"],
  "DELETE /api/v1/recipes/{id}/covers/{coverId}": ["kitchen:write"],
  "POST /api/v1/recipes/{id}/covers/regenerate": ["kitchen:write"],
  "POST /api/v1/recipes/{id}/covers/from-spoon/{spoonId}": ["kitchen:write"],
  "GET /api/v1/cookbooks": ["cookbooks:read"],
  "POST /api/v1/cookbooks": ["kitchen:write"],
  "GET /api/v1/cookbooks/{id}": ["cookbooks:read"],
  "PATCH /api/v1/cookbooks/{id}": ["kitchen:write"],
  "DELETE /api/v1/cookbooks/{id}": ["kitchen:write"],
  "POST /api/v1/cookbooks/{id}/recipes/{recipeId}": ["kitchen:write"],
  "DELETE /api/v1/cookbooks/{id}/recipes/{recipeId}": ["kitchen:write"],
  "GET /api/v1/me": ["account:read"],
  "PATCH /api/v1/me": ["account:write"],
  "GET /api/v1/me/sync": ["account:read", "kitchen:read"],
  "POST /api/v1/me/photo": ["account:write"],
  "DELETE /api/v1/me/photo": ["account:write"],
  "GET /api/v1/me/notification-preferences": ["account:read"],
  "PATCH /api/v1/me/notification-preferences": ["account:write"],
  "POST /api/v1/me/apns-devices": ["account:write"],
  "DELETE /api/v1/me/apns-devices/{deviceId}": ["account:write"],
  "GET /api/v1/me/connections": ["tokens:read"],
  "DELETE /api/v1/me/connections/{connectionId}": ["tokens:write"],
  "GET /api/v1/shopping-list": ["shopping_list:read"],
  "GET /api/v1/shopping-list/sync": ["shopping_list:read"],
  "POST /api/v1/shopping-list/items": ["shopping_list:write"],
  "PATCH /api/v1/shopping-list/items/{itemId}": ["shopping_list:write"],
  "DELETE /api/v1/shopping-list/items/{itemId}": ["shopping_list:write"],
  "POST /api/v1/shopping-list/add-from-recipe": ["shopping_list:write"],
  "POST /api/v1/shopping-list/clear-completed": ["shopping_list:write"],
  "POST /api/v1/shopping-list/clear-all": ["shopping_list:write"],
  "GET /api/v1/tokens": ["tokens:read"],
  "POST /api/v1/tokens": ["tokens:write"],
  "DELETE /api/v1/tokens/{credentialId}": ["tokens:write"],
} satisfies Record<string, string[]>;

function operation(document: any, path: string, method: string) {
  return document.paths[path][method.toLowerCase()];
}

function responseExample(document: any, path: string, method: string, status: string) {
  const examples = operation(document, path, method).responses[status].content["application/json"].examples;
  return (examples.example ?? Object.values(examples)[0] as any).value;
}

function requestExample(document: any, path: string, method: string) {
  const content = operation(document, path, method).requestBody?.content ?? {};
  const examples = content["application/json"]?.examples ?? content["multipart/form-data"]?.examples;
  return examples?.example?.value;
}

function errorExample(document: any, path: string, method: string, status: string, code: string) {
  return operation(document, path, method).responses[status].content["application/json"].examples[code].value;
}

function expectFlexibleDeleteContract(document: any, path: string, requestSchema: string) {
  const deleteOperation = operation(document, path, "DELETE");

  expect(deleteOperation.requestBody).toMatchObject({
    required: false,
    content: {
      "application/json": {
        schema: { $ref: `#/components/schemas/${requestSchema}` },
      },
    },
  });
  expect(deleteOperation.parameters).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: "X-Client-Mutation-Id", in: "header", required: false }),
    expect.objectContaining({ name: "clientMutationId", in: "query", required: false }),
    expect.objectContaining({ name: "X-Request-Id", in: "header", required: false }),
  ]));
  expect(deleteOperation["x-idempotency"]).toMatchObject({
    key: "clientMutationId",
    location: "jsonBody, query, or X-Client-Mutation-Id",
  });
  expect(deleteOperation.responses["400"].content["application/json"].examples.invalid_json.value.error.code)
    .toBe("invalid_json");
}

function dedupeSecurity(security: Array<Record<string, unknown>>) {
  const seen = new Set<string>();
  return security.filter((entry) => {
    const key = JSON.stringify(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

describe("API v1 OpenAPI document", () => {
  it("generates the required top-level OpenAPI 3.1 contract", () => {
    const document = buildApiV1OpenApiDocument();

    expect(document.openapi).toBe("3.1.0");
    expect(document.info).toEqual({
      title: "Spoonjoy API",
      version: "v1",
      description: expect.stringContaining("public-by-default Chef graph"),
    });
    expect(document.servers).toEqual([{ url: "https://spoonjoy.app" }]);
    const preview = buildApiV1OpenApiDocument({ serverUrl: "https://preview.example" });
    expect(preview.servers).toEqual([{ url: "https://preview.example" }]);
    expect(preview.components.securitySchemes.oauth2.flows.authorizationCode.authorizationUrl)
      .toBe("https://preview.example/oauth/authorize");
    expect(preview.components.securitySchemes.oauth2.flows.authorizationCode.tokenUrl)
      .toBe("https://preview.example/oauth/token");
    expect(preview["x-oauth-discovery"].dynamicRegistrationUrl).toBe("https://preview.example/oauth/register");
    expect(preview["x-public-data-policy"].termsUrl).toBe("https://preview.example/terms");
    expect(document.security).toEqual([]);
    expect(Object.keys(document.paths).sort()).toEqual([...AUTH_PATHS, ...RESOURCE_PATHS].sort());
    expect(document.components.securitySchemes.bearerAuth).toEqual({
      type: "http",
      scheme: "bearer",
      bearerFormat: "Spoonjoy API token",
    });
    expect(document.components.securitySchemes.cookieAuth).toMatchObject({
      type: "apiKey",
      in: "cookie",
      name: "__session",
    });
    expect(document.components.securitySchemes.oauth2).toMatchObject({
      type: "oauth2",
      flows: {
        authorizationCode: {
          authorizationUrl: "https://spoonjoy.app/oauth/authorize",
          tokenUrl: "https://spoonjoy.app/oauth/token",
          scopes: {
            "account:read": expect.any(String),
            "account:write": expect.any(String),
            "kitchen:read": expect.any(String),
            "kitchen:write": expect.any(String),
            "shopping_list:read": expect.any(String),
            "shopping_list:write": expect.any(String),
          },
        },
      },
    });
    expect(document["x-oauth-scope-map"]).toEqual({
      "account:read": ["account:read"],
      "account:write": ["account:write"],
      "cookbooks:read": ["cookbooks:read"],
      "kitchen:read": ["cookbooks:read", "public:read", "recipes:read", "shopping_list:read"],
      "kitchen:write": ["kitchen:write", "shopping_list:write"],
      "public:read": ["recipes:read", "cookbooks:read"],
      "recipes:read": ["recipes:read"],
      "shopping_list:read": ["shopping_list:read"],
      "shopping_list:write": ["shopping_list:write"],
    });
    expect(document["x-auth-flows"].map((flow: { id: string }) => flow.id)).toEqual(["oauth-pkce", "delegated-approval", "mcp"]);
    expect(document["x-client-scenarios"].map((scenario: { id: string }) => scenario.id)).toEqual([
      "spoonjoy-apple-native-dogfood",
      "cloudflare-worker-sync",
      "browser-extension-shopping-sync",
      "no-code-connector",
      "public-data-export",
    ]);
    const nativeDogfoodScenario = document["x-client-scenarios"].find((scenario: { id: string }) => (
      scenario.id === "spoonjoy-apple-native-dogfood"
    ));
    expect(nativeDogfoodScenario.sample).toContain("POST /api/v1/auth/password/native");
    expect(nativeDogfoodScenario.sample).toContain("GET /api/v1/me/sync?limit=50");
    expect(nativeDogfoodScenario.sample).not.toContain("POST /oauth/register");
    expect(nativeDogfoodScenario.sample).not.toContain("/api/v1/shopping-list/sync");
  });

  it("declares paths, auth, scopes, parameters, examples, and error responses for every resource", () => {
    const document = buildApiV1OpenApiDocument();

    for (const resource of API_V1_RESOURCES) {
      for (const method of resource.methods) {
        const op = operation(document, resource.path, method);
        expect(op.operationId).toMatch(new RegExp(`^${method.toLowerCase()}ApiV1`));
        expect(op.tags).toEqual(expect.any(Array));
        expect(op["x-auth"]).toBe(resource.auth);
        expect(op["x-scopes"]).toEqual(OPERATION_SCOPES[`${method} ${resource.path}`]);
        expect(op.responses["405"].content["application/json"].schema.$ref).toBe("#/components/schemas/ErrorEnvelope");
        expect(op.responses["405"].content["application/json"].examples.method_not_allowed.value.error.code).toBe("method_not_allowed");
        expect(op.responses["429"].content["application/json"].schema.$ref).toBe("#/components/schemas/ErrorEnvelope");
        expect(op.responses["500"].content["application/json"].schema.$ref).toBe("#/components/schemas/ErrorEnvelope");
        expect(Object.values(op.responses)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              description: expect.any(String),
              content: expect.objectContaining({
                "application/json": expect.objectContaining({
                  examples: expect.any(Object),
                }),
              }),
            }),
          ]),
        );

        const operationScopes = OPERATION_SCOPES[`${method} ${resource.path}`];
        const oauthScopes = operationScopes.filter((scope) => !scope.startsWith("tokens:"));

        const acceptedOauthScopes = op["x-accepted-oauth-scopes"] ?? [];
        if (resource.path === "/api/v1/search") {
          expect(op.security).toEqual([
            {},
            { bearerAuth: [] },
            { cookieAuth: [] },
            { oauth2: ["shopping_list:read"] },
            { oauth2: ["kitchen:read"] },
          ]);
          expect(op["x-credential-modes"]).toEqual(["anonymous", "session", "bearer", "oauth_pkce"]);
        } else if (resource.auth === "bearer") {
          expect(op.security).toEqual(dedupeSecurity([
            { bearerAuth: [] },
            { cookieAuth: [] },
            ...(oauthScopes.length > 0 ? [{ oauth2: oauthScopes }] : []),
            ...acceptedOauthScopes.map((scopeSet: string[]) => ({ oauth2: scopeSet })),
          ]));
        } else if (operationScopes.length > 0) {
          expect(op.security).toEqual(dedupeSecurity([
            {},
            { bearerAuth: [] },
            { cookieAuth: [] },
            { oauth2: oauthScopes },
            ...acceptedOauthScopes.map((scopeSet: string[]) => ({ oauth2: scopeSet })),
            ...(oauthScopes.some((scope) => scope === "recipes:read" || scope === "cookbooks:read") ? [{ oauth2: ["public:read"] }] : []),
          ]));
        } else {
          expect(op.security).toEqual([{}]);
        }
        if (resource.path === "/api/v1/search") {
          expect(op["x-credential-modes"]).toContain("oauth_pkce");
        } else if (oauthScopes.length > 0) {
          expect(op["x-credential-modes"]).toContain("oauth_pkce");
        } else {
          expect(op["x-credential-modes"]).not.toContain("oauth_pkce");
        }
        expect(op["x-retry-policy"]).toEqual(expect.any(Object));
      }
    }

    expect(operation(document, "/api/v1/recipes", "GET").parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "query", in: "query", required: false }),
      expect.objectContaining({ name: "q", in: "query", required: false }),
      expect.objectContaining({
        name: "limit",
        in: "query",
        schema: { type: "integer", minimum: 1, maximum: 50, default: 20 },
      }),
    ]));
    expect(operation(document, "/api/v1/search", "GET")).toMatchObject({
      operationId: "getApiV1Search",
      tags: ["Search"],
      "x-auth": "optional",
      "x-scopes": [],
      "x-private-result-scope": {
        scope: "shopping-list",
        requiredScope: "shopping_list:read",
        acceptedLegacyScope: "kitchen:read",
      },
    });
    expect(operation(document, "/api/v1/search", "GET").parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "query", in: "query", required: false }),
      expect.objectContaining({ name: "q", in: "query", required: false }),
      expect.objectContaining({
        name: "scope",
        in: "query",
        schema: { type: "string", enum: ["all", "recipes", "cookbooks", "chefs", "shopping-list"], default: "all" },
      }),
      expect.objectContaining({
        name: "limit",
        in: "query",
        schema: { type: "integer", minimum: 1, maximum: 50, default: 20 },
      }),
    ]));
    expect(operation(document, "/api/v1/recipes/{id}", "GET").parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "id", in: "path", required: true, schema: { type: "string", minLength: 1 } }),
      expect.objectContaining({ name: "X-Request-Id", in: "header", required: false }),
    ]));
    expect(operation(document, "/api/v1/recipes/import", "POST")).toMatchObject({
      operationId: "postApiV1RecipeImport",
      tags: ["Recipes"],
      "x-auth": "bearer",
      "x-scopes": ["kitchen:write"],
      "x-idempotency": expect.objectContaining({
        key: "clientMutationId",
        location: "jsonBody",
        replayStatus: [200, 201],
      }),
      requestBody: {
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/RecipeImportRequest" },
          },
        },
      },
    });
    expect(operation(document, "/api/v1/recipes/{id}/spoons", "GET")).toMatchObject({
      operationId: "getApiV1RecipeSpoons",
      tags: ["Recipe Spoons"],
      "x-auth": "optional",
      "x-scopes": ["recipes:read"],
    });
    expect(operation(document, "/api/v1/recipes/{id}/spoons", "GET").parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "id", in: "path", required: true, schema: { type: "string", minLength: 1 } }),
      expect.objectContaining({ name: "cursor", in: "query", required: false, schema: { type: "string" } }),
      expect.objectContaining({ name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50, default: 20 } }),
    ]));
    expect(operation(document, "/api/v1/recipes/{id}/spoons", "POST")).toMatchObject({
      operationId: "postApiV1RecipeSpoons",
      tags: ["Recipe Spoons"],
      "x-auth": "bearer",
      "x-scopes": ["kitchen:write"],
      "x-idempotency": expect.objectContaining({
        key: "clientMutationId",
        location: "jsonBody",
        replayStatus: [201],
      }),
    });
    expect(operation(document, "/api/v1/recipes/{id}/spoons/{spoonId}", "PATCH")).toMatchObject({
      operationId: "patchApiV1RecipeSpoon",
      "x-idempotency": expect.objectContaining({ replayStatus: [200] }),
    });
    expect(operation(document, "/api/v1/recipes/{id}/spoons/{spoonId}", "DELETE")).toMatchObject({
      operationId: "deleteApiV1RecipeSpoon",
      "x-idempotency": expect.objectContaining({
        location: "jsonBody, query, or X-Client-Mutation-Id",
        replayStatus: [200],
      }),
      requestBody: {
        required: false,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/DeleteRecipeSpoonRequest" },
          },
        },
      },
    });
    expect(operation(document, "/api/v1/recipes/{id}/spoons/{spoonId}", "DELETE").parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "X-Client-Mutation-Id", in: "header", required: false }),
      expect.objectContaining({ name: "clientMutationId", in: "query", required: false }),
      expect.objectContaining({ name: "X-Request-Id", in: "header", required: false }),
    ]));
    expect(operation(document, "/api/v1/shopping-list/sync", "GET").parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "cursor", in: "query", required: false, schema: { type: "string" } }),
      expect.objectContaining({
        name: "limit",
        in: "query",
        schema: { type: "integer", minimum: 1, maximum: 50, default: 20 },
      }),
      expect.objectContaining({ name: "X-Request-Id", in: "header", required: false }),
    ]));
    expect(operation(document, "/api/v1/shopping-list/items/{itemId}", "PATCH").parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "itemId", in: "path", required: true, schema: { type: "string", minLength: 1 } }),
      expect.objectContaining({ name: "X-Request-Id", in: "header", required: false }),
    ]));
  });

  it("documents raw OpenAPI, method-level token scopes, health principal source, and concrete examples", () => {
    const document = buildApiV1OpenApiDocument();

    expect(operation(document, "/api/v1/openapi.json", "GET").responses["200"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/OpenApiDocument");
    expect(operation(document, "/api/v1/openapi.connector.json", "GET").responses["200"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/ConnectorOpenApiDocument");
    expect(responseExample(document, "/api/v1/openapi.json", "GET", "200")).toMatchObject({
      openapi: "3.1.0",
      info: { title: "Spoonjoy API", version: "v1" },
    });
    expect(responseExample(document, "/api/v1/openapi.json", "GET", "200").ok).toBeUndefined();

    expect(operation(document, "/api/v1/tokens", "GET")["x-scopes"]).toEqual(["tokens:read"]);
    expect(operation(document, "/api/v1/tokens", "POST")["x-scopes"]).toEqual(["tokens:write"]);
    expect(operation(document, "/api/v1/tokens", "GET").security).toEqual([{ bearerAuth: [] }, { cookieAuth: [] }]);
    expect(operation(document, "/api/v1/tokens", "POST").security).toEqual([{ bearerAuth: [] }, { cookieAuth: [] }]);

    expect(document.components.schemas.HealthData.properties.principal.oneOf).toEqual([
      { $ref: "#/components/schemas/ApiPrincipalSummary" },
      { type: "null" },
    ]);
    expect(document.components.schemas.ApiPrincipalSummary).toMatchObject({
      required: ["id", "username", "source"],
      properties: {
        source: { type: "string", enum: ["session", "bearer", "environment"] },
      },
    });

    expect(responseExample(document, "/api/v1/recipes", "GET", "200").data).toMatchObject({
      query: "pasta",
      limit: 20,
      recipes: [expect.objectContaining({
        title: "Pasta",
        coverProvenanceLabel: "Chef photo",
        coverSourceType: "chef-upload",
        coverVariant: "image",
      })],
    });
    expect(responseExample(document, "/api/v1/search", "GET", "200").data).toMatchObject({
      query: "pasta",
      scope: "all",
      limit: 20,
      isAuthenticated: true,
      results: [
        expect.objectContaining({
          type: "recipe",
          canonicalUrl: "https://spoonjoy.app/recipes/recipe_1",
          metadata: expect.objectContaining({ coverProvenanceLabel: "Chef photo" }),
        }),
        expect.objectContaining({
          type: "shopping-list-item",
          canonicalUrl: "https://spoonjoy.app/shopping-list",
          metadata: expect.objectContaining({ checked: false }),
        }),
      ],
    });
    expect(responseExample(document, "/api/v1/recipes/{id}", "GET", "200").data.recipe).toMatchObject({
      coverProvenanceLabel: "Chef photo",
      coverSourceType: "chef-upload",
      coverVariant: "image",
    });
    expect(responseExample(document, "/api/v1/recipes/{id}/spoons", "GET", "200").data).toMatchObject({
      limit: 20,
      cursor: null,
      nextCursor: expect.stringMatching(/^v1\./),
      hasMore: false,
      spoons: [expect.objectContaining({
        id: "spoon_1",
        recipeId: "recipe_1",
        photoUrl: "https://spoonjoy.app/photos/spoons/chef_1/uploads/cover-raw.jpg",
      })],
    });
    const createSpoonData = responseExample(document, "/api/v1/recipes/{id}/spoons", "POST", "201").data;
    expect(createSpoonData).toMatchObject({
      spoon: expect.objectContaining({ id: "spoon_1" }),
      isOriginCook: true,
      mutation: { clientMutationId: "device-uuid-spoon-create", replayed: false },
    });
    expect(createSpoonData).not.toHaveProperty("removed");
    expect(responseExample(document, "/api/v1/recipes/{id}/spoons/{spoonId}", "PATCH", "200").data).toMatchObject({
      spoon: expect.objectContaining({ id: "spoon_1" }),
      mutation: { clientMutationId: "device-uuid-spoon-update", replayed: false },
    });
    expect(responseExample(document, "/api/v1/recipes/{id}/spoons/{spoonId}", "DELETE", "200").data).toMatchObject({
      removed: true,
      mutation: { clientMutationId: "device-uuid-spoon-delete", replayed: false },
    });
    expect(responseExample(document, "/api/v1/cookbooks/{id}", "GET", "200").data.cookbook.recipes[0]).toMatchObject({
      coverProvenanceLabel: "Chef photo",
      coverSourceType: "chef-upload",
      coverVariant: "image",
    });
    expect(responseExample(document, "/api/v1/cookbooks", "POST", "201").data).toMatchObject({
      created: true,
      cookbook: {
        recipeCount: 0,
        coverImageUrls: [],
        recipes: [],
      },
      mutation: { clientMutationId: "device-uuid-cookbook-create", replayed: false },
    });
    expect(responseExample(document, "/api/v1/cookbooks/{id}/recipes/{recipeId}", "POST", "201").data).toMatchObject({
      added: true,
      recipeId: "recipe_1",
      cookbook: { recipeCount: 1 },
      mutation: { clientMutationId: "device-uuid-cookbook-recipe", replayed: false },
    });
    const removeCookbookRecipe = responseExample(document, "/api/v1/cookbooks/{id}/recipes/{recipeId}", "DELETE", "200").data;
    expect(removeCookbookRecipe).toMatchObject({
      removed: true,
      recipeId: "recipe_1",
      cookbook: { recipeCount: 0, recipes: [] },
      mutation: { clientMutationId: "device-uuid-cookbook-recipe-remove", replayed: false },
    });
    expect(removeCookbookRecipe).not.toHaveProperty("added");
    expect(responseExample(document, "/api/v1/me", "GET", "200").data).toMatchObject({
      email: "ari@spoonjoy.app",
      username: "ari",
      oauthAccounts: [expect.objectContaining({ provider: "google" })],
      passkeys: [expect.objectContaining({ name: "Kitchen Mac" })],
    });
    expect(responseExample(document, "/api/v1/me/notification-preferences", "GET", "200").data)
      .toMatchObject({ notifySpoonOnMyRecipe: true, notifyFellowChefOriginCook: true });
	    expect(responseExample(document, "/api/v1/me/apns-devices", "POST", "201").data).toMatchObject({
	      created: true,
	      device: {
	        deviceId: "ios-simulator-1",
	        environment: "development",
	        tokenPrefix: "apns-token-",
	      },
	      mutation: { clientMutationId: "device-uuid-apns-register", replayed: false },
	    });
	    expect(responseExample(document, "/api/v1/me/apns-devices/{deviceId}", "DELETE", "200").data)
	      .toMatchObject({
	        revoked: true,
	        revokedCount: 1,
	        devices: [expect.objectContaining({ deviceId: "ios-simulator-1" })],
	        mutation: { clientMutationId: "device-uuid-apns-revoke", replayed: false },
	      });
    expect(responseExample(document, "/api/v1/me/connections", "GET", "200").data.connections[0])
      .toMatchObject({ id: expect.stringMatching(/^conn_/), clientName: "Meal planner" });
    expect(responseExample(document, "/api/v1/me/connections/{connectionId}", "DELETE", "200").data)
      .toMatchObject({ disconnected: true, revokedRefreshTokens: 1, revokedAccessTokens: 1 });
    expect(responseExample(document, "/api/v1/tokens", "GET", "200").data.tokens[0].scopes).toEqual(["recipes:read", "shopping_list:read", "shopping_list:write"]);
    expect(responseExample(document, "/api/v1/shopping-list/items", "POST", "201").data).toMatchObject({
      created: true,
      updated: false,
      mutation: { clientMutationId: "device-uuid-1", replayed: false },
    });
    expect(responseExample(document, "/api/v1/shopping-list/add-from-recipe", "POST", "200").data).toMatchObject({
      recipe: { id: "recipe_1", title: "Pasta" },
      created: 1,
      updated: 0,
      mutation: { clientMutationId: "device-uuid-4", replayed: false },
    });
    expect(responseExample(document, "/api/v1/shopping-list/clear-all", "POST", "200").data).toMatchObject({
      removed: 1,
      mutation: { clientMutationId: "device-uuid-clear-all", replayed: false },
    });
    expect(errorExample(document, "/api/v1/health", "GET", "401", "invalid_token").error.code).toBe("invalid_token");
    expect(errorExample(document, "/api/v1/shopping-list", "GET", "401", "authentication_required").error.code).toBe("authentication_required");
    expect(errorExample(document, "/api/v1/shopping-list/items", "POST", "409", "idempotency_conflict").error.code).toBe("idempotency_conflict");
    expect(errorExample(document, "/api/v1/tokens", "POST", "400", "validation_error").error.code).toBe("validation_error");

    expect(operation(document, "/api/v1/tokens", "POST").requestBody.content["application/json"].examples.example.value)
      .toEqual({ name: "Tiny client", scopes: ["recipes:read", "shopping_list:read", "shopping_list:write"] });
    expect(operation(document, "/api/v1/me/photo", "POST").requestBody.content["multipart/form-data"].schema.$ref)
      .toBe("#/components/schemas/ProfilePhotoUploadRequest");
	    expect(operation(document, "/api/v1/me/apns-devices", "POST").requestBody.content["application/json"].examples.example.value)
	      .toMatchObject({
	        clientMutationId: "device-uuid-apns-register",
	        deviceId: "ios-simulator-1",
	        environment: "development",
	      });
    expect(operation(document, "/api/v1/me/apns-devices/{deviceId}", "DELETE").parameters)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "deviceId", in: "path", required: true }),
        expect.objectContaining({ name: "X-Request-Id", in: "header", required: false }),
      ]));
    expect(operation(document, "/oauth/revoke", "POST").requestBody.content["application/x-www-form-urlencoded"].examples.refresh_token.value)
      .toMatchObject({ token: "ort_...", client_id: "cm_client_id_from_register" });
    expect(operation(document, "/api/v1/shopping-list/items", "POST").requestBody.content["application/json"].examples.example.value)
      .toEqual({
        clientMutationId: "device-uuid-1",
        name: "Eggs",
        quantity: 12,
        unit: "Each",
        categoryKey: null,
        iconKey: null,
      });
    expect(operation(document, "/api/v1/shopping-list/add-from-recipe", "POST").requestBody.content["application/json"].examples.example.value)
      .toEqual({ clientMutationId: "device-uuid-4", recipeId: "recipe_1", scaleFactor: 1 });
    expect(operation(document, "/api/v1/shopping-list/clear-completed", "POST").requestBody.content["application/json"].examples.example.value)
      .toEqual({ clientMutationId: "device-uuid-clear-completed" });
    expect(operation(document, "/api/v1/shopping-list/clear-all", "POST").requestBody.content["application/json"].examples.example.value)
      .toEqual({ clientMutationId: "device-uuid-clear-all" });
    expect(operation(document, "/api/v1/shopping-list/clear-completed", "POST").requestBody.content["application/json"].examples.example.value)
      .not.toEqual(operation(document, "/api/v1/shopping-list/clear-all", "POST").requestBody.content["application/json"].examples.example.value);
    expect(operation(document, "/api/v1/cookbooks/{id}/recipes/{recipeId}", "POST").responses["201"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/CookbookRecipeMutationEnvelope");
    expect(operation(document, "/api/v1/cookbooks/{id}/recipes/{recipeId}", "DELETE").responses["200"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/CookbookRecipeRemoveEnvelope");

    const authorizeParams = operation(document, "/oauth/authorize", "GET").parameters;
    expect(authorizeParams).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "redirect_uri",
        schema: expect.objectContaining({
          description: expect.stringContaining("HTTPS"),
        }),
      }),
      expect.objectContaining({
        name: "scope",
        "x-recommended-scope": "shopping_list:read shopping_list:write",
        schema: expect.not.objectContaining({ default: expect.anything() }),
      }),
      expect.objectContaining({
        name: "state",
        schema: expect.not.objectContaining({ default: expect.anything() }),
      }),
    ]));
    expect(document.components.schemas.OAuthRegisterRequest.properties.redirect_uris.items.description)
      .toContain("custom schemes");
  });

  it("uses response examples whose status and envelope shape match each response", () => {
    const document = buildApiV1OpenApiDocument();

    for (const path of Object.keys(document.paths)) {
      for (const method of Object.keys(document.paths[path])) {
        const op = document.paths[path][method];

        for (const [statusKey, response] of Object.entries(op.responses) as Array<[string, any]>) {
          if (!response.content?.["application/json"]) continue;
          const status = Number(statusKey);
          const schemaRef = response.content["application/json"].schema.$ref;

          for (const example of Object.values(response.content["application/json"].examples) as any[]) {
            const value = example.value;

            if (status >= 200 && status < 300) {
              if (schemaRef === "#/components/schemas/OpenApiDocument" || schemaRef === "#/components/schemas/SdkOpenApiDocument" || schemaRef === "#/components/schemas/ConnectorOpenApiDocument") {
                expect(value).toMatchObject({ openapi: expect.stringMatching(/^3\./), info: expect.any(Object), paths: expect.any(Object) });
                expect(value.ok).toBeUndefined();
              } else if (path.startsWith("/api/v1")) {
                expect(value).toMatchObject({ ok: true, requestId: "req_example" });
                expect(value.data).not.toEqual({});
              } else if (path.startsWith("/api/tools/")) {
                expect(value).toMatchObject({ ok: true, data: expect.any(Object) });
              } else if (path === "/mcp") {
                expect(value).toMatchObject({ jsonrpc: "2.0" });
              } else {
                expect(value).toEqual(expect.any(Object));
              }
              continue;
            }

            if (path.startsWith("/api/v1")) {
              expect(value).toMatchObject({ ok: false, requestId: "req_example" });
              expect(API_V1_ERROR_STATUS[value.error.code as keyof typeof API_V1_ERROR_STATUS]).toBe(status);
              expect(value.error.status).toBe(status);
            } else if (path.startsWith("/api/tools/")) {
              if (value.error === "rate_limited") {
                expect(value).toMatchObject({ error: "rate_limited", retryAfterSeconds: expect.any(Number) });
              } else {
                expect(value).toMatchObject({ ok: false, error: { status } });
              }
            } else {
              expect(value).toEqual(expect.any(Object));
            }
          }
        }
      }
    }
  });

  it("keeps idempotent request and response examples on the same client mutation id", () => {
    const document = buildApiV1OpenApiDocument();

    for (const resource of API_V1_RESOURCES) {
      for (const method of resource.methods) {
        const op = operation(document, resource.path, method);
        const requestClientMutationId = requestExample(document, resource.path, method)?.clientMutationId;
        if (!op["x-idempotency"] || typeof requestClientMutationId !== "string") continue;

        for (const status of op["x-idempotency"].replayStatus) {
          const responseClientMutationId = responseExample(document, resource.path, method, String(status))
            .data
            ?.mutation
            ?.clientMutationId;
          if (typeof responseClientMutationId !== "string") continue;

          expect(responseClientMutationId, `${method} ${resource.path} ${status}`).toBe(requestClientMutationId);
        }
      }
    }
  });

  it("declares exact request and response schemas for tokens and shopping-list mutations", () => {
    const document = buildApiV1OpenApiDocument();

    expect(operation(document, "/api/v1/tokens", "POST").requestBody.content["application/json"].schema.$ref)
      .toBe("#/components/schemas/CreateTokenRequest");
    expect(operation(document, "/api/v1/shopping-list/items", "POST").requestBody.content["application/json"].schema.$ref)
      .toBe("#/components/schemas/CreateShoppingItemRequest");
    expect(operation(document, "/api/v1/shopping-list/items/{itemId}", "PATCH").requestBody.content["application/json"].schema.$ref)
      .toBe("#/components/schemas/CheckShoppingItemRequest");
    expect(operation(document, "/api/v1/shopping-list/add-from-recipe", "POST").requestBody.content["application/json"].schema.$ref)
      .toBe("#/components/schemas/AddRecipeIngredientsToShoppingListRequest");
    expect(operation(document, "/api/v1/shopping-list/clear-all", "POST").requestBody.content["application/json"].schema.$ref)
      .toBe("#/components/schemas/ClearShoppingListRequest");
    expectFlexibleDeleteContract(document, "/api/v1/shopping-list/items/{itemId}", "DeleteShoppingItemRequest");
    expect(operation(document, "/api/v1/shopping-list/items/{itemId}", "DELETE").parameters)
      .toEqual(expect.arrayContaining([expect.objectContaining({ name: "itemId", in: "path", required: true })]));
    expectFlexibleDeleteContract(document, "/api/v1/cookbooks/{id}", "DeleteCookbookRequest");
    expectFlexibleDeleteContract(document, "/api/v1/cookbooks/{id}/recipes/{recipeId}", "CookbookRecipeMutationRequest");
    expect(operation(document, "/api/v1/shopping-list/sync", "GET")["x-cursor-policy"]).toMatchObject({
      cursor: "opaque",
      tombstones: expect.any(String),
    });
    expect(operation(document, "/api/v1/shopping-list/items", "POST")["x-idempotency"]).toMatchObject({
      key: "clientMutationId",
      retentionHours: 24,
      inProgressRetryAfterSeconds: 2,
      retryBodyRule: expect.stringContaining("canonicalizes object key order"),
    });
    expect(operation(document, "/api/v1/shopping-list/items/{itemId}", "DELETE")["x-idempotency"]).toMatchObject({
      key: "clientMutationId",
      location: "jsonBody, query, or X-Client-Mutation-Id",
      replayStatus: [200],
      retryBodyRule: expect.stringContaining("JSON body, query string, or X-Client-Mutation-Id header"),
    });
    expect(operation(document, "/api/v1/shopping-list/add-from-recipe", "POST")["x-idempotency"]).toMatchObject({
      key: "clientMutationId",
      retentionHours: 24,
      replayStatus: [200],
      retryBodyRule: expect.stringContaining("canonicalizes object key order"),
    });
    expect(operation(document, "/api/v1/shopping-list/clear-completed", "POST")["x-idempotency"]).toMatchObject({
      key: "clientMutationId",
      retentionHours: 24,
      replayStatus: [200],
    });
    expect(operation(document, "/api/v1/tokens", "POST")["x-personal-token-only"]).toBe(true);

    expect(operation(document, "/api/v1/shopping-list/items", "POST").responses).toMatchObject({
      200: { content: { "application/json": { schema: { $ref: "#/components/schemas/CreateShoppingItemEnvelope" } } } },
      201: { content: { "application/json": { schema: { $ref: "#/components/schemas/CreateShoppingItemEnvelope" } } } },
      409: {
        headers: { "Retry-After": expect.any(Object) },
        content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } } },
      },
    });
    expect(operation(document, "/api/v1/shopping-list/items/{itemId}", "PATCH").responses["404"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/ErrorEnvelope");
    expect(operation(document, "/api/v1/shopping-list/items/{itemId}", "DELETE").responses["404"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/ErrorEnvelope");
    expect(operation(document, "/api/v1/shopping-list/add-from-recipe", "POST").responses["404"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/ErrorEnvelope");
  });

  it("declares exact request and response schemas for recipe step mutations", () => {
    const document = buildApiV1OpenApiDocument();

    expect(operation(document, "/api/v1/recipes/{id}/steps", "POST").requestBody.content["application/json"].schema.$ref)
      .toBe("#/components/schemas/CreateRecipeStepRequest");
    expect(operation(document, "/api/v1/recipes/{id}/steps", "POST").responses["201"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/CreateRecipeStepEnvelope");
    expect(operation(document, "/api/v1/recipes/{id}/steps/{stepId}", "PATCH").requestBody.content["application/json"].schema.$ref)
      .toBe("#/components/schemas/UpdateRecipeStepRequest");
    expect(operation(document, "/api/v1/recipes/{id}/steps/{stepId}", "PATCH").responses["200"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/UpdateRecipeStepEnvelope");
    expect(operation(document, "/api/v1/recipes/{id}/steps/{stepId}", "DELETE").requestBody.content["application/json"].schema.$ref)
      .toBe("#/components/schemas/DeleteRecipeStepRequest");
    expectFlexibleDeleteContract(document, "/api/v1/recipes/{id}/steps/{stepId}", "DeleteRecipeStepRequest");
    expect(operation(document, "/api/v1/recipes/{id}/steps/{stepId}", "DELETE").responses["200"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/DeleteRecipeStepEnvelope");
    expect(operation(document, "/api/v1/recipes/{id}/steps/reorder", "POST").requestBody.content["application/json"].schema.$ref)
      .toBe("#/components/schemas/ReorderRecipeStepRequest");
    expect(operation(document, "/api/v1/recipes/{id}/steps/{stepId}/ingredients", "POST").requestBody.content["application/json"].schema.$ref)
      .toBe("#/components/schemas/CreateRecipeStepIngredientRequest");
    expect(operation(document, "/api/v1/recipes/{id}/steps/{stepId}/ingredients/{ingredientId}", "DELETE").requestBody.content["application/json"].schema.$ref)
      .toBe("#/components/schemas/DeleteRecipeStepIngredientRequest");
    expectFlexibleDeleteContract(document, "/api/v1/recipes/{id}/steps/{stepId}/ingredients/{ingredientId}", "DeleteRecipeStepIngredientRequest");
    expect(operation(document, "/api/v1/recipes/{id}/step-output-uses", "PUT").requestBody.content["application/json"].schema.$ref)
      .toBe("#/components/schemas/ReplaceRecipeStepOutputUsesRequest");
    expect(operation(document, "/api/v1/recipes/{id}/step-output-uses", "PUT").responses["200"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/ReplaceRecipeStepOutputUsesEnvelope");

    expect(document.components.schemas.RecipeStep.required).toEqual([
      "id",
      "stepNum",
      "stepTitle",
      "description",
      "duration",
      "ingredients",
      "usingSteps",
    ]);
    expect(document.components.schemas.RecipeStep.properties.usingSteps.items.$ref)
      .toBe("#/components/schemas/RecipeStepOutputUse");
    expect(operation(document, "/api/v1/recipes/{id}/steps", "POST")["x-idempotency"]).toMatchObject({
      key: "clientMutationId",
      location: "jsonBody",
      replayStatus: [201],
    });
    expect(operation(document, "/api/v1/recipes/{id}/steps/{stepId}", "DELETE")["x-idempotency"]).toMatchObject({
      key: "clientMutationId",
      location: "jsonBody, query, or X-Client-Mutation-Id",
      replayStatus: [200],
    });
    expect(operation(document, "/api/v1/recipes/{id}/steps/{stepId}/ingredients/{ingredientId}", "DELETE")["x-idempotency"]).toMatchObject({
      key: "clientMutationId",
      location: "jsonBody, query, or X-Client-Mutation-Id",
      replayStatus: [200],
    });
    expect(responseExample(document, "/api/v1/recipes/{id}/steps", "POST", "201").data.step).toMatchObject({
      id: "step_2",
      usingSteps: [expect.objectContaining({ outputStepNum: 1 })],
    });
  });

  it("declares exact request and response schemas for native account endpoints", () => {
    const document = buildApiV1OpenApiDocument();

    expect(operation(document, "/api/v1/me", "GET").responses["200"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/AccountProfileEnvelope");
    expect(operation(document, "/api/v1/me", "PATCH").requestBody.content["application/json"].schema.$ref)
      .toBe("#/components/schemas/UpdateAccountProfileRequest");
	    expect(operation(document, "/api/v1/me", "PATCH").responses["200"].content["application/json"].schema.$ref)
	      .toBe("#/components/schemas/AccountProfileMutationEnvelope");
	    expect(operation(document, "/api/v1/me", "PATCH")).toMatchObject({
	      "x-idempotency": expect.objectContaining({
	        key: "clientMutationId",
	        location: "jsonBody",
	        replayStatus: [200],
	      }),
	    });
    expect(responseExample(document, "/api/v1/me", "GET", "200").data).toMatchObject({
      email: "ari@spoonjoy.app",
      username: "ari",
      oauthAccounts: [expect.objectContaining({ provider: "google" })],
      passkeys: [expect.objectContaining({ name: "Kitchen Mac" })],
    });

    expect(operation(document, "/api/v1/me/photo", "POST").requestBody.content["multipart/form-data"].schema.$ref)
      .toBe("#/components/schemas/ProfilePhotoUploadRequest");
    expect(operation(document, "/api/v1/me/photo", "POST").requestBody.content["application/json"]).toBeUndefined();
	    expect(operation(document, "/api/v1/me/photo", "POST").responses["200"].content["application/json"].schema.$ref)
	      .toBe("#/components/schemas/AccountProfileMutationEnvelope");
	    expect(operation(document, "/api/v1/me/photo", "POST")).toMatchObject({
	      "x-idempotency": expect.objectContaining({
	        key: "clientMutationId",
	        location: "multipartFormData",
	        replayStatus: [200],
	      }),
	    });
	    expect(operation(document, "/api/v1/me/photo", "DELETE").responses["200"].content["application/json"].schema.$ref)
	      .toBe("#/components/schemas/AccountProfileMutationEnvelope");
	    expectFlexibleDeleteContract(document, "/api/v1/me/photo", "AccountDeleteMutationRequest");

	    expect(operation(document, "/api/v1/me/notification-preferences", "GET").responses["200"].content["application/json"].schema.$ref)
	      .toBe("#/components/schemas/NotificationPreferencesEnvelope");
    expect(operation(document, "/api/v1/me/notification-preferences", "PATCH").requestBody.content["application/json"].schema.$ref)
      .toBe("#/components/schemas/UpdateNotificationPreferencesRequest");
	    expect(operation(document, "/api/v1/me/notification-preferences", "PATCH").responses["200"].content["application/json"].schema.$ref)
	      .toBe("#/components/schemas/NotificationPreferencesMutationEnvelope");
	    expect(operation(document, "/api/v1/me/notification-preferences", "PATCH")).toMatchObject({
	      "x-idempotency": expect.objectContaining({
	        key: "clientMutationId",
	        location: "jsonBody",
	        replayStatus: [200],
	      }),
	    });

	    expect(operation(document, "/api/v1/me/apns-devices", "POST").requestBody.content["application/json"].schema.$ref)
	      .toBe("#/components/schemas/ApnsDeviceRegistrationRequest");
    expect(operation(document, "/api/v1/me/apns-devices", "POST").responses["200"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/ApnsDeviceRegistrationEnvelope");
	    expect(operation(document, "/api/v1/me/apns-devices", "POST").responses["201"].content["application/json"].schema.$ref)
	      .toBe("#/components/schemas/ApnsDeviceRegistrationEnvelope");
	    expect(operation(document, "/api/v1/me/apns-devices", "POST")).toMatchObject({
	      "x-idempotency": expect.objectContaining({
	        key: "clientMutationId",
	        location: "jsonBody",
	        replayStatus: [200, 201],
	      }),
	    });
	    expect(responseExample(document, "/api/v1/me/apns-devices", "POST", "201").data.device)
	      .not.toEqual(expect.objectContaining({ token: expect.anything(), tokenHash: expect.anything() }));
	    expect(operation(document, "/api/v1/me/apns-devices/{deviceId}", "DELETE").responses["200"].content["application/json"].schema.$ref)
	      .toBe("#/components/schemas/ApnsDeviceRevokeEnvelope");
	    expectFlexibleDeleteContract(document, "/api/v1/me/apns-devices/{deviceId}", "AccountDeleteMutationRequest");
	    expect(operation(document, "/api/v1/me/apns-devices/{deviceId}", "DELETE").parameters.map((parameter: { name: string }) => parameter.name))
	      .toEqual(expect.arrayContaining(["deviceId", "X-Request-Id", "X-Client-Mutation-Id", "clientMutationId"]));

    expect(operation(document, "/api/v1/me/connections", "GET").responses["200"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/OAuthConnectionListEnvelope");
    expect(operation(document, "/api/v1/me/connections/{connectionId}", "DELETE").responses["200"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/DisconnectOAuthConnectionEnvelope");
    expect(operation(document, "/api/v1/me/connections/{connectionId}", "DELETE").parameters.map((parameter: { name: string }) => parameter.name))
      .not.toContain("X-Client-Mutation-Id");
  });

  it("defines reusable schemas with strict objects, nullable fields, and error enums", () => {
    const { components } = buildApiV1OpenApiDocument();

    for (const [name, schema] of Object.entries(components.schemas) as Array<[string, any]>) {
      if (schema.type === "object" && name !== "ErrorDetails" && name !== "OpenApiDocument" && name !== "SdkOpenApiDocument" && name !== "ConnectorOpenApiDocument") {
        expect(schema.additionalProperties).toBe(false);
      }
    }

    expect(components.schemas.ErrorDetails.additionalProperties).toBe(true);
    expect(components.schemas.ErrorObject.properties.code.enum.sort()).toEqual(Object.keys(API_V1_ERROR_STATUS).sort());
    expect(components.schemas.ErrorEnvelope).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["ok", "requestId", "error"],
      properties: { ok: { const: false } },
    });
    expect(components.schemas.SuccessEnvelope).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["ok", "requestId", "data"],
      properties: { ok: { const: true } },
    });
    expect(components.schemas.RecipeSummary.required).toEqual([
      "id",
      "title",
      "description",
      "servings",
      "chef",
      "coverImageUrl",
      "coverProvenanceLabel",
      "coverSourceType",
      "coverVariant",
      "href",
      "canonicalUrl",
      "attribution",
      "createdAt",
      "updatedAt",
    ]);
    expect(components.schemas.RecipeSummary.properties).toMatchObject({
      coverProvenanceLabel: { type: ["string", "null"] },
      coverSourceType: { type: ["string", "null"], enum: ["ai-placeholder", "chef-upload", "import", "spoon", null] },
      coverVariant: { type: ["string", "null"], enum: ["image", "stylized", null] },
    });
    expect(components.schemas.RecipeDetail.required).toEqual([
      "id",
      "title",
      "description",
      "servings",
      "chef",
      "coverImageUrl",
      "coverProvenanceLabel",
      "coverSourceType",
      "coverVariant",
      "href",
      "canonicalUrl",
      "attribution",
      "createdAt",
      "updatedAt",
      "steps",
      "cookbooks",
    ]);
    expect(components.schemas.ShoppingItem.required).toEqual([
      "id",
      "name",
      "quantity",
      "unit",
      "checked",
      "checkedAt",
      "deletedAt",
      "categoryKey",
      "iconKey",
      "sortIndex",
      "updatedAt",
    ]);
    expect(components.schemas.ShoppingItem.properties.quantity.type).toEqual(["number", "null"]);
    expect(components.schemas.ShoppingItem.properties.unit.type).toEqual(["string", "null"]);
    expect(components.schemas.CredentialMetadata.properties.revokedAt.type).toEqual(["string", "null"]);
    expect(components.schemas.CreateShoppingItemRequest).toMatchObject({
      additionalProperties: false,
      required: ["clientMutationId", "name"],
      properties: {
        clientMutationId: { type: "string", minLength: 1, maxLength: 160 },
        name: { type: "string", minLength: 1, maxLength: 160 },
        quantity: { type: "number", exclusiveMinimum: 0 },
        categoryKey: { type: ["string", "null"] },
      },
    });
	    expect(components.schemas.CreateTokenRequest.properties.name).toEqual({ type: "string", minLength: 1, maxLength: 160 });
	    expect(components.schemas.UpdateAccountProfileRequest).toMatchObject({
	      additionalProperties: false,
	      required: ["clientMutationId", "email", "username"],
	      properties: {
	        clientMutationId: { type: "string", minLength: 1, maxLength: 160 },
	        email: { type: "string", format: "email" },
	        username: { type: "string", minLength: 1, maxLength: 160 },
	      },
	    });
	    expect(components.schemas.ProfilePhotoUploadRequest).toMatchObject({
	      additionalProperties: false,
	      required: ["clientMutationId", "photo"],
	      properties: {
	        clientMutationId: { type: "string", minLength: 1, maxLength: 160 },
	        photo: { type: "string", format: "binary" },
	      },
	    });
	    expect(components.schemas.UpdateNotificationPreferencesRequest.required).toEqual([
	      "clientMutationId",
	      "notifySpoonOnMyRecipe",
	      "notifyForkOfMyRecipe",
	      "notifyCookbookSaveOfMine",
	      "notifyFellowChefOriginCook",
	    ]);
	    expect(components.schemas.ApnsDeviceRegistrationRequest.required).toEqual(["clientMutationId", "deviceId", "platform", "environment", "token"]);
	    expect(components.schemas.AccountDeleteMutationRequest.required).toEqual(["clientMutationId"]);
	    expect(components.schemas.AccountProfileMutationData.required).toContain("mutation");
	    expect(components.schemas.NotificationPreferencesMutationData.required).toContain("mutation");
	    expect(components.schemas.ApnsDeviceRegistrationData.required).toContain("mutation");
	    expect(components.schemas.ApnsDeviceRevokeData.required).toContain("mutation");
	    expect(components.schemas.CreateShoppingItemData.required).toEqual(["created", "updated", "item", "mutation"]);
    expect(components.schemas.UpdateShoppingItemData.required).toEqual(["item", "mutation"]);
    expect(components.schemas.DeleteShoppingItemData.required).toEqual(["removed", "item", "mutation"]);
    expect(components.schemas.AddRecipeIngredientsToShoppingListRequest).toMatchObject({
      additionalProperties: false,
      required: ["clientMutationId", "recipeId"],
      properties: {
        clientMutationId: { type: "string", minLength: 1, maxLength: 160 },
        recipeId: { type: "string", minLength: 1 },
        scaleFactor: { type: "number", exclusiveMinimum: 0, default: 1 },
      },
    });
    expect(components.schemas.ClearShoppingListRequest.required).toEqual(["clientMutationId"]);
    expect(components.schemas.AddRecipeIngredientsToShoppingListData.required).toEqual(["recipe", "created", "updated", "items", "mutation"]);
    expect(components.schemas.ClearShoppingItemsData.required).toEqual(["removed", "items", "mutation"]);
    expect(components.schemas.RecipeCover.required).toEqual([
      "id",
      "recipeId",
      "status",
      "sourceType",
      "imageUrl",
      "stylizedImageUrl",
      "displayUrl",
      "activeVariant",
      "provenanceLabel",
      "archivedAt",
      "generationStatus",
      "sourceImageUrl",
      "createdAt",
    ]);
    expect(components.schemas.RecipeCoverListData.required).toEqual(["covers", "activeCover", "spoonImages", "pagination"]);
    expect(components.schemas.RecipeCoverMutationData.required).toEqual(["activeCover", "previousActiveCover", "mutation"]);
    expect(components.schemas.SetRecipeNoCoverRequest).toMatchObject({
      additionalProperties: false,
      required: ["clientMutationId", "confirmNoCover"],
      properties: {
        clientMutationId: { type: "string", minLength: 1, maxLength: 160 },
        confirmNoCover: { const: true },
      },
    });
    expect(components.schemas.ArchiveRecipeCoverRequest).toMatchObject({
      additionalProperties: false,
      required: ["clientMutationId"],
      properties: {
        clientMutationId: { type: "string", minLength: 1, maxLength: 160 },
        replacementCoverId: { type: ["string", "null"] },
        deleteSafeObjects: { type: "boolean", default: false },
      },
    });
    expect(components.schemas.ArchiveRecipeCoverRequest.properties.coverId).toBeUndefined();
  });

  it("publishes an OpenAPI 3.0 REST-only connector profile for no-code importers", () => {
    const connector = buildApiV1ConnectorOpenApiDocument();
    const previewConnector = buildApiV1ConnectorOpenApiDocument({ serverUrl: "https://preview.example" });

    expect(connector.openapi).toBe("3.0.3");
    expect(Object.keys(connector.paths).sort()).toEqual([
      "/api/v1/cookbooks",
      "/api/v1/cookbooks/{id}",
      "/api/v1/cookbooks/{id}/recipes/{recipeId}",
      "/api/v1/recipes",
      "/api/v1/recipes/import",
      "/api/v1/recipes/{id}",
      "/api/v1/shopping-list",
      "/api/v1/shopping-list/add-from-recipe",
      "/api/v1/shopping-list/clear-all",
      "/api/v1/shopping-list/clear-completed",
      "/api/v1/shopping-list/items",
      "/api/v1/shopping-list/items/{itemId}",
      "/api/v1/shopping-list/sync",
    ].sort());
    expect(connector.paths["/mcp"]).toBeUndefined();
    expect(connector.paths["/api/v1/recipes/{id}/covers"]).toBeUndefined();
    expect(connector.paths["/oauth/authorize"]).toBeUndefined();
    expect(connector.components.securitySchemes.cookieAuth).toBeUndefined();
    expect(JSON.stringify(connector.paths)).not.toContain("cookieAuth");
    expect(connector["x-connector-profile"].oauth.authorizationUrl).toBe("https://spoonjoy.app/oauth/authorize");
    expect(previewConnector["x-connector-profile"].oauth.authorizationUrl).toBe("https://preview.example/oauth/authorize");
    expect(previewConnector["x-connector-profile"].playgroundUrl).toBe("https://preview.example/api/playground");
    expect(connector["x-connector-profile"].triggers[0]).toMatchObject({
      path: "/api/v1/shopping-list/sync",
      eventName: "new_updated_or_removed_shopping_list_item",
      tombstoneField: "deletedAt",
      removalWhen: "deletedAt is not null",
    });
    expect(connector.paths["/api/v1/shopping-list/sync"].get).toMatchObject({
      "x-display-name": "New, updated, or removed shopping-list item",
      "x-tombstone-field": "deletedAt",
      "x-removal-when": "deletedAt is not null",
    });
    expect(JSON.stringify(connector)).not.toContain('"const"');
    expect(JSON.stringify(connector)).not.toContain('["string","null"]');
    expect(JSON.stringify(connector)).not.toContain('"type":"null"');
    expect(JSON.stringify(connector)).not.toContain('"exclusiveMinimum":0');
    expect(connector.components.schemas.CreateShoppingItemRequest.properties.categoryKey).toEqual({
      type: "string",
      maxLength: 160,
      nullable: true,
    });
    expect(connector.paths["/api/v1/shopping-list/items/{itemId}"].delete.requestBody).toBeUndefined();
    expect(connector.paths["/api/v1/cookbooks/{id}"].delete.requestBody).toBeUndefined();
    expect(connector.paths["/api/v1/cookbooks/{id}/recipes/{recipeId}"].delete.requestBody).toBeUndefined();
    expect(connector.paths["/api/v1/cookbooks/{id}/recipes/{recipeId}"].post).toMatchObject({
      "x-connector-role": "action",
      "x-display-name": "Add recipe to cookbook",
    });
    expect(connector.paths["/api/v1/shopping-list/add-from-recipe"].post).toMatchObject({
      "x-connector-role": "action",
      "x-display-name": "Add recipe ingredients to shopping list",
    });
    expect(connector.paths["/api/v1/shopping-list/clear-all"].post).toMatchObject({
      "x-connector-role": "action",
      "x-display-name": "Clear all shopping-list items",
    });
    expect(JSON.stringify(connector)).not.toContain('"$ref":"#/components/schemas/SourceRecipeAttribution","nullable":true');
  });

  it("publishes an SDK profile with token lifecycle but without browser/session/MCP routes", () => {
    const sdk = buildApiV1SdkOpenApiDocument();
    const previewSdk = buildApiV1SdkOpenApiDocument({ serverUrl: "https://preview.example" });

    expect(sdk.openapi).toBe("3.1.0");
    expect(sdk.info.title).toBe("Spoonjoy API v1 SDK Profile");
    expect(sdk.paths["/oauth/register"]).toBeDefined();
    expect(sdk.paths["/oauth/token"]).toBeDefined();
    expect(sdk.paths["/oauth/revoke"]).toBeDefined();
    expect(sdk.paths["/oauth/authorize"]).toBeDefined();
    expect(sdk.paths["/mcp"]).toBeUndefined();
    expect(sdk.paths["/api/tools/start_agent_connection"]).toBeDefined();
    expect(sdk.paths["/api/tools/poll_agent_connection"]).toBeDefined();
    expect(sdk.paths["/api/v1/openapi.json"]).toBeUndefined();
    expect(sdk.paths["/api/v1/search"].get).toMatchObject({
      operationId: "getApiV1Search",
      "x-private-result-scope": expect.objectContaining({
        requiredScope: "shopping_list:read",
      }),
    });
    expect(sdk.paths["/api/v1/recipes/{id}/covers"].get).toMatchObject({
      operationId: "getApiV1RecipeCovers",
      "x-scopes": ["kitchen:write"],
    });
    expect(sdk.paths["/api/v1/recipes/{id}/covers"].patch["x-idempotency"]).toMatchObject({
      key: "clientMutationId",
      location: "jsonBody",
    });
    expect(sdk.paths["/api/v1/recipes/{id}/covers/from-spoon/{spoonId}"].post).toMatchObject({
      operationId: "postApiV1RecipeCoverFromSpoon",
      "x-scopes": ["kitchen:write"],
    });
    expectFlexibleDeleteContract(sdk, "/api/v1/shopping-list/items/{itemId}", "DeleteShoppingItemRequest");
    expectFlexibleDeleteContract(sdk, "/api/v1/recipes/{id}/spoons/{spoonId}", "DeleteRecipeSpoonRequest");
    expectFlexibleDeleteContract(sdk, "/api/v1/cookbooks/{id}", "DeleteCookbookRequest");
    expect(sdk.components.securitySchemes.cookieAuth).toBeUndefined();
    expect(JSON.stringify(sdk.paths)).not.toContain("cookieAuth");
    expect(sdk["x-sdk-profile"].omitted).toContain("same-origin cookieAuth");
    expect(previewSdk.components.securitySchemes.oauth2.flows.authorizationCode.authorizationUrl)
      .toBe("https://preview.example/oauth/authorize");
    expect(previewSdk["x-sdk-profile"].docsUrl).toBe("https://preview.example/api");
  });
});
