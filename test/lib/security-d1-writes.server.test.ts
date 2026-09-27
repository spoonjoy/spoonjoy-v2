// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { D1ReadDatabase } from "~/lib/d1-read.server";
import { getLocalDb } from "~/lib/db.server";
import { IMPORT_DAILY_CAP, tryConsumeImageGenQuota } from "~/lib/image-gen-ledger.server";
import { createOAuthUser, type OAuthUserData } from "~/lib/oauth-user.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser } from "../utils";

// The daily image-generation quota and OAuth sign-up with a D1 binding: each is one D1 batch
// (through the SQLite-backed fake binding) and ends the same as the Prisma path, which still
// runs where there is no binding.

let db: PrismaClient;
let d1: SqliteD1;

const now = () => new Date("2026-09-27T15:00:00.000Z");
const failing = (error: unknown): D1ReadDatabase => ({
  prepare: (sql) => d1.binding.prepare(sql),
  batch: async () => {
    throw error;
  },
});

describe("security-relevant writes on a D1 binding", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    d1 = sqliteD1();
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  describe("tryConsumeImageGenQuota", () => {
    it("consumes up to the cap in one batch per call, in the same row the Prisma path uses", async () => {
      const user = await db.user.create({ data: createTestUser() });
      // Prisma starts the day's row; the D1 path must count in that same row.
      await expect(tryConsumeImageGenQuota(db, user.id, "import", { now })).resolves.toBe(true);
      await db.imageGenLedger.updateMany({ where: { userId: user.id }, data: { count: IMPORT_DAILY_CAP - 1 } });

      const before = d1.roundTrips();
      await expect(tryConsumeImageGenQuota(db, user.id, "import", { now, d1: d1.binding })).resolves.toBe(true);
      await expect(tryConsumeImageGenQuota(db, user.id, "import", { now, d1: d1.binding })).resolves.toBe(false);
      expect(d1.roundTrips() - before).toBe(2);

      await expect(db.imageGenLedger.findMany({ where: { userId: user.id } })).resolves.toEqual([
        expect.objectContaining({ kind: "import", count: IMPORT_DAILY_CAP, bucketStart: new Date("2026-09-27T00:00:00.000Z") }),
      ]);
      // Prisma still counts in the row the D1 path wrote to.
      await expect(tryConsumeImageGenQuota(db, user.id, "import", { now })).resolves.toBe(false);
    });

    it("starts the day's row, and writes nothing for a user that is gone", async () => {
      const user = await db.user.create({ data: createTestUser() });
      await expect(tryConsumeImageGenQuota(db, user.id, "stylization", { now, d1: d1.binding })).resolves.toBe(true);
      await expect(db.imageGenLedger.findMany({ where: { userId: user.id } })).resolves.toEqual([
        expect.objectContaining({ kind: "stylization", count: 1 }),
      ]);

      await expect(tryConsumeImageGenQuota(db, "no-such-user", "placeholder", { d1: d1.binding })).resolves.toBe(false);
      await expect(db.imageGenLedger.count({ where: { userId: "no-such-user" } })).resolves.toBe(0);
    });

    it("rethrows a D1 fault instead of reporting the quota exhausted, capturing it when configured", async () => {
      await expect(tryConsumeImageGenQuota(db, "u1", "import", { now, d1: failing(new Error("D1 is down")) }))
        .rejects.toThrow("D1 is down");

      const analyticsFetchImpl = vi.fn(async () => new Response("ok")) as unknown as typeof fetch;
      await expect(tryConsumeImageGenQuota(db, "u1", "import", {
        now,
        d1: failing(new Error("D1 is down")),
        postHogConfig: { enabled: true, key: "phc_test", host: "https://ph.example.com" },
        analyticsFetchImpl,
      })).rejects.toThrow("D1 is down");
      expect(analyticsFetchImpl).toHaveBeenCalledTimes(1);
    });
  });

  describe("createOAuthUser", () => {
    const data = (overrides: Partial<OAuthUserData> = {}): OAuthUserData => ({
      provider: "google",
      providerUserId: "google-1",
      providerUsername: "Cook",
      email: "Cook@Example.com",
      name: "Home Cook",
      ...overrides,
    });

    async function account(email: string) {
      return db.user.findUnique({
        where: { email },
        select: { username: true, hashedPassword: true, OAuth: { select: { provider: true, providerUserId: true, providerUsername: true } } },
      });
    }

    it("writes the user and its link in one batch, as the Prisma path does", async () => {
      const viaPrisma = await createOAuthUser(db, data({ providerUserId: "p", email: "prisma@example.com" }));
      const before = d1.roundTrips();
      const viaD1 = await createOAuthUser(db, data({ providerUserId: "d", email: "D1@example.com" }), d1.binding);

      expect(d1.roundTrips() - before).toBe(1);
      expect(viaD1).toEqual({ success: true, user: { id: expect.any(String), email: "d1@example.com", username: "home-cook-1" } });
      expect(viaPrisma.user!.username).toBe("home-cook");
      expect({ ...(await account("d1@example.com"))!, username: "" }).toEqual({
        ...(await account("prisma@example.com"))!,
        username: "",
        OAuth: [{ provider: "google", providerUserId: "d", providerUsername: "Cook" }],
      });
    });

    it("signs a second sign-in with the same identity in to the account created in between", async () => {
      let first: Awaited<ReturnType<typeof createOAuthUser>> | undefined;
      const racing: D1ReadDatabase = {
        prepare: (sql) => d1.binding.prepare(sql),
        async batch(statements) {
          first ??= await createOAuthUser(db, data(), d1.binding);
          return d1.binding.batch(statements as never);
        },
      };

      const second = await createOAuthUser(db, data(), racing);

      expect(second).toEqual(first);
      await expect(db.user.count({ where: { email: "cook@example.com" } })).resolves.toBe(1);
      await expect(db.oAuth.count({ where: { providerUserId: "google-1" } })).resolves.toBe(1);
    });

    it("answers account_exists when another sign-up took the email in between", async () => {
      const racing: D1ReadDatabase = {
        prepare: (sql) => d1.binding.prepare(sql),
        async batch(statements) {
          await createOAuthUser(db, data({ provider: "github", providerUserId: "github-1" }));
          return d1.binding.batch(statements as never);
        },
      };

      await expect(createOAuthUser(db, data(), racing)).resolves.toMatchObject({ success: false, error: "account_exists" });
      await expect(db.oAuth.findMany({ select: { provider: true } })).resolves.toEqual([{ provider: "github" }]);
    });

    it("picks another username when one is taken in between, and gives up after three tries", async () => {
      let taken = 0;
      const takeUsername = (limit: number): D1ReadDatabase => ({
        prepare: (sql) => d1.binding.prepare(sql),
        async batch(statements) {
          if (taken < limit) {
            const username = (statements as unknown as Array<{ params: unknown[] }>)[0]!.params[2] as string;
            await db.user.create({ data: { ...createTestUser(), username } });
            taken += 1;
          }
          return d1.binding.batch(statements as never);
        },
      });

      await expect(createOAuthUser(db, data(), takeUsername(1))).resolves.toMatchObject({
        success: true,
        user: { username: "home-cook-1" },
      });

      taken = 0;
      const error = await createOAuthUser(db, data({ providerUserId: "google-2", email: "other@example.com" }), takeUsername(3))
        .catch((caught: unknown) => caught);
      expect(String(error)).toContain("UNIQUE constraint failed");
      await expect(account("other@example.com")).resolves.toBeNull();
    });

    it("recovers a Prisma unique conflict too, and rethrows any other failure", async () => {
      const winner = await createOAuthUser(db, data());
      const conflict = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      await expect(createOAuthUser(db, data({ email: "late@example.com" }), failing(conflict))).resolves.toEqual(winner);

      await expect(createOAuthUser(db, data({ providerUserId: "google-3", email: "down@example.com" }), failing(new Error("D1 is down"))))
        .rejects.toThrow("D1 is down");
      await expect(createOAuthUser(db, data({ providerUserId: "google-3", email: "down@example.com" }), failing("not an error")))
        .rejects.toBe("not an error");
    });
  });
});
