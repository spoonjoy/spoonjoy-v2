import { describe, expect, it } from "vitest";
import {
  SECURITY_HEADERS,
  buildContentSecurityPolicy,
  generateNonce,
  resolvePostHogCspOrigins,
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

  it("defaults to CSP report-only for local/dev and rollback-safe responses", () => {
    const result = withSecurityHeaders(new Response("ok"));
    expect(result.headers.get("Content-Security-Policy-Report-Only")).toBe(
      buildContentSecurityPolicy(),
    );
    expect(result.headers.get("Content-Security-Policy")).toBeNull();
  });

  it("embeds the per-request nonce in the default report-only CSP when provided", () => {
    const result = withSecurityHeaders(new Response("ok"), "test-nonce-123");
    expect(result.headers.get("Content-Security-Policy-Report-Only")).toBe(
      buildContentSecurityPolicy("test-nonce-123"),
    );
    expect(result.headers.get("Content-Security-Policy-Report-Only")).toContain(
      "'nonce-test-nonce-123'",
    );
  });

  it("ships an enforcing CSP, not report-only, when the environment selects enforcement", () => {
    const result = withSecurityHeaders(
      new Response("ok"),
      "enforced-nonce",
      { SPOONJOY_CSP_MODE: "enforce" },
    );

    expect(result.headers.get("Content-Security-Policy")).toBe(
      buildContentSecurityPolicy("enforced-nonce"),
    );
    expect(result.headers.get("Content-Security-Policy")).toContain("'nonce-enforced-nonce'");
    expect(result.headers.get("Content-Security-Policy-Report-Only")).toBeNull();
  });

  it("keeps the one-commit rollback flag report-only and non-enforcing", () => {
    const result = withSecurityHeaders(
      new Response("ok"),
      "rollback-nonce",
      { SPOONJOY_CSP_MODE: "report-only" },
    );

    expect(result.headers.get("Content-Security-Policy-Report-Only")).toBe(
      buildContentSecurityPolicy("rollback-nonce"),
    );
    expect(result.headers.get("Content-Security-Policy")).toBeNull();
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

  it("uses the configured HTTPS PostHog host and matching assets origin", () => {
    const csp = buildContentSecurityPolicy("abc", {
      VITE_POSTHOG_HOST: " https://eu.i.posthog.com/project/123?ignored=1 ",
    });

    expect(directiveSources(csp, "script-src")).toEqual([
      "'self'",
      "'nonce-abc'",
      "https://eu-assets.i.posthog.com",
    ]);
    expect(directiveSources(csp, "connect-src")).toEqual([
      "'self'",
      "https://eu.i.posthog.com",
      "https://eu-assets.i.posthog.com",
    ]);
  });

  it("allows a validated custom HTTPS PostHog origin without carrying URL path data", () => {
    const csp = buildContentSecurityPolicy(undefined, {
      VITE_POSTHOG_HOST: "https://analytics.example.com/posthog?secret=ignored",
    });

    expect(directiveSources(csp, "script-src")).toEqual([
      "'self'",
      "https://analytics.example.com",
    ]);
    expect(directiveSources(csp, "connect-src")).toEqual([
      "'self'",
      "https://analytics.example.com",
    ]);
    expect(csp).not.toContain("secret=ignored");
    expect(csp).not.toContain("/posthog");
  });

  it("falls back to the conservative US PostHog origins for unsafe configured hosts", () => {
    for (const VITE_POSTHOG_HOST of [
      "http://eu.i.posthog.com",
      "javascript:alert(1)",
      "https://user:pass@eu.i.posthog.com",
      "   ",
      "not a url",
    ]) {
      expect(resolvePostHogCspOrigins({ VITE_POSTHOG_HOST })).toEqual({
        ingestOrigin: "https://us.i.posthog.com",
        assetsOrigin: "https://us-assets.i.posthog.com",
      });
    }
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
