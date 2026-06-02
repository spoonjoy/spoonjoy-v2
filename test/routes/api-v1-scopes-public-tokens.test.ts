import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { faker } from "@faker-js/faker";
import { Request as UndiciRequest } from "undici";
import { action, loader } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import { resolveApiV1ScopeRequirement } from "~/lib/api-v1.server";
import { getLocalDb } from "~/lib/db.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRecipe, createTestUser } from "../utils";

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

describe("API v1 public/token scope matrix", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("resolves method-specific scope requirements from one matrix", () => {
    expect(resolveApiV1ScopeRequirement("GET", "")).toEqual({ auth: "optional", scopes: [] });
    expect(resolveApiV1ScopeRequirement("GET", "health")).toEqual({ auth: "optional", scopes: [] });
    expect(resolveApiV1ScopeRequirement("GET", "openapi.json")).toEqual({ auth: "optional", scopes: [] });
    expect(resolveApiV1ScopeRequirement("GET", "recipes")).toEqual({ auth: "optional", scopes: ["recipes:read"] });
    expect(resolveApiV1ScopeRequirement("GET", "recipes/recipe_1")).toEqual({ auth: "optional", scopes: ["recipes:read"] });
    expect(resolveApiV1ScopeRequirement("GET", "cookbooks")).toEqual({ auth: "optional", scopes: ["cookbooks:read"] });
    expect(resolveApiV1ScopeRequirement("GET", "cookbooks/cookbook_1")).toEqual({ auth: "optional", scopes: ["cookbooks:read"] });
    expect(resolveApiV1ScopeRequirement("GET", "tokens")).toEqual({ auth: "bearer", scopes: ["tokens:read"] });
    expect(resolveApiV1ScopeRequirement("POST", "tokens")).toEqual({ auth: "bearer", scopes: ["tokens:write"] });
    expect(resolveApiV1ScopeRequirement("DELETE", "tokens/credential_1")).toEqual({ auth: "bearer", scopes: ["tokens:write"] });
    expect(resolveApiV1ScopeRequirement("PUT", "recipes")).toBeNull();
    expect(resolveApiV1ScopeRequirement("GET", "missing")).toBeNull();
  });

  it("allows optional discovery routes anonymously and for authenticated callers with no scopes", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const emptyScope = await createApiCredential(db, user.id, "No scopes", { scopes: [] });

    for (const [requestId, path, splat] of [
      ["req_scope_root", "http://localhost/api/v1", ""],
      ["req_scope_health", "http://localhost/api/v1/health", "health"],
      ["req_scope_openapi", "http://localhost/api/v1/openapi.json", "openapi.json"],
    ] as const) {
      const anonymous = await loader(routeArgs(new UndiciRequest(path, {
        headers: { "X-Request-Id": `${requestId}_anon` },
      }) as unknown as Request, splat));
      expect(anonymous.status).toBe(200);
      expectEnvelopeHeaders(anonymous, `${requestId}_anon`);

      const scoped = await loader(routeArgs(new UndiciRequest(path, {
        headers: { Authorization: `Bearer ${emptyScope.token}`, "X-Request-Id": `${requestId}_bearer` },
      }) as unknown as Request, splat));
      expect(scoped.status).toBe(200);
      expectEnvelopeHeaders(scoped, `${requestId}_bearer`);
    }
  });

  it("enforces recipe and cookbook read scopes only when a bearer caller is present", async () => {
    const chef = await db.user.create({ data: createTestUser() });
    const recipe = await db.recipe.create({
      data: {
        ...createTestRecipe(chef.id),
        title: `Scope Recipe ${faker.string.alphanumeric(8)}`,
        description: "Scope matrix recipe",
      },
    });
    const cookbook = await db.cookbook.create({
      data: { title: `Scope Cookbook ${faker.string.alphanumeric(8)}`, authorId: chef.id },
    });
    await db.recipeInCookbook.create({
      data: { cookbookId: cookbook.id, recipeId: recipe.id, addedById: chef.id },
    });
    const tokenOwner = await db.user.create({ data: createTestUser() });
    const publicOnly = await createApiCredential(db, tokenOwner.id, "Public only", { scopes: ["public:read"] });
    const legacyRead = await createApiCredential(db, tokenOwner.id, "Legacy read", { scopes: ["kitchen:read"] });

    for (const [requestId, path, splat] of [
      ["req_scope_recipe_list", "http://localhost/api/v1/recipes", "recipes"],
      ["req_scope_recipe_detail", `http://localhost/api/v1/recipes/${recipe.id}`, `recipes/${recipe.id}`],
      ["req_scope_cookbook_list", "http://localhost/api/v1/cookbooks", "cookbooks"],
      ["req_scope_cookbook_detail", `http://localhost/api/v1/cookbooks/${cookbook.id}`, `cookbooks/${cookbook.id}`],
    ] as const) {
      const anonymous = await loader(routeArgs(new UndiciRequest(path, {
        headers: { "X-Request-Id": `${requestId}_anon` },
      }) as unknown as Request, splat));
      expect(anonymous.status).toBe(200);

      const insufficient = await loader(routeArgs(new UndiciRequest(path, {
        headers: { Authorization: `Bearer ${publicOnly.token}`, "X-Request-Id": `${requestId}_public_only` },
      }) as unknown as Request, splat));
      expect(insufficient.status).toBe(403);
      expectEnvelopeHeaders(insufficient, `${requestId}_public_only`);
      await expect(readJson(insufficient)).resolves.toMatchObject({
        ok: false,
        requestId: `${requestId}_public_only`,
        error: { code: "insufficient_scope", status: 403 },
      });

      const legacy = await loader(routeArgs(new UndiciRequest(path, {
        headers: { Authorization: `Bearer ${legacyRead.token}`, "X-Request-Id": `${requestId}_legacy` },
      }) as unknown as Request, splat));
      expect(legacy.status).toBe(200);
      expectEnvelopeHeaders(legacy, `${requestId}_legacy`);
    }
  });

  it("enforces token read/write scopes for sessions, fine-grained tokens, and legacy scopes", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const cookie = await sessionCookie(user.id);
    const target = await createApiCredential(db, user.id, "Target", { scopes: ["recipes:read"] });
    const reader = await createApiCredential(db, user.id, "Reader", { scopes: ["tokens:read"] });
    const writer = await createApiCredential(db, user.id, "Writer", { scopes: ["tokens:write"] });
    const legacyRead = await createApiCredential(db, user.id, "Legacy read", { scopes: ["kitchen:read"] });
    const legacyWrite = await createApiCredential(db, user.id, "Legacy write", { scopes: ["kitchen:write"] });

    const sessionList = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
      headers: { Cookie: cookie, "X-Request-Id": "req_scope_tokens_session_list" },
    }) as unknown as Request, "tokens"));
    expect(sessionList.status).toBe(200);

    const readerList = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
      headers: { Authorization: `Bearer ${reader.token}`, "X-Request-Id": "req_scope_tokens_reader" },
    }) as unknown as Request, "tokens"));
    expect(readerList.status).toBe(200);

    const legacyReaderList = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
      headers: { Authorization: `Bearer ${legacyRead.token}`, "X-Request-Id": "req_scope_tokens_legacy_read" },
    }) as unknown as Request, "tokens"));
    expect(legacyReaderList.status).toBe(200);

    const writerList = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
      headers: { Authorization: `Bearer ${writer.token}`, "X-Request-Id": "req_scope_tokens_writer_list" },
    }) as unknown as Request, "tokens"));
    expect(writerList.status).toBe(403);
    await expect(readJson(writerList)).resolves.toMatchObject({
      ok: false,
      requestId: "req_scope_tokens_writer_list",
      error: { code: "insufficient_scope", status: 403 },
    });

    const readerCreate = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
      method: "POST",
      headers: { Authorization: `Bearer ${reader.token}`, "Content-Type": "application/json", "X-Request-Id": "req_scope_tokens_reader_create" },
      body: JSON.stringify({ name: "Cannot write" }),
    }) as unknown as Request, "tokens"));
    expect(readerCreate.status).toBe(403);

    for (const [requestId, authorization, name] of [
      ["req_scope_tokens_writer_create", `Bearer ${writer.token}`, "Writer child"],
      ["req_scope_tokens_legacy_write_create", `Bearer ${legacyWrite.token}`, "Legacy writer child"],
    ] as const) {
      const created = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/tokens", {
        method: "POST",
        headers: { Authorization: authorization, "Content-Type": "application/json", "X-Request-Id": requestId },
        body: JSON.stringify({ name }),
      }) as unknown as Request, "tokens"));
      expect(created.status).toBe(201);
      expectEnvelopeHeaders(created, requestId);
    }

    const legacyReadDelete = await action(routeArgs(new UndiciRequest(`http://localhost/api/v1/tokens/${target.credential.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${legacyRead.token}`, "X-Request-Id": "req_scope_tokens_legacy_read_delete" },
    }) as unknown as Request, `tokens/${target.credential.id}`));
    expect(legacyReadDelete.status).toBe(403);

    const legacyWriteDelete = await action(routeArgs(new UndiciRequest(`http://localhost/api/v1/tokens/${target.credential.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${legacyWrite.token}`, "X-Request-Id": "req_scope_tokens_legacy_write_delete" },
    }) as unknown as Request, `tokens/${target.credential.id}`));
    expect(legacyWriteDelete.status).toBe(200);
    expectEnvelopeHeaders(legacyWriteDelete, "req_scope_tokens_legacy_write_delete");
  });
});
