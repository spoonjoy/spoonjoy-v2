import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { faker } from "@faker-js/faker";
import { FormData as UndiciFormData, Request as UndiciRequest } from "undici";
import { action, loader } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import { createUser } from "~/lib/auth.server";
import { db } from "~/lib/db.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";

function routeArgs(request: Request, splat: string, context: Record<string, unknown> = {}) {
  return {
    request,
    params: { "*": splat },
    context: { cloudflare: { env: null }, ...context },
  } as any;
}

async function readJson(response: Response) {
  return await response.json() as any;
}

async function sessionCookie(userId: string) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  return (await sessionStorage.commitSession(session)).split(";")[0];
}

function expectEnvelopeHeaders(response: Response, requestId: string) {
  expect(response.headers.get("Content-Type")).toContain("application/json");
  expect(response.headers.get("X-Request-Id")).toBe(requestId);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Pragma")).toBe("no-cache");
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
}

function jsonRequest(path: string, method: "GET" | "PATCH" | "DELETE", headers: HeadersInit, body?: unknown) {
  return new UndiciRequest(`http://localhost/api/v1/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as Request;
}

async function apiGet(path: string, headers: HeadersInit, requestId: string) {
  return await loader(routeArgs(jsonRequest(path, "GET", { "X-Request-Id": requestId, ...headers }), path));
}

async function apiPatch(path: string, headers: HeadersInit, requestId: string, body: unknown) {
  return await action(routeArgs(jsonRequest(path, "PATCH", { "X-Request-Id": requestId, ...headers }, body), path));
}

async function apiDelete(path: string, headers: HeadersInit, requestId: string) {
  return await action(routeArgs(jsonRequest(path, "DELETE", { "X-Request-Id": requestId, ...headers }), path));
}

async function uploadProfilePhoto(cookie: string, file: File, requestId: string) {
  const formData = new UndiciFormData();
  formData.append("photo", file);
  return await action(routeArgs(new UndiciRequest("http://localhost/api/v1/me/photo", {
    method: "POST",
    headers: { Cookie: cookie, "X-Request-Id": requestId },
    body: formData,
    duplex: "half",
  }) as unknown as Request, "me/photo"));
}

function oauthConnectionFixture(
  userId: string,
  clientId: string,
  resource: string | null,
  scope: string,
  createdAt: Date,
  connectionKey?: string | null,
) {
  return db.oAuthRefreshToken.create({
    data: {
      tokenHash: `refresh-${faker.string.alphanumeric(18)}`,
      userId,
      clientId,
      resource,
      scope,
      createdAt,
      connectionKey,
    },
  });
}

describe("API v1 native account settings", () => {
  let userId: string;
  let email: string;
  let username: string;

  beforeEach(async () => {
    await cleanupDatabase();
    email = faker.internet.email();
    username = `${faker.internet.username()}_${faker.string.alphanumeric(8)}`;
    const user = await createUser(db, email, username, "testPassword123");
    userId = user.id;
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("serves the signed-in account profile with native-decoded auth methods", async () => {
    await db.user.update({
      where: { id: userId },
      data: { photoUrl: "/photos/profiles/chef/avatar.jpg" },
    });
    await db.oAuth.create({
      data: {
        provider: "google",
        providerUserId: `google-${faker.string.alphanumeric(8)}`,
        providerUsername: "chef@example.com",
        userId,
      },
    });
    await db.userCredential.create({
      data: {
        id: "pk_native_account",
        userId,
        publicKey: new Uint8Array([1, 2, 3]),
        counter: 0n,
        name: "Kitchen Mac",
        transports: "internal",
        createdAt: new Date("2026-06-20T10:00:00.000Z"),
      },
    });
    await db.userCredential.create({
      data: {
        id: "pk_legacy_native_account",
        userId,
        publicKey: new Uint8Array([4, 5, 6]),
        counter: 0n,
        name: null,
        transports: null,
      },
    });
    const cookie = await sessionCookie(userId);

    const response = await apiGet("me", { Cookie: cookie }, "req_me_profile");
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expectEnvelopeHeaders(response, "req_me_profile");
    expect(payload.data).toMatchObject({
      id: userId,
      email: email.toLowerCase(),
      username,
      photoUrl: "https://spoonjoy.app/photos/profiles/chef/avatar.jpg",
      hasPassword: true,
      oauthAccounts: [{ provider: "google", providerUsername: "chef@example.com" }],
    });
    expect(payload.data.passkeys).toEqual(expect.arrayContaining([{
        id: "pk_native_account",
        name: "Kitchen Mac",
        transports: "internal",
        createdAt: "2026-06-20T10:00:00.000Z",
      },
      {
        id: "pk_legacy_native_account",
        name: "Passkey",
        transports: null,
        createdAt: null,
      },
    ]));
  });

  it("updates profile identity with session or account-write bearer auth and rejects collisions", async () => {
    const bearer = await createApiCredential(db, userId, "Native settings writer", { scopes: ["account:write"] });
    const other = await createUser(
      db,
      faker.internet.email(),
      `${faker.internet.username()}_${faker.string.alphanumeric(8)}`,
      "testPassword123",
    );
    const newEmail = faker.internet.email().toUpperCase();
    const newUsername = `native_${faker.string.alphanumeric(8)}`;

    const response = await apiPatch("me", {
      Authorization: `Bearer ${bearer.token}`,
    }, "req_me_profile_update", { email: newEmail, username: newUsername });
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expectEnvelopeHeaders(response, "req_me_profile_update");
    expect(payload.data).toMatchObject({
      id: userId,
      email: newEmail.toLowerCase(),
      username: newUsername,
    });
    await expect(db.user.findUniqueOrThrow({ where: { id: userId } }))
      .resolves.toMatchObject({ email: newEmail.toLowerCase(), username: newUsername });

    const noChange = await apiPatch("me", {
      Authorization: `Bearer ${bearer.token}`,
    }, "req_me_profile_no_change", { email: newEmail.toLowerCase(), username: newUsername });

    expect(noChange.status).toBe(200);

    const emailConflict = await apiPatch("me", {
      Authorization: `Bearer ${bearer.token}`,
    }, "req_me_email_conflict", { email: other.email.toUpperCase(), username: newUsername });
    const emailConflictPayload = await readJson(emailConflict);

    expect(emailConflict.status).toBe(400);
    expect(emailConflictPayload).toMatchObject({
      ok: false,
      requestId: "req_me_email_conflict",
      error: { code: "validation_error", details: { field: "email" } },
    });

    const usernameConflict = await apiPatch("me", {
      Authorization: `Bearer ${bearer.token}`,
    }, "req_me_username_conflict", { email: newEmail, username: other.username });
    const usernameConflictPayload = await readJson(usernameConflict);

    expect(usernameConflict.status).toBe(400);
    expect(usernameConflictPayload).toMatchObject({
      ok: false,
      requestId: "req_me_username_conflict",
      error: { code: "validation_error", details: { field: "username" } },
    });

    const invalid = await apiPatch("me", {
      Authorization: `Bearer ${bearer.token}`,
    }, "req_me_profile_invalid", { email: "not-an-email", username: "" });
    const invalidPayload = await readJson(invalid);

    expect(invalid.status).toBe(400);
    expect(invalidPayload.error).toMatchObject({
      code: "validation_error",
      details: { fields: expect.arrayContaining(["email", "username"]) },
    });

    const nonStringInvalid = await apiPatch("me", {
      Authorization: `Bearer ${bearer.token}`,
    }, "req_me_profile_non_string_invalid", { email: 123, username: 456 });
    const nonStringInvalidPayload = await readJson(nonStringInvalid);

    expect(nonStringInvalid.status).toBe(400);
    expect(nonStringInvalidPayload.error).toMatchObject({
      code: "validation_error",
      details: { fields: expect.arrayContaining(["email", "username"]) },
    });
  });

  it("reads and updates native notification preferences", async () => {
    const cookie = await sessionCookie(userId);

    const defaults = await apiGet("me/notification-preferences", { Cookie: cookie }, "req_me_notifications_default");
    const defaultsPayload = await readJson(defaults);

    expect(defaults.status).toBe(200);
    expect(defaultsPayload.data).toEqual({
      notifySpoonOnMyRecipe: true,
      notifyForkOfMyRecipe: true,
      notifyCookbookSaveOfMine: true,
      notifyFellowChefOriginCook: true,
    });

    const update = await apiPatch("me/notification-preferences", { Cookie: cookie }, "req_me_notifications_update", {
      notifySpoonOnMyRecipe: false,
      notifyForkOfMyRecipe: true,
      notifyCookbookSaveOfMine: false,
      notifyFellowChefOriginCook: true,
    });
    const updatePayload = await readJson(update);

    expect(update.status).toBe(200);
    expectEnvelopeHeaders(update, "req_me_notifications_update");
    expect(updatePayload.data).toEqual({
      notifySpoonOnMyRecipe: false,
      notifyForkOfMyRecipe: true,
      notifyCookbookSaveOfMine: false,
      notifyFellowChefOriginCook: true,
    });
    await expect(db.notificationPreference.findUniqueOrThrow({ where: { userId } }))
      .resolves.toMatchObject({
        notifySpoonOnMyRecipe: false,
        notifyForkOfMyRecipe: true,
        notifyCookbookSaveOfMine: false,
        notifyFellowChefOriginCook: true,
      });

    const persisted = await apiGet("me/notification-preferences", { Cookie: cookie }, "req_me_notifications_persisted");
    const persistedPayload = await readJson(persisted);

    expect(persisted.status).toBe(200);
    expect(persistedPayload.data).toEqual(updatePayload.data);

    const invalid = await apiPatch("me/notification-preferences", { Cookie: cookie }, "req_me_notifications_invalid_boolean", {
      notifySpoonOnMyRecipe: "false",
      notifyForkOfMyRecipe: true,
      notifyCookbookSaveOfMine: false,
      notifyFellowChefOriginCook: true,
    });
    const invalidPayload = await readJson(invalid);

    expect(invalid.status).toBe(400);
    expect(invalidPayload.error).toMatchObject({
      code: "validation_error",
      details: { field: "notifySpoonOnMyRecipe" },
    });
  });

  it("uploads, rejects, and removes native profile photos", async () => {
    const cookie = await sessionCookie(userId);
    const validPhotos = [
      { requestId: "req_me_photo_gif", file: new File([new TextEncoder().encode("GIF89a")], "profile.gif", { type: "image/gif" }), prefix: /^data:image\/gif;base64,/ },
      { requestId: "req_me_photo_png", file: new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])], "profile.png", { type: "image/png" }), prefix: /^data:image\/png;base64,/ },
      { requestId: "req_me_photo_jpeg", file: new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00])], "profile.jpeg", { type: "image/jpeg" }), prefix: /^data:image\/jpeg;base64,/ },
      { requestId: "req_me_photo_webp", file: new File([new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])], "profile.webp", { type: "image/webp" }), prefix: /^data:image\/webp;base64,/ },
    ];

    for (const { requestId, file, prefix } of validPhotos) {
      const upload = await uploadProfilePhoto(cookie, file, requestId);
      const uploadPayload = await readJson(upload);

      expect(upload.status).toBe(200);
      expectEnvelopeHeaders(upload, requestId);
      expect(uploadPayload.data.photoUrl).toMatch(prefix);
      await expect(db.user.findUniqueOrThrow({ where: { id: userId } }))
        .resolves.toMatchObject({ photoUrl: uploadPayload.data.photoUrl });
    }

    const invalidFormData = new UndiciFormData();
    invalidFormData.append("photo", new File(["hello"], "notes.txt", { type: "text/plain" }));
    const invalid = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/me/photo", {
      method: "POST",
      headers: { Cookie: cookie, "X-Request-Id": "req_me_photo_invalid" },
      body: invalidFormData,
      duplex: "half",
    }) as unknown as Request, "me/photo"));
    const invalidPayload = await readJson(invalid);

    expect(invalid.status).toBe(400);
    expect(invalidPayload.error).toMatchObject({ code: "validation_error", details: { field: "photo" } });

    const missingFormData = new UndiciFormData();
    const missing = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/me/photo", {
      method: "POST",
      headers: { Cookie: cookie, "X-Request-Id": "req_me_photo_missing" },
      body: missingFormData,
      duplex: "half",
    }) as unknown as Request, "me/photo"));
    const missingPayload = await readJson(missing);

    expect(missing.status).toBe(400);
    expect(missingPayload.error).toMatchObject({ code: "validation_error", details: { field: "photo", reason: "missing" } });

    const noBody = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/me/photo", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded", "X-Request-Id": "req_me_photo_no_body" },
    }) as unknown as Request, "me/photo"));
    const noBodyPayload = await readJson(noBody);

    expect(noBody.status).toBe(400);
    expect(noBodyPayload.error).toMatchObject({ code: "validation_error", details: { field: "photo", reason: "missing" } });

    const urlEncodedBytes = new TextEncoder().encode("photo=");
    const streamedWithLength = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/me/photo", {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": String(urlEncodedBytes.byteLength),
        "X-Request-Id": "req_me_photo_streamed_with_length",
      },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(urlEncodedBytes);
          controller.close();
        },
      }),
      duplex: "half",
    }) as unknown as Request, "me/photo"));
    const streamedWithLengthPayload = await readJson(streamedWithLength);

    expect(streamedWithLength.status).toBe(400);
    expect(streamedWithLengthPayload.error).toMatchObject({ code: "validation_error", details: { field: "photo", reason: "missing" } });

    const spoofed = await uploadProfilePhoto(
      cookie,
      new File(["hello"], "fake.png", { type: "image/png" }),
      "req_me_photo_spoofed",
    );
    const spoofedPayload = await readJson(spoofed);

    expect(spoofed.status).toBe(400);
    expect(spoofedPayload.error).toMatchObject({ code: "validation_error", details: { field: "photo" } });

    const unknownTypeUpload = await uploadProfilePhoto(
      cookie,
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00])], "profile.bin", { type: "application/octet-stream" }),
      "req_me_photo_octet",
    );
    const unknownTypePayload = await readJson(unknownTypeUpload);

    expect(unknownTypeUpload.status).toBe(200);
    expect(unknownTypePayload.data.photoUrl).toMatch(/^data:image\/jpeg;base64,/);

    const wrongDeclaredType = await uploadProfilePhoto(
      cookie,
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00])], "profile.png", { type: "image/png" }),
      "req_me_photo_wrong_declared_type",
    );
    const wrongDeclaredPayload = await readJson(wrongDeclaredType);

    expect(wrongDeclaredType.status).toBe(400);
    expect(wrongDeclaredPayload.error).toMatchObject({ code: "validation_error", details: { field: "photo" } });

    const oversized = await uploadProfilePhoto(
      cookie,
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], "huge.png", { type: "image/png" }),
      "req_me_photo_oversized",
    );
    const oversizedPayload = await readJson(oversized);

    expect(oversized.status).toBe(400);
    expect(oversizedPayload.error).toMatchObject({ code: "validation_error", details: { field: "photo" } });

    const oversizedDeclared = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/me/photo", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Length": String(6 * 1024 * 1024), "X-Request-Id": "req_me_photo_declared_oversized" },
      body: new UndiciFormData(),
      duplex: "half",
    }) as unknown as Request, "me/photo"));
    const oversizedDeclaredPayload = await readJson(oversizedDeclared);

    expect(oversizedDeclared.status).toBe(400);
    expect(oversizedDeclaredPayload.error).toMatchObject({ code: "validation_error", details: { field: "photo" } });

    const oversizedChunked = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/me/photo", {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "multipart/form-data; boundary=spoonjoy-native-boundary",
        "X-Request-Id": "req_me_photo_chunked_oversized",
      },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(6 * 1024 * 1024));
          controller.close();
        },
      }),
      duplex: "half",
    }) as unknown as Request, "me/photo"));
    const oversizedChunkedPayload = await readJson(oversizedChunked);

    expect(oversizedChunked.status).toBe(400);
    expect(oversizedChunkedPayload.error).toMatchObject({ code: "validation_error", details: { field: "photo" } });

    const cancelRejectingOversized = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/me/photo", {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "multipart/form-data; boundary=spoonjoy-native-boundary",
        "X-Request-Id": "req_me_photo_cancel_rejecting_oversized",
      },
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(6 * 1024 * 1024));
        },
        cancel() {
          return Promise.reject(new Error("cancel rejected"));
        },
      }),
      duplex: "half",
    }) as unknown as Request, "me/photo"));
    const cancelRejectingPayload = await readJson(cancelRejectingOversized);

    expect(cancelRejectingOversized.status).toBe(400);
    expect(cancelRejectingPayload.error).toMatchObject({ code: "validation_error", details: { field: "photo" } });

    const remove = await apiDelete("me/photo", { Cookie: cookie }, "req_me_photo_remove");
    const removePayload = await readJson(remove);

    expect(remove.status).toBe(200);
    expect(removePayload.data).toMatchObject({ photoUrl: null });
    await expect(db.user.findUniqueOrThrow({ where: { id: userId } }))
      .resolves.toMatchObject({ photoUrl: null });

    await db.user.update({
      where: { id: userId },
      data: { photoUrl: `/photos/profiles/${userId}/avatar.jpg` },
    });
    const deleteCalls: string[] = [];
    const removeWithEnv = await action(routeArgs(jsonRequest("me/photo", "DELETE", {
      Cookie: cookie,
      "X-Request-Id": "req_me_photo_remove_with_env",
    }), "me/photo", {
      cloudflare: {
        env: {
          POSTHOG_KEY: "ph_test",
          PHOTOS: { delete: async (key: string) => { deleteCalls.push(key); } },
        },
      },
    }));
    const removeWithEnvPayload = await readJson(removeWithEnv);

    expect(removeWithEnv.status).toBe(200);
    expect(removeWithEnvPayload.data).toMatchObject({ photoUrl: null });
    expect(deleteCalls).toEqual([`profiles/${userId}/avatar.jpg`]);
  });

  it("lists and disconnects OAuth app connections with opaque native IDs", async () => {
    const token = await createApiCredential(db, userId, "Native token admin", { scopes: ["tokens:read", "tokens:write"] });
    const client = await db.oAuthClient.create({
      data: {
        clientName: "Meal planner",
        redirectUris: JSON.stringify(["https://client.example/callback"]),
      },
    });
    await oauthConnectionFixture(userId, client.id, "https://spoonjoy.app/mcp", "shopping_list:read", new Date("2026-06-22T10:00:00.000Z"));
    await oauthConnectionFixture(userId, client.id, "https://spoonjoy.app/mcp", "cookbooks:read", new Date("2026-06-22T10:00:00.000Z"));
    await oauthConnectionFixture(userId, client.id, "https://spoonjoy.app/mcp", "recipes:read shopping_list:write", new Date("2026-06-21T10:00:00.000Z"));
    const access = await createApiCredential(db, userId, "Meal planner access", {
      scopes: ["shopping_list:read"],
      oauthClientId: client.id,
      oauthResource: "https://spoonjoy.app/mcp",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const missingClientId = `cm_missing_${faker.string.alphanumeric(8)}`;
    await oauthConnectionFixture(userId, missingClientId, null, "account:read", new Date("2026-06-20T10:00:00.000Z"));
    await createApiCredential(db, userId, "Missing client access", {
      scopes: ["account:read"],
      oauthClientId: missingClientId,
      oauthResource: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const response = await apiGet("me/connections", {
      Authorization: `Bearer ${token.token}`,
    }, "req_me_connections");
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expectEnvelopeHeaders(response, "req_me_connections");
    expect(payload.data.connections).toEqual([expect.objectContaining({
      id: expect.stringMatching(/^conn_[A-Za-z0-9_-]+$/),
      clientId: client.id,
      clientName: "Meal planner",
      resource: "https://spoonjoy.app/mcp",
      scopes: ["cookbooks:read", "recipes:read", "shopping_list:read", "shopping_list:write"],
      createdAt: "2026-06-21T10:00:00.000Z",
      refreshTokenCount: 3,
      accessTokenCount: 1,
    }), expect.objectContaining({
      clientId: missingClientId,
      clientName: missingClientId,
      resource: null,
      scopes: ["account:read"],
      refreshTokenCount: 1,
      accessTokenCount: 1,
    })]);

    type NativeConnectionSummary = {
      id: string;
      clientId: string;
      resource: string | null;
    };
    const connections = payload.data.connections as NativeConnectionSummary[];
    const primaryConnection = connections.find((connection) =>
      connection.clientId === client.id && connection.resource === "https://spoonjoy.app/mcp");

    expect(primaryConnection).toBeDefined();
    const connectionId = primaryConnection!.id;
    const malformedPrefix = await apiDelete("me/connections/not-a-connection", {
      Authorization: `Bearer ${token.token}`,
    }, "req_me_connection_bad_prefix");

    expect(malformedPrefix.status).toBe(404);

    const wrongShapeId = `conn_${Buffer.from(JSON.stringify({
      clientId: 123,
      resource: null,
      connectionKey: "bad",
    })).toString("base64url")}`;
    const wrongShape = await apiDelete(`me/connections/${wrongShapeId}`, {
      Authorization: `Bearer ${token.token}`,
    }, "req_me_connection_wrong_shape");

    expect(wrongShape.status).toBe(404);

    const invalidResourceId = `conn_${Buffer.from(JSON.stringify({
      clientId: "client-with-invalid-resource",
      resource: 123,
      connectionKey: "bad-resource",
    })).toString("base64url")}`;
    const invalidResource = await apiDelete(`me/connections/${invalidResourceId}`, {
      Authorization: `Bearer ${token.token}`,
    }, "req_me_connection_invalid_resource");

    expect(invalidResource.status).toBe(404);

    const disconnect = await apiDelete(`me/connections/${connectionId}`, {
      Authorization: `Bearer ${token.token}`,
    }, "req_me_connection_disconnect");
    const disconnectPayload = await readJson(disconnect);

    expect(disconnect.status).toBe(200);
    expect(disconnectPayload.data).toMatchObject({ disconnected: true, connectionId });
    await expect(db.oAuthRefreshToken.count({ where: { userId, clientId: client.id, revokedAt: null } })).resolves.toBe(0);
    await expect(db.apiCredential.findUniqueOrThrow({ where: { id: access.credential.id } }))
      .resolves.toMatchObject({ revokedAt: expect.any(Date) });

    const repeated = await apiDelete(`me/connections/${connectionId}`, {
      Authorization: `Bearer ${token.token}`,
    }, "req_me_connection_repeat");

    expect(repeated.status).toBe(404);

    await oauthConnectionFixture(userId, client.id, "https://spoonjoy.app/mcp", "shopping_list:read", new Date("2026-06-23T10:00:00.000Z"));
    const staleDisconnect = await apiDelete(`me/connections/${connectionId}`, {
      Authorization: `Bearer ${token.token}`,
    }, "req_me_connection_stale");

    expect(staleDisconnect.status).toBe(404);
    await expect(db.oAuthRefreshToken.count({ where: { userId, clientId: client.id, revokedAt: null } })).resolves.toBe(1);
  });

  it("keeps OAuth app connection IDs stable across refresh rotation", async () => {
    const token = await createApiCredential(db, userId, "Native token admin", { scopes: ["tokens:read", "tokens:write"] });
    const client = await db.oAuthClient.create({
      data: {
        clientName: "Meal planner",
        redirectUris: JSON.stringify(["https://client.example/callback"]),
      },
    });
    const original = await oauthConnectionFixture(userId, client.id, null, "account:read", new Date("2026-06-21T10:00:00.000Z"));

    const response = await apiGet("me/connections", {
      Authorization: `Bearer ${token.token}`,
    }, "req_me_connection_before_rotation");
    const payload = await readJson(response);
    const connectionId = payload.data.connections[0].id;

    await db.oAuthRefreshToken.update({
      where: { id: original.id },
      data: { revokedAt: new Date("2026-06-22T10:00:00.000Z") },
    });
    await oauthConnectionFixture(userId, client.id, null, "account:read", new Date("2026-06-22T10:00:01.000Z"), original.id);

    const disconnect = await apiDelete(`me/connections/${connectionId}`, {
      Authorization: `Bearer ${token.token}`,
    }, "req_me_connection_after_rotation");
    const disconnectPayload = await readJson(disconnect);

    expect(disconnect.status).toBe(200);
    expect(disconnectPayload.data).toMatchObject({ disconnected: true, connectionId });
    await expect(db.oAuthRefreshToken.count({ where: { userId, clientId: client.id, revokedAt: null } })).resolves.toBe(0);
  });

  it("enforces authentication and native settings scopes", async () => {
    const noAuth = await apiGet("me", {}, "req_me_no_auth");
    const narrow = await createApiCredential(db, userId, "Recipe reader", { scopes: ["recipes:read"] });
    const wrongScope = await apiGet("me", {
      Authorization: `Bearer ${narrow.token}`,
    }, "req_me_wrong_scope");
    const kitchen = await createApiCredential(db, userId, "Kitchen-only native client", { scopes: ["kitchen:read", "kitchen:write"] });
    const kitchenWrongScope = await apiGet("me", {
      Authorization: `Bearer ${kitchen.token}`,
    }, "req_me_kitchen_wrong_scope");
    const account = await createApiCredential(db, userId, "Account reader", { scopes: ["account:read"] });
    const accountRead = await apiGet("me", {
      Authorization: `Bearer ${account.token}`,
    }, "req_me_account_read");
    const connectionWrongScope = await apiGet("me/connections", {
      Authorization: `Bearer ${narrow.token}`,
    }, "req_me_connections_wrong_scope");

    expect(noAuth.status).toBe(401);
    await expect(readJson(noAuth)).resolves.toMatchObject({
      ok: false,
      error: { code: "authentication_required" },
    });
    expect(wrongScope.status).toBe(403);
    await expect(readJson(wrongScope)).resolves.toMatchObject({
      ok: false,
      error: { code: "insufficient_scope", message: "Missing required scope: account:read" },
    });
    expect(kitchenWrongScope.status).toBe(403);
    await expect(readJson(kitchenWrongScope)).resolves.toMatchObject({
      ok: false,
      error: { code: "insufficient_scope", message: "Missing required scope: account:read" },
    });
    expect(accountRead.status).toBe(200);
    expect(connectionWrongScope.status).toBe(403);
    await expect(readJson(connectionWrongScope)).resolves.toMatchObject({
      ok: false,
      error: { code: "insufficient_scope", message: "Missing required scope: tokens:read" },
    });
  });
});
