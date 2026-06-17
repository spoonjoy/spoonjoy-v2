import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { FormData as UndiciFormData, Request as UndiciRequest } from "undici";
import { action, loader } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "~/lib/account-settings.server";
import { getLocalDb } from "~/lib/db.server";
import { IMAGE_MAX_FILE_SIZE, PROFILE_IMAGE_TYPES } from "~/lib/recipe-image";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser } from "../utils";

type LocalDb = Awaited<ReturnType<typeof getLocalDb>>;

function routeArgs(request: Request, splat: string, env: Record<string, unknown> | null = null) {
  return { request, params: { "*": splat }, context: { cloudflare: { env } } } as any;
}

async function readJson(response: Response) {
  return await response.json() as any;
}

async function sessionCookie(userId: string) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  return (await sessionStorage.commitSession(session)).split(";")[0];
}

function expectPrivateEnvelopeHeaders(response: Response, requestId: string) {
  expect(response.headers.get("Content-Type")).toContain("application/json");
  expect(response.headers.get("X-Request-Id")).toBe(requestId);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Pragma")).toBe("no-cache");
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Authorization, Content-Type, X-Request-Id, X-Client-Mutation-Id");
  expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, PATCH, PUT, DELETE, OPTIONS");
  expect(response.headers.get("Access-Control-Expose-Headers")).toBe("X-Request-Id, Retry-After");
}

function expectNoStoreEnvelopeHeaders(response: Response, requestId: string) {
  expect(response.headers.get("Content-Type")).toContain("application/json");
  expect(response.headers.get("X-Request-Id")).toBe(requestId);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(response.headers.get("Pragma")).toBe("no-cache");
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Authorization, Content-Type, X-Request-Id, X-Client-Mutation-Id");
  expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, PATCH, PUT, DELETE, OPTIONS");
  expect(response.headers.get("Access-Control-Expose-Headers")).toBe("X-Request-Id, Retry-After");
}

function expectSuccessEnvelope(payload: any, requestId: string) {
  expect(Object.keys(payload).sort()).toEqual(["data", "ok", "requestId"]);
  expect(payload.ok).toBe(true);
  expect(payload.requestId).toBe(requestId);
  expect(payload.data).toBeDefined();
}

function expectErrorEnvelope(payload: any, requestId: string, code: string, status: number, withDetails = false) {
  expect(Object.keys(payload).sort()).toEqual(["error", "ok", "requestId"]);
  expect(payload.ok).toBe(false);
  expect(payload.requestId).toBe(requestId);
  expect(Object.keys(payload.error).sort()).toEqual(withDetails
    ? ["code", "details", "message", "status"]
    : ["code", "message", "status"]);
  expect(payload.error).toMatchObject({ code, status, message: expect.any(String) });
}

function nativeConnectionIdFor(clientId: string, resource: string | null) {
  return `oauth_${Buffer.from(JSON.stringify({ clientId, resource })).toString("base64url")}`;
}

function bearerHeaders(token: string, requestId: string, extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${token}`,
    "X-Request-Id": requestId,
    ...extra,
  };
}

function jsonRequest(path: string, method: string, token: string, requestId: string, body: unknown) {
  return new UndiciRequest(`http://localhost/api/v1/${path}`, {
    method,
    headers: bearerHeaders(token, requestId, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  }) as unknown as Request;
}

function getRequest(path: string, token: string, requestId: string) {
  return new UndiciRequest(`http://localhost/api/v1/${path}`, {
    headers: bearerHeaders(token, requestId),
  }) as unknown as Request;
}

async function clearNativePushDevicesIfPresent(db: LocalDb) {
  try {
    await db.$executeRawUnsafe('DELETE FROM "NativePushDevice";');
  } catch {
    // The implementation unit creates this table; red tests run before it exists.
  }
}

function isoFromDbDate(value: string | Date) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function createMemoryPhotosBucket() {
  const puts: Array<{ key: string; value: unknown; options: unknown }> = [];
  const deletes: string[] = [];
  return {
    puts,
    deletes,
    bucket: {
      put: vi.fn(async (key: string, value: unknown, options?: unknown) => {
        puts.push({ key, value, options });
        return null;
      }),
      delete: vi.fn(async (key: string) => {
        deletes.push(key);
      }),
    },
  };
}

describe("API v1 native account and bootstrap endpoints", () => {
  let db: LocalDb;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
    await clearNativePushDevicesIfPresent(db);
  });

  afterEach(async () => {
    await clearNativePushDevicesIfPresent(db);
    await cleanupDatabase();
  });

  it("returns current account bootstrap data and private cache headers for /me and /me/kitchen", async () => {
    const user = await db.user.create({
      data: {
        ...createTestUser(),
        photoUrl: "/photos/profiles/bootstrap/avatar.jpg",
      },
    });
    await db.notificationPreference.create({
      data: {
        userId: user.id,
        notifySpoonOnMyRecipe: false,
        notifyForkOfMyRecipe: true,
        notifyCookbookSaveOfMine: false,
        notifyFellowChefOriginCook: true,
      },
    });
    await db.pushSubscription.create({
      data: {
        userId: user.id,
        endpoint: `https://push.example/${faker.string.alphanumeric(12)}`,
        p256dh: "push-public-key",
        authSecret: "push-auth-secret",
        userAgent: "Safari",
      },
    });
    await db.oAuth.create({
      data: {
        provider: "google",
        providerUserId: `google-${faker.string.alphanumeric(10)}`,
        providerUsername: "chef@example.com",
        userId: user.id,
      },
    });
    await db.userCredential.create({
      data: {
        id: "pk_native_bootstrap",
        userId: user.id,
        publicKey: new Uint8Array([1, 2, 3]),
        transports: "internal",
        counter: 0n,
        name: "MacBook Touch ID",
        createdAt: new Date("2026-06-03T10:00:00.000Z"),
      },
    });
    const personal = await createApiCredential(db, user.id, "Native shell", {
      scopes: ["kitchen:read", "kitchen:write", "tokens:read"],
    });
    const revoked = await createApiCredential(db, user.id, "Revoked shell", {
      scopes: ["kitchen:read"],
    });
    await db.apiCredential.update({
      where: { id: revoked.credential.id },
      data: { revokedAt: new Date("2026-06-01T12:00:00.000Z") },
    });
    const client = await db.oAuthClient.create({
      data: {
        clientName: "Grocery helper",
        redirectUris: "https://example.com/callback",
      },
    });
    const resource = "https://spoonjoy.app/mcp";
    await db.oAuthRefreshToken.create({
      data: {
        tokenHash: `refresh-${faker.string.alphanumeric(16)}`,
        userId: user.id,
        clientId: client.id,
        resource,
        scope: "shopping_list:read recipes:read",
        createdAt: new Date("2026-06-02T10:00:00.000Z"),
      },
    });
    const oauthAccess = await createApiCredential(db, user.id, "Grocery helper access", {
      scopes: ["recipes:read"],
      oauthClientId: client.id,
      oauthResource: resource,
      expiresAt: new Date("2026-06-03T10:00:00.000Z"),
    });
    const reader = await createApiCredential(db, user.id, "Native reader", {
      scopes: ["kitchen:read"],
    });

    const response = await loader(routeArgs(getRequest("me", reader.token, "req_me_bootstrap"), "me"));
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expectPrivateEnvelopeHeaders(response, "req_me_bootstrap");
    expectSuccessEnvelope(payload, "req_me_bootstrap");
    expect(Object.keys(payload.data).sort()).toEqual(["me", "notifications"]);
    expect(payload.data.me).toMatchObject({
      id: user.id,
      email: user.email,
      username: user.username,
      hasPassword: true,
      photoUrl: "/photos/profiles/bootstrap/avatar.jpg",
      oauthAccounts: [
        {
          provider: "google",
          providerUsername: "chef@example.com",
        },
      ],
      passkeys: [
        {
          id: "pk_native_bootstrap",
          name: "MacBook Touch ID",
          transports: "internal",
          createdAt: "2026-06-03T10:00:00.000Z",
        },
      ],
      handoffs: {
        accountSettings: { method: "GET", url: "/account/settings", onlineOnly: true },
        password: {
          method: "GET",
          url: "/account/settings",
          onlineOnly: true,
          actions: ["changePassword", "setPassword", "removePassword"],
        },
        passkeys: {
          method: "GET",
          url: "/account/settings",
          onlineOnly: true,
          registrationOptionsUrl: "/auth/webauthn/register/options",
          registrationVerifyUrl: "/auth/webauthn/register/verify",
          actions: ["addPasskey", "renamePasskey", "removePasskey"],
        },
        providerLinks: {
          google: { method: "GET", url: "/auth/google?linking=true", onlineOnly: true },
          github: { method: "GET", url: "/auth/github?linking=true", onlineOnly: true },
          apple: { method: "GET", url: "/auth/apple?linking=true", onlineOnly: true },
        },
      },
      apiCredentials: expect.arrayContaining([
        expect.objectContaining({
          id: personal.credential.id,
          name: "Native shell",
          tokenPrefix: personal.credential.tokenPrefix,
          scopes: expect.arrayContaining(["kitchen:read", "kitchen:write", "tokens:read"]),
          createdAt: expect.any(String),
          lastUsedAt: null,
          revokedAt: null,
          expiresAt: null,
        }),
      ]),
      oauthConnections: [
        {
          id: nativeConnectionIdFor(client.id, resource),
          clientId: client.id,
          clientName: "Grocery helper",
          resource,
          scopes: ["recipes:read", "shopping_list:read"],
          createdAt: "2026-06-02T10:00:00.000Z",
          refreshTokenCount: 1,
          accessTokenCount: 1,
        },
      ],
    });
    expect(payload.data.me.apiCredentials.map((credential: { id: string }) => credential.id)).not.toContain(oauthAccess.credential.id);
    expect(payload.data.me.apiCredentials.map((credential: { id: string }) => credential.id)).not.toContain(revoked.credential.id);
    expect(payload.data.me.apiCredentials[0].token).toBeUndefined();
    expect(payload.data.notifications).toEqual({
      pushSubscribed: true,
      preferences: {
        notifySpoonOnMyRecipe: false,
        notifyForkOfMyRecipe: true,
        notifyCookbookSaveOfMine: false,
        notifyFellowChefOriginCook: true,
      },
    });

    const kitchenResponse = await loader(routeArgs(getRequest("me/kitchen", reader.token, "req_me_kitchen"), "me/kitchen"));
    const kitchenPayload = await readJson(kitchenResponse);

    expect(kitchenResponse.status).toBe(200);
    expectPrivateEnvelopeHeaders(kitchenResponse, "req_me_kitchen");
    expectSuccessEnvelope(kitchenPayload, "req_me_kitchen");
    expect(kitchenPayload.data).toMatchObject({
      me: { id: user.id, username: user.username },
      notifications: { pushSubscribed: true },
    });
  });

  it("manages native account personal tokens without leaking OAuth access credentials or token secrets", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const otherUser = await db.user.create({ data: createTestUser() });
    const cookie = await sessionCookie(user.id);
    const personal = await createApiCredential(db, user.id, "Native personal token", {
      scopes: ["kitchen:read", "tokens:read"],
    });
    const reader = await createApiCredential(db, user.id, "Native token reader", { scopes: ["tokens:read"] });
    const writer = await createApiCredential(db, user.id, "Native token writer", { scopes: ["tokens:write"] });
    const otherOwnerToken = await createApiCredential(db, otherUser.id, "Other owner token", { scopes: ["tokens:read"] });
    const client = await db.oAuthClient.create({
      data: {
        clientName: "OAuth native client",
        redirectUris: "https://native.example/callback",
      },
    });
    const oauthAccess = await createApiCredential(db, user.id, "OAuth access credential", {
      scopes: ["recipes:read"],
      oauthClientId: client.id,
      oauthResource: "https://spoonjoy.app/mcp",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const list = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
      headers: { Cookie: cookie, "X-Request-Id": "req_native_tokens_list" },
    }) as unknown as Request, "tokens"));
    const listPayload = await readJson(list);

    expect(list.status).toBe(200);
    expectPrivateEnvelopeHeaders(list, "req_native_tokens_list");
    expectSuccessEnvelope(listPayload, "req_native_tokens_list");
    const listedIds = listPayload.data.tokens.map((credential: { id: string }) => credential.id);
    expect(listedIds).toEqual(expect.arrayContaining([personal.credential.id, reader.credential.id, writer.credential.id]));
    expect(listedIds).not.toContain(oauthAccess.credential.id);
    expect(listedIds).not.toContain(otherOwnerToken.credential.id);
    expect(listPayload.data.tokens.every((credential: { token?: unknown }) => credential.token === undefined)).toBe(true);

    const created = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        "X-Request-Id": "req_native_tokens_create",
      },
      body: JSON.stringify({ name: "Native account cache", scopes: ["kitchen:read", "tokens:read"] }),
    }) as unknown as Request, "tokens"));
    const createdPayload = await readJson(created);

    expect(created.status).toBe(201);
    expectNoStoreEnvelopeHeaders(created, "req_native_tokens_create");
    expectSuccessEnvelope(createdPayload, "req_native_tokens_create");
    expect(createdPayload.data.token).toMatch(/^sj_/);
    expect(createdPayload.data.credential).toMatchObject({
      id: expect.any(String),
      name: "Native account cache",
      tokenPrefix: createdPayload.data.token.slice(0, 12),
      scopes: expect.arrayContaining(["kitchen:read", "tokens:read"]),
      revokedAt: null,
    });
    await expect(db.apiCredential.findUniqueOrThrow({ where: { id: createdPayload.data.credential.id } }))
      .resolves.toMatchObject({ tokenHash: expect.not.stringContaining(createdPayload.data.token) });

    const revoke = await action(routeArgs(new UndiciRequest(`http://localhost/api/v1/tokens/${createdPayload.data.credential.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie, "X-Request-Id": "req_native_tokens_revoke" },
    }) as unknown as Request, `tokens/${createdPayload.data.credential.id}`));
    const revokePayload = await readJson(revoke);

    expect(revoke.status).toBe(200);
    expectPrivateEnvelopeHeaders(revoke, "req_native_tokens_revoke");
    expectSuccessEnvelope(revokePayload, "req_native_tokens_revoke");
    expect(revokePayload.data).toMatchObject({
      revoked: true,
      credential: { id: createdPayload.data.credential.id, revokedAt: expect.any(String) },
    });

    const revokeAgain = await action(routeArgs(new UndiciRequest(`http://localhost/api/v1/tokens/${createdPayload.data.credential.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie, "X-Request-Id": "req_native_tokens_revoke_again" },
    }) as unknown as Request, `tokens/${createdPayload.data.credential.id}`));
    const revokeAgainPayload = await readJson(revokeAgain);

    expect(revokeAgain.status).toBe(200);
    expectPrivateEnvelopeHeaders(revokeAgain, "req_native_tokens_revoke_again");
    expectSuccessEnvelope(revokeAgainPayload, "req_native_tokens_revoke_again");
    expect(revokeAgainPayload.data).toMatchObject({
      revoked: false,
      credential: { id: createdPayload.data.credential.id, revokedAt: expect.any(String) },
    });

    const afterRevokeList = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
      headers: { Cookie: cookie, "X-Request-Id": "req_native_tokens_after_revoke" },
    }) as unknown as Request, "tokens"));
    const afterRevokePayload = await readJson(afterRevokeList);
    expect(afterRevokeList.status).toBe(200);
    expectPrivateEnvelopeHeaders(afterRevokeList, "req_native_tokens_after_revoke");
    expect(afterRevokePayload.data.tokens.map((credential: { id: string }) => credential.id))
      .not.toContain(createdPayload.data.credential.id);

    const readWithoutScope = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
      headers: { Authorization: `Bearer ${writer.token}`, "X-Request-Id": "req_native_tokens_read_scope" },
    }) as unknown as Request, "tokens"));
    expect(readWithoutScope.status).toBe(403);
    expectPrivateEnvelopeHeaders(readWithoutScope, "req_native_tokens_read_scope");
    expectErrorEnvelope(await readJson(readWithoutScope), "req_native_tokens_read_scope", "insufficient_scope", 403);

    const writeWithoutScope = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${reader.token}`,
        "Content-Type": "application/json",
        "X-Request-Id": "req_native_tokens_write_scope_bad_json",
      },
      body: "{",
    }) as unknown as Request, "tokens"));
    expect(writeWithoutScope.status).toBe(403);
    expectPrivateEnvelopeHeaders(writeWithoutScope, "req_native_tokens_write_scope_bad_json");
    expectErrorEnvelope(await readJson(writeWithoutScope), "req_native_tokens_write_scope_bad_json", "insufficient_scope", 403);

    const deleteWithoutScope = await action(routeArgs(new UndiciRequest(`http://localhost/api/v1/tokens/${personal.credential.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${reader.token}`, "X-Request-Id": "req_native_tokens_delete_scope" },
    }) as unknown as Request, `tokens/${personal.credential.id}`));
    expect(deleteWithoutScope.status).toBe(403);
    expectPrivateEnvelopeHeaders(deleteWithoutScope, "req_native_tokens_delete_scope");
    expectErrorEnvelope(await readJson(deleteWithoutScope), "req_native_tokens_delete_scope", "insufficient_scope", 403);
  });

  it("updates current profile fields and returns validation envelopes for invalid or duplicate input", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const other = await db.user.create({ data: createTestUser() });
    const writer = await createApiCredential(db, user.id, "Native writer", { scopes: ["kitchen:write"] });
    const nextEmail = `New.${faker.string.alphanumeric(8)}@Example.COM`;
    const nextUsername = `native_${faker.string.alphanumeric(10)}`;

    const response = await action(routeArgs(jsonRequest("me", "PATCH", writer.token, "req_me_patch", {
      email: nextEmail,
      username: nextUsername,
    }), "me"));
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expectPrivateEnvelopeHeaders(response, "req_me_patch");
    expectSuccessEnvelope(payload, "req_me_patch");
    expect(payload.data.me).toMatchObject({
      id: user.id,
      email: nextEmail.toLowerCase(),
      username: nextUsername,
    });
    await expect(db.user.findUniqueOrThrow({ where: { id: user.id } }))
      .resolves.toMatchObject({ email: nextEmail.toLowerCase(), username: nextUsername });

    const invalid = await action(routeArgs(jsonRequest("me", "PATCH", writer.token, "req_me_patch_invalid", {
      email: "not-an-email",
      username: " ",
    }), "me"));
    const invalidPayload = await readJson(invalid);

    expect(invalid.status).toBe(400);
    expectPrivateEnvelopeHeaders(invalid, "req_me_patch_invalid");
    expectErrorEnvelope(invalidPayload, "req_me_patch_invalid", "validation_error", 400, true);
    expect(invalidPayload.error.details).toMatchObject({
      fieldErrors: {
        email: expect.any(String),
        username: expect.any(String),
      },
    });

    const duplicate = await action(routeArgs(jsonRequest("me", "PATCH", writer.token, "req_me_patch_duplicate", {
      email: other.email.toUpperCase(),
      username: other.username,
    }), "me"));
    const duplicatePayload = await readJson(duplicate);

    expect(duplicate.status).toBe(400);
    expectPrivateEnvelopeHeaders(duplicate, "req_me_patch_duplicate");
    expectErrorEnvelope(duplicatePayload, "req_me_patch_duplicate", "validation_error", 400, true);
    expect(duplicatePayload.error.details).toMatchObject({
      fieldErrors: {
        email: expect.any(String),
        username: expect.any(String),
      },
    });
  });

  it("reads and updates notification preferences with default values and strict validation", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const reader = await createApiCredential(db, user.id, "Native prefs reader", { scopes: ["kitchen:read"] });
    const writer = await createApiCredential(db, user.id, "Native prefs writer", { scopes: ["kitchen:write"] });

    const defaults = await loader(routeArgs(getRequest(
      "me/notification-preferences",
      reader.token,
      "req_me_prefs_defaults",
    ), "me/notification-preferences"));
    const defaultsPayload = await readJson(defaults);

    expect(defaults.status).toBe(200);
    expectPrivateEnvelopeHeaders(defaults, "req_me_prefs_defaults");
    expectSuccessEnvelope(defaultsPayload, "req_me_prefs_defaults");
    expect(defaultsPayload.data.preferences).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);

    const nextPreferences = {
      notifySpoonOnMyRecipe: false,
      notifyForkOfMyRecipe: false,
      notifyCookbookSaveOfMine: true,
      notifyFellowChefOriginCook: false,
    };
    const updated = await action(routeArgs(jsonRequest(
      "me/notification-preferences",
      "PATCH",
      writer.token,
      "req_me_prefs_update",
      nextPreferences,
    ), "me/notification-preferences"));
    const updatedPayload = await readJson(updated);

    expect(updated.status).toBe(200);
    expectPrivateEnvelopeHeaders(updated, "req_me_prefs_update");
    expectSuccessEnvelope(updatedPayload, "req_me_prefs_update");
    expect(updatedPayload.data.preferences).toEqual(nextPreferences);
    await expect(db.notificationPreference.findUniqueOrThrow({ where: { userId: user.id } }))
      .resolves.toMatchObject(nextPreferences);

    const invalid = await action(routeArgs(jsonRequest(
      "me/notification-preferences",
      "PATCH",
      writer.token,
      "req_me_prefs_invalid",
      { notifySpoonOnMyRecipe: "yes", marketingEmails: true },
    ), "me/notification-preferences"));
    const invalidPayload = await readJson(invalid);

    expect(invalid.status).toBe(400);
    expectPrivateEnvelopeHeaders(invalid, "req_me_prefs_invalid");
    expectErrorEnvelope(invalidPayload, "req_me_prefs_invalid", "validation_error", 400, true);
    expect(invalidPayload.error.details).toMatchObject({
      fieldErrors: {
        notifySpoonOnMyRecipe: expect.any(String),
        marketingEmails: expect.any(String),
      },
    });
  });

  it("uploads and removes profile photos using the web profile-image policy and R2 boundary", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const writer = await createApiCredential(db, user.id, "Native photo writer", { scopes: ["kitchen:write"] });
    const photos = createMemoryPhotosBucket();
    const env = { PHOTOS: photos.bucket };
    const formData = new UndiciFormData();
    formData.append("photo", new File([new TextEncoder().encode("GIF89a")], "profile.gif", {
      type: PROFILE_IMAGE_TYPES.find((type) => type === "image/gif"),
    }));

    const upload = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/me/photo", {
      method: "POST",
      headers: bearerHeaders(writer.token, "req_me_photo_upload"),
      body: formData,
    }) as unknown as Request, "me/photo", env));
    const uploadPayload = await readJson(upload);

    expect(upload.status).toBe(200);
    expectPrivateEnvelopeHeaders(upload, "req_me_photo_upload");
    expectSuccessEnvelope(uploadPayload, "req_me_photo_upload");
    expect(uploadPayload.data.photoUrl).toMatch(new RegExp(`^/photos/profiles/${user.id}/.+\\.gif$`));
    expect(uploadPayload.data.me).toMatchObject({ id: user.id, photoUrl: uploadPayload.data.photoUrl });
    expect(photos.puts).toHaveLength(1);
    expect(photos.puts[0]).toMatchObject({
      key: expect.stringMatching(new RegExp(`^profiles/${user.id}/.+\\.gif$`)),
      options: { httpMetadata: { contentType: "image/gif" } },
    });
    await expect(db.user.findUniqueOrThrow({ where: { id: user.id } }))
      .resolves.toMatchObject({ photoUrl: uploadPayload.data.photoUrl });

    const remove = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/me/photo", {
      method: "DELETE",
      headers: bearerHeaders(writer.token, "req_me_photo_remove"),
    }) as unknown as Request, "me/photo", env));
    const removePayload = await readJson(remove);

    expect(remove.status).toBe(200);
    expectPrivateEnvelopeHeaders(remove, "req_me_photo_remove");
    expectSuccessEnvelope(removePayload, "req_me_photo_remove");
    expect(removePayload.data).toMatchObject({ removed: true, photoUrl: null, me: { id: user.id, photoUrl: null } });
    expect(photos.deletes).toEqual([uploadPayload.data.photoUrl.replace("/photos/", "")]);
    await expect(db.user.findUniqueOrThrow({ where: { id: user.id } }))
      .resolves.toMatchObject({ photoUrl: null });

    const removeAgain = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/me/photo", {
      method: "DELETE",
      headers: bearerHeaders(writer.token, "req_me_photo_remove_again"),
    }) as unknown as Request, "me/photo", env));
    const removeAgainPayload = await readJson(removeAgain);

    expect(removeAgain.status).toBe(200);
    expectPrivateEnvelopeHeaders(removeAgain, "req_me_photo_remove_again");
    expectSuccessEnvelope(removeAgainPayload, "req_me_photo_remove_again");
    expect(removeAgainPayload.data).toMatchObject({ removed: false, photoUrl: null, me: { id: user.id, photoUrl: null } });
    expect(photos.deletes).toHaveLength(1);

    for (const [requestId, file, reason] of [
      ["req_me_photo_invalid_type", new File(["<svg></svg>"], "avatar.svg", { type: "image/svg+xml" }), "invalid_file_type"],
      ["req_me_photo_too_large", new File([new Uint8Array(IMAGE_MAX_FILE_SIZE + 1)], "avatar.jpg", { type: "image/jpeg" }), "file_too_large"],
    ] as const) {
      const invalidForm = new UndiciFormData();
      invalidForm.append("photo", file);
      const invalid = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/me/photo", {
        method: "POST",
        headers: bearerHeaders(writer.token, requestId),
        body: invalidForm,
      }) as unknown as Request, "me/photo", env));
      const invalidPayload = await readJson(invalid);

      expect(invalid.status).toBe(400);
      expectPrivateEnvelopeHeaders(invalid, requestId);
      expectErrorEnvelope(invalidPayload, requestId, "validation_error", 400, true);
      expect(invalidPayload.error.details).toMatchObject({
        reason,
        fieldErrors: { photo: expect.any(String) },
      });
    }

    const missingForm = new UndiciFormData();
    const missing = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/me/photo", {
      method: "POST",
      headers: bearerHeaders(writer.token, "req_me_photo_missing"),
      body: missingForm,
    }) as unknown as Request, "me/photo", env));
    const missingPayload = await readJson(missing);

    expect(missing.status).toBe(400);
    expectPrivateEnvelopeHeaders(missing, "req_me_photo_missing");
    expectErrorEnvelope(missingPayload, "req_me_photo_missing", "validation_error", 400, true);
    expect(missingPayload.error.details).toMatchObject({
      reason: "no_file",
      fieldErrors: { photo: expect.any(String) },
    });
  });

  it("registers and revokes APNs devices without writing web push subscriptions", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const writer = await createApiCredential(db, user.id, "Native APNs writer", { scopes: ["kitchen:write"] });
    const token = `apns-token-${faker.string.alphanumeric(32)}`;

    const create = await action(routeArgs(jsonRequest("me/apns-devices", "POST", writer.token, "req_me_apns_create", {
      deviceId: "ios-simulator-1",
      platform: "ios",
      environment: "development",
      token,
      deviceName: "iPhone 17",
      appVersion: "1.0.0",
    }), "me/apns-devices"));
    const createPayload = await readJson(create);

    expect(create.status).toBe(201);
    expectPrivateEnvelopeHeaders(create, "req_me_apns_create");
    expectSuccessEnvelope(createPayload, "req_me_apns_create");
    expect(createPayload.data.device).toMatchObject({
      id: expect.any(String),
      deviceId: "ios-simulator-1",
      platform: "ios",
      environment: "development",
      tokenPrefix: token.slice(0, 12),
      deviceName: "iPhone 17",
      appVersion: "1.0.0",
      enabledAt: expect.any(String),
      revokedAt: null,
      lastRegisteredAt: expect.any(String),
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(createPayload.data.device.token).toBeUndefined();
    expect(createPayload.data.device.tokenHash).toBeUndefined();
    const rows = await db.$queryRawUnsafe<Array<{
      id: string;
      userId: string;
      deviceId: string;
      platform: string;
      environment: string;
      tokenHash: string;
      tokenPrefix: string;
      deviceName: string | null;
      appVersion: string | null;
      enabledAt: string | Date;
      revokedAt: string | null;
      lastRegisteredAt: string | Date;
      createdAt: string | Date;
      updatedAt: string | Date;
    }>>('SELECT "id", "userId", "deviceId", "platform", "environment", "tokenHash", "tokenPrefix", "deviceName", "appVersion", "enabledAt", "revokedAt", "lastRegisteredAt", "createdAt", "updatedAt" FROM "NativePushDevice" WHERE "userId" = ? AND "deviceId" = ?', user.id, "ios-simulator-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: createPayload.data.device.id,
      userId: user.id,
      deviceId: "ios-simulator-1",
      platform: "ios",
      environment: "development",
      tokenPrefix: token.slice(0, 12),
      deviceName: "iPhone 17",
      appVersion: "1.0.0",
      revokedAt: null,
    });
    expect(rows[0].tokenHash).not.toBe(token);
    expect(isoFromDbDate(rows[0].enabledAt)).toBe(createPayload.data.device.enabledAt);
    expect(isoFromDbDate(rows[0].lastRegisteredAt)).toBe(createPayload.data.device.lastRegisteredAt);
    expect(isoFromDbDate(rows[0].createdAt)).toBe(createPayload.data.device.createdAt);
    expect(isoFromDbDate(rows[0].updatedAt)).toBe(createPayload.data.device.updatedAt);
    expect(await db.pushSubscription.count({ where: { userId: user.id } })).toBe(0);

    const newToken = `apns-token-${faker.string.alphanumeric(32)}`;
    const update = await action(routeArgs(jsonRequest("me/apns-devices", "POST", writer.token, "req_me_apns_update", {
      deviceId: "ios-simulator-1",
      platform: "ios",
      environment: "development",
      token: newToken,
      deviceName: "iPhone 17 Pro",
      appVersion: "1.0.1",
    }), "me/apns-devices"));
    const updatePayload = await readJson(update);

    expect(update.status).toBe(200);
    expectPrivateEnvelopeHeaders(update, "req_me_apns_update");
    expectSuccessEnvelope(updatePayload, "req_me_apns_update");
    expect(updatePayload.data).toMatchObject({
      created: false,
      device: {
        id: createPayload.data.device.id,
        deviceId: "ios-simulator-1",
        tokenPrefix: newToken.slice(0, 12),
        deviceName: "iPhone 17 Pro",
        appVersion: "1.0.1",
        revokedAt: null,
        enabledAt: expect.any(String),
        lastRegisteredAt: expect.any(String),
      },
    });
    const updatedRows = await db.$queryRawUnsafe<Array<{ id: string; tokenHash: string; tokenPrefix: string; revokedAt: string | null }>>(
      'SELECT "id", "tokenHash", "tokenPrefix", "revokedAt" FROM "NativePushDevice" WHERE "userId" = ? AND "deviceId" = ?',
      user.id,
      "ios-simulator-1",
    );
    expect(updatedRows).toHaveLength(1);
    expect(updatedRows[0]).toMatchObject({
      id: createPayload.data.device.id,
      tokenPrefix: newToken.slice(0, 12),
      revokedAt: null,
    });
    expect(updatedRows[0].tokenHash).not.toBe(rows[0].tokenHash);
    expect(updatedRows[0].tokenHash).not.toBe(newToken);
    expect(await db.pushSubscription.count({ where: { userId: user.id } })).toBe(0);

    const revoke = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/me/apns-devices/ios-simulator-1", {
      method: "DELETE",
      headers: bearerHeaders(writer.token, "req_me_apns_revoke"),
    }) as unknown as Request, "me/apns-devices/ios-simulator-1"));
    const revokePayload = await readJson(revoke);

    expect(revoke.status).toBe(200);
    expectPrivateEnvelopeHeaders(revoke, "req_me_apns_revoke");
    expectSuccessEnvelope(revokePayload, "req_me_apns_revoke");
    expect(revokePayload.data).toMatchObject({
      revoked: true,
      device: {
        deviceId: "ios-simulator-1",
        revokedAt: expect.any(String),
      },
    });
    const revokedRows = await db.$queryRawUnsafe<Array<{ revokedAt: string | null }>>(
      'SELECT "revokedAt" FROM "NativePushDevice" WHERE "userId" = ? AND "deviceId" = ?',
      user.id,
      "ios-simulator-1",
    );
    expect(revokedRows[0].revokedAt).toEqual(expect.any(String));

    const revokeAgain = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/me/apns-devices/ios-simulator-1", {
      method: "DELETE",
      headers: bearerHeaders(writer.token, "req_me_apns_revoke_again"),
    }) as unknown as Request, "me/apns-devices/ios-simulator-1"));
    const revokeAgainPayload = await readJson(revokeAgain);

    expect(revokeAgain.status).toBe(200);
    expectPrivateEnvelopeHeaders(revokeAgain, "req_me_apns_revoke_again");
    expectSuccessEnvelope(revokeAgainPayload, "req_me_apns_revoke_again");
    expect(revokeAgainPayload.data).toMatchObject({
      revoked: false,
      device: { deviceId: "ios-simulator-1", revokedAt: expect.any(String) },
    });

    const invalid = await action(routeArgs(jsonRequest("me/apns-devices", "POST", writer.token, "req_me_apns_invalid", {
      deviceId: "",
      platform: "watchos",
      environment: "test",
      token: "",
      extra: true,
    }), "me/apns-devices"));
    const invalidPayload = await readJson(invalid);

    expect(invalid.status).toBe(400);
    expectPrivateEnvelopeHeaders(invalid, "req_me_apns_invalid");
    expectErrorEnvelope(invalidPayload, "req_me_apns_invalid", "validation_error", 400, true);
    expect(invalidPayload.error.details).toMatchObject({
      fieldErrors: {
        deviceId: expect.any(String),
        platform: expect.any(String),
        environment: expect.any(String),
        token: expect.any(String),
        extra: expect.any(String),
      },
    });
  });

  it("lists and disconnects OAuth account connections by stable resource-aware IDs", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const reader = await createApiCredential(db, user.id, "Native connection reader", { scopes: ["kitchen:read"] });
    const writer = await createApiCredential(db, user.id, "Native connection writer", { scopes: ["kitchen:write"] });
    const client = await db.oAuthClient.create({
      data: {
        clientName: "Meal planner",
        redirectUris: "https://planner.example/callback",
      },
    });
    const resource = "https://spoonjoy.app/mcp";
    const connectionId = nativeConnectionIdFor(client.id, resource);
    await db.oAuthRefreshToken.create({
      data: {
        tokenHash: `refresh-${faker.string.alphanumeric(12)}`,
        userId: user.id,
        clientId: client.id,
        resource,
        scope: "recipes:read shopping_list:read",
        createdAt: new Date("2026-06-05T10:00:00.000Z"),
      },
    });
    await db.oAuthRefreshToken.create({
      data: {
        tokenHash: `refresh-${faker.string.alphanumeric(12)}`,
        userId: user.id,
        clientId: client.id,
        resource,
        scope: "cookbooks:read",
        createdAt: new Date("2026-06-04T10:00:00.000Z"),
      },
    });
    const access = await createApiCredential(db, user.id, "Meal planner access", {
      scopes: ["recipes:read"],
      oauthClientId: client.id,
      oauthResource: resource,
      expiresAt: new Date("2026-07-01T10:00:00.000Z"),
    });

    const list = await loader(routeArgs(getRequest("me/connections", reader.token, "req_me_connections"), "me/connections"));
    const listPayload = await readJson(list);

    expect(list.status).toBe(200);
    expectPrivateEnvelopeHeaders(list, "req_me_connections");
    expectSuccessEnvelope(listPayload, "req_me_connections");
    expect(listPayload.data.connections).toEqual([
      {
        id: connectionId,
        clientId: client.id,
        clientName: "Meal planner",
        resource,
        scopes: ["cookbooks:read", "recipes:read", "shopping_list:read"],
        createdAt: "2026-06-04T10:00:00.000Z",
        refreshTokenCount: 2,
        accessTokenCount: 1,
      },
    ]);

    const disconnect = await action(routeArgs(new UndiciRequest(`http://localhost/api/v1/me/connections/${connectionId}`, {
      method: "DELETE",
      headers: bearerHeaders(writer.token, "req_me_connection_disconnect"),
    }) as unknown as Request, `me/connections/${connectionId}`));
    const disconnectPayload = await readJson(disconnect);

    expect(disconnect.status).toBe(200);
    expectPrivateEnvelopeHeaders(disconnect, "req_me_connection_disconnect");
    expectSuccessEnvelope(disconnectPayload, "req_me_connection_disconnect");
    expect(disconnectPayload.data).toMatchObject({
      disconnected: true,
      connection: { id: connectionId, clientId: client.id, resource },
    });
    await expect(db.oAuthRefreshToken.findMany({ where: { userId: user.id, clientId: client.id, resource } }))
      .resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      ]));
    await expect(db.apiCredential.findUniqueOrThrow({ where: { id: access.credential.id } }))
      .resolves.toMatchObject({ revokedAt: expect.any(Date) });

    const missing = await action(routeArgs(new UndiciRequest(`http://localhost/api/v1/me/connections/${connectionId}`, {
      method: "DELETE",
      headers: bearerHeaders(writer.token, "req_me_connection_missing"),
    }) as unknown as Request, `me/connections/${connectionId}`));
    const missingPayload = await readJson(missing);

    expect(missing.status).toBe(404);
    expectPrivateEnvelopeHeaders(missing, "req_me_connection_missing");
    expectErrorEnvelope(missingPayload, "req_me_connection_missing", "not_found", 404);
  });

  it("enforces authentication and kitchen scopes before account payload parsing", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const readOnly = await createApiCredential(db, user.id, "Native account read", { scopes: ["kitchen:read"] });
    const shoppingOnly = await createApiCredential(db, user.id, "Shopping only", { scopes: ["shopping_list:read"] });

    const missingAuth = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/me", {
      headers: { "X-Request-Id": "req_me_missing_auth" },
    }) as unknown as Request, "me"));
    const missingAuthPayload = await readJson(missingAuth);

    expect(missingAuth.status).toBe(401);
    expectPrivateEnvelopeHeaders(missingAuth, "req_me_missing_auth");
    expectErrorEnvelope(missingAuthPayload, "req_me_missing_auth", "authentication_required", 401);

    const invalidBearer = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/me", {
      headers: { Authorization: "Bearer sj_missing", "X-Request-Id": "req_me_invalid_bearer" },
    }) as unknown as Request, "me"));
    const invalidBearerPayload = await readJson(invalidBearer);

    expect(invalidBearer.status).toBe(401);
    expectPrivateEnvelopeHeaders(invalidBearer, "req_me_invalid_bearer");
    expectErrorEnvelope(invalidBearerPayload, "req_me_invalid_bearer", "invalid_token", 401);

    const readWithoutKitchen = await loader(routeArgs(getRequest(
      "me",
      shoppingOnly.token,
      "req_me_read_scope",
    ), "me"));
    const readWithoutKitchenPayload = await readJson(readWithoutKitchen);

    expect(readWithoutKitchen.status).toBe(403);
    expectPrivateEnvelopeHeaders(readWithoutKitchen, "req_me_read_scope");
    expectErrorEnvelope(readWithoutKitchenPayload, "req_me_read_scope", "insufficient_scope", 403);

    const writeWithoutKitchen = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/me", {
      method: "PATCH",
      headers: bearerHeaders(readOnly.token, "req_me_write_scope_bad_json", { "Content-Type": "application/json" }),
      body: "{",
    }) as unknown as Request, "me"));
    const writeWithoutKitchenPayload = await readJson(writeWithoutKitchen);

    expect(writeWithoutKitchen.status).toBe(403);
    expectPrivateEnvelopeHeaders(writeWithoutKitchen, "req_me_write_scope_bad_json");
    expectErrorEnvelope(writeWithoutKitchenPayload, "req_me_write_scope_bad_json", "insufficient_scope", 403);

    const photoWithoutKitchen = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/me/photo", {
      method: "DELETE",
      headers: bearerHeaders(readOnly.token, "req_me_photo_write_scope"),
    }) as unknown as Request, "me/photo"));
    const photoWithoutKitchenPayload = await readJson(photoWithoutKitchen);

    expect(photoWithoutKitchen.status).toBe(403);
    expectPrivateEnvelopeHeaders(photoWithoutKitchen, "req_me_photo_write_scope");
    expectErrorEnvelope(photoWithoutKitchenPayload, "req_me_photo_write_scope", "insufficient_scope", 403);

    const sessionOnly = await db.user.create({ data: createTestUser() });
    const cookie = await sessionCookie(sessionOnly.id);
    const sessionResponse = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/me", {
      headers: { Cookie: cookie, "X-Request-Id": "req_me_session" },
    }) as unknown as Request, "me"));
    const sessionPayload = await readJson(sessionResponse);

    expect(sessionResponse.status).toBe(200);
    expectPrivateEnvelopeHeaders(sessionResponse, "req_me_session");
    expectSuccessEnvelope(sessionPayload, "req_me_session");
    expect(sessionPayload.data.me).toMatchObject({ id: sessionOnly.id });
  });
});
