import { describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import { action as registerAction } from "~/routes/oauth.register";
import { action as revokeAction } from "~/routes/oauth.revoke";
import { action as tokenAction } from "~/routes/oauth.token";

const Request = UndiciRequest as unknown as typeof globalThis.Request;

function routeArgs(request: Request) {
  return {
    request,
    context: { cloudflare: { env: null } },
    params: {},
  } as never;
}

describe("OAuth route CORS", () => {
  it("preflights dynamic registration without touching storage", async () => {
    const response = await registerAction(routeArgs(new Request("https://spoonjoy.app/oauth/register", {
      method: "OPTIONS",
      headers: { Origin: "https://example.com" },
    })));

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Content-Type");
  });

  it("preflights token exchange without returning an unexpected server error", async () => {
    const response = await tokenAction(routeArgs(new Request("https://spoonjoy.app/oauth/token", {
      method: "OPTIONS",
      headers: { Origin: "https://example.com" },
    })));

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Content-Type");
  });

  it("preflights refresh-token revocation", async () => {
    const response = await revokeAction(routeArgs(new Request("https://spoonjoy.app/oauth/revoke", {
      method: "OPTIONS",
      headers: { Origin: "https://example.com" },
    })));

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Content-Type");
  });
});
