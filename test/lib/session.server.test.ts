// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { faker } from "@faker-js/faker";
import {
  createUserSession,
  createUserSessionCookie,
  destroyUserSession,
  getSessionIdentity,
  getUserId,
  isCurrentSession,
  requireUserId,
  sanitizeSessionRedirect,
  sessionStorage,
  _resetSessionWarningLatchForTests,
} from "~/lib/session.server";
import { getLocalDb } from "~/lib/db.server";
import { Request } from "undici";
import { resolve } from "node:path";
import DatabaseSync from "better-sqlite3";
import { cleanupDatabase } from "../helpers/cleanup";

async function createSessionUser(sessionVersion = 0): Promise<string> {
  const db = await getLocalDb();
  const user = await db.user.create({
    data: {
      email: `session-${faker.string.alphanumeric(10).toLowerCase()}@example.com`,
      username: `session_${faker.string.alphanumeric(10).toLowerCase()}`,
      sessionVersion,
    },
    select: { id: true },
  });
  return user.id;
}

async function cookieFor(values: Record<string, unknown>): Promise<string> {
  const session = await sessionStorage.getSession();
  for (const [key, value] of Object.entries(values)) session.set(key, value);
  return (await sessionStorage.commitSession(session)).split(";")[0];
}

function requestWithCookie(cookie: string, url = "http://localhost:3000/account/settings") {
  return new Request(url, { headers: { Cookie: cookie } }) as unknown as globalThis.Request;
}

async function thrownResponse(promise: Promise<unknown>): Promise<Response> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(Response);
    return error as Response;
  }
  throw new Error("Expected a thrown Response");
}

describe("revocable sessions", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("stores the user's current session version in new session cookies", async () => {
    const userId = await createSessionUser(3);

    const cookie = (await createUserSessionCookie(userId)).split(";")[0];

    await expect(getSessionIdentity(requestWithCookie(cookie))).resolves.toEqual({ userId, sessionVersion: 3 });
    await expect(getUserId(requestWithCookie(cookie))).resolves.toBe(userId);
  });

  it("uses a caller-supplied session version without reading the user", async () => {
    const userId = await createSessionUser(0);
    const db = await getLocalDb();
    const findUnique = vi.spyOn(db.user, "findUnique");

    try {
      const cookie = (await createUserSessionCookie(userId, null, null, { sessionVersion: 0 })).split(";")[0];
      expect(findUnique).not.toHaveBeenCalled();
      await expect(getSessionIdentity(requestWithCookie(cookie))).resolves.toEqual({ userId, sessionVersion: 0 });
    } finally {
      findUnique.mockRestore();
    }
  });

  it("accepts a cookie issued before session versions existed as version 0", async () => {
    const userId = await createSessionUser(0);
    const cookie = await cookieFor({ userId });

    await expect(getSessionIdentity(requestWithCookie(cookie))).resolves.toEqual({ userId, sessionVersion: 0 });
    await expect(getUserId(requestWithCookie(cookie))).resolves.toBe(userId);
    await expect(requireUserId(requestWithCookie(cookie))).resolves.toBe(userId);
  });

  it("rejects a cookie without a version once the user's version has been bumped", async () => {
    const userId = await createSessionUser(1);
    const cookie = await cookieFor({ userId });

    await expect(getUserId(requestWithCookie(cookie))).resolves.toBeNull();
  });

  it("rejects a cookie whose version does not match the user's current version", async () => {
    const userId = await createSessionUser(0);
    const cookie = (await createUserSessionCookie(userId)).split(";")[0];
    const db = await getLocalDb();
    await db.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });

    await expect(getUserId(requestWithCookie(cookie))).resolves.toBeNull();
  });

  it("rejects a cookie for a user that no longer exists", async () => {
    const userId = await createSessionUser(0);
    const cookie = (await createUserSessionCookie(userId)).split(";")[0];
    const db = await getLocalDb();
    await db.user.delete({ where: { id: userId } });

    await expect(getUserId(requestWithCookie(cookie))).resolves.toBeNull();
  });

  it("mints version 0 for a user id that does not exist, which the read then rejects", async () => {
    const cookie = (await createUserSessionCookie("missing-user-id")).split(";")[0];

    await expect(getSessionIdentity(requestWithCookie(cookie))).resolves.toEqual({
      userId: "missing-user-id",
      sessionVersion: 0,
    });
    await expect(getUserId(requestWithCookie(cookie))).resolves.toBeNull();
  });

  it.each([
    ["a negative version", -1],
    ["a fractional version", 1.5],
    ["a string version", "0"],
    ["a null version", null],
  ])("treats a cookie with %s as signed out", async (_label, sessionVersion) => {
    const userId = await createSessionUser(0);
    const cookie = await cookieFor({ userId, sessionVersion });

    await expect(getSessionIdentity(requestWithCookie(cookie))).resolves.toBeNull();
    await expect(getUserId(requestWithCookie(cookie))).resolves.toBeNull();
  });

  it("treats a cookie with an empty or non-string user id as signed out", async () => {
    await expect(getSessionIdentity(requestWithCookie(await cookieFor({ userId: "" })))).resolves.toBeNull();
    await expect(getSessionIdentity(requestWithCookie(await cookieFor({ userId: 42 })))).resolves.toBeNull();
  });

  it("clears a revoked cookie when requireUserId redirects to sign-in", async () => {
    const userId = await createSessionUser(2);
    const cookie = await cookieFor({ userId, sessionVersion: 1 });

    const response = await thrownResponse(requireUserId(requestWithCookie(cookie)));

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/login?redirectTo=%2Faccount%2Fsettings");
    expect(response.headers.get("Set-Cookie")).toContain("__session=;");
    expect(response.headers.get("Set-Cookie")).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  });

  it("clears a malformed cookie when requireUserId redirects to sign-in", async () => {
    const cookie = await cookieFor({ userId: "someone", sessionVersion: "nope" });

    const response = await thrownResponse(requireUserId(requestWithCookie(cookie)));

    expect(response.headers.get("Set-Cookie")).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  });

  it("does not set a cookie when requireUserId redirects a visitor who never signed in", async () => {
    const response = await thrownResponse(requireUserId(requestWithCookie("")));

    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  it("reads the user's version once per request and environment, however many loaders ask", async () => {
    const userId = await createSessionUser(0);
    const cookie = (await createUserSessionCookie(userId)).split(";")[0];
    const request = requestWithCookie(cookie);
    const db = await getLocalDb();
    const findUnique = vi.spyOn(db.user, "findUnique");

    try {
      await expect(Promise.all([
        getUserId(request),
        getUserId(request, null),
        requireUserId(request),
      ])).resolves.toEqual([userId, userId, userId]);
      expect(findUnique).toHaveBeenCalledTimes(1);
      expect(findUnique).toHaveBeenCalledWith({ where: { id: userId }, select: { sessionVersion: true } });

      await expect(getUserId(requestWithCookie(cookie))).resolves.toBe(userId);
      expect(findUnique).toHaveBeenCalledTimes(2);
    } finally {
      findUnique.mockRestore();
    }
  });

  it("does not read the database when the request carries no session", async () => {
    const db = await getLocalDb();
    const findUnique = vi.spyOn(db.user, "findUnique");

    try {
      await expect(getUserId(requestWithCookie(""))).resolves.toBeNull();
      expect(findUnique).not.toHaveBeenCalled();
    } finally {
      findUnique.mockRestore();
    }
  });

  describe("on a D1 binding", () => {
    // A fake D1 binding backed by the real test database, so the raw statement runs against the
    // real schema (table and column quoting included) without Prisma.
    function sqliteD1() {
      const sqlite = new DatabaseSync(resolve(__dirname, "../../prisma/test.db"), { readonly: true });
      const statements: Array<{ sql: string; params: unknown[] }> = [];
      const binding = {
        prepare(sql: string) {
          return {
            bind(...params: unknown[]) {
              statements.push({ sql, params });
              return { first: async () => (sqlite.prepare(sql).get(...params) as unknown) ?? null };
            },
          };
        },
      };
      return { binding, statements, close: () => sqlite.close() };
    }

    async function withoutPrisma<T>(run: (module: typeof import("~/lib/session.server")) => Promise<T>) {
      vi.resetModules();
      const getDb = vi.fn();
      const getLocalDb = vi.fn();
      vi.doMock("~/lib/db.server", () => ({ getDb, getLocalDb }));
      try {
        const result = await run(await import("~/lib/session.server"));
        expect(getDb).not.toHaveBeenCalled();
        expect(getLocalDb).not.toHaveBeenCalled();
        return result;
      } finally {
        vi.doUnmock("~/lib/db.server");
        vi.resetModules();
      }
    }

    it("checks the version with one prepared statement and never constructs a Prisma client", async () => {
      const userId = await createSessionUser(2);
      const cookie = await cookieFor({ userId, sessionVersion: 2 });
      const d1 = sqliteD1();

      try {
        await withoutPrisma(async (module) => {
          const env = { DB: d1.binding };
          const request = requestWithCookie(cookie);
          await expect(module.getUserId(request, env)).resolves.toBe(userId);
          await expect(module.requireUserId(request, "/login", env)).resolves.toBe(userId);
        });
        expect(d1.statements).toEqual([
          { sql: 'SELECT "sessionVersion" FROM "User" WHERE "id" = ?', params: [userId] },
        ]);
      } finally {
        d1.close();
      }
    });

    it("rejects a revoked or deleted user's cookie through the binding", async () => {
      const userId = await createSessionUser(3);
      const d1 = sqliteD1();

      try {
        await withoutPrisma(async (module) => {
          const env = { DB: d1.binding };
          await expect(module.getUserId(requestWithCookie(await cookieFor({ userId, sessionVersion: 2 })), env))
            .resolves.toBeNull();
          await expect(module.getUserId(requestWithCookie(await cookieFor({ userId: "deleted-user" })), env))
            .resolves.toBeNull();
        });
      } finally {
        d1.close();
      }
    });

    it("mints sign-in cookies at the version read through the binding", async () => {
      const userId = await createSessionUser(5);
      const d1 = sqliteD1();

      try {
        const cookie = await withoutPrisma(async (module) =>
          (await module.createUserSessionCookie(userId, { DB: d1.binding })).split(";")[0]);
        await expect(getSessionIdentity(requestWithCookie(cookie))).resolves.toEqual({ userId, sessionVersion: 5 });
      } finally {
        d1.close();
      }
    });
  });

  it("compares a cookie's version with the user's current version", () => {
    const identity = { userId: "user", sessionVersion: 2 };

    expect(isCurrentSession(identity, 2)).toBe(true);
    expect(isCurrentSession(identity, 3)).toBe(false);
    expect(isCurrentSession(identity, 1)).toBe(false);
    expect(isCurrentSession(identity, null)).toBe(false);
    expect(isCurrentSession(identity, undefined)).toBe(false);
  });
});

describe("session.server", () => {
  let originalSessionSecret: string | undefined;

  function cookieHeader(setCookieHeader: string) {
    return setCookieHeader.split(";")[0];
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    originalSessionSecret = process.env.SESSION_SECRET;
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
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
        const localDogfoodUserId = await createSessionUser();
        const request = new Request("http://localhost:5173/", { method: "GET" }) as unknown as globalThis.Request;

        await expect(getUserId(request, {
          NODE_ENV: "production",
          SPOONJOY_BASE_URL: "http://localhost:5173",
        })).resolves.toBeNull();

        const response = await createUserSession(localDogfoodUserId, "/recipes", {
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
        })).resolves.toBe(localDogfoodUserId);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("recognizes explicitly local IPv6 loopback workers", async () => {
      delete process.env.SESSION_SECRET;
      vi.stubEnv("NODE_ENV", "production");
      try {
        const localIpv6DogfoodUserId = await createSessionUser();
        const request = new Request("http://[::1]:5173/", { method: "GET" }) as unknown as globalThis.Request;

        const response = await createUserSession(localIpv6DogfoodUserId, "/recipes", {
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
        })).resolves.toBe(localIpv6DogfoodUserId);
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
      const secureProductionUserId = await createSessionUser();
      const request = new Request("https://spoonjoy.app/", { method: "GET" }) as unknown as globalThis.Request;

      const response = await createUserSession(secureProductionUserId, "/recipes", {
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
      })).resolves.toBe(secureProductionUserId);
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
      const testUserId = await createSessionUser();
      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
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
      expect(userId).toBe(testUserId);
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
      const testUserId = await createSessionUser();
      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
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
      expect(result).toBe(testUserId);
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
        const processUserId = await createSessionUser();
        const response = await createUserSession(processUserId, "/recipes");
        const request = new Request("http://localhost:3000/recipes", {
          headers: { Cookie: cookieHeader(response.headers.get("Set-Cookie") ?? "") },
        });

        await expect(getUserId(request)).resolves.toBe(processUserId);
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
        const devSecretUserId = await createSessionUser();
        const response = await createUserSession(devSecretUserId, "/recipes");
        const request = new Request("http://localhost:3000/recipes", {
          headers: { Cookie: cookieHeader(response.headers.get("Set-Cookie") ?? "") },
        });

        await expect(getUserId(request)).resolves.toBe(devSecretUserId);
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
      const testUserId = await createSessionUser();
      const response = await createUserSession(testUserId, "/recipes", {
        SESSION_SECRET: "runtime-secret",
      });
      const headers = new Headers();
      headers.set("Cookie", cookieHeader(response.headers.get("Set-Cookie") ?? ""));
      const request = new Request("http://localhost:3000/recipes", {
        headers,
      });

      await expect(getUserId(request, { SESSION_SECRET: "runtime-secret" })).resolves.toBe(testUserId);
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
