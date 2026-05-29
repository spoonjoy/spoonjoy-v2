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

  describe("SESSION_SECRET production-fallback warning", () => {
    it("logs a loud warning when SESSION_SECRET is missing while env.NODE_ENV is production", async () => {
      // Real prod never legitimately hits this path — SESSION_SECRET is always
      // configured as a wrangler secret there. The warning is the operator
      // signal so a misconfigured deploy is loud rather than silent.
      delete process.env.SESSION_SECRET;
      _resetSessionWarningLatchForTests();
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const request = new Request("http://localhost/", { method: "GET" }) as unknown as globalThis.Request;
        await expect(getUserId(request, { NODE_ENV: "production" })).resolves.toBeNull();
        expect(warnSpy).toHaveBeenCalledOnce();
        expect(warnSpy.mock.calls[0][0]).toMatch(/SESSION_SECRET is not set/);
        // Latch fires once per process — a second call must not re-warn.
        await getUserId(request, { NODE_ENV: "production" });
        expect(warnSpy).toHaveBeenCalledOnce();
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("also warns when only process.env.NODE_ENV is production (the build-time path)", async () => {
      delete process.env.SESSION_SECRET;
      _resetSessionWarningLatchForTests();
      vi.stubEnv("NODE_ENV", "production");
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const request = new Request("http://localhost/", { method: "GET" }) as unknown as globalThis.Request;
        await expect(getUserId(request, null)).resolves.toBeNull();
        expect(warnSpy).toHaveBeenCalledOnce();
      } finally {
        warnSpy.mockRestore();
        vi.unstubAllEnvs();
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
