// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  canonicalizeOrigin,
  canonicalizeRequestUrl,
  canonicalizeRequestUrlForHost,
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
});
