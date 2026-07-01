// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createUserSession,
  destroyUserSession,
  getUserId,
  requireUserId,
  sanitizeSessionRedirect,
  sessionStorage,
  _resetSessionWarningLatchForTests,
} from "~/lib/session.server";
import { Request } from "undici";

describe("session.server", () => {
  let originalSessionSecret: string | undefined;

  function cookieHeader(setCookieHeader: string) {
    return setCookieHeader.split(";")[0];
  }

  beforeEach(() => {
    vi.clearAllMocks();
    originalSessionSecret = process.env.SESSION_SECRET;
  });

  afterEach(() => {
    // Restore original SESSION_SECRET
    if (originalSessionSecret !== undefined) {
      process.env.SESSION_SECRET = originalSessionSecret;
    } else {
      delete process.env.SESSION_SECRET;
    }
  });

  describe("SESSION_SECRET production fallback", () => {
    it("fails closed when SESSION_SECRET is missing while env.NODE_ENV is production", async () => {
      delete process.env.SESSION_SECRET;
      _resetSessionWarningLatchForTests();
      const request = new Request("https://spoonjoy.app/", { method: "GET" }) as unknown as globalThis.Request;
      await expect(getUserId(request, { NODE_ENV: "production" })).rejects.toThrow(/SESSION_SECRET is required/);
    });

    it("also fails closed when only process.env.NODE_ENV is production", async () => {
      delete process.env.SESSION_SECRET;
      _resetSessionWarningLatchForTests();
      vi.stubEnv("NODE_ENV", "production");
      try {
        const request = new Request("https://spoonjoy.app/", { method: "GET" }) as unknown as globalThis.Request;
        await expect(getUserId(request, null)).rejects.toThrow(/SESSION_SECRET is required/);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("does not let a spoofed localhost request host bypass the production session secret requirement", async () => {
      delete process.env.SESSION_SECRET;
      vi.stubEnv("NODE_ENV", "production");
      try {
        const request = new Request("http://localhost:5173/", { method: "GET" }) as unknown as globalThis.Request;

        await expect(getUserId(request, { NODE_ENV: "production" })).rejects.toThrow(/SESSION_SECRET is required/);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("allows explicitly local production-shaped workers to use the dev secret without secure cookies", async () => {
      delete process.env.SESSION_SECRET;
      vi.stubEnv("NODE_ENV", "production");
      try {
        const request = new Request("http://localhost:5173/", { method: "GET" }) as unknown as globalThis.Request;

        await expect(getUserId(request, {
          NODE_ENV: "production",
          SPOONJOY_BASE_URL: "http://localhost:5173",
        })).resolves.toBeNull();

        const response = await createUserSession("local-dogfood-user-id", "/recipes", {
          NODE_ENV: "production",
          SPOONJOY_BASE_URL: "http://localhost:5173",
        }, request);
        const setCookie = response.headers.get("Set-Cookie") ?? "";
        expect(setCookie).toContain("__session=");
        expect(setCookie).not.toContain("Secure");

        const signedInRequest = new Request("http://localhost:5173/recipes", {
          headers: { Cookie: cookieHeader(setCookie) },
        }) as unknown as globalThis.Request;
        await expect(getUserId(signedInRequest, {
          NODE_ENV: "production",
          SPOONJOY_BASE_URL: "http://localhost:5173",
        })).resolves.toBe("local-dogfood-user-id");
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("recognizes explicitly local IPv6 loopback workers", async () => {
      delete process.env.SESSION_SECRET;
      vi.stubEnv("NODE_ENV", "production");
      try {
        const request = new Request("http://[::1]:5173/", { method: "GET" }) as unknown as globalThis.Request;

        const response = await createUserSession("local-ipv6-dogfood-user-id", "/recipes", {
          NODE_ENV: "production",
          SPOONJOY_BASE_URL: "http://[::1]:5173",
        }, request);
        const setCookie = response.headers.get("Set-Cookie") ?? "";
        expect(setCookie).toContain("__session=");
        expect(setCookie).not.toContain("Secure");

        const signedInRequest = new Request("http://[::1]:5173/recipes", {
          headers: { Cookie: cookieHeader(setCookie) },
        }) as unknown as globalThis.Request;
        await expect(getUserId(signedInRequest, {
          NODE_ENV: "production",
          SPOONJOY_BASE_URL: "http://[::1]:5173",
        })).resolves.toBe("local-ipv6-dogfood-user-id");
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("allows explicitly flagged local production-shaped workers without a local base URL", async () => {
      delete process.env.SESSION_SECRET;
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("SPOONJOY_BASE_URL", "https://spoonjoy.app");
      try {
        const request = new Request("http://localhost:5173/", { method: "GET" }) as unknown as globalThis.Request;

        const response = await createUserSession("local-flag-dogfood-user-id", "/recipes", {
          NODE_ENV: "production",
          SPOONJOY_ALLOW_INSECURE_LOCAL_SESSIONS: " yes ",
        }, request);
        const setCookie = response.headers.get("Set-Cookie") ?? "";
        expect(setCookie).toContain("__session=");
        expect(setCookie).not.toContain("Secure");
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("ignores disabled local session flags", async () => {
      delete process.env.SESSION_SECRET;
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("SPOONJOY_BASE_URL", "https://spoonjoy.app");
      vi.stubEnv("SPOONJOY_ALLOW_INSECURE_LOCAL_SESSIONS", "no");
      try {
        const request = new Request("http://localhost:5173/", { method: "GET" }) as unknown as globalThis.Request;

        await expect(getUserId(request, {
          NODE_ENV: "production",
          SPOONJOY_ALLOW_INSECURE_LOCAL_SESSIONS: "no",
        })).rejects.toThrow(/SESSION_SECRET is required/);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("uses secure runtime session cookies when production has a real secret", async () => {
      const request = new Request("https://spoonjoy.app/", { method: "GET" }) as unknown as globalThis.Request;

      const response = await createUserSession("secure-production-user-id", "/recipes", {
        NODE_ENV: "production",
        SESSION_SECRET: "production-runtime-secret",
      }, request);
      const setCookie = response.headers.get("Set-Cookie") ?? "";
      expect(setCookie).toContain("__session=");
      expect(setCookie).toContain("Secure");

      const signedInRequest = new Request("https://spoonjoy.app/recipes", {
        headers: { Cookie: cookieHeader(setCookie) },
      }) as unknown as globalThis.Request;
      await expect(getUserId(signedInRequest, {
        NODE_ENV: "production",
        SESSION_SECRET: "production-runtime-secret",
      })).resolves.toBe("secure-production-user-id");
    });

    it("does not resolve default session storage during production module import", async () => {
      delete process.env.SESSION_SECRET;
      vi.stubEnv("NODE_ENV", "production");
      vi.resetModules();
      try {
        const module = await import("~/lib/session.server");
        expect(module.sessionStorage).toBeDefined();
        const request = new Request("https://spoonjoy.app/", { method: "GET" }) as unknown as globalThis.Request;
        await expect(module.getUserId(request, { NODE_ENV: "production" })).rejects.toThrow(/SESSION_SECRET is required/);
      } finally {
        vi.unstubAllEnvs();
        vi.resetModules();
      }
    });
  });

  describe("getUserId", () => {
    it("should return null when no session exists", async () => {
      const request = new Request("http://localhost:3000/test");
      const userId = await getUserId(request);

      expect(userId).toBeNull();
    });

    it("should return userId from valid session", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", "test-user-id");
      const setCookieHeader = await sessionStorage.commitSession(session);

      // Extract just the cookie value from the Set-Cookie header
      // Set-Cookie format: "name=value; Path=/; HttpOnly; ..."
      const cookieValue = setCookieHeader.split(";")[0];

      // Create headers object explicitly
      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new Request("http://localhost:3000/test", {
        headers,
      });

      const userId = await getUserId(request);
      expect(userId).toBe("test-user-id");
    });

    it("does not trust a default-secret cookie when a runtime session secret is configured", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", "forged-default-cookie-user-id");
      const setCookieHeader = await sessionStorage.commitSession(session);

      const request = new Request("http://localhost:3000/account/settings", {
        headers: { Cookie: cookieHeader(setCookieHeader) },
      });

      await expect(getUserId(request, { SESSION_SECRET: "runtime-secret" })).resolves.toBeNull();
    });
  });

  describe("requireUserId", () => {
    it("should throw redirect response when no session", async () => {
      const request = new Request("http://localhost:3000/test");

      try {
        await requireUserId(request);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(Response);
        expect((error as Response).status).toBe(302);
      }
    });

    it("should return userId from valid session", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", "test-user-id");
      const setCookieHeader = await sessionStorage.commitSession(session);

      // Extract just the cookie value from the Set-Cookie header
      const cookieValue = setCookieHeader.split(";")[0];

      // Create headers object explicitly
      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new Request("http://localhost:3000/test", {
        headers,
      });

      const result = await requireUserId(request);
      expect(result).toBe("test-user-id");
    });
  });

  describe("createUserSession", () => {
    it("should create a session and return redirect response", async () => {
      const response = await createUserSession("test-user-id", "/recipes");

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/recipes");
      expect(response.headers.get("Set-Cookie")).toBeDefined();
    });

    it("initializes default storages from process SESSION_SECRET when present", async () => {
      const original = process.env.SESSION_SECRET;
      process.env.SESSION_SECRET = "process-secret";

      try {
        const response = await createUserSession("process-user-id", "/recipes");
        const request = new Request("http://localhost:3000/recipes", {
          headers: { Cookie: cookieHeader(response.headers.get("Set-Cookie") ?? "") },
        });

        await expect(getUserId(request)).resolves.toBe("process-user-id");
        await expect(getUserId(request, { SESSION_SECRET: "different-secret" })).resolves.toBeNull();
      } finally {
        if (original === undefined) {
          delete process.env.SESSION_SECRET;
        } else {
          process.env.SESSION_SECRET = original;
        }
      }
    });

    it("falls back to the dev secret only when no runtime or process secret exists", async () => {
      const original = process.env.SESSION_SECRET;
      delete process.env.SESSION_SECRET;

      try {
        const response = await createUserSession("dev-secret-user-id", "/recipes");
        const request = new Request("http://localhost:3000/recipes", {
          headers: { Cookie: cookieHeader(response.headers.get("Set-Cookie") ?? "") },
        });

        await expect(getUserId(request)).resolves.toBe("dev-secret-user-id");
        await expect(getUserId(request, { SESSION_SECRET: "different-secret" })).resolves.toBeNull();
      } finally {
        if (original === undefined) {
          delete process.env.SESSION_SECRET;
        } else {
          process.env.SESSION_SECRET = original;
        }
      }
    });

    it("creates cookies that are scoped to the runtime session secret", async () => {
      const response = await createUserSession("test-user-id", "/recipes", {
        SESSION_SECRET: "runtime-secret",
      });
      const headers = new Headers();
      headers.set("Cookie", cookieHeader(response.headers.get("Set-Cookie") ?? ""));
      const request = new Request("http://localhost:3000/recipes", {
        headers,
      });

      await expect(getUserId(request, { SESSION_SECRET: "runtime-secret" })).resolves.toBe("test-user-id");
      await expect(getUserId(request, { SESSION_SECRET: "different-secret" })).resolves.toBeNull();
    });

    it("sanitizes unsafe session redirect targets", async () => {
      expect(sanitizeSessionRedirect("/recipes")).toBe("/recipes");
      expect(sanitizeSessionRedirect("https://evil.example", "/recipes")).toBe("/recipes");
      expect(sanitizeSessionRedirect("//evil.example", "/recipes")).toBe("/recipes");
      expect(sanitizeSessionRedirect("/\\evil.example", "/recipes")).toBe("/recipes");
      expect(sanitizeSessionRedirect("/\u0000evil", "/recipes")).toBe("/recipes");
      expect(sanitizeSessionRedirect(null, "/recipes")).toBe("/recipes");

      const response = await createUserSession("test-user-id", "https://evil.example");
      expect(response.headers.get("Location")).toBe("/");
    });
  });

  describe("destroyUserSession", () => {
    it("destroys sessions through the lazy default storage export", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", "lazy-destroy-user-id");

      const setCookieHeader = await sessionStorage.destroySession(session);

      expect(setCookieHeader).toContain("__session=");
      expect(setCookieHeader).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    });

    it("should destroy session and return redirect response", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", "test-user-id");
      const setCookieHeader = await sessionStorage.commitSession(session);

      // Extract just the cookie value from the Set-Cookie header
      const cookieValue = setCookieHeader.split(";")[0];

      // Create headers object explicitly
      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new Request("http://localhost:3000/logout", {
        headers,
      });

      const response = await destroyUserSession(request, "/");

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/");
      expect(response.headers.get("Set-Cookie")).toBeDefined();
    });
  });
});
