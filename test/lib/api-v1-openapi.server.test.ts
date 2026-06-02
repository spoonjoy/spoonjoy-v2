import { describe, expect, it } from "vitest";
import { buildApiV1OpenApiDocument } from "~/lib/api-v1-openapi.server";
import { API_V1_ERROR_STATUS, API_V1_RESOURCES } from "~/lib/api-v1-contract.server";

const RESOURCE_PATHS = Array.from(new Set(API_V1_RESOURCES.map((resource) => resource.path))).sort();

function operation(document: any, path: string, method: string) {
  return document.paths[path][method.toLowerCase()];
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
        expect(op["x-scopes"]).toEqual(resource.scopes);
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
          expect(op.security).toEqual([{ bearerAuth: [] }]);
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
