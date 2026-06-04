import { describe, expect, it } from "vitest";
import {
  applyOAuthCorsHeaders,
  OAUTH_CORS_HEADERS,
  oauthCorsPreflightResponse,
} from "~/lib/oauth-cors.server";

describe("oauth CORS helpers", () => {
  it("returns a preflight response for supported OAuth endpoints", () => {
    const response = oauthCorsPreflightResponse(new Request("https://spoonjoy.app/oauth/token", {
      method: "OPTIONS",
    }));

    expect(response).toBeInstanceOf(Response);
    expect(response?.status).toBe(204);
    for (const [name, value] of Object.entries(OAUTH_CORS_HEADERS)) {
      expect(response?.headers.get(name)).toBe(value);
    }
  });

  it("returns null for non-OPTIONS requests and unsupported OPTIONS paths", () => {
    expect(oauthCorsPreflightResponse(new Request("https://spoonjoy.app/oauth/token", {
      method: "POST",
    }))).toBeNull();
    expect(oauthCorsPreflightResponse(new Request("https://spoonjoy.app/oauth/authorize", {
      method: "OPTIONS",
    }))).toBeNull();
  });

  it("applies CORS headers in place", () => {
    const response = new Response("ok", { status: 200 });

    const returned = applyOAuthCorsHeaders(response);

    expect(returned).toBe(response);
    for (const [name, value] of Object.entries(OAUTH_CORS_HEADERS)) {
      expect(response.headers.get(name)).toBe(value);
    }
  });
});
