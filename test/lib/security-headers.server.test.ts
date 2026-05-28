import { describe, expect, it } from "vitest";
import { SECURITY_HEADERS, withSecurityHeaders } from "~/lib/security-headers.server";

describe("withSecurityHeaders", () => {
  it("adds every baseline security header", async () => {
    const result = withSecurityHeaders(new Response("ok", { status: 200 }));
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(result.headers.get(name)).toBe(value);
    }
  });

  it("preserves the original status, body, and existing headers", async () => {
    const original = new Response("hello", {
      status: 201,
      statusText: "Created",
      headers: { "X-Existing": "kept", "Content-Type": "text/plain" },
    });

    const result = withSecurityHeaders(original);

    expect(result.status).toBe(201);
    expect(result.statusText).toBe("Created");
    expect(result.headers.get("X-Existing")).toBe("kept");
    expect(result.headers.get("Content-Type")).toBe("text/plain");
    await expect(result.text()).resolves.toBe("hello");
  });

  it("carries the Location header through on a redirect (null body)", () => {
    const result = withSecurityHeaders(
      new Response(null, { status: 308, headers: { Location: "https://spoonjoy.app/" } }),
    );
    expect(result.status).toBe(308);
    expect(result.headers.get("Location")).toBe("https://spoonjoy.app/");
    expect(result.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("does not constrain WebAuthn — Permissions-Policy leaves publickey-credentials alone", () => {
    const result = withSecurityHeaders(new Response("ok"));
    const permissions = result.headers.get("Permissions-Policy") ?? "";
    expect(permissions).not.toContain("publickey-credentials");
    expect(permissions).toContain("camera=()");
  });
});
