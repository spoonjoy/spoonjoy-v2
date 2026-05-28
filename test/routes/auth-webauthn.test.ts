// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";

vi.mock("~/lib/webauthn.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/webauthn.server")>();
  return {
    ...actual,
    buildRegistrationOptions: vi.fn(),
    verifyRegistration: vi.fn(),
    credentialFromRegistration: vi.fn(),
    buildAuthenticationOptions: vi.fn(),
    verifyAuthentication: vi.fn(),
  };
});

import {
  buildAuthenticationOptions,
  buildRegistrationOptions,
  credentialFromRegistration,
  verifyAuthentication,
  verifyRegistration,
} from "~/lib/webauthn.server";
import { action as registerOptions } from "~/routes/auth.webauthn.register.options";
import { action as registerVerify } from "~/routes/auth.webauthn.register.verify";
import { action as authenticateOptions } from "~/routes/auth.webauthn.authenticate.options";
import { action as authenticateVerify } from "~/routes/auth.webauthn.authenticate.verify";
import { getLocalDb } from "~/lib/db.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser } from "../utils";

function routeArgs(request: Request) {
  return { request, params: {}, context: { cloudflare: { env: null } } } as never;
}

function routeArgsRateLimited(request: Request) {
  return {
    request,
    params: {},
    context: {
      cloudflare: { env: { AUTH_IP_RATE_LIMITER: { limit: async () => ({ success: false }) } } },
    },
  } as never;
}

async function sessionCookie(userId: string) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  return (await sessionStorage.commitSession(session)).split(";")[0];
}

function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new UndiciRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  }) as unknown as Request;
}

describe("WebAuthn routes", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
    vi.clearAllMocks();
  });
  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("register/options", () => {
    it("401s without a session", async () => {
      const res = await registerOptions(routeArgs(jsonRequest("https://spoonjoy.app/auth/webauthn/register/options", {})));
      expect(res.status).toBe(401);
    });

    it("returns options for an authenticated user", async () => {
      const user = await db.user.create({ data: createTestUser() });
      vi.mocked(buildRegistrationOptions).mockResolvedValue({ challenge: "c" } as never);
      const res = await registerOptions(routeArgs(jsonRequest(
        "https://spoonjoy.app/auth/webauthn/register/options",
        {},
        { Cookie: await sessionCookie(user.id) },
      )));
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ challenge: "c" });
    });

    it("maps orchestration errors to their status", async () => {
      const cookie = await sessionCookie("ghost-user-id");
      const res = await registerOptions(routeArgs(jsonRequest(
        "https://spoonjoy.app/auth/webauthn/register/options",
        {},
        { Cookie: cookie },
      )));
      expect(res.status).toBe(404);
    });
  });

  describe("register/verify", () => {
    it("401s without a session", async () => {
      const res = await registerVerify(routeArgs(jsonRequest("https://spoonjoy.app/auth/webauthn/register/verify", { response: {} })));
      expect(res.status).toBe(401);
    });

    it("400s on missing response", async () => {
      const user = await db.user.create({ data: createTestUser() });
      const res = await registerVerify(routeArgs(jsonRequest(
        "https://spoonjoy.app/auth/webauthn/register/verify",
        {},
        { Cookie: await sessionCookie(user.id) },
      )));
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ error: "Missing registration response" });
    });

    it("400s on invalid JSON", async () => {
      const user = await db.user.create({ data: createTestUser() });
      const req = new UndiciRequest("https://spoonjoy.app/auth/webauthn/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: await sessionCookie(user.id) },
        body: "not-json",
      }) as unknown as Request;
      const res = await registerVerify(routeArgs(req));
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ error: "Invalid JSON body" });
    });

    it("verifies and persists for an authenticated user", async () => {
      const user = await db.user.create({ data: { ...createTestUser(), webAuthnChallenge: "reg_chal" } });
      vi.mocked(verifyRegistration).mockResolvedValue({ verified: true } as never);
      vi.mocked(credentialFromRegistration).mockReturnValue({
        id: "cred_route", publicKey: new Uint8Array([1]), counter: 0n, transports: null,
      });
      const res = await registerVerify(routeArgs(jsonRequest(
        "https://spoonjoy.app/auth/webauthn/register/verify",
        { response: { id: "cred_route" } },
        { Cookie: await sessionCookie(user.id) },
      )));
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({ verified: true, credentialId: "cred_route" });
    });
  });

  describe("authenticate/options", () => {
    it("429s when the auth rate limiter is exhausted", async () => {
      const res = await authenticateOptions(routeArgsRateLimited(jsonRequest(
        "https://spoonjoy.app/auth/webauthn/authenticate/options",
        { email: "x@example.com" },
        { "CF-Connecting-IP": "203.0.113.5" },
      )));
      expect(res.status).toBe(429);
    });

    it("400s without an email", async () => {
      const res = await authenticateOptions(routeArgs(jsonRequest("https://spoonjoy.app/auth/webauthn/authenticate/options", {})));
      expect(res.status).toBe(400);
    });

    it("400s on invalid JSON", async () => {
      const req = new UndiciRequest("https://spoonjoy.app/auth/webauthn/authenticate/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{bad",
      }) as unknown as Request;
      const res = await authenticateOptions(routeArgs(req));
      expect(res.status).toBe(400);
    });

    it("returns options for a known email", async () => {
      const user = await db.user.create({ data: createTestUser() });
      vi.mocked(buildAuthenticationOptions).mockResolvedValue({ challenge: "ac" } as never);
      const res = await authenticateOptions(routeArgs(jsonRequest(
        "https://spoonjoy.app/auth/webauthn/authenticate/options",
        { email: user.email },
      )));
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ challenge: "ac" });
    });
  });

  describe("authenticate/verify", () => {
    it("429s when the auth rate limiter is exhausted", async () => {
      const res = await authenticateVerify(routeArgsRateLimited(jsonRequest(
        "https://spoonjoy.app/auth/webauthn/authenticate/verify",
        { email: "x@example.com", response: { id: "vc" } },
        { "CF-Connecting-IP": "203.0.113.6" },
      )));
      expect(res.status).toBe(429);
    });

    it("400s without email + response", async () => {
      const res = await authenticateVerify(routeArgs(jsonRequest("https://spoonjoy.app/auth/webauthn/authenticate/verify", { email: "x@example.com" })));
      expect(res.status).toBe(400);
    });

    it("mints a session cookie on a verified passkey", async () => {
      const user = await db.user.create({
        data: { ...createTestUser(), email: "passkey-login@example.com", webAuthnChallenge: "ac" },
      });
      await db.userCredential.create({ data: { id: "vc", userId: user.id, publicKey: new Uint8Array([1]), counter: 1n } });
      vi.mocked(verifyAuthentication).mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 2 } } as never);

      const res = await authenticateVerify(routeArgs(jsonRequest(
        "https://spoonjoy.app/auth/webauthn/authenticate/verify",
        { email: user.email, response: { id: "vc" }, redirectTo: "/recipes" },
      )));
      expect(res.status).toBe(200);
      expect(res.headers.get("Set-Cookie") ?? "").toContain("__session=");
      await expect(res.json()).resolves.toMatchObject({ verified: true, redirectTo: "/recipes" });
    });

    it("400s on invalid JSON", async () => {
      const req = new UndiciRequest("https://spoonjoy.app/auth/webauthn/authenticate/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "nope",
      }) as unknown as Request;
      const res = await authenticateVerify(routeArgs(req));
      expect(res.status).toBe(400);
    });
  });
});
