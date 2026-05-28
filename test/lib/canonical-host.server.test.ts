// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  canonicalizeOrigin,
  canonicalizeRequestUrl,
  canonicalizeRequestUrlForHost,
  requestCanonicalOrigin,
} from "~/lib/canonical-host.server";

describe("canonical-host.server", () => {
  it("redirects the www Spoonjoy host to the apex host over https", () => {
    const url = canonicalizeRequestUrl("http://www.spoonjoy.app/login?redirectTo=%2Frecipes");

    expect(url?.toString()).toBe("https://spoonjoy.app/login?redirectTo=%2Frecipes");
  });

  it("leaves canonical and non-Spoonjoy hosts alone", () => {
    expect(canonicalizeRequestUrl("https://spoonjoy.app/login")).toBeNull();
    expect(canonicalizeRequestUrl("https://spoonjoy-v2.mendelow-studio.workers.dev/login")).toBeNull();
  });

  it("accepts URL objects without mutating the original", () => {
    const original = new URL("https://www.spoonjoy.app/auth/apple");
    const canonical = canonicalizeRequestUrl(original);

    expect(canonical?.origin).toBe("https://spoonjoy.app");
    expect(original.origin).toBe("https://www.spoonjoy.app");
  });

  it("redirects when the public host arrives through a forwarded host header", () => {
    const url = canonicalizeRequestUrlForHost(
      "https://spoonjoy-v2.mendelow-studio.workers.dev/login",
      "www.spoonjoy.app"
    );

    expect(url?.toString()).toBe("https://spoonjoy.app/login");
  });

  it("normalizes comma-separated and port-bearing forwarded host headers", () => {
    const url = canonicalizeRequestUrlForHost(
      "https://spoonjoy-v2.mendelow-studio.workers.dev/auth/apple?x=1",
      "WWW.SPOONJOY.APP:443, spoonjoy-v2.mendelow-studio.workers.dev"
    );

    expect(url?.toString()).toBe("https://spoonjoy.app/auth/apple?x=1");
  });

  it("accepts URL objects when canonicalizing from host headers", () => {
    const url = canonicalizeRequestUrlForHost(
      new URL("https://spoonjoy-v2.mendelow-studio.workers.dev/login"),
      "www.spoonjoy.app"
    );

    expect(url?.toString()).toBe("https://spoonjoy.app/login");
  });

  it("falls back to the request URL for absent and unsupported host headers", () => {
    expect(canonicalizeRequestUrlForHost("https://www.spoonjoy.app/login", null)?.toString()).toBe(
      "https://spoonjoy.app/login"
    );
    expect(
      canonicalizeRequestUrlForHost("https://spoonjoy-v2.mendelow-studio.workers.dev/login", "[::1]:8787")
    ).toBeNull();
    expect(canonicalizeRequestUrlForHost("https://spoonjoy-v2.mendelow-studio.workers.dev/login", ":443")).toBeNull();
  });

  it("canonicalizes origins for provider callback URLs", () => {
    expect(canonicalizeOrigin("https://www.spoonjoy.app")).toBe("https://spoonjoy.app");
    expect(canonicalizeOrigin("https://local.spoonjoy.app:8787")).toBe("https://local.spoonjoy.app:8787");
  });

  describe("requestCanonicalOrigin", () => {
    it("falls back to the request origin when no forwarded host is present", () => {
      expect(requestCanonicalOrigin(new Request("https://spoonjoy.app/auth/webauthn/x"))).toBe(
        "https://spoonjoy.app"
      );
      expect(requestCanonicalOrigin(new Request("http://localhost:5173/auth/webauthn/x"))).toBe(
        "http://localhost:5173"
      );
    });

    it("prefers the forwarded public host over the internal worker host", () => {
      const request = new Request("https://spoonjoy-v2.mendelow-studio.workers.dev/auth/webauthn/x", {
        headers: { "X-Forwarded-Host": "spoonjoy.app", "X-Forwarded-Proto": "https" },
      });
      expect(requestCanonicalOrigin(request)).toBe("https://spoonjoy.app");
    });

    it("honors a forwarded http proto for local proxies", () => {
      const request = new Request("https://spoonjoy-v2.mendelow-studio.workers.dev/auth/webauthn/x", {
        headers: { "X-Forwarded-Host": "local.spoonjoy.app:8787", "X-Forwarded-Proto": "http" },
      });
      expect(requestCanonicalOrigin(request)).toBe("http://local.spoonjoy.app:8787");
    });

    it("falls back to the request's https scheme when the forwarded proto is missing", () => {
      const request = new Request("https://spoonjoy-v2.mendelow-studio.workers.dev/auth/webauthn/x", {
        headers: { "X-Forwarded-Host": "spoonjoy.app" },
      });
      expect(requestCanonicalOrigin(request)).toBe("https://spoonjoy.app");
    });

    it("falls back to the request's http scheme when the proto is missing (local dev)", () => {
      // The dev server forwards the host but not the proto and serves plain
      // http; defaulting to https would break the WebAuthn origin check.
      const request = new Request("http://localhost:5173/auth/webauthn/x", {
        headers: { "X-Forwarded-Host": "localhost:5173" },
      });
      expect(requestCanonicalOrigin(request)).toBe("http://localhost:5173");
    });

    it("canonicalizes a forwarded www host to the apex host", () => {
      const request = new Request("https://spoonjoy-v2.mendelow-studio.workers.dev/auth/webauthn/x", {
        headers: { "X-Forwarded-Host": "www.spoonjoy.app", "X-Forwarded-Proto": "https" },
      });
      expect(requestCanonicalOrigin(request)).toBe("https://spoonjoy.app");
    });

    it("ignores a malformed forwarded host and uses the request origin", () => {
      const request = new Request("https://spoonjoy-v2.mendelow-studio.workers.dev/auth/webauthn/x", {
        headers: { "X-Forwarded-Host": "spoonjoy.app/evil", "X-Forwarded-Proto": "https" },
      });
      expect(requestCanonicalOrigin(request)).toBe("https://spoonjoy-v2.mendelow-studio.workers.dev");
    });
  });
});
