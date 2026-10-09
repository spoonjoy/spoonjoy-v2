// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import DatabaseSync from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getLocalDb } from "~/lib/db.server";
import {
  aiGenerationDisabled,
  GLOBAL_DAILY_GENERATION_BUDGET,
  globalDailyGenerationBudget,
  PLACEHOLDER_DAILY_CAP,
  tryConsumeImageGenQuota,
} from "~/lib/image-gen-ledger.server";
import { assertAdditiveMigrationSql } from "../../scripts/deploy-production-canary";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser } from "../utils";

// The global daily AI generation budget and the operator kill switch, on the atomic D1
// batch (production) and on the Prisma fallback (tests, scripts).

let db: PrismaClient;
let d1: SqliteD1;
const now = () => new Date("2026-10-09T15:00:00.000Z");

async function users(count: number) {
  return Promise.all(Array.from({ length: count }, () => db.user.create({ data: createTestUser() })));
}

async function d1BudgetCount() {
  const row = await d1.binding.prepare(`SELECT COALESCE(SUM("count"), 0) AS n FROM "ImageGenDailyBudget"`).first<{ n: number }>();
  return row?.n ?? 0;
}

describe("global AI generation budget", () => {
  beforeEach(async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    d1 = sqliteD1();
  });

  afterEach(async () => {
    d1.close();
    await cleanupDatabase();
  });

  describe.each([
    ["D1 batch", () => ({ d1: d1.binding })],
    ["Prisma fallback", () => ({})],
  ])("on the %s", (_label, path) => {
    it("stops every user once the day's global budget is spent", async () => {
      const chefs = await users(4);
      const env = { SPOONJOY_AI_DAILY_GENERATION_BUDGET: "3" };
      const results = [];
      for (const chef of chefs) {
        results.push(await tryConsumeImageGenQuota(db, chef.id, "placeholder", { now, env, ...path() }));
      }
      expect(results).toEqual([true, true, true, false]);
      // The refused user spent nothing of their own cap.
      const refused = await db.imageGenLedger.findMany({ where: { userId: chefs[3].id } });
      expect(refused.reduce((sum, row) => sum + row.count, 0)).toBe(0);
    });

    it("opens a fresh global budget at UTC midnight", async () => {
      const [chef] = await users(1);
      const env = { SPOONJOY_AI_DAILY_GENERATION_BUDGET: "1" };
      await expect(tryConsumeImageGenQuota(db, chef.id, "placeholder", { now, env, ...path() })).resolves.toBe(true);
      await expect(tryConsumeImageGenQuota(db, chef.id, "placeholder", { now, env, ...path() })).resolves.toBe(false);
      const tomorrow = () => new Date("2026-10-10T00:00:01.000Z");
      await expect(tryConsumeImageGenQuota(db, chef.id, "placeholder", { now: tomorrow, env, ...path() })).resolves.toBe(true);
    });

    it("writes nothing and generates nothing when the kill switch is off", async () => {
      const [chef] = await users(1);
      await expect(
        tryConsumeImageGenQuota(db, chef.id, "stylization", { now, env: { SPOONJOY_AI_IMAGE_GENERATION: "off" }, ...path() }),
      ).resolves.toBe(false);
      await expect(db.imageGenLedger.count()).resolves.toBe(0);
      await expect(db.imageGenDailyBudget.count()).resolves.toBe(0);
    });

    it("does not hand units back when an account that spent them is deleted", async () => {
      const [spender, next] = await users(2);
      const env = { SPOONJOY_AI_DAILY_GENERATION_BUDGET: "1" };
      await expect(tryConsumeImageGenQuota(db, spender.id, "placeholder", { now, env, ...path() })).resolves.toBe(true);
      await db.user.delete({ where: { id: spender.id } });
      await expect(tryConsumeImageGenQuota(db, next.id, "placeholder", { now, env, ...path() })).resolves.toBe(false);
    });
  });

  it("does not spend the global budget for a user already at their own cap (D1)", async () => {
    const [chef] = await users(1);
    await db.imageGenLedger.create({
      data: { userId: chef.id, kind: "placeholder", bucketStart: new Date("2026-10-09T00:00:00.000Z"), count: PLACEHOLDER_DAILY_CAP },
    });
    await expect(tryConsumeImageGenQuota(db, chef.id, "placeholder", { now, d1: d1.binding })).resolves.toBe(false);
    expect(await d1BudgetCount()).toBe(0);
  });

  it("keeps the D1 consume to one round trip and counts each success once", async () => {
    const chefs = await users(3);
    const before = d1.roundTrips();
    for (const chef of chefs) {
      await expect(tryConsumeImageGenQuota(db, chef.id, "import", { now, d1: d1.binding })).resolves.toBe(true);
    }
    expect(d1.roundTrips() - before).toBe(3);
    expect(await d1BudgetCount()).toBe(3);
  });

  it("refunds the global unit on the Prisma path when the user is gone", async () => {
    await expect(tryConsumeImageGenQuota(db, "missing-user", "placeholder", { now })).resolves.toBe(false);
    const rows = await db.imageGenDailyBudget.findMany();
    expect(rows.reduce((sum, row) => sum + row.count, 0)).toBe(0);
  });
});

describe("global budget on the Prisma fallback, races and faults", () => {
  function stub(createError: unknown, retryCount: number) {
    let spends = 0;
    const ledgerUpdate = vi.fn(async () => ({ count: 1 }));
    const fake = {
      imageGenDailyBudget: {
        updateMany: vi.fn(async (args: { data: { count: { increment?: number } } }) => {
          if (args.data.count.increment === undefined) return { count: 1 };
          spends += 1;
          return { count: spends === 1 ? 0 : retryCount };
        }),
        create: vi.fn(async () => {
          throw createError;
        }),
      },
      imageGenLedger: { updateMany: ledgerUpdate },
    };
    return { db: fake as unknown as PrismaClient, ledgerUpdate };
  }

  it("treats a budget P2002 race as expected and spends on the retry", async () => {
    const { db: fake, ledgerUpdate } = stub({ code: "P2002" }, 1);
    await expect(tryConsumeImageGenQuota(fake, "u", "placeholder", { now })).resolves.toBe(true);
    expect(ledgerUpdate).toHaveBeenCalledOnce();
  });

  it("refuses when the P2002 retry finds the day already full", async () => {
    const { db: fake, ledgerUpdate } = stub({ code: "P2002" }, 0);
    await expect(tryConsumeImageGenQuota(fake, "u", "placeholder", { now })).resolves.toBe(false);
    expect(ledgerUpdate).not.toHaveBeenCalled();
  });

  it("rethrows an unexpected fault when starting the day's budget", async () => {
    const { db: fake } = stub(new Error("D1_ERROR: gone"), 0);
    await expect(tryConsumeImageGenQuota(fake, "u", "placeholder", { now })).rejects.toThrow("gone");
  });

  it("generates nothing when the budget is set to 0", async () => {
    db = await getLocalDb();
    await cleanupDatabase();
    const chef = await db.user.create({ data: createTestUser() });
    const env = { SPOONJOY_AI_DAILY_GENERATION_BUDGET: "0" };
    await expect(tryConsumeImageGenQuota(db, chef.id, "placeholder", { now, env })).resolves.toBe(false);
    await expect(db.imageGenDailyBudget.count()).resolves.toBe(0);
    await cleanupDatabase();
  });
});

describe("budget settings", () => {
  it("reads the kill switch case-insensitively and defaults to on", () => {
    expect(aiGenerationDisabled({ SPOONJOY_AI_IMAGE_GENERATION: " OFF " })).toBe(true);
    expect(aiGenerationDisabled({ SPOONJOY_AI_IMAGE_GENERATION: "on" })).toBe(false);
    expect(aiGenerationDisabled({})).toBe(false);
    expect(aiGenerationDisabled(null)).toBe(false);
  });

  it("uses a valid integer override and the default otherwise", () => {
    expect(globalDailyGenerationBudget({ SPOONJOY_AI_DAILY_GENERATION_BUDGET: "75" })).toBe(75);
    expect(globalDailyGenerationBudget({ SPOONJOY_AI_DAILY_GENERATION_BUDGET: "0" })).toBe(0);
    expect(globalDailyGenerationBudget({ SPOONJOY_AI_DAILY_GENERATION_BUDGET: "lots" })).toBe(GLOBAL_DAILY_GENERATION_BUDGET);
    expect(globalDailyGenerationBudget({ SPOONJOY_AI_DAILY_GENERATION_BUDGET: "-5" })).toBe(GLOBAL_DAILY_GENERATION_BUDGET);
    expect(globalDailyGenerationBudget(undefined)).toBe(GLOBAL_DAILY_GENERATION_BUDGET);
  });

  it("sets the production and QA budgets in wrangler.json", () => {
    const wrangler = JSON.parse(readFileSync("wrangler.json", "utf8")) as {
      vars: Record<string, string>;
      env: { qa: { vars: Record<string, string> } };
    };
    expect(wrangler.vars.SPOONJOY_AI_DAILY_GENERATION_BUDGET).toBe("200");
    expect(wrangler.env.qa.vars.SPOONJOY_AI_DAILY_GENERATION_BUDGET).toBe("1000");
  });
});

describe("migration 0031 - image gen daily budget", () => {
  const root = resolve(__dirname, "../../migrations/0031_image_gen_daily_budget.sql");
  const prisma = resolve(__dirname, "../../prisma/migrations/20261009060000_image_gen_daily_budget/migration.sql");
  const sql = readFileSync(root, "utf8");

  it("keeps root D1 and Prisma migration SQL byte-identical", () => {
    expect(sql).toBe(readFileSync(prisma, "utf8"));
  });

  it("is additive so the production release can apply it automatically", () => {
    expect(() => assertAdditiveMigrationSql("0031_image_gen_daily_budget.sql", sql)).not.toThrow();
  });

  it("creates a one-row-per-day counter keyed by the day", () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(sql);
    sqlite.exec(`INSERT INTO "ImageGenDailyBudget" ("bucketStart") VALUES ('2026-10-09T00:00:00.000+00:00')`);
    expect(() => sqlite.exec(`INSERT INTO "ImageGenDailyBudget" ("bucketStart") VALUES ('2026-10-09T00:00:00.000+00:00')`)).toThrow();
    expect(sqlite.prepare(`SELECT "count" FROM "ImageGenDailyBudget"`).get()).toEqual({ count: 0 });
    sqlite.close();
  });
});
