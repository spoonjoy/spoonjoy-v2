import { describe, expect, it } from "vitest";
import {
  SECURITY_HEADERS,
  buildContentSecurityPolicy,
  generateNonce,
  withSecurityHeaders,
} from "~/lib/security-headers.server";

function directiveSources(csp: string, directive: string): string[] {
  const clause = csp
    .split("; ")
    .find((part) => part === directive || part.startsWith(`${directive} `));
  if (!clause) return [];
  return clause.split(" ").slice(1);
}

describe("withSecurityHeaders", () => {
  it("adds every baseline (non-CSP) security header", () => {
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

  it("ships the CSP report-only (never the enforcing header)", () => {
    const result = withSecurityHeaders(new Response("ok"));
    expect(result.headers.get("Content-Security-Policy-Report-Only")).toBe(
      buildContentSecurityPolicy(),
    );
    // Report-only must NOT enforce — the enforcing header stays absent.
    expect(result.headers.get("Content-Security-Policy")).toBeNull();
  });

  it("embeds the per-request nonce in the report-only CSP when provided", () => {
    const result = withSecurityHeaders(new Response("ok"), "test-nonce-123");
    expect(result.headers.get("Content-Security-Policy-Report-Only")).toBe(
      buildContentSecurityPolicy("test-nonce-123"),
    );
    expect(result.headers.get("Content-Security-Policy-Report-Only")).toContain(
      "'nonce-test-nonce-123'",
    );
  });
});

describe("buildContentSecurityPolicy", () => {
  it("locks down the framing/object/base/form surface", () => {
    const csp = buildContentSecurityPolicy();
    expect(directiveSources(csp, "default-src")).toEqual(["'self'"]);
    expect(directiveSources(csp, "base-uri")).toEqual(["'self'"]);
    expect(directiveSources(csp, "object-src")).toEqual(["'none'"]);
    expect(directiveSources(csp, "frame-ancestors")).toEqual(["'none'"]);
    expect(directiveSources(csp, "form-action")).toEqual(["'self'"]);
  });

  it("nonces script-src and drops 'unsafe-inline' when a nonce is supplied", () => {
    const csp = buildContentSecurityPolicy("abc");
    expect(directiveSources(csp, "script-src")).toEqual([
      "'self'",
      "'nonce-abc'",
      "https://us-assets.i.posthog.com",
    ]);
    expect(directiveSources(csp, "script-src")).not.toContain("'unsafe-inline'");
  });

  it("omits the nonce token from script-src for non-HTML responses (no inline scripts)", () => {
    const csp = buildContentSecurityPolicy();
    expect(directiveSources(csp, "script-src")).toEqual([
      "'self'",
      "https://us-assets.i.posthog.com",
    ]);
    expect(directiveSources(csp, "script-src")).not.toContain("'unsafe-inline'");
  });

  it("keeps 'unsafe-inline' on style-src (React style attributes cannot be nonced)", () => {
    const csp = buildContentSecurityPolicy("abc");
    expect(directiveSources(csp, "style-src")).toEqual([
      "'self'",
      "'unsafe-inline'",
      "https://fonts.googleapis.com",
    ]);
  });

  it("allows the real runtime dependencies (fonts, broad images, PostHog ingest)", () => {
    const csp = buildContentSecurityPolicy();
    expect(directiveSources(csp, "font-src")).toEqual(["'self'", "https://fonts.gstatic.com"]);
    expect(directiveSources(csp, "img-src")).toEqual(["'self'", "data:", "blob:", "https:"]);
    expect(directiveSources(csp, "connect-src")).toEqual([
      "'self'",
      "https://us.i.posthog.com",
      "https://us-assets.i.posthog.com",
    ]);
  });

  it("points violations at the sink route (legacy report-uri + modern report-to)", () => {
    const csp = buildContentSecurityPolicy();
    expect(directiveSources(csp, "report-uri")).toEqual(["/csp-report"]);
    expect(directiveSources(csp, "report-to")).toEqual(["csp-endpoint"]);
  });
});

describe("generateNonce", () => {
  it("returns a non-empty base64 string, unique per call", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(a.length).toBeGreaterThanOrEqual(16);
    expect(a).not.toBe(b);
  });
});
