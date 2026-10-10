import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { Request as UndiciRequest } from "undici";
import type { PrismaClient as PrismaClientType } from "@prisma/client";
import { createApiCredential } from "~/lib/api-auth.server";
import { createUser } from "~/lib/auth.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestRecipe } from "../utils";
import { expectConsoleError } from "../warning-policy";

const mocked = vi.hoisted(() => ({
  db: null as PrismaClientType | null,
  verifyNativeAppleIdentityToken: vi.fn(),
}));

vi.mock("~/lib/route-platform.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/route-platform.server")>()),
  getRequestDb: vi.fn(async () => mocked.db!),
}));

vi.mock("~/lib/apple-native-auth.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/apple-native-auth.server")>()),
  verifyNativeAppleIdentityToken: mocked.verifyNativeAppleIdentityToken,
}));

const { action, loader } = await import("~/routes/api.v1.$");
const { NativeAppleAuthError } = await import("~/lib/apple-native-auth.server");

const PASSWORD = "correctHorseBatteryStaple";
let db: PrismaClientType;
let d1: SqliteD1;

function env(extra: Record<string, unknown> = {}) {
  return { NODE_ENV: "production", SPOONJOY_BASE_URL: "https://spoonjoy.app", APPLE_NATIVE_CLIENT_IDS: "app.spoonjoy", DB: d1.binding, ...extra };
}

function deleteRequest(token: string, body: unknown, envOverrides?: Record<string, unknown>) {
  const request = new UndiciRequest("http://localhost/api/v1/me", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Request-Id": "req_account_delete" },
    body: JSON.stringify(body),
  }) as unknown as Request;
  return action({ request, params: { "*": "me" }, context: { cloudflare: { env: envOverrides ?? env() } } } as any);
}

function getRequest(token: string, path: string) {
  const request = new UndiciRequest(`http://localhost/api/v1/${path}`, {
    headers: { Authorization: `Bearer ${token}`, "X-Request-Id": `req_${path.replace("/", "_")}` },
  }) as unknown as Request;
  return loader({ request, params: { "*": path }, context: { cloudflare: { env: env() } } } as any);
}

async function passwordChef() {
  const user = await createUser(db, `${faker.string.alphanumeric(8)}@example.com`, `chef_${faker.string.alphanumeric(8)}`, PASSWORD);
  const credential = await createApiCredential(db, user.id, "Native app", { scopes: ["account:read", "account:write", "kitchen:read"] });
  return { user, token: credential.token };
}

async function appleChef() {
  const user = await db.user.create({
    data: {
      email: `${faker.string.alphanumeric(8)}@privaterelay.appleid.com`,
      username: `apple_${faker.string.alphanumeric(8)}`,
      OAuth: { create: { provider: "apple", providerUserId: "apple-sub", providerUsername: "Apple Chef" } },
    },
  });
  const credential = await createApiCredential(db, user.id, "Native app", { scopes: ["account:write"] });
  return { user, token: credential.token };
}

async function errorOf(response: Response) {
  return ((await response.json()) as { error: { code: string; details?: Record<string, unknown> } }).error;
}

beforeEach(async () => {
  await cleanupDatabase();
  db = await getLocalDb();
  mocked.db = db;
  d1 = sqliteD1();
  mocked.verifyNativeAppleIdentityToken.mockReset();
});

afterEach(async () => {
  d1.close();
  await cleanupDatabase();
});

describe("DELETE /api/v1/me", () => {
  it("deletes a password account after the password and username, and its token stops working", async () => {
    const { user, token } = await passwordChef();
    const other = await createUser(db, "other@example.com", `other_${faker.string.alphanumeric(8)}`, PASSWORD);
    const recipe = await db.recipe.create({ data: createTestRecipe(user.id) });
    await db.recipe.create({ data: { ...createTestRecipe(other.id), sourceRecipeId: recipe.id } });
    await db.recipe.create({ data: { ...createTestRecipe(user.id), title: "Private" } });

    const response = await deleteRequest(token, { confirmUsername: user.username, password: PASSWORD });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, data: { deleted: true, reassignedRecipes: 1, deletedRecipes: 1 } });
    await expect(db.user.findUnique({ where: { id: user.id } })).resolves.toBeNull();
    await expect(db.recipe.findUniqueOrThrow({ where: { id: recipe.id } })).resolves.toMatchObject({ chefId: "deleted-chef" });
    expect((await getRequest(token, "me")).status).toBe(401);
  });

  it("refuses without the typed username or the right password, and deletes nothing", async () => {
    const { user, token } = await passwordChef();

    const mismatch = await deleteRequest(token, { confirmUsername: "someone", password: PASSWORD });
    expect(mismatch.status).toBe(400);
    expect(await errorOf(mismatch)).toMatchObject({ code: "validation_error", details: { reason: "confirmation_mismatch" } });

    const missing = await deleteRequest(token, { confirmUsername: user.username });
    expect(await errorOf(missing)).toMatchObject({ details: { reason: "password_required" } });

    const wrong = await deleteRequest(token, { confirmUsername: user.username, password: "nope" });
    expect(await errorOf(wrong)).toMatchObject({ details: { reason: "password_incorrect" } });

    const unknown = await deleteRequest(token, { confirmUsername: user.username, extra: true });
    expect(await errorOf(unknown)).toMatchObject({ code: "validation_error", details: { fields: ["extra"] } });

    await expect(db.user.findUnique({ where: { id: user.id } })).resolves.not.toBeNull();
  });

  it("deletes a passwordless Apple account with a fresh Apple credential for its Apple ID", async () => {
    const { user, token } = await appleChef();
    mocked.verifyNativeAppleIdentityToken.mockResolvedValueOnce({ id: "someone-else" }).mockResolvedValueOnce({ id: "apple-sub" });
    const body = { confirmUsername: user.username, appleIdentityToken: "a.b.c", appleRawNonce: "nonce" };

    const mismatch = await deleteRequest(token, body);
    expect(await errorOf(mismatch)).toMatchObject({ details: { reason: "apple_account_mismatch" } });

    const response = await deleteRequest(token, body);
    expect(response.status).toBe(200);
    expect(mocked.verifyNativeAppleIdentityToken).toHaveBeenLastCalledWith(
      { identityToken: "a.b.c", rawNonce: "nonce" },
      expect.objectContaining({ clientIds: ["app.spoonjoy"] }),
    );
    await expect(db.user.findUnique({ where: { id: user.id } })).resolves.toBeNull();
  });

  it("refuses an invalid Apple credential, a missing nonce, and a passwordless account with no proof", async () => {
    const { user, token } = await appleChef();
    mocked.verifyNativeAppleIdentityToken.mockRejectedValueOnce(new NativeAppleAuthError("expired_identity_token", "Apple identity token has expired.", 401));

    const invalid = await deleteRequest(token, { confirmUsername: user.username, appleIdentityToken: "a.b.c", appleRawNonce: "nonce" });
    expect(await errorOf(invalid)).toMatchObject({ code: "validation_error", details: { reason: "apple_credential_invalid", providerCode: "expired_identity_token" } });

    const noNonce = await deleteRequest(token, { confirmUsername: user.username, appleIdentityToken: "a.b.c" });
    expect(noNonce.status).toBe(400);

    const noProof = await deleteRequest(token, { confirmUsername: user.username });
    expect(await errorOf(noProof)).toMatchObject({ details: { reason: "recent_sign_in_required" } });

    await expect(db.user.findUnique({ where: { id: user.id } })).resolves.not.toBeNull();
  });

  it("reports native Apple sign-in that is not configured", async () => {
    const { user, token } = await appleChef();
    const request = new UndiciRequest("http://localhost/api/v1/me", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ confirmUsername: user.username, appleIdentityToken: "a.b.c", appleRawNonce: "nonce" }),
    }) as unknown as Request;
    // No environment at all: the Apple client ids are missing.
    const response = await action({ request, params: { "*": "me" }, context: { cloudflare: {} } } as any);
    expect(await errorOf(response)).toMatchObject({ code: "validation_error", details: { providerCode: "apple_native_unconfigured" } });
    expect(mocked.verifyNativeAppleIdentityToken).not.toHaveBeenCalled();
  });

  it("passes on unexpected Apple verifier failures", async () => {
    const { user, token } = await appleChef();
    const failure = new Error("JWKS fetch failed");
    mocked.verifyNativeAppleIdentityToken.mockRejectedValueOnce(failure);
    expectConsoleError("[api-v1] internal_error", {
      requestId: "req_account_delete",
      method: "DELETE",
      path: "/api/v1/me",
      error: { name: failure.name, message: failure.message, stack: failure.stack },
    });
    const response = await deleteRequest(token, { confirmUsername: user.username, appleIdentityToken: "a.b.c", appleRawNonce: "nonce" });
    expect(response.status).toBe(500);
  });

  it("is rate limited like sign-in, and needs the database binding", async () => {
    const { user, token } = await passwordChef();
    const limited = await deleteRequest(token, { confirmUsername: user.username, password: PASSWORD }, env({
      AUTH_IP_RATE_LIMITER: { limit: async () => ({ success: false }) },
    }));
    expect(limited.status).toBe(429);

    const unbound = await deleteRequest(token, { confirmUsername: user.username, password: PASSWORD }, env({ DB: undefined }));
    expect(unbound.status).toBe(500);
    await expect(db.user.findUnique({ where: { id: user.id } })).resolves.not.toBeNull();
  });

  it("requires account:write", async () => {
    const { user } = await passwordChef();
    const reader = await createApiCredential(db, user.id, "Reader", { scopes: ["account:read"] });
    const response = await deleteRequest(reader.token, { confirmUsername: user.username, password: PASSWORD });
    expect(response.status).toBe(403);
  });
});

describe("GET /api/v1/me/export", () => {
  it("returns the account's data as a JSON download", async () => {
    const { user, token } = await passwordChef();
    await db.recipe.create({ data: { ...createTestRecipe(user.id), title: "Exported" } });

    const response = await getRequest(token, "me/export");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("private");
    expect(response.headers.get("Content-Disposition")).toMatch(new RegExp(`^attachment; filename="spoonjoy-${user.username}-\\d{4}-\\d{2}-\\d{2}\\.json"$`));
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        format: "spoonjoy.account-export.v1",
        account: { id: user.id, username: user.username, signInMethods: ["password"] },
        recipes: [expect.objectContaining({ title: "Exported", url: expect.stringMatching(/^https:\/\/spoonjoy\.app\/recipes\//) })],
      },
    });
  });

  it("requires account:read and kitchen:read", async () => {
    const { user } = await passwordChef();
    const writer = await createApiCredential(db, user.id, "Writer", { scopes: ["account:read"] });
    expect((await getRequest(writer.token, "me/export")).status).toBe(403);
  });
});
