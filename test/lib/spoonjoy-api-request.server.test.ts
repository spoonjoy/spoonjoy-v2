import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import { faker } from "@faker-js/faker";
import {
  PUBLIC_BOOTSTRAP_OPERATIONS,
  buildSpoonjoyApiContext,
  resolveApiPrincipal,
} from "~/lib/spoonjoy-api-request.server";
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
});
