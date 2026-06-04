import { afterEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";

const Request = UndiciRequest as unknown as typeof globalThis.Request;

afterEach(() => {
  vi.doUnmock("~/lib/oauth-server.server");
  vi.resetModules();
});

function jsonPost(body: unknown): Request {
  return new Request("https://spoonjoy.app/oauth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function formPost(url: string, fields: Record<string, string>): Request {
  return new Request(url, {
    method: "POST",
    body: new URLSearchParams(fields),
  });
}

describe("OAuth route defensive error coverage", () => {
  it("bubbles unexpected dynamic-registration core errors", async () => {
    vi.doMock("~/lib/oauth-server.server", async (importOriginal) => ({
      ...(await importOriginal<typeof import("~/lib/oauth-server.server")>()),
      registerOAuthClient: vi.fn(async () => {
        throw new Error("register core failed");
      }),
    }));
    const { handleOAuthRegister } = await import("~/lib/oauth-routes.server");

    await expect(handleOAuthRegister(
      jsonPost({ redirect_uris: ["https://client.example/oauth/callback"] }),
      {} as never,
    )).rejects.toThrow("register core failed");
  });

  it("bubbles unexpected token core errors", async () => {
    vi.doMock("~/lib/oauth-server.server", async (importOriginal) => ({
      ...(await importOriginal<typeof import("~/lib/oauth-server.server")>()),
      consumeAuthorizationCode: vi.fn(async () => ({
        userId: "user_1",
        scope: "shopping_list:read",
        resource: "https://spoonjoy.app/mcp",
      })),
      issueConnectorTokens: vi.fn(async () => {
        throw new Error("token core failed");
      }),
    }));
    const { handleOAuthToken } = await import("~/lib/oauth-routes.server");

    await expect(handleOAuthToken(
      formPost("https://spoonjoy.app/oauth/token", {
        grant_type: "authorization_code",
        code: "oac_safe_test_code",
        client_id: "client_1",
        redirect_uri: "https://client.example/oauth/callback",
        code_verifier: "verifier-0123456789-abcdefghijklmnopqrstuvwxyz",
      }),
      {} as never,
      null,
    )).rejects.toThrow("token core failed");
  });

  it("bubbles unexpected revoke core errors", async () => {
    vi.doMock("~/lib/oauth-server.server", async (importOriginal) => ({
      ...(await importOriginal<typeof import("~/lib/oauth-server.server")>()),
      revokeConnectorRefreshToken: vi.fn(async () => {
        throw new Error("revoke core failed");
      }),
    }));
    const { handleOAuthRevoke } = await import("~/lib/oauth-routes.server");

    await expect(handleOAuthRevoke(
      formPost("https://spoonjoy.app/oauth/revoke", {
        token: "ort_safe_test_token",
        client_id: "client_1",
      }),
      {} as never,
    )).rejects.toThrow("revoke core failed");
  });
});
