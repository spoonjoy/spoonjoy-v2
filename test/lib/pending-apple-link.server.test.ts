// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { action } from "~/routes/api.v1.$";
import { db } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { createAuthorizationCode } from "~/lib/oauth-server.server";
import { handleOAuthToken } from "~/lib/oauth-routes.server";
import {
  appleSubSupportHash,
  claimPendingAppleLink,
  claimPendingAppleLinkFromCookie,
  createPendingAppleLink,
  PENDING_APPLE_LINK_MESSAGE,
  PENDING_APPLE_LINK_TTL_MS,
  rememberPendingAppleLink,
} from "~/lib/pending-apple-link.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { expectConsoleWarning } from "../warning-policy";

const CLAIM_ERROR_LOG = JSON.stringify({ event: "apple.pending_link", outcome: "error", error: "Error" });

const APPLE_CLIENT_ID = "app.spoonjoy";
const APPLE_SUB = "apple-user-pending-123";
const PASSWORD = "correctHorseBatteryStaple";

function base64Url(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A signed native Apple identity token with no email claim, and the keys that verify it. */
async function emaillessAppleToken(sub = APPLE_SUB) {
  const keys = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const rawNonce = "pending-link-nonce";
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: "RS256", kid: "pending-key" });
  const payload = base64UrlJson({
    iss: "https://appleid.apple.com",
    aud: APPLE_CLIENT_ID,
    exp: now + 300,
    iat: now,
    sub,
    nonce: await sha256Hex(rawNonce),
  });
  const signature = new Uint8Array(await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keys.privateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  ));
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({
    keys: [{ ...jwk, kid: "pending-key", alg: "RS256", use: "sig" }],
  }), { headers: { "Content-Type": "application/json" } }));
  return { identityToken: `${header}.${payload}.${base64Url(signature)}`, rawNonce };
}

function apiArgs(path: string, body: unknown) {
  return {
    request: new UndiciRequest(`http://localhost/api/v1/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Request-Id": `req_${path.replace(/\W/g, "_")}` },
      body: JSON.stringify(body),
    }) as unknown as Request,
    params: { "*": path },
    context: { cloudflare: { env: { APPLE_NATIVE_CLIENT_IDS: APPLE_CLIENT_ID } } },
  } as any;
}

async function nativeAppleSignIn(token: { identityToken: string; rawNonce: string }) {
  const response = await action(apiArgs("auth/apple/native", token));
  return { status: response.status, json: await response.json() as any };
}

async function appleLinkOwner(sub = APPLE_SUB) {
  const row = await db.oAuth.findUnique({ where: { provider_providerUserId: { provider: "apple", providerUserId: sub } } });
  return row?.userId ?? null;
}

function supportLogs(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls
    .map(([line]) => JSON.parse(String(line)))
    .filter((entry) => entry.event === "apple.pending_link");
}

describe("pending Apple links", () => {
  let info: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await cleanupDatabase();
    info = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupDatabase();
  });

  it("keeps an unlinked, email-less Apple ID pending, links it on the device's next password sign-in, and then signs Apple straight in", async () => {
    const chef = await createUser(db, "pending-chef@example.com", "pending_chef", PASSWORD);
    const appleToken = await emaillessAppleToken();

    const refused = await nativeAppleSignIn(appleToken);
    expect(refused.status).toBe(400);
    expect(refused.json.error.message).toBe(PENDING_APPLE_LINK_MESSAGE);
    expect(refused.json.error.details).toMatchObject({ providerCode: "apple_email_unavailable" });
    const { pendingAppleLinkToken, pendingAppleLinkExpiresAt } = refused.json.error.details;
    expect(pendingAppleLinkToken).toMatch(/^pal_[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(pendingAppleLinkExpiresAt) - Date.now()).toBeGreaterThan(PENDING_APPLE_LINK_TTL_MS - 60_000);
    await expect(appleLinkOwner()).resolves.toBeNull();

    const password = await action(apiArgs("auth/password/native", {
      emailOrUsername: "pending_chef",
      password: PASSWORD,
      pendingAppleLinkToken,
    }));
    const passwordJson = await password.json() as any;
    expect(password.status).toBe(201);
    expect(passwordJson.data).toMatchObject({ userId: chef.id, appleLink: "linked" });
    await expect(appleLinkOwner()).resolves.toBe(chef.id);
    await expect(db.oAuth.findFirst({ where: { provider: "apple" } })).resolves.toMatchObject({ providerUsername: "Apple ID" });

    const signedIn = await nativeAppleSignIn(appleToken);
    expect(signedIn.status).toBe(201);
    expect(signedIn.json.data).toMatchObject({ action: "user_logged_in", userId: chef.id });
  });

  it("leaves the native password response unchanged when no pending link is sent", async () => {
    await createUser(db, "plain-chef@example.com", "plain_chef", PASSWORD);
    const response = await action(apiArgs("auth/password/native", { emailOrUsername: "plain_chef", password: PASSWORD }));
    const json = await response.json() as any;
    expect(response.status).toBe(201);
    expect(json.data).not.toHaveProperty("appleLink");
  });

  it("links a pending Apple ID when the native app's next sign-in is Google (or any web method) through the OAuth code exchange", async () => {
    const chef = await createUser(db, "google-chef@example.com", "google_chef", PASSWORD);
    const { token } = await createPendingAppleLink(db, { appleSub: APPLE_SUB, providerUsername: "Pending Chef" });
    const clientId = "native-google-client";
    const redirectUri = "https://spoonjoy.app/oauth/callback";
    const verifier = "verifier-0123456789-abcdefghijklmnopqrstuvwxyz";
    await db.oAuthClient.create({ data: { id: clientId, clientName: "Spoonjoy Apple", redirectUris: redirectUri, issuer: "https://spoonjoy.app" } });
    const exchange = async (extra: Record<string, string>) => {
      const code = await createAuthorizationCode(db, {
        clientId,
        userId: chef.id,
        redirectUri,
        codeChallenge: base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))),
        scope: "kitchen:read",
        resource: null,
        issuer: "https://spoonjoy.app",
      });
      const response = await handleOAuthToken(new Request("https://spoonjoy.app/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: redirectUri, code_verifier: verifier, ...extra }),
      }), db, { SPOONJOY_BASE_URL: "https://spoonjoy.app" } as any);
      return { status: response.status, json: await response.json() as any };
    };

    const linked = await exchange({ pending_apple_link_token: token });
    expect(linked.status).toBe(200);
    expect(linked.json).toMatchObject({ token_type: "Bearer", apple_link: "linked" });
    await expect(appleLinkOwner()).resolves.toBe(chef.id);
    await expect(db.oAuth.findFirst({ where: { provider: "apple" } })).resolves.toMatchObject({ providerUsername: "Pending Chef" });

    const plain = await exchange({});
    expect(plain.status).toBe(200);
    expect(plain.json).not.toHaveProperty("apple_link");
  });

  it("ignores a pending link sent by a third-party OAuth client the chef approved", async () => {
    const chef = await createUser(db, "victim@example.com", "victim_chef", PASSWORD);
    const { token } = await createPendingAppleLink(db, { appleSub: APPLE_SUB, providerUsername: null });
    const clientId = "third-party-connector";
    const redirectUri = "https://attacker.example/callback";
    const verifier = "verifier-0123456789-abcdefghijklmnopqrstuvwxyz";
    await db.oAuthClient.create({ data: { id: clientId, clientName: "Spoonjoy Apple", redirectUris: redirectUri, issuer: "https://spoonjoy.app" } });
    const code = await createAuthorizationCode(db, {
      clientId,
      userId: chef.id,
      redirectUri,
      codeChallenge: base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))),
      scope: "kitchen:read",
      resource: null,
      issuer: "https://spoonjoy.app",
    });

    const response = await handleOAuthToken(new Request("https://spoonjoy.app/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: redirectUri, code_verifier: verifier, pending_apple_link_token: token }),
    }), db, { SPOONJOY_BASE_URL: "https://spoonjoy.app" } as any);
    const json = await response.json() as any;

    expect(response.status).toBe(200);
    expect(json).not.toHaveProperty("apple_link");
    await expect(appleLinkOwner()).resolves.toBeNull();
    await expect(db.pendingAppleLink.findFirstOrThrow()).resolves.toMatchObject({ consumedAt: null });
  });

  it("clears expired pending links as new ones are made", async () => {
    const old = new Date("2026-11-11T10:00:00.000Z");
    await createPendingAppleLink(db, { appleSub: "apple-user-old", providerUsername: null }, { now: old });
    await createPendingAppleLink(db, { appleSub: APPLE_SUB, providerUsername: null }, { now: new Date(old.getTime() + PENDING_APPLE_LINK_TTL_MS + 1) });

    await expect(db.pendingAppleLink.findMany({ select: { appleSub: true } })).resolves.toEqual([{ appleSub: APPLE_SUB }]);
  });

  it("answers \"error\" instead of failing the sign-in when the database fails", async () => {
    const chef = await createUser(db, "db-down@example.com", "db_down_chef", PASSWORD);
    const { token } = await createPendingAppleLink(db, { appleSub: APPLE_SUB, providerUsername: null });
    vi.spyOn(db.pendingAppleLink, "findUnique").mockRejectedValueOnce(new Error("boom"));
    expectConsoleWarning(CLAIM_ERROR_LOG);

    await expect(claimPendingAppleLink(db, token, chef.id)).resolves.toBe("error");
    await expect(db.pendingAppleLink.findFirstOrThrow()).resolves.toMatchObject({ consumedAt: null });
  });

  it("puts a spent pending link back when linking fails, so the next sign-in can still link", async () => {
    const chef = await createUser(db, "retry@example.com", "retry_chef", PASSWORD);
    const { token } = await createPendingAppleLink(db, { appleSub: APPLE_SUB, providerUsername: null });
    vi.spyOn(db.oAuth, "create").mockRejectedValueOnce(new Error("boom"));
    expectConsoleWarning(CLAIM_ERROR_LOG);

    await expect(claimPendingAppleLink(db, token, chef.id)).resolves.toBe("error");
    await expect(db.pendingAppleLink.findFirstOrThrow()).resolves.toMatchObject({ consumedAt: null });
    await expect(claimPendingAppleLink(db, token, chef.id)).resolves.toBe("linked");
  });

  it("still answers \"error\" when putting the spent link back fails too", async () => {
    const chef = await createUser(db, "double@example.com", "double_chef", PASSWORD);
    const { token } = await createPendingAppleLink(db, { appleSub: APPLE_SUB, providerUsername: null });
    const realUpdateMany = db.pendingAppleLink.updateMany.bind(db.pendingAppleLink);
    vi.spyOn(db.pendingAppleLink, "updateMany")
      .mockImplementationOnce(realUpdateMany as any)
      .mockRejectedValueOnce(new Error("still down"));
    vi.spyOn(db.oAuth, "create").mockRejectedValueOnce(new Error("boom"));
    expectConsoleWarning(CLAIM_ERROR_LOG);

    await expect(claimPendingAppleLink(db, token, chef.id)).resolves.toBe("error");
  });

  it("logs a thrown non-Error as unknown", async () => {
    const { token } = await createPendingAppleLink(db, { appleSub: APPLE_SUB, providerUsername: null });
    vi.spyOn(db.pendingAppleLink, "findUnique").mockRejectedValueOnce("not an error");
    expectConsoleWarning(JSON.stringify({ event: "apple.pending_link", outcome: "error", error: "unknown" }));

    await expect(claimPendingAppleLink(db, token, "user-id")).resolves.toBe("error");
  });

  it("does not link a pending Apple ID once thirty minutes have passed", async () => {
    const chef = await createUser(db, "late-chef@example.com", "late_chef", PASSWORD);
    const created = new Date("2026-11-11T12:00:00.000Z");
    const { token, expiresAt } = await createPendingAppleLink(db, { appleSub: APPLE_SUB, providerUsername: null }, { now: created });
    expect(expiresAt.getTime() - created.getTime()).toBe(30 * 60 * 1000);

    await expect(claimPendingAppleLink(db, token, chef.id, { now: expiresAt })).resolves.toBe("expired");
    await expect(appleLinkOwner()).resolves.toBeNull();
  });

  it("never moves an Apple ID already linked to another account", async () => {
    const owner = await createUser(db, "owner@example.com", "owner_chef", PASSWORD);
    const other = await createUser(db, "other@example.com", "other_chef", PASSWORD);
    await db.oAuth.create({ data: { provider: "apple", providerUserId: APPLE_SUB, providerUsername: "Owner", userId: owner.id } });
    const { token } = await createPendingAppleLink(db, { appleSub: APPLE_SUB, providerUsername: null });

    await expect(claimPendingAppleLink(db, token, other.id)).resolves.toBe("taken");
    await expect(appleLinkOwner()).resolves.toBe(owner.id);
    await expect(db.oAuth.count({ where: { userId: other.id } })).resolves.toBe(0);
  });

  it("reports an Apple ID already linked to the same account", async () => {
    const chef = await createUser(db, "same@example.com", "same_chef", PASSWORD);
    await db.oAuth.create({ data: { provider: "apple", providerUserId: APPLE_SUB, providerUsername: "Same", userId: chef.id } });
    const { token } = await createPendingAppleLink(db, { appleSub: APPLE_SUB, providerUsername: null });

    await expect(claimPendingAppleLink(db, token, chef.id)).resolves.toBe("already_linked");
  });

  it("does not replace a different Apple ID the account already has", async () => {
    const chef = await createUser(db, "has-apple@example.com", "has_apple", PASSWORD);
    await db.oAuth.create({ data: { provider: "apple", providerUserId: "apple-user-original", providerUsername: "Original", userId: chef.id } });
    const { token } = await createPendingAppleLink(db, { appleSub: APPLE_SUB, providerUsername: null });

    await expect(claimPendingAppleLink(db, token, chef.id)).resolves.toBe("provider_already_linked");
    await expect(appleLinkOwner()).resolves.toBeNull();
    await expect(appleLinkOwner("apple-user-original")).resolves.toBe(chef.id);
  });

  it("links nothing when the account that signed in no longer exists", async () => {
    const { token } = await createPendingAppleLink(db, { appleSub: APPLE_SUB, providerUsername: null });

    await expect(claimPendingAppleLink(db, token, "deleted-user-id")).resolves.toBe("taken");
    await expect(appleLinkOwner()).resolves.toBeNull();
  });

  it("consumes a pending link once", async () => {
    const first = await createUser(db, "first@example.com", "first_chef", PASSWORD);
    const second = await createUser(db, "second@example.com", "second_chef", PASSWORD);
    const { token } = await createPendingAppleLink(db, { appleSub: APPLE_SUB, providerUsername: null });

    await expect(claimPendingAppleLink(db, token, first.id)).resolves.toBe("linked");
    await expect(claimPendingAppleLink(db, token, second.id)).resolves.toBe("consumed");
    await expect(appleLinkOwner()).resolves.toBe(first.id);
  });

  it("lets only one of two racing sign-ins spend a pending link", async () => {
    const chef = await createUser(db, "race@example.com", "race_chef", PASSWORD);
    const { token } = await createPendingAppleLink(db, { appleSub: APPLE_SUB, providerUsername: null });
    // The other sign-in spent the row between this one's read and its conditional update.
    vi.spyOn(db.pendingAppleLink, "updateMany").mockResolvedValueOnce({ count: 0 });

    await expect(claimPendingAppleLink(db, token, chef.id)).resolves.toBe("consumed");
    await expect(appleLinkOwner()).resolves.toBeNull();
  });

  it("rejects forged, malformed and oversized pending link tokens", async () => {
    const chef = await createUser(db, "forged@example.com", "forged_chef", PASSWORD);
    const { token } = await createPendingAppleLink(db, { appleSub: APPLE_SUB, providerUsername: null });
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;

    await expect(claimPendingAppleLink(db, tampered, chef.id)).resolves.toBe("invalid");
    await expect(claimPendingAppleLink(db, "not-a-pending-link", chef.id)).resolves.toBe("invalid");
    await expect(claimPendingAppleLink(db, `pal_${"a".repeat(200)}`, chef.id)).resolves.toBe("invalid");
    await expect(appleLinkOwner()).resolves.toBeNull();
    // The real token still works: a forged guess spends nothing.
    await expect(claimPendingAppleLink(db, token, chef.id)).resolves.toBe("linked");
  });

  it("stores only the token's hash, and logs the Apple sub only as a truncated SHA-256", async () => {
    const chef = await createUser(db, "logged@example.com", "logged_chef", PASSWORD);
    const { token } = await createPendingAppleLink(db, { appleSub: APPLE_SUB, providerUsername: null });
    await claimPendingAppleLink(db, token, chef.id);

    const row = await db.pendingAppleLink.findFirstOrThrow();
    expect(row.tokenHash).toBe(await sha256Hex(token));
    expect(JSON.stringify(row)).not.toContain(token);
    const hash = (await sha256Hex(APPLE_SUB)).slice(0, 16);
    await expect(appleSubSupportHash(APPLE_SUB)).resolves.toBe(hash);
    expect(supportLogs(info)).toEqual([
      { event: "apple.pending_link", outcome: "created", apple_sub_hash: hash },
      { event: "apple.pending_link", outcome: "linked", apple_sub_hash: hash },
    ]);
    expect(info.mock.calls.flat().join("\n")).not.toContain(APPLE_SUB);
  });

  it("writes a pending link again after a transient D1 failure, without a second row", async () => {
    const realCreate = db.pendingAppleLink.create.bind(db.pendingAppleLink);
    vi.spyOn(db.pendingAppleLink, "create")
      .mockRejectedValueOnce(new Error("D1_ERROR: Network connection lost."))
      .mockImplementation(realCreate as any);

    const { token } = await createPendingAppleLink(db, { appleSub: APPLE_SUB, providerUsername: null });

    await expect(db.pendingAppleLink.count()).resolves.toBe(1);
    await expect(db.pendingAppleLink.findFirstOrThrow()).resolves.toMatchObject({ tokenHash: await sha256Hex(token) });
  });

  describe("in the browser", () => {
    const env = { SESSION_SECRET: "pending-link-test-secret" };
    const request = (cookie?: string) => new Request("https://spoonjoy.app/login", { headers: cookie ? { Cookie: cookie } : {} });

    it("hands the browser a signed, HttpOnly, thirty-minute cookie", async () => {
      const link = await createPendingAppleLink(db, { appleSub: APPLE_SUB, providerUsername: null });
      const setCookie = await rememberPendingAppleLink(env, request(), link);

      expect(setCookie).toMatch(/^__apple_pending=/);
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Lax");
      expect(setCookie).toContain("Max-Age=1800");
      expect(setCookie).not.toContain(link.token);
    });

    it("claims the browser's pending link on sign-in and clears the cookie", async () => {
      const chef = await createUser(db, "web@example.com", "web_chef", PASSWORD);
      const link = await createPendingAppleLink(db, { appleSub: APPLE_SUB, providerUsername: null });
      const cookie = (await rememberPendingAppleLink(env, request(), link)).split(";")[0];

      const cleared = await claimPendingAppleLinkFromCookie(async () => db, request(`other=1; ${cookie}`), env, chef.id);

      expect(cleared).toMatch(/^__apple_pending=;/);
      expect(cleared).toContain("Max-Age=0");
      await expect(appleLinkOwner()).resolves.toBe(chef.id);
    });

    it("does nothing, and never opens the database, without a pending link cookie", async () => {
      const getDb = vi.fn();
      await expect(claimPendingAppleLinkFromCookie(getDb, request("other=1"), env, "user-id")).resolves.toBeNull();
      await expect(claimPendingAppleLinkFromCookie(getDb, request(), env, "user-id")).resolves.toBeNull();
      await expect(claimPendingAppleLinkFromCookie(getDb, request("x__apple_pending=1"), env, "user-id")).resolves.toBeNull();
      expect(getDb).not.toHaveBeenCalled();
    });

    it("rejects a pending link cookie whose signature does not match, and clears it", async () => {
      const chef = await createUser(db, "tamper@example.com", "tamper_chef", PASSWORD);
      const link = await createPendingAppleLink(db, { appleSub: APPLE_SUB, providerUsername: null });
      const forged = `__apple_pending=${encodeURIComponent(btoa(JSON.stringify(link.token)))}`;
      const getDb = vi.fn(async () => db);

      const cleared = await claimPendingAppleLinkFromCookie(getDb, request(forged), env, chef.id);

      expect(cleared).toContain("Max-Age=0");
      expect(getDb).not.toHaveBeenCalled();
      await expect(appleLinkOwner()).resolves.toBeNull();
      expect(supportLogs(info).at(-1)).toEqual({ event: "apple.pending_link", outcome: "invalid", apple_sub_hash: null, source: "cookie" });
    });
  });
});
