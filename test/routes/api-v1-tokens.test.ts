import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { faker } from "@faker-js/faker";
import { Request as UndiciRequest } from "undici";
import { action, loader } from "~/routes/api.v1.$";
import { createApiCredential, DEFAULT_PERSONAL_API_TOKEN_SCOPES } from "~/lib/api-auth.server";
import { getLocalDb } from "~/lib/db.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser } from "../utils";

function routeArgs(request: Request, splat: string) {
  return { request, params: { "*": splat }, context: { cloudflare: { env: null } } } as any;
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
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Authorization, Content-Type, X-Request-Id");
  expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, PATCH, DELETE, OPTIONS");
  expect(response.headers.get("Access-Control-Expose-Headers")).toBe("X-Request-Id");
}

function expectCredentialMetadataShape(credential: any) {
  expect(credential).toMatchObject({
    id: expect.any(String),
    name: expect.any(String),
    tokenPrefix: expect.stringMatching(/^sj_/),
    scopes: expect.any(Array),
    createdAt: expect.any(String),
    updatedAt: expect.any(String),
  });
  for (const key of ["lastUsedAt", "revokedAt", "expiresAt"]) {
    expect(credential[key] === null || typeof credential[key] === "string").toBe(true);
  }
}

describe("API v1 personal token metadata", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("lists credential metadata for session and tokens:read bearer callers", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const cookie = await sessionCookie(user.id);
    const first = await createApiCredential(db, user.id, `List one ${faker.string.alphanumeric(6)}`, {
      scopes: ["recipes:read", "tokens:read"],
    });
    const second = await createApiCredential(db, user.id, `List two ${faker.string.alphanumeric(6)}`, {
      scopes: ["shopping_list:read"],
    });
    const reader = await createApiCredential(db, user.id, "Token reader", { scopes: ["tokens:read"] });

    const sessionResponse = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
      headers: { Cookie: cookie, "X-Request-Id": "req_tokens_session_list" },
    }) as unknown as Request, "tokens"));
    const sessionPayload = await readJson(sessionResponse);

    expect(sessionResponse.status).toBe(200);
    expectEnvelopeHeaders(sessionResponse, "req_tokens_session_list");
    expect(sessionPayload.data.tokens.map((credential: { id: string }) => credential.id)).toEqual(
      expect.arrayContaining([first.credential.id, second.credential.id, reader.credential.id])
    );
    expectCredentialMetadataShape(sessionPayload.data.tokens[0]);
    expect(sessionPayload.data.tokens.find((credential: { id: string }) => credential.id === first.credential.id)).toMatchObject({
      name: first.credential.name,
      tokenPrefix: first.credential.tokenPrefix,
      scopes: ["recipes:read", "tokens:read"],
      lastUsedAt: null,
      revokedAt: null,
      expiresAt: null,
    });
    expect(sessionPayload.data.tokens[0].token).toBeUndefined();

    const bearerResponse = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
      headers: { Authorization: `Bearer ${reader.token}`, "X-Request-Id": "req_tokens_bearer_list" },
    }) as unknown as Request, "tokens"));
    const bearerPayload = await readJson(bearerResponse);

    expect(bearerResponse.status).toBe(200);
    expectEnvelopeHeaders(bearerResponse, "req_tokens_bearer_list");
    expect(bearerPayload.data.tokens.map((credential: { id: string }) => credential.id)).toContain(reader.credential.id);
  });

  it("creates session tokens with requested and default scopes and never stores the secret", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const cookie = await sessionCookie(user.id);

    const requested = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json", "X-Request-Id": "req_tokens_create_requested" },
      body: JSON.stringify({ name: "Tiny client", scopes: "shopping_list:read recipes:read" }),
    }) as unknown as Request, "tokens"));
    const requestedPayload = await readJson(requested);

    expect(requested.status).toBe(201);
    expectEnvelopeHeaders(requested, "req_tokens_create_requested");
    expect(requestedPayload.data.token).toMatch(/^sj_/);
    expect(requestedPayload.data.credential).toMatchObject({
      name: "Tiny client",
      tokenPrefix: requestedPayload.data.token.slice(0, 12),
      scopes: ["recipes:read", "shopping_list:read"],
      lastUsedAt: null,
      revokedAt: null,
      expiresAt: null,
    });
    expectCredentialMetadataShape(requestedPayload.data.credential);
    await expect(db.apiCredential.findUniqueOrThrow({ where: { id: requestedPayload.data.credential.id } }))
      .resolves.toMatchObject({ tokenHash: expect.not.stringContaining(requestedPayload.data.token) });

    const defaults = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json", "X-Request-Id": "req_tokens_create_default" },
      body: JSON.stringify({ name: "Default client" }),
    }) as unknown as Request, "tokens"));
    const defaultsPayload = await readJson(defaults);

    expect(defaults.status).toBe(201);
    expectEnvelopeHeaders(defaults, "req_tokens_create_default");
    expect(defaultsPayload.data.credential.scopes).toEqual([...DEFAULT_PERSONAL_API_TOKEN_SCOPES].sort());

    const duplicateName = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json", "X-Request-Id": "req_tokens_duplicate_name" },
      body: JSON.stringify({ name: "Default client", scopes: ["recipes:read"] }),
    }) as unknown as Request, "tokens"));
    const duplicatePayload = await readJson(duplicateName);

    expect(duplicateName.status).toBe(201);
    expectEnvelopeHeaders(duplicateName, "req_tokens_duplicate_name");
    expect(duplicatePayload.data.credential).toMatchObject({
      name: "Default client",
      scopes: ["recipes:read"],
    });
  });

  it("caps bearer-created token scopes and rejects scope escalation", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const creator = await createApiCredential(db, user.id, "Scoped creator", {
      scopes: ["tokens:write", "recipes:read", "offline_access"],
    });

    const omitted = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
      method: "POST",
      headers: { Authorization: `Bearer ${creator.token}`, "Content-Type": "application/json", "X-Request-Id": "req_tokens_bearer_create" },
      body: JSON.stringify({ name: "Subset default" }),
    }) as unknown as Request, "tokens"));
    const omittedPayload = await readJson(omitted);

    expect(omitted.status).toBe(201);
    expectEnvelopeHeaders(omitted, "req_tokens_bearer_create");
    expect(omittedPayload.data.credential.scopes).toEqual(["recipes:read", "tokens:write"]);

    const escalation = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
      method: "POST",
      headers: { Authorization: `Bearer ${creator.token}`, "Content-Type": "application/json", "X-Request-Id": "req_tokens_escalation" },
      body: JSON.stringify({ name: "Escalates", scopes: ["shopping_list:write"] }),
    }) as unknown as Request, "tokens"));

    expect(escalation.status).toBe(403);
    expectEnvelopeHeaders(escalation, "req_tokens_escalation");
    await expect(readJson(escalation)).resolves.toMatchObject({
      ok: false,
      requestId: "req_tokens_escalation",
      error: { code: "insufficient_scope", status: 403 },
    });
  });

  it("revokes credentials and allows self-revoke for the current request only", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const otherUser = await db.user.create({ data: createTestUser() });
    const other = await createApiCredential(db, user.id, "Other client", { scopes: ["recipes:read"] });
    const self = await createApiCredential(db, user.id, "Self revoker", { scopes: ["tokens:read", "tokens:write"] });
    const otherOwnerToken = await createApiCredential(db, otherUser.id, "Other owner", { scopes: ["recipes:read"] });

    const revokeOther = await action(routeArgs(new UndiciRequest(`http://localhost/api/v1/tokens/${other.credential.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${self.token}`, "X-Request-Id": "req_tokens_revoke_other" },
    }) as unknown as Request, `tokens/${other.credential.id}`));
    const revokeOtherPayload = await readJson(revokeOther);

    expect(revokeOther.status).toBe(200);
    expectEnvelopeHeaders(revokeOther, "req_tokens_revoke_other");
    expect(revokeOtherPayload.data).toMatchObject({
      revoked: true,
      credential: { id: other.credential.id, revokedAt: expect.any(String) },
    });
    expectCredentialMetadataShape(revokeOtherPayload.data.credential);

    const revokeAlreadyRevoked = await action(routeArgs(new UndiciRequest(`http://localhost/api/v1/tokens/${other.credential.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${self.token}`, "X-Request-Id": "req_tokens_revoke_already_revoked" },
    }) as unknown as Request, `tokens/${other.credential.id}`));
    expect(revokeAlreadyRevoked.status).toBe(200);
    expectEnvelopeHeaders(revokeAlreadyRevoked, "req_tokens_revoke_already_revoked");
    await expect(readJson(revokeAlreadyRevoked)).resolves.toMatchObject({
      ok: true,
      requestId: "req_tokens_revoke_already_revoked",
      data: { revoked: false, credential: { id: other.credential.id, revokedAt: expect.any(String) } },
    });

    const missing = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens/missing-credential", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${self.token}`, "X-Request-Id": "req_tokens_revoke_missing" },
    }) as unknown as Request, "tokens/missing-credential"));
    expect(missing.status).toBe(404);
    expectEnvelopeHeaders(missing, "req_tokens_revoke_missing");
    await expect(readJson(missing)).resolves.toMatchObject({
      ok: false,
      requestId: "req_tokens_revoke_missing",
      error: { code: "not_found", status: 404 },
    });

    const crossOwner = await action(routeArgs(new UndiciRequest(`http://localhost/api/v1/tokens/${otherOwnerToken.credential.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${self.token}`, "X-Request-Id": "req_tokens_revoke_cross_owner" },
    }) as unknown as Request, `tokens/${otherOwnerToken.credential.id}`));
    expect(crossOwner.status).toBe(404);
    expectEnvelopeHeaders(crossOwner, "req_tokens_revoke_cross_owner");
    await expect(readJson(crossOwner)).resolves.toMatchObject({
      ok: false,
      requestId: "req_tokens_revoke_cross_owner",
      error: { code: "not_found", status: 404 },
    });

    const revokeSelf = await action(routeArgs(new UndiciRequest(`http://localhost/api/v1/tokens/${self.credential.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${self.token}`, "X-Request-Id": "req_tokens_revoke_self" },
    }) as unknown as Request, `tokens/${self.credential.id}`));

    expect(revokeSelf.status).toBe(200);
    expectEnvelopeHeaders(revokeSelf, "req_tokens_revoke_self");
    await expect(readJson(revokeSelf)).resolves.toMatchObject({
      ok: true,
      requestId: "req_tokens_revoke_self",
      data: { revoked: true, credential: { id: self.credential.id, revokedAt: expect.any(String) } },
    });

    const afterSelfRevoke = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
      headers: { Authorization: `Bearer ${self.token}`, "X-Request-Id": "req_tokens_after_self_revoke" },
    }) as unknown as Request, "tokens"));

    expect(afterSelfRevoke.status).toBe(401);
    expectEnvelopeHeaders(afterSelfRevoke, "req_tokens_after_self_revoke");
    await expect(readJson(afterSelfRevoke)).resolves.toMatchObject({
      ok: false,
      requestId: "req_tokens_after_self_revoke",
      error: { code: "invalid_token", status: 401 },
    });
  });

  it("returns stable auth and validation errors for token endpoints", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const cookie = await sessionCookie(user.id);
    const readOnly = await createApiCredential(db, user.id, "Read only", { scopes: ["tokens:read"] });
    const writeOnly = await createApiCredential(db, user.id, "Write only", { scopes: ["tokens:write"] });
    const target = await createApiCredential(db, user.id, "Target", { scopes: ["recipes:read"] });

    const missingAuth = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
      headers: { "X-Request-Id": "req_tokens_missing_auth" },
    }) as unknown as Request, "tokens"));
    expect(missingAuth.status).toBe(401);
    expectEnvelopeHeaders(missingAuth, "req_tokens_missing_auth");
    await expect(readJson(missingAuth)).resolves.toMatchObject({
      ok: false,
      requestId: "req_tokens_missing_auth",
      error: { code: "authentication_required", status: 401 },
    });

    const invalidBearer = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
      headers: { Authorization: "Bearer sj_missing", "X-Request-Id": "req_tokens_invalid_bearer" },
    }) as unknown as Request, "tokens"));
    expect(invalidBearer.status).toBe(401);
    expectEnvelopeHeaders(invalidBearer, "req_tokens_invalid_bearer");
    await expect(readJson(invalidBearer)).resolves.toMatchObject({
      ok: false,
      requestId: "req_tokens_invalid_bearer",
      error: { code: "invalid_token", status: 401 },
    });

    const readWithoutScope = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
      headers: { Authorization: `Bearer ${writeOnly.token}`, "X-Request-Id": "req_tokens_read_scope" },
    }) as unknown as Request, "tokens"));
    expect(readWithoutScope.status).toBe(403);
    expectEnvelopeHeaders(readWithoutScope, "req_tokens_read_scope");
    await expect(readJson(readWithoutScope)).resolves.toMatchObject({
      ok: false,
      requestId: "req_tokens_read_scope",
      error: { code: "insufficient_scope", status: 403 },
    });

    const writeWithoutScope = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
      method: "POST",
      headers: { Authorization: `Bearer ${readOnly.token}`, "Content-Type": "application/json", "X-Request-Id": "req_tokens_write_scope" },
      body: JSON.stringify({ name: "No write" }),
    }) as unknown as Request, "tokens"));
    expect(writeWithoutScope.status).toBe(403);
    expectEnvelopeHeaders(writeWithoutScope, "req_tokens_write_scope");
    await expect(readJson(writeWithoutScope)).resolves.toMatchObject({
      ok: false,
      requestId: "req_tokens_write_scope",
      error: { code: "insufficient_scope", status: 403 },
    });

    const malformedWithoutScope = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
      method: "POST",
      headers: { Authorization: `Bearer ${readOnly.token}`, "Content-Type": "application/json", "X-Request-Id": "req_tokens_write_scope_bad_json" },
      body: "{",
    }) as unknown as Request, "tokens"));
    expect(malformedWithoutScope.status).toBe(403);
    expectEnvelopeHeaders(malformedWithoutScope, "req_tokens_write_scope_bad_json");
    await expect(readJson(malformedWithoutScope)).resolves.toMatchObject({
      ok: false,
      requestId: "req_tokens_write_scope_bad_json",
      error: { code: "insufficient_scope", status: 403 },
    });

    const deleteWithoutScope = await action(routeArgs(new UndiciRequest(`http://localhost/api/v1/tokens/${target.credential.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${readOnly.token}`, "X-Request-Id": "req_tokens_delete_scope" },
    }) as unknown as Request, `tokens/${target.credential.id}`));
    expect(deleteWithoutScope.status).toBe(403);
    expectEnvelopeHeaders(deleteWithoutScope, "req_tokens_delete_scope");
    await expect(readJson(deleteWithoutScope)).resolves.toMatchObject({
      ok: false,
      requestId: "req_tokens_delete_scope",
      error: { code: "insufficient_scope", status: 403 },
    });

    const invalidJson = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json", "X-Request-Id": "req_tokens_bad_json" },
      body: "{",
    }) as unknown as Request, "tokens"));
    expect(invalidJson.status).toBe(400);
    expectEnvelopeHeaders(invalidJson, "req_tokens_bad_json");
    await expect(readJson(invalidJson)).resolves.toMatchObject({
      ok: false,
      requestId: "req_tokens_bad_json",
      error: { code: "invalid_json", status: 400 },
    });

    for (const [requestId, init] of [
      ["req_tokens_no_json_body", { method: "POST", headers: { Cookie: cookie, "X-Request-Id": "req_tokens_no_json_body" } }],
      ["req_tokens_blank_json_body", {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json", "X-Request-Id": "req_tokens_blank_json_body" },
        body: "   ",
      }],
    ] as const) {
      const response = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", init) as unknown as Request, "tokens"));
      expect(response.status).toBe(400);
      expectEnvelopeHeaders(response, requestId);
      await expect(readJson(response)).resolves.toMatchObject({
        ok: false,
        requestId,
        error: { code: "validation_error", status: 400 },
      });
    }

    const primitiveJson = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json", "X-Request-Id": "req_tokens_primitive_json" },
      body: JSON.stringify("token"),
    }) as unknown as Request, "tokens"));
    expect(primitiveJson.status).toBe(400);
    expectEnvelopeHeaders(primitiveJson, "req_tokens_primitive_json");
    await expect(readJson(primitiveJson)).resolves.toMatchObject({
      ok: false,
      requestId: "req_tokens_primitive_json",
      error: { code: "validation_error", status: 400 },
    });

    for (const [requestId, body, code] of [
      ["req_tokens_unknown_field", { name: "Client", ownerEmail: user.email }, "validation_error"],
      ["req_tokens_blank_name", { name: " " }, "validation_error"],
      ["req_tokens_invalid_scope", { name: "Client", scopes: ["recipes:delete"] }, "invalid_scope"],
      ["req_tokens_invalid_scope_type", { name: "Client", scopes: [1] }, "validation_error"],
    ] as const) {
      const response = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json", "X-Request-Id": requestId },
        body: JSON.stringify(body),
      }) as unknown as Request, "tokens"));

      expect(response.status).toBe(400);
      expectEnvelopeHeaders(response, requestId);
      await expect(readJson(response)).resolves.toMatchObject({
        ok: false,
        requestId,
        error: { code, status: 400 },
      });
    }
  });
});
