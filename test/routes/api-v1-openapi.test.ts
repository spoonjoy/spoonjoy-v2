import { describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import { loader } from "~/routes/api.v1.$";
import { buildApiV1OpenApiDocument } from "~/lib/api-v1-openapi.server";

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
    expect(await readJson(response)).toEqual(buildApiV1OpenApiDocument());
  });
});
