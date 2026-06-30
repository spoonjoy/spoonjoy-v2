import { describe, expect, it } from "vitest";
import { CSP_REPORT_ONLY, SECURITY_HEADERS, withSecurityHeaders } from "~/lib/security-headers.server";

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

  it("preserves an explicit no-referrer policy for sensitive routes", () => {
    const result = withSecurityHeaders(
      new Response("ok", { headers: { "Referrer-Policy": "no-referrer" } }),
    );

    expect(result.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("normalizes weaker explicit referrer policies to the baseline", () => {
    const result = withSecurityHeaders(
      new Response("ok", { headers: { "Referrer-Policy": "unsafe-url" } }),
    );

    expect(result.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
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

  it("ships the Content-Security-Policy report-only (never the enforcing header)", () => {
    const result = withSecurityHeaders(new Response("ok"));
    expect(result.headers.get("Content-Security-Policy-Report-Only")).toBe(CSP_REPORT_ONLY);
    // Report-only must NOT enforce — the enforcing header stays absent.
    expect(result.headers.get("Content-Security-Policy")).toBeNull();
  });
});

describe("CSP_REPORT_ONLY", () => {
  function directiveSources(directive: string): string[] {
    const clause = CSP_REPORT_ONLY.split("; ").find((part) => part === directive || part.startsWith(`${directive} `));
    if (!clause) return [];
    return clause.split(" ").slice(1);
  }

  it("locks down the framing/object/base/form surface", () => {
    expect(directiveSources("default-src")).toEqual(["'self'"]);
    expect(directiveSources("base-uri")).toEqual(["'self'"]);
    expect(directiveSources("object-src")).toEqual(["'none'"]);
    expect(directiveSources("frame-ancestors")).toEqual(["'none'"]);
    expect(directiveSources("form-action")).toEqual(["'self'"]);
  });

  it("allows the real runtime dependencies (PostHog, Google Fonts, broad images)", () => {
    expect(directiveSources("script-src")).toEqual([
      "'self'",
      "'unsafe-inline'",
      "https://us-assets.i.posthog.com",
    ]);
    expect(directiveSources("style-src")).toEqual([
      "'self'",
      "'unsafe-inline'",
      "https://fonts.googleapis.com",
    ]);
    expect(directiveSources("font-src")).toEqual(["'self'", "https://fonts.gstatic.com"]);
    expect(directiveSources("img-src")).toEqual(["'self'", "data:", "blob:", "https:"]);
    expect(directiveSources("connect-src")).toEqual([
      "'self'",
      "https://us.i.posthog.com",
      "https://us-assets.i.posthog.com",
    ]);
  });

  it("points violations at the sink route", () => {
    expect(directiveSources("report-uri")).toEqual(["/csp-report"]);
  });
});
