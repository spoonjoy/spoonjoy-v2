import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { withTransientD1Retry } from "../../app/lib/d1-transient-retry.server";
import { getDb } from "../../app/lib/db.server";

// The retry wrapper only intercepts prepare and batch and forwards everything else; this runs
// the real workerd D1 binding and Prisma's D1 adapter through it, so a call shape the unit
// fake does not have (a statement the binding rejects as foreign, a member it needs bound)
// fails here. Read-only statements only: the lane shares one database across files.
describe("the D1 binding wrapped for transient retries", () => {
  const wrapped = () => withTransientD1Retry({ DB: env.DB }).DB as D1Database;

  it("answers prepared statements and batches like the binding itself", async () => {
    const db = wrapped();
    await expect(db.prepare("SELECT ? AS value").bind(7).first()).resolves.toEqual({ value: 7 });
    await expect(db.prepare("SELECT ? AS value").bind("a").first("value")).resolves.toBe("a");
    const all = await db.prepare("SELECT 1 AS one UNION ALL SELECT 2").all();
    expect(all.results).toEqual([{ one: 1 }, { one: 2 }]);
    await expect(db.prepare("SELECT 3 AS three").raw({ columnNames: true })).resolves.toEqual([["three"], [3]]);
    const run = await db.prepare("SELECT 1").run();
    expect(run.success).toBe(true);
    const batch = await db.batch([db.prepare("SELECT ? AS a").bind(1), db.prepare("SELECT 2 AS b")]);
    expect(batch.map((result) => result.results)).toEqual([[{ a: 1 }], [{ b: 2 }]]);
  });

  it("serves Prisma's D1 adapter", async () => {
    const prisma = await getDb({ DB: wrapped() });
    await expect(prisma.$queryRawUnsafe("SELECT 41 + 1 AS answer")).resolves.toEqual([{ answer: 42 }]);
  });
});
