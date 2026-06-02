import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { faker } from "@faker-js/faker";
import { Request as UndiciRequest } from "undici";
import { getLocalDb } from "~/lib/db.server";
import { sessionStorage } from "~/lib/session.server";
import {
  ApiAuthError,
  assertCanUseOwnerEmail,
  authenticateApiRequest,
  authenticateApiToken,
  createApiCredential,
  expandCredentialScopes,
  extractBearerToken,
  normalizeCredentialScopes,
  generateApiToken,
  hashApiToken,
  principalFromUserEmail,
  principalFromUserId,
  requireApiPrincipal,
} from "~/lib/api-auth.server";
import { cleanupDatabase } from "../helpers/cleanup";

function uniqueEmail(prefix = "api-auth") {
  return `${prefix}-${faker.string.alphanumeric(8).toLowerCase()}@example.com`;
}

async function sessionCookie(userId: string) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  return (await sessionStorage.commitSession(session)).split(";")[0];
}

describe("API authentication helpers", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("extracts bearer tokens and reports malformed authorization headers", () => {
    expect(extractBearerToken(new UndiciRequest("http://localhost/api"))).toBeNull();
    expect(extractBearerToken(new UndiciRequest("http://localhost/api", {
      headers: { Authorization: "Bearer sj_test" },
    }))).toBe("sj_test");

    expect(() => extractBearerToken(new UndiciRequest("http://localhost/api", {
      headers: { Authorization: "Basic sj_test" },
    }))).toThrow(ApiAuthError);
    expect(() => extractBearerToken(new UndiciRequest("http://localhost/api", {
      headers: { Authorization: "Bearer" },
    }))).toThrow("Malformed Authorization header");
    expect(() => extractBearerToken(new UndiciRequest("http://localhost/api", {
      headers: { Authorization: "Bearer one two" },
    }))).toThrow("Malformed Authorization header");
  });

  it("generates, hashes, authenticates, updates, and rejects API tokens", async () => {
    const user = await db.user.create({ data: { email: uniqueEmail(), username: faker.internet.username() } });
    const token = generateApiToken();
    expect(token).toMatch(/^sj_/);
    await expect(hashApiToken(token)).resolves.toMatch(/^[a-f0-9]{64}$/);

    const created = await createApiCredential(db, user.id, "  Harness token  ");
    expect(created.token).toMatch(/^sj_/);
    expect(created.credential).toMatchObject({
      userId: user.id,
      name: "Harness token",
      tokenPrefix: created.token.slice(0, 12),
      scopes: "cookbooks:read public:read recipes:read shopping_list:read shopping_list:write tokens:read tokens:write",
      lastUsedAt: null,
      revokedAt: null,
    });

    const authenticated = await authenticateApiToken(db, created.token);
    expect(authenticated).toMatchObject({
      id: user.id,
      email: user.email,
      username: user.username,
      source: "bearer",
      credentialId: created.credential.id,
      scopes: [
        "cookbooks:read",
        "public:read",
        "recipes:read",
        "shopping_list:read",
        "shopping_list:write",
        "tokens:read",
        "tokens:write",
      ],
    });
    await expect(db.apiCredential.findUniqueOrThrow({ where: { id: created.credential.id } }))
      .resolves.toMatchObject({ lastUsedAt: expect.any(Date) });

    await db.apiCredential.update({ where: { id: created.credential.id }, data: { revokedAt: new Date() } });
    await expect(authenticateApiToken(db, created.token)).rejects.toMatchObject({ status: 401 });
    await expect(authenticateApiToken(db, "sj_missing")).rejects.toThrow("Invalid API token");
  });

  it("normalizes and expands credential scopes", async () => {
    expect(normalizeCredentialScopes(["recipes:read", "recipes:read", "public:read"]))
      .toBe("public:read recipes:read");
    expect(normalizeCredentialScopes(" kitchen:write   shopping_list:read ")).toBe("kitchen:write shopping_list:read");
    expect(normalizeCredentialScopes("")).toBe("");
    expect(normalizeCredentialScopes([])).toBe("");
    expect(() => normalizeCredentialScopes(["recipes:read", "recipes:delete"])).toThrow("Unknown API credential scope");
    expect(expandCredentialScopes("kitchen:write recipes:read")).toEqual([
      "recipes:read",
      "shopping_list:write",
      "tokens:write",
    ]);
    expect(expandCredentialScopes(null)).toEqual([]);
    expect(expandCredentialScopes(undefined)).toEqual([]);
    expect(() => expandCredentialScopes("recipes:delete")).toThrow("Unknown API credential scope");

    const user = await db.user.create({ data: { email: uniqueEmail("scopes"), username: faker.internet.username() } });
    const legacy = await createApiCredential(db, user.id, "Legacy", {
      scopes: ["kitchen:read", "kitchen:write"],
    });
    const principal = await authenticateApiToken(db, legacy.token);
    expect(principal.scopes).toEqual([
      "cookbooks:read",
      "public:read",
      "recipes:read",
      "shopping_list:read",
      "shopping_list:write",
      "tokens:read",
      "tokens:write",
    ]);

    const empty = await createApiCredential(db, user.id, "Empty", { scopes: [] });
    expect(empty.credential.scopes).toBe("");
    await expect(authenticateApiToken(db, empty.token)).resolves.toMatchObject({ scopes: [] });
  });

  it("honors an optional expiry on a credential", async () => {
    const user = await db.user.create({ data: { email: uniqueEmail(), username: faker.internet.username() } });

    // A future expiry still authenticates...
    const future = await createApiCredential(db, user.id, "OAuth token", {
      expiresAt: new Date(Date.now() + 60_000),
      scopes: ["kitchen:read"],
    });
    expect(future.credential.expiresAt).toBeInstanceOf(Date);
    await expect(authenticateApiToken(db, future.token)).resolves.toMatchObject({
      id: user.id,
      scopes: ["cookbooks:read", "public:read", "recipes:read", "shopping_list:read", "tokens:read"],
    });

    // ...but a past expiry is rejected as invalid.
    const expired = await createApiCredential(db, user.id, "Expired token", {
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(authenticateApiToken(db, expired.token)).rejects.toMatchObject({ status: 401 });
  });

  it("authenticates bearer requests, session requests, and lowercased environment users", async () => {
    const user = await db.user.create({ data: { email: uniqueEmail(), username: faker.internet.username() } });
    const created = await createApiCredential(db, user.id, "REST client");

    await expect(authenticateApiRequest(db, new UndiciRequest("http://localhost/api", {
      headers: { Authorization: `Bearer ${created.token}` },
    }))).resolves.toMatchObject({ source: "bearer", credentialId: created.credential.id });

    await expect(authenticateApiRequest(db, new UndiciRequest("http://localhost/api", {
      headers: { Cookie: await sessionCookie(user.id) },
    }))).resolves.toMatchObject({ source: "session", id: user.id });

    await expect(principalFromUserEmail(db, user.email.toUpperCase())).resolves.toMatchObject({
      source: "environment",
      id: user.id,
    });
  });

  it("handles absent users and owner authorization checks", async () => {
    await expect(authenticateApiRequest(db, new UndiciRequest("http://localhost/api"))).resolves.toBeNull();
    await expect(principalFromUserId(db, "missing-user")).resolves.toBeNull();
    await expect(principalFromUserEmail(db, "missing@example.com")).resolves.toBeNull();

    expect(() => requireApiPrincipal(null)).toThrow("Authentication required");
    expect(() => assertCanUseOwnerEmail(null, "anyone@example.com")).not.toThrow();

    const user = await db.user.create({ data: { email: uniqueEmail(), username: faker.internet.username() } });
    const principal = await principalFromUserId(db, user.id);
    expect(requireApiPrincipal(principal)).toMatchObject({ source: "session", id: user.id });
    expect(() => assertCanUseOwnerEmail(principal, user.email.toUpperCase())).not.toThrow();
    expect(() => assertCanUseOwnerEmail(principal, "other@example.com")).toThrow("different owner");
  });
});
