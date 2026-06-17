import { describe, expect, it } from "vitest";
import { buildApiV1ConnectorOpenApiDocument, buildApiV1OpenApiDocument, buildApiV1SdkOpenApiDocument } from "~/lib/api-v1-openapi.server";
import { API_V1_ERROR_STATUS, API_V1_RESOURCES } from "~/lib/api-v1-contract.server";
import {
  endpointKey,
  nativeRestOperationScopes,
  NATIVE_REST_ENDPOINT_SCOPE,
  type NativeRestEndpointScopeRow,
} from "../config/api-v1-native-endpoint-scope";

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
const OPERATION_SCOPES = nativeRestOperationScopes();

function operation(document: any, path: string, method: string) {
  return document.paths[path][method.toLowerCase()];
}

function existingOperation(document: any, row: NativeRestEndpointScopeRow) {
  return document.paths[row.path]?.[row.method.toLowerCase()];
}

function responseExample(document: any, path: string, method: string, status: string) {
  const examples = operation(document, path, method).responses[status].content["application/json"].examples;
  return (examples.example ?? Object.values(examples)[0] as any).value;
}

function errorExample(document: any, path: string, method: string, status: string, code: string) {
  return operation(document, path, method).responses[status].content["application/json"].examples[code].value;
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
            "kitchen:read": expect.any(String),
            "kitchen:write": expect.any(String),
            "shopping_list:read": expect.any(String),
            "shopping_list:write": expect.any(String),
          },
        },
      },
    });
    expect(document["x-oauth-scope-map"]).toEqual({
      "cookbooks:read": ["cookbooks:read"],
      "kitchen:read": ["cookbooks:read", "kitchen:read", "public:read", "recipes:read", "shopping_list:read"],
      "kitchen:write": ["kitchen:write", "shopping_list:write"],
      "public:read": ["cookbooks:read", "public:read", "recipes:read"],
      "recipes:read": ["recipes:read"],
      "shopping_list:read": ["shopping_list:read"],
      "shopping_list:write": ["shopping_list:write"],
    });
    expect(document["x-auth-flows"].map((flow: { id: string }) => flow.id)).toEqual(["oauth-pkce", "delegated-approval", "mcp"]);
    expect(document["x-client-scenarios"].map((scenario: { id: string }) => scenario.id)).toEqual([
      "cloudflare-worker-sync",
      "browser-extension-shopping-sync",
      "no-code-connector",
      "public-data-export",
    ]);
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
        if (resource.auth === "bearer") {
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
        if (oauthScopes.length > 0) {
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
    expect(operation(document, "/api/v1/recipes/{id}", "GET").parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "id", in: "path", required: true, schema: { type: "string", minLength: 1 } }),
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

  it("declares every accepted native REST endpoint with auth, schemas, examples, and error envelopes", () => {
    const document = buildApiV1OpenApiDocument();

    expect(
      NATIVE_REST_ENDPOINT_SCOPE
        .filter((row) => !existingOperation(document, row))
        .map(endpointKey),
    ).toEqual([]);

    for (const row of NATIVE_REST_ENDPOINT_SCOPE) {
      const op = existingOperation(document, row);

      expect(op.operationId).toMatch(new RegExp(`^${row.method.toLowerCase()}ApiV1`));
      expect(op["x-auth"]).toBe(row.auth);
      expect(op["x-scopes"]).toEqual([...row.scopes]);
      expect(op["x-credential-modes"]).toEqual(expect.any(Array));

      const successStatuses = Object.keys(op.responses).filter((status) => status.startsWith("2"));
      expect(successStatuses.length).toBeGreaterThan(0);
      for (const status of successStatuses) {
        expect(op.responses[status].content["application/json"].schema.$ref).toEqual(expect.any(String));
        expect(op.responses[status].content["application/json"].examples).toEqual(expect.any(Object));
      }

      for (const status of ["405", "429", "500"]) {
        expect(op.responses[status].content["application/json"].schema.$ref).toBe("#/components/schemas/ErrorEnvelope");
        expect(Object.values(op.responses[status].content["application/json"].examples).length).toBeGreaterThan(0);
      }

      if (row.auth === "bearer") {
        for (const status of ["401", "403"]) {
          expect(op.responses[status].content["application/json"].schema.$ref).toBe("#/components/schemas/ErrorEnvelope");
        }
      }

      if (["POST", "PATCH", "PUT"].includes(row.method)) {
        const requestContent = op.requestBody?.content ?? {};
        expect(Object.keys(requestContent).length).toBeGreaterThan(0);
        expect(
          Object.values(requestContent).some((content: any) => content.schema && content.examples),
        ).toBe(true);
      }
    }
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
    expect(responseExample(document, "/api/v1/recipes/{id}", "GET", "200").data.recipe).toMatchObject({
      coverProvenanceLabel: "Chef photo",
      coverSourceType: "chef-upload",
      coverVariant: "image",
    });
    expect(responseExample(document, "/api/v1/cookbooks/{id}", "GET", "200").data.cookbook.recipes[0]).toMatchObject({
      coverProvenanceLabel: "Chef photo",
      coverSourceType: "chef-upload",
      coverVariant: "image",
    });
    expect(responseExample(document, "/api/v1/tokens", "GET", "200").data.tokens[0].scopes).toEqual(["recipes:read", "shopping_list:read", "shopping_list:write"]);
    expect(responseExample(document, "/api/v1/shopping-list/items", "POST", "201").data).toMatchObject({
      created: true,
      updated: false,
      mutation: { clientMutationId: "device-uuid-1", replayed: false },
    });
    expect(errorExample(document, "/api/v1/health", "GET", "401", "invalid_token").error.code).toBe("invalid_token");
    expect(errorExample(document, "/api/v1/shopping-list", "GET", "401", "authentication_required").error.code).toBe("authentication_required");
    expect(errorExample(document, "/api/v1/shopping-list/items", "POST", "409", "idempotency_conflict").error.code).toBe("idempotency_conflict");
    expect(errorExample(document, "/api/v1/tokens", "POST", "400", "validation_error").error.code).toBe("validation_error");

    expect(operation(document, "/api/v1/tokens", "POST").requestBody.content["application/json"].examples.example.value)
      .toEqual({ name: "Tiny client", scopes: ["recipes:read", "shopping_list:read", "shopping_list:write"] });
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

  it("declares exact request and response schemas for tokens and shopping-list mutations", () => {
    const document = buildApiV1OpenApiDocument();

    expect(operation(document, "/api/v1/tokens", "POST").requestBody.content["application/json"].schema.$ref)
      .toBe("#/components/schemas/CreateTokenRequest");
    expect(operation(document, "/api/v1/shopping-list/items", "POST").requestBody.content["application/json"].schema.$ref)
      .toBe("#/components/schemas/CreateShoppingItemRequest");
    expect(operation(document, "/api/v1/shopping-list/items/{itemId}", "PATCH").requestBody.content["application/json"].schema.$ref)
      .toBe("#/components/schemas/CheckShoppingItemRequest");
    expect(operation(document, "/api/v1/shopping-list/items/{itemId}", "DELETE").requestBody).toBeUndefined();
    expect(operation(document, "/api/v1/shopping-list/items/{itemId}", "DELETE").parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "itemId", in: "path", required: true }),
      expect.objectContaining({ name: "X-Client-Mutation-Id", in: "header", required: true }),
      expect.objectContaining({ name: "X-Request-Id", in: "header", required: false }),
    ]));
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
  });

  it("declares exact request and response schemas for native account endpoints", () => {
    const document = buildApiV1OpenApiDocument();

    expect(operation(document, "/api/v1/me", "GET").responses["200"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/NativeAccountSnapshotEnvelope");
    expect(operation(document, "/api/v1/me", "PATCH").requestBody.content["application/json"].schema.$ref)
      .toBe("#/components/schemas/NativeProfileRequest");
    expect(operation(document, "/api/v1/me", "PATCH").responses["200"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/NativeAccountSnapshotEnvelope");
    expect(responseExample(document, "/api/v1/me", "GET", "200").data.me).toMatchObject({
      handoffs: {
        accountSettings: { url: "/account/settings", onlineOnly: true },
        passkeys: {
          registrationOptionsUrl: "/auth/webauthn/register/options",
          registrationVerifyUrl: "/auth/webauthn/register/verify",
        },
        providerLinks: {
          google: { url: "/auth/google?linking=true", onlineOnly: true },
          github: { url: "/auth/github?linking=true", onlineOnly: true },
          apple: { url: "/auth/apple?linking=true", onlineOnly: true },
        },
      },
      apiCredentials: [expect.not.objectContaining({ tokenHash: expect.anything() })],
      oauthConnections: [expect.objectContaining({ accessTokenCount: 1, refreshTokenCount: 1 })],
    });

    expect(operation(document, "/api/v1/me/photo", "POST").requestBody.content["multipart/form-data"].schema.$ref)
      .toBe("#/components/schemas/ProfilePhotoUploadRequest");
    expect(operation(document, "/api/v1/me/photo", "POST").requestBody.content["application/json"]).toBeUndefined();
    expect(operation(document, "/api/v1/me/photo", "POST").responses["200"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/NativeProfilePhotoEnvelope");
    expect(operation(document, "/api/v1/me/photo", "DELETE").responses["200"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/NativeProfilePhotoRemoveEnvelope");
    expect(operation(document, "/api/v1/me/photo", "DELETE").parameters.map((parameter: { name: string }) => parameter.name))
      .not.toContain("X-Client-Mutation-Id");

    expect(operation(document, "/api/v1/me/kitchen", "GET").responses["200"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/NativeAccountSnapshotEnvelope");
    expect(operation(document, "/api/v1/me/notification-preferences", "GET").responses["200"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/NativeNotificationPreferencesEnvelope");
    expect(operation(document, "/api/v1/me/notification-preferences", "PATCH").requestBody.content["application/json"].schema.$ref)
      .toBe("#/components/schemas/NativeNotificationPreferencesRequest");
    expect(operation(document, "/api/v1/me/notification-preferences", "PATCH").responses["200"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/NativeNotificationPreferencesEnvelope");

    expect(operation(document, "/api/v1/me/apns-devices", "POST").requestBody.content["application/json"].schema.$ref)
      .toBe("#/components/schemas/NativeApnsDeviceRequest");
    expect(operation(document, "/api/v1/me/apns-devices", "POST").responses["200"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/NativeApnsDeviceEnvelope");
    expect(operation(document, "/api/v1/me/apns-devices", "POST").responses["201"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/NativeApnsDeviceEnvelope");
    expect(responseExample(document, "/api/v1/me/apns-devices", "POST", "201").data.device)
      .not.toEqual(expect.objectContaining({ token: expect.anything(), tokenHash: expect.anything() }));
    expect(operation(document, "/api/v1/me/apns-devices/{deviceId}", "DELETE").responses["200"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/NativeApnsDeviceRevokeEnvelope");
    expect(responseExample(document, "/api/v1/me/apns-devices/{deviceId}", "DELETE", "200").data).toMatchObject({
      revoked: true,
      revokedCount: 1,
      device: expect.objectContaining({ deviceId: "ios-simulator-1" }),
      devices: [expect.objectContaining({ deviceId: "ios-simulator-1" })],
    });
    expect(operation(document, "/api/v1/me/apns-devices/{deviceId}", "DELETE").parameters.map((parameter: { name: string }) => parameter.name))
      .toEqual(expect.arrayContaining(["deviceId", "X-Request-Id"]));
    expect(operation(document, "/api/v1/me/apns-devices/{deviceId}", "DELETE").parameters.map((parameter: { name: string }) => parameter.name))
      .not.toContain("X-Client-Mutation-Id");

    expect(operation(document, "/api/v1/me/connections", "GET").responses["200"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/NativeOAuthConnectionsEnvelope");
    expect(operation(document, "/api/v1/me/connections/{connectionId}", "DELETE").responses["200"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/NativeOAuthConnectionDisconnectEnvelope");
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
    expect(components.schemas.CreateShoppingItemData.required).toEqual(["created", "updated", "item", "mutation"]);
    expect(components.schemas.UpdateShoppingItemData.required).toEqual(["item", "mutation"]);
    expect(components.schemas.DeleteShoppingItemData.required).toEqual(["removed", "item", "mutation"]);
  });

  it("publishes an OpenAPI 3.0 REST-only connector profile for no-code importers", () => {
    const connector = buildApiV1ConnectorOpenApiDocument();
    const previewConnector = buildApiV1ConnectorOpenApiDocument({ serverUrl: "https://preview.example" });

    expect(connector.openapi).toBe("3.0.3");
    expect(Object.keys(connector.paths).sort()).toEqual([
      "/api/v1/cookbooks",
      "/api/v1/cookbooks/{id}",
      "/api/v1/recipes",
      "/api/v1/recipes/{id}",
      "/api/v1/search",
      "/api/v1/shopping-list",
      "/api/v1/shopping-list/items",
      "/api/v1/shopping-list/items/{itemId}",
      "/api/v1/shopping-list/sync",
    ].sort());
    expect(connector.paths["/mcp"]).toBeUndefined();
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
    expect(connector.paths["/api/v1/search"].get).toMatchObject({
      "x-connector-role": "search",
      "x-display-name": "Search Spoonjoy",
      "x-item-path": "$.data.results",
      "x-private-scope-policy": {
        shoppingListResultsRequireAny: ["shopping_list:read", "kitchen:read"],
      },
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
    expect(sdk.components.securitySchemes.cookieAuth).toBeUndefined();
    expect(JSON.stringify(sdk.paths)).not.toContain("cookieAuth");
    expect(sdk["x-sdk-profile"].omitted).toContain("same-origin cookieAuth");
    expect(previewSdk.components.securitySchemes.oauth2.flows.authorizationCode.authorizationUrl)
      .toBe("https://preview.example/oauth/authorize");
    expect(previewSdk["x-sdk-profile"].docsUrl).toBe("https://preview.example/api");
  });
});
