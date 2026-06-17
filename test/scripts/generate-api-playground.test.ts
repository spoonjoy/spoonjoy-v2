import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildApiV1OpenApiDocument } from "../../app/lib/api-v1-openapi.server";
import {
  buildApiPlaygroundManifest,
  OPENAPI_OPERATION_METHODS,
  serializeApiPlaygroundManifest,
} from "../../scripts/generate-api-playground";
import {
  endpointKey,
  NATIVE_REST_ENDPOINT_SCOPE,
} from "../config/api-v1-native-endpoint-scope";

describe("generate-api-playground", () => {
  it("derives every playground operation from the OpenAPI document", () => {
    const document = buildApiV1OpenApiDocument();
    const manifest = buildApiPlaygroundManifest(document);
    const openApiOperations = Object.entries(document.paths).flatMap(([path, pathItem]) => (
      Object.keys(pathItem as Record<string, unknown>)
        .filter((method) => (OPENAPI_OPERATION_METHODS as readonly string[]).includes(method))
        .map((method) => `${method.toUpperCase()} ${path}`)
    ));

    expect([...OPENAPI_OPERATION_METHODS]).toEqual(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);
    expect(manifest.source).toBe("buildApiV1OpenApiDocument");
    expect(manifest.version).toBe("v1");
    expect(manifest.operations.map((operation) => operation.id)).toEqual(openApiOperations);
    expect(
      NATIVE_REST_ENDPOINT_SCOPE
        .filter((row) => !manifest.operations.some((operation) => operation.id === endpointKey(row)))
        .map(endpointKey),
    ).toEqual([]);
    expect(manifest.operations.find((operation) => operation.id === "POST /api/v1/tokens")).toMatchObject({
      auth: "authenticated",
      scopes: ["tokens:write"],
      requestBody: {
        contentType: "application/json",
        example: expect.stringContaining("\"name\": \"Tiny client\""),
      },
    });
    expect(manifest.operations.find((operation) => operation.id === "POST /api/v1/recipes/{id}/image")).toMatchObject({
      auth: "authenticated",
      scopes: ["kitchen:write"],
      requestBody: {
        contentType: "multipart/form-data",
        fileFields: ["image"],
        example: expect.stringContaining("\"clientMutationId\": \"cover-upload-device-uuid-1\""),
      },
    });
    expect(manifest.operations.find((operation) => operation.id === "POST /api/v1/recipes/{id}/spoons")).toMatchObject({
      requestBodyVariants: [
        expect.objectContaining({ contentType: "application/json", fileFields: [] }),
        expect.objectContaining({ contentType: "multipart/form-data", fileFields: ["photo"] }),
      ],
    });
    expect(manifest.operations.find((operation) => operation.id === "GET /api/v1/recipes/{id}")).toMatchObject({
      params: expect.arrayContaining([
        expect.objectContaining({ name: "id", in: "path", placeholder: "recipe_1" }),
        expect.objectContaining({ name: "X-Request-Id", in: "header" }),
      ]),
    });
  });

  it("keeps the committed client manifest in sync with the generator output", async () => {
    const generated = await readFile("app/lib/generated/api-v1-playground.ts", "utf8");

    expect(generated).toBe(serializeApiPlaygroundManifest());
  });
});
