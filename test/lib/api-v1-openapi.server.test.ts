import { describe, expect, it } from "vitest";
import { buildApiV1OpenApiDocument } from "~/lib/api-v1-openapi.server";
import { API_V1_ERROR_STATUS, API_V1_RESOURCES } from "~/lib/api-v1-contract.server";

const RESOURCE_PATHS = Array.from(new Set(API_V1_RESOURCES.map((resource) => resource.path))).sort();
const OPERATION_SCOPES = {
  "GET /api/v1": [],
  "GET /api/v1/health": [],
  "GET /api/v1/openapi.json": [],
  "GET /api/v1/recipes": ["recipes:read"],
  "GET /api/v1/recipes/{id}": ["recipes:read"],
  "GET /api/v1/cookbooks": ["cookbooks:read"],
  "GET /api/v1/cookbooks/{id}": ["cookbooks:read"],
  "GET /api/v1/shopping-list": ["shopping_list:read"],
  "GET /api/v1/shopping-list/sync": ["shopping_list:read"],
  "POST /api/v1/shopping-list/items": ["shopping_list:write"],
  "PATCH /api/v1/shopping-list/items/{itemId}": ["shopping_list:write"],
  "DELETE /api/v1/shopping-list/items/{itemId}": ["shopping_list:write"],
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

function errorExample(document: any, path: string, method: string, status: string, code: string) {
  return operation(document, path, method).responses[status].content["application/json"].examples[code].value;
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
    expect(Object.keys(document.paths).sort()).toEqual(RESOURCE_PATHS);
    expect(document.components.securitySchemes.bearerAuth).toEqual({
      type: "http",
      scheme: "bearer",
      bearerFormat: "Spoonjoy API token",
    });
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

        if (resource.auth === "bearer") {
          expect(op.security).toEqual([{ bearerAuth: OPERATION_SCOPES[`${method} ${resource.path}`] }]);
        } else {
          expect(op.security).toBeUndefined();
        }
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
    expect(operation(document, "/api/v1/recipes/{id}", "GET").parameters).toEqual([
      expect.objectContaining({ name: "id", in: "path", required: true, schema: { type: "string", minLength: 1 } }),
    ]);
    expect(operation(document, "/api/v1/shopping-list/sync", "GET").parameters).toEqual([
      expect.objectContaining({ name: "cursor", in: "query", required: false, schema: { type: "string", format: "date-time" } }),
    ]);
    expect(operation(document, "/api/v1/shopping-list/items/{itemId}", "PATCH").parameters).toEqual([
      expect.objectContaining({ name: "itemId", in: "path", required: true, schema: { type: "string", minLength: 1 } }),
    ]);
  });

  it("documents raw OpenAPI, method-level token scopes, health principal source, and concrete examples", () => {
    const document = buildApiV1OpenApiDocument();

    expect(operation(document, "/api/v1/openapi.json", "GET").responses["200"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/OpenApiDocument");
    expect(responseExample(document, "/api/v1/openapi.json", "GET", "200")).toMatchObject({
      openapi: "3.1.0",
      info: { title: "Spoonjoy API", version: "v1" },
    });
    expect(responseExample(document, "/api/v1/openapi.json", "GET", "200").ok).toBeUndefined();

    expect(operation(document, "/api/v1/tokens", "GET")["x-scopes"]).toEqual(["tokens:read"]);
    expect(operation(document, "/api/v1/tokens", "POST")["x-scopes"]).toEqual(["tokens:write"]);
    expect(operation(document, "/api/v1/tokens", "GET").security).toEqual([{ bearerAuth: ["tokens:read"] }]);
    expect(operation(document, "/api/v1/tokens", "POST").security).toEqual([{ bearerAuth: ["tokens:write"] }]);

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
      recipes: [expect.objectContaining({ title: "Pasta" })],
    });
    expect(responseExample(document, "/api/v1/tokens", "GET", "200").data.tokens[0].scopes).toEqual(["recipes:read"]);
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
      .toEqual({ name: "Tiny client", scopes: ["recipes:read", "shopping_list:read"] });
    expect(operation(document, "/api/v1/shopping-list/items", "POST").requestBody.content["application/json"].examples.example.value)
      .toEqual({
        clientMutationId: "device-uuid-1",
        name: "Eggs",
        quantity: 12,
        unit: "Each",
        categoryKey: null,
        iconKey: null,
      });
  });

  it("uses response examples whose status and envelope shape match each response", () => {
    const document = buildApiV1OpenApiDocument();

    for (const path of Object.keys(document.paths)) {
      for (const method of Object.keys(document.paths[path])) {
        const op = document.paths[path][method];

        for (const [statusKey, response] of Object.entries(op.responses) as Array<[string, any]>) {
          const status = Number(statusKey);
          const schemaRef = response.content["application/json"].schema.$ref;

          for (const example of Object.values(response.content["application/json"].examples) as any[]) {
            const value = example.value;

            if (status >= 200 && status < 300) {
              if (schemaRef === "#/components/schemas/OpenApiDocument") {
                expect(value).toMatchObject({ openapi: "3.1.0", info: expect.any(Object), paths: expect.any(Object) });
                expect(value.ok).toBeUndefined();
              } else {
                expect(value).toMatchObject({ ok: true, requestId: "req_example" });
                expect(value.data).not.toEqual({});
              }
              continue;
            }

            expect(value).toMatchObject({ ok: false, requestId: "req_example" });
            expect(API_V1_ERROR_STATUS[value.error.code as keyof typeof API_V1_ERROR_STATUS]).toBe(status);
            expect(value.error.status).toBe(status);
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
    expect(operation(document, "/api/v1/shopping-list/items/{itemId}", "DELETE").requestBody.content["application/json"].schema.$ref)
      .toBe("#/components/schemas/DeleteShoppingItemRequest");

    expect(operation(document, "/api/v1/shopping-list/items", "POST").responses).toMatchObject({
      200: { content: { "application/json": { schema: { $ref: "#/components/schemas/CreateShoppingItemEnvelope" } } } },
      201: { content: { "application/json": { schema: { $ref: "#/components/schemas/CreateShoppingItemEnvelope" } } } },
      409: { content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } } } },
    });
    expect(operation(document, "/api/v1/shopping-list/items/{itemId}", "PATCH").responses["404"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/ErrorEnvelope");
    expect(operation(document, "/api/v1/shopping-list/items/{itemId}", "DELETE").responses["404"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/ErrorEnvelope");
  });

  it("defines reusable schemas with strict objects, nullable fields, and error enums", () => {
    const { components } = buildApiV1OpenApiDocument();

    for (const [name, schema] of Object.entries(components.schemas) as Array<[string, any]>) {
      if (schema.type === "object" && name !== "ErrorDetails") {
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
        quantity: { type: "number", exclusiveMinimum: 0 },
        categoryKey: { type: ["string", "null"] },
      },
    });
  });
});
