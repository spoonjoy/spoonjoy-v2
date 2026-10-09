// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  isSameSiteFormPost,
  normalizeUserCode,
  rememberTypedCode,
  typedCodeFor,
} from "~/lib/agent-connection-route.server";
import { requestNetworkDetails } from "~/lib/spoonjoy-api-request.server";

function post(headers: Record<string, string>, url = "https://spoonjoy.app/agent/connect") {
  return new Request(url, { method: "POST", headers });
}

describe("agent connection route rules", () => {
  it("normalizes typed codes the way agents show them", () => {
    expect(normalizeUserCode(" abcd 2345 ")).toBe("ABCD-2345");
    expect(normalizeUserCode("ab")).toBe("AB");
    expect(normalizeUserCode(null)).toBe("");
  });

  it("accepts same-site posts and refuses cross-site ones", () => {
    expect(isSameSiteFormPost(post({}), null)).toBe(true);
    expect(isSameSiteFormPost(post({ "Sec-Fetch-Site": "same-origin" }), null)).toBe(true);
    expect(isSameSiteFormPost(post({ "Sec-Fetch-Site": "none" }), null)).toBe(true);
    expect(isSameSiteFormPost(post({ Origin: "https://spoonjoy.app" }), null)).toBe(true);
    // The public host fronts the Worker, so the configured base URL also counts as this site.
    expect(isSameSiteFormPost(
      post({ Origin: "https://spoonjoy.app" }, "https://spoonjoy-v2.example.workers.dev/agent/connect"),
      { SPOONJOY_BASE_URL: "https://spoonjoy.app" },
    )).toBe(true);
    expect(isSameSiteFormPost(post({ "Sec-Fetch-Site": "same-site" }), null)).toBe(false);
    expect(isSameSiteFormPost(post({ "Sec-Fetch-Site": "cross-site" }), null)).toBe(false);
    expect(isSameSiteFormPost(post({ Origin: "https://evil.example" }), null)).toBe(false);
    expect(isSameSiteFormPost(post({ Origin: "null" }), null)).toBe(false);
  });

  it("ignores code cookies that are missing or not the expected shape", async () => {
    const request = new Request("http://localhost/agent/connect/abc");
    await expect(typedCodeFor(null, request, "abc")).resolves.toBeNull();

    const odd = await rememberTypedCode(null, request, "abc", 42 as unknown as string);
    const withOdd = new Request("http://localhost/agent/connect/abc", { headers: { Cookie: odd.split(";")[0] } });
    await expect(typedCodeFor(null, withOdd, "abc")).resolves.toBeNull();
  });

  it("reads the caller's network details from Cloudflare, preferring request.cf", () => {
    const request = new Request("https://spoonjoy.app/api/tools/start_agent_connection", {
      headers: { "CF-Connecting-IP": "203.0.113.9", "User-Agent": "agent/1.0", "CF-IPCountry": "US" },
    });
    expect(requestNetworkDetails(request)).toEqual({ ip: "203.0.113.9", userAgent: "agent/1.0", country: "US" });
    Object.defineProperty(request, "cf", { value: { country: "NZ" } });
    expect(requestNetworkDetails(request).country).toBe("NZ");
    expect(requestNetworkDetails(new Request("https://spoonjoy.app/"))).toEqual({ ip: null, userAgent: null, country: null });
  });
});
