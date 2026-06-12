import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const scriptUrl = pathToFileURL(join(process.cwd(), "scripts/smoke-api-live.mjs")).href;

const originalArgv = process.argv;
const originalBaseUrl = process.env.SPOONJOY_SMOKE_BASE_URL;

afterEach(() => {
  process.argv = originalArgv;
  if (originalBaseUrl === undefined) {
    delete process.env.SPOONJOY_SMOKE_BASE_URL;
  } else {
    process.env.SPOONJOY_SMOKE_BASE_URL = originalBaseUrl;
  }
  vi.unstubAllGlobals();
});

async function importSmokeApi(args: string[]) {
  process.argv = ["node", "scripts/smoke-api-live.mjs", ...args];
  return import(`${scriptUrl}?case=${Date.now()}-${Math.random()}`);
}

function apiResponse(
  body: unknown,
  {
    headers = {},
    status = 200,
  }: {
    headers?: Record<string, string>;
    status?: number;
  } = {},
) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const text = typeof body === "string" ? body : JSON.stringify(body);

  return {
    status,
    headers: {
      entries: () => Object.entries(normalizedHeaders),
    },
    text: async () => text,
  } as unknown as Response;
}

function jsonResponse(body: unknown, init: { headers?: Record<string, string>; status?: number } = {}) {
  return apiResponse(body, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

function openApiBody(baseUrl: string) {
  return {
    openapi: "3.1.0",
    servers: [{ url: new URL(baseUrl).origin }],
    paths: Object.fromEntries(
      [
        "/api/v1/openapi.json",
        "/api/v1/openapi.sdk.json",
        "/api/v1/openapi.connector.json",
        "/oauth/register",
        "/oauth/authorize",
        "/oauth/token",
        "/oauth/revoke",
        "/api/tools/start_agent_connection",
        "/api/tools/poll_agent_connection",
        "/mcp",
      ].map((path) => [path, {}]),
    ),
  };
}

function stubSuccessfulApiSmokeFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(input instanceof URL ? input.href : input.toString());
      const requestHeaders = init?.headers as Record<string, string> | undefined;
      const requestId =
        new Headers(init?.headers).get("X-Request-Id") ??
        requestHeaders?.["X-Request-Id"] ??
        requestHeaders?.["x-request-id"] ??
        "api_smoke_not_found";

      if (url.pathname === "/api") {
        return apiResponse("Spoonjoy API");
      }
      if (url.pathname === "/api/playground") {
        return apiResponse("Spoonjoy API Playground");
      }
      if (url.pathname === "/api/v1/not-a-real-endpoint") {
        return jsonResponse(
          {
            ok: false,
            requestId,
            error: {
              code: "not_found",
              message: "Unknown Spoonjoy API v1 endpoint: /api/v1/not-a-real-endpoint",
              status: 404,
            },
          },
          {
            status: 404,
            headers: {
              "X-Request-Id": requestId,
            },
          },
        );
      }
      if (url.pathname === "/api/v1/openapi.json" || url.pathname === "/api/v1/openapi.sdk.json") {
        return jsonResponse(openApiBody(url.origin), {
          status: 200,
          headers: requestId ? { "X-Request-Id": requestId } : {},
        });
      }
      if (url.pathname === "/oauth/token" && init?.method === "OPTIONS") {
        return apiResponse("", {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }
      if (url.pathname === "/api/v1/shopping-list/items/item_1" && init?.method === "OPTIONS") {
        return apiResponse("", {
          status: 204,
          headers: {
            "Access-Control-Allow-Headers": "Authorization, X-Client-Mutation-Id",
          },
        });
      }
      if (url.pathname === "/api/v1/recipes") {
        return jsonResponse(
          { recipes: [] },
          {
            status: 200,
            headers: {
              "Cache-Control": "public, max-age=60",
              Vary: "Authorization, Cookie",
            },
          },
        );
      }

      throw new Error(`unexpected API smoke request: ${url.pathname}`);
    }),
  );
}

describe("API live smoke target handling", () => {
  it("rejects remote API smoke URLs without an explicit target before making requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("fetch should not run before target validation");
      }),
    );

    await expect(importSmokeApi(["--base-url", "https://spoonjoy.app"])).rejects.toThrow(
      /--target-env qa or --target-env production/,
    );
  });

  it("rejects mismatched API smoke target env and URL before making requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("fetch should not run before target validation");
      }),
    );

    await expect(
      importSmokeApi([
        "--target-env",
        "qa",
        "--base-url",
        "https://spoonjoy-v2.mendelow-studio.workers.dev",
      ]),
    ).rejects.toThrow(/QA target/);
  });

  it("writes environment metadata into API smoke artifacts", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "spoonjoy-api-smoke-"));
    stubSuccessfulApiSmokeFetch();

    try {
      await importSmokeApi([
        "--target-env",
        "production",
        "--base-url",
        "https://spoonjoy.app",
        "--out",
        outDir,
      ]);

      const report = JSON.parse(await readFile(join(outDir, "api-smoke-results.json"), "utf8")) as {
        environment?: Record<string, unknown>;
      };

      expect(report.environment).toEqual({
        targetEnv: "production",
        baseUrl: "https://spoonjoy.app",
        d1Target: "production D1 spoonjoy (--remote)",
        r2Target: "production R2 spoonjoy-photos (--remote)",
        destructiveScope: "production read-only by default; exact smoke cleanup only",
      });
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
