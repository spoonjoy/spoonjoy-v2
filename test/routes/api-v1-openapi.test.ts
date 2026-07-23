import { describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import { loader } from "~/routes/api.v1.$";
import {
  buildApiV1ConnectorOpenApiDocument,
  buildApiV1OpenApiDocument,
  buildApiV1SdkOpenApiDocument,
} from "~/lib/api-v1-openapi.server";

function routeArgs(request: Request, splat: string) {
  return { request, params: { "*": splat }, context: { cloudflare: { env: null } } } as any;
}

async function readJson(response: Response) {
  return await response.json() as any;
}

describe("GET /api/v1/openapi.json", () => {
  it("serves the generated OpenAPI document directly with v1 headers", async () => {
    const response = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/openapi.json", {
      headers: { "X-Request-Id": "req_openapi_full" },
    }) as unknown as Request, "openapi.json"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("X-Request-Id")).toBe("req_openapi_full");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const document = await readJson(response);

    expect(document).toEqual(buildApiV1OpenApiDocument({ serverUrl: "http://localhost" }));
    expect(document.ok).toBeUndefined();
    expect(document.paths["/api/v1/openapi.json"].get.responses["200"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/OpenApiDocument");
  });

  it("serves generated SDK and connector profiles directly with v1 headers", async () => {
    for (const [splat, expected] of [
      ["openapi.sdk.json", buildApiV1SdkOpenApiDocument({ serverUrl: "http://localhost" })],
      ["openapi.connector.json", buildApiV1ConnectorOpenApiDocument({ serverUrl: "http://localhost" })],
    ] as const) {
      const response = await loader(routeArgs(new UndiciRequest(`http://localhost/api/v1/${splat}`, {
        headers: { "X-Request-Id": `req_${splat}` },
      }) as unknown as Request, splat));

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("application/json");
      expect(response.headers.get("X-Request-Id")).toBe(`req_${splat}`);
      const document = await readJson(response);

      expect(document).toEqual(expected);
      if (splat === "openapi.sdk.json") {
        expect(document.paths["/api/v1/recipes/{id}/image"].post.operationId)
          .toBe("postApiV1RecipeImage");
        expect(document.paths["/api/v1/recipes/{id}/covers"].post.operationId)
          .toBe("postApiV1RecipeCovers");
        expect(document.paths["/api/v1/recipes/{id}/covers/generate"]).toBeDefined();
        expect(document.paths["/api/v1/recipes/{id}/covers/generate"].post.operationId)
          .toBe("postApiV1RecipeCoverGenerate");
        expect(document.paths["/api/v1/recipes/{id}/covers/regenerate"].post.operationId)
          .toBe("postApiV1RecipeCoverRegenerate");
      } else {
        expect(document.paths["/api/v1/recipes/{id}/image"]).toBeUndefined();
        expect(document.paths["/api/v1/recipes/{id}/covers"]).toBeUndefined();
        expect(document.paths["/api/v1/recipes/{id}/covers/generate"]).toBeUndefined();
        expect(document.paths["/api/v1/recipes/{id}/covers/regenerate"]).toBeUndefined();
      }
    }
  });

  it("documents private saved-recipe list and idempotent mutation contracts", () => {
    for (const document of [
      buildApiV1OpenApiDocument({ serverUrl: "http://localhost" }),
      buildApiV1SdkOpenApiDocument({ serverUrl: "http://localhost" }),
      buildApiV1ConnectorOpenApiDocument({ serverUrl: "http://localhost" }),
    ]) {
      const list = document.paths["/api/v1/saved-recipes"].get;
      const mutation = document.paths["/api/v1/saved-recipes/{recipeId}"];

      expect(list.operationId).toBe("getApiV1SavedRecipes");
      expect(list["x-auth"]).toBe("bearer");
      expect(list["x-scopes"]).toEqual(["kitchen:read"]);
      expect(list.parameters.filter((parameter: { in: string }) => parameter.in === "query")
        .map((parameter: { name: string }) => parameter.name)).toEqual(["q", "limit", "cursor"]);
      expect(list.parameters.find((parameter: { name: string }) => parameter.name === "limit").schema)
        .toMatchObject({ type: "integer", minimum: 1, maximum: 24, default: 24 });
      expect(list.responses["200"].content["application/json"].schema.$ref)
        .toBe("#/components/schemas/SavedRecipeListEnvelope");
      expect(list.responses["200"].headers["Cache-Control"].schema.example).toBe("private, no-store");

      for (const [method, operationId, responseSchema] of [
        ["put", "putApiV1SavedRecipe", "SaveRecipeEnvelope"],
        ["delete", "deleteApiV1SavedRecipe", "UnsaveRecipeEnvelope"],
      ] as const) {
        const operation = mutation[method];
        expect(operation.operationId).toBe(operationId);
        expect(operation["x-auth"]).toBe("bearer");
        expect(operation["x-scopes"]).toEqual(["kitchen:write"]);
        expect(operation.requestBody.required).toBe(true);
        expect(operation.requestBody.content["application/json"].schema.$ref)
          .toBe("#/components/schemas/SavedRecipeMutationRequest");
        expect(operation.responses["200"].content["application/json"].schema.$ref)
          .toBe(`#/components/schemas/${responseSchema}`);
        expect(operation.responses["200"].headers["Cache-Control"].schema.example)
          .toBe("private, no-store");
      }

      expect(document.components.schemas.SavedRecipeMutationRequest).toMatchObject({
        type: "object",
        additionalProperties: false,
        required: ["clientMutationId"],
        properties: { clientMutationId: { type: "string" } },
      });
      expect(document.components.schemas.SavedRecipeListData.required).toEqual(["recipes", "nextCursor"]);
    }
  });
});
