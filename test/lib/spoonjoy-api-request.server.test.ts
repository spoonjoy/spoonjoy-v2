import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import { faker } from "@faker-js/faker";
import {
  PUBLIC_BOOTSTRAP_OPERATIONS,
  buildSpoonjoyApiContext,
  resolveApiPrincipal,
} from "~/lib/spoonjoy-api-request.server";
import {
  callSpoonjoyApiOperation,
  type ApiPrincipal,
  type SpoonjoyApiContext,
} from "~/lib/spoonjoy-api.server";
import { createApiCredential } from "~/lib/api-auth.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";

function uniqueEmail(prefix = "apireq") {
  return `${prefix}-${faker.string.alphanumeric(8).toLowerCase()}@example.com`;
}

describe("spoonjoy-api-request shared helper", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });
  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("PUBLIC_BOOTSTRAP_OPERATIONS", () => {
    it("includes the device-flow + health bootstrap ops", () => {
      expect(PUBLIC_BOOTSTRAP_OPERATIONS.has("health")).toBe(true);
      expect(PUBLIC_BOOTSTRAP_OPERATIONS.has("auth_status")).toBe(true);
      expect(PUBLIC_BOOTSTRAP_OPERATIONS.has("start_agent_connection")).toBe(true);
      expect(PUBLIC_BOOTSTRAP_OPERATIONS.has("poll_agent_connection")).toBe(true);
      expect(PUBLIC_BOOTSTRAP_OPERATIONS.has("create_recipe")).toBe(false);
    });
  });

  describe("resolveApiPrincipal", () => {
    it("returns null when no credentials are present", async () => {
      const request = new UndiciRequest("https://spoonjoy.app/mcp") as unknown as Request;
      await expect(resolveApiPrincipal(db, request, null, "search_spoonjoy")).resolves.toBeNull();
    });

    it("resolves a principal from a valid bearer token", async () => {
      const user = await db.user.create({ data: { email: uniqueEmail(), username: faker.internet.username() } });
      const { token } = await createApiCredential(db, user.id, "mcp token");
      const request = new UndiciRequest("https://spoonjoy.app/mcp", {
        headers: { Authorization: `Bearer ${token}` },
      }) as unknown as Request;

      const principal = await resolveApiPrincipal(db, request, null, "create_recipe");
      expect(principal?.email).toBe(user.email);
      expect(principal?.source).toBe("bearer");
    });

    it("swallows an invalid token for a public bootstrap operation", async () => {
      const request = new UndiciRequest("https://spoonjoy.app/mcp", {
        headers: { Authorization: "Bearer sj_totally_invalid" },
      }) as unknown as Request;
      await expect(resolveApiPrincipal(db, request, null, "health")).resolves.toBeNull();
    });

    it("rethrows an invalid token for a protected operation", async () => {
      const request = new UndiciRequest("https://spoonjoy.app/mcp", {
        headers: { Authorization: "Bearer sj_totally_invalid" },
      }) as unknown as Request;
      await expect(resolveApiPrincipal(db, request, null, "create_recipe")).rejects.toMatchObject({
        status: 401,
      });
    });
  });

  describe("buildSpoonjoyApiContext", () => {
    it("assembles the env subset + bucket + guards", () => {
      const bucket = {} as R2Bucket;
      const waitUntil = () => {};
      const context = buildSpoonjoyApiContext({
        db,
        principal: null,
        cloudflareEnv: {
          OPENAI_API_KEY: "sk-x",
          SPOONJOY_BASE_URL: "https://spoonjoy.app",
          VAPID_PUBLIC_KEY: "vp",
          VAPID_PRIVATE_KEY: "vk",
          VAPID_SUBJECT: "mailto:x@y.z",
          PHOTOS: bucket,
        } as unknown as Env,
        waitUntil,
      });

      expect(context.db).toBe(db);
      expect(context.principal).toBeNull();
      expect(context.allowOwnerEmailFallback).toBe(false);
      expect(context.waitUntil).toBe(waitUntil);
      expect(context.env).toEqual({
        OPENAI_API_KEY: "sk-x",
        SPOONJOY_BASE_URL: "https://spoonjoy.app",
        VAPID_PUBLIC_KEY: "vp",
        VAPID_PRIVATE_KEY: "vk",
        VAPID_SUBJECT: "mailto:x@y.z",
      });
      expect(context.bucket).toBe(bucket);
    });

    it("yields null env + undefined bucket when no cloudflare env", () => {
      const context = buildSpoonjoyApiContext({ db, principal: null, cloudflareEnv: null });
      expect(context.env).toBeNull();
      expect(context.bucket).toBeUndefined();
      expect(context.waitUntil).toBeUndefined();
    });
  });

  describe("callSpoonjoyApiOperation auth and token scope edges", () => {
    async function makePrincipal(scopes: string[]): Promise<ApiPrincipal> {
      const user = await db.user.create({ data: { email: uniqueEmail("apiop"), username: faker.internet.username() } });
      return {
        id: user.id,
        email: user.email,
        username: user.username,
        source: "bearer",
        credentialId: "cred_test",
        scopes,
      };
    }

    it("rejects protected operations when the bearer principal lacks the required scope", async () => {
      const principal = await makePrincipal(["recipes:read"]);
      const context: SpoonjoyApiContext = { db, principal };

      await expect(
        callSpoonjoyApiOperation("create_api_token", { name: "limited" }, context),
      ).rejects.toMatchObject({
        status: 403,
        message: "Missing required scope: tokens:write",
      });
    });

    it("accepts token scopes supplied as a string", async () => {
      const principal = await makePrincipal(["tokens:write", "recipes:read"]);
      const context: SpoonjoyApiContext = { db, principal };

      const result = await callSpoonjoyApiOperation(
        "create_api_token",
        { name: "read token", scopes: "recipes:read" },
        context,
      ) as { credential: { id: string } };

      await expect(db.apiCredential.findUniqueOrThrow({ where: { id: result.credential.id } }))
        .resolves.toMatchObject({ scopes: "recipes:read" });
    });

    it("rejects token scopes that are neither a string nor string array", async () => {
      const principal = await makePrincipal(["tokens:write"]);
      const context: SpoonjoyApiContext = { db, principal };

      await expect(
        callSpoonjoyApiOperation("create_api_token", { name: "bad token", scopes: 123 }, context),
      ).rejects.toMatchObject({
        status: 400,
        message: "scopes must be a string or string array",
      });
    });
  });
});
