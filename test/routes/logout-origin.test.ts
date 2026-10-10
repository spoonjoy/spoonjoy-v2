// @vitest-environment node
// The DOM test environment hides Set-Cookie on responses, so the cookie-clearing checks run in node.
import { describe, it, expect } from "vitest";
import { Request as UndiciRequest } from "undici";
import { action } from "~/routes/logout";
import { sessionStorage } from "~/lib/session.server";

describe("Logout action across hosts", () => {
  // On spoonjoy.app the Worker can see its internal workers.dev address as the request URL while
  // the browser sends Origin https://spoonjoy.app (audit 2026-10-09 review of this fix).
  it("signs out a post from the configured public site when the Worker sees another host", async () => {
    const session = await sessionStorage.getSession();
    session.set("userId", "test-user-id");
    const cookieValue = (await sessionStorage.commitSession(session)).split(";")[0];
    const post = (origin: string) =>
      action({
        request: new UndiciRequest("https://spoonjoy-v2.mendelow-studio.workers.dev/logout", {
          method: "POST",
          headers: { Cookie: cookieValue, Origin: origin },
        }),
        context: { cloudflare: { env: { SPOONJOY_BASE_URL: "https://spoonjoy.app" } } },
        params: {},
      } as any);

    const response = (await post("https://spoonjoy.app")) as Response;
    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/login");
    expect(response.headers.get("Set-Cookie")).toMatch(/__session=;.*(Max-Age=0|Expires=Thu, 01 Jan 1970)/i);

    expect(((await post("https://spoonjoy.app.evil.example")) as any).init?.status).toBe(403);
  });

  it("falls back to the request's own origin when the configured site is unset or malformed", async () => {
    const post = (origin: string, baseUrl: string | undefined) =>
      action({
        request: new UndiciRequest("https://spoonjoy-v2.mendelow-studio.workers.dev/logout", {
          method: "POST",
          headers: { Origin: origin },
        }),
        context: { cloudflare: { env: baseUrl === undefined ? {} : { SPOONJOY_BASE_URL: baseUrl } } },
        params: {},
      } as any) as Promise<any>;

    for (const baseUrl of [undefined, "not a url"]) {
      const same = await post("https://spoonjoy-v2.mendelow-studio.workers.dev", baseUrl);
      expect(same).toBeInstanceOf(Response);
      expect(same.status).toBe(302);
      expect((await post("https://spoonjoy.app", baseUrl)).init?.status).toBe(403);
    }
  });

  it("refuses a cross-origin post without touching the cookie", async () => {
    const result = (await action({
      request: new UndiciRequest("https://spoonjoy.app/logout", {
        method: "POST",
        headers: { Origin: "https://evil.example" },
      }),
      context: { cloudflare: { env: { SPOONJOY_BASE_URL: "https://spoonjoy.app" } } },
      params: {},
    } as any)) as any;
    expect(result).not.toBeInstanceOf(Response);
    expect(result.init?.status).toBe(403);
    expect(result.data).toEqual({ error: "Sign-out must come from Spoonjoy." });
    expect(result.init?.headers).toBeUndefined();
  });
});
