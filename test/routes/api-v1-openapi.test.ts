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
      await expect(readJson(response)).resolves.toEqual(expected);
    }
  });
});
