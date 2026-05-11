import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "~/lib/db.server";
import {
  PLACEHOLDER_DAILY_CAP,
  STYLIZATION_DAILY_CAP,
  tryConsumeImageGenQuota,
} from "~/lib/image-gen-ledger.server";
import { createTestUser } from "../utils";
import { cleanupDatabase } from "../helpers/cleanup";

describe("image-gen-ledger.server", () => {
  let userId: string;

  beforeEach(async () => {
    const user = await db.user.create({ data: createTestUser() });
    userId = user.id;
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("exposes the documented daily caps", () => {
    expect(PLACEHOLDER_DAILY_CAP).toBe(30);
    expect(STYLIZATION_DAILY_CAP).toBe(50);
  });

  it("creates a ledger row with count=1 on first consume for the day", async () => {
    const now = () => new Date("2026-05-11T08:30:00Z");
    const ok = await tryConsumeImageGenQuota(db, userId, "placeholder", { now });
    expect(ok).toBe(true);
    const row = await db.imageGenLedger.findFirst({ where: { userId, kind: "placeholder" } });
    expect(row).not.toBeNull();
    expect(row?.count).toBe(1);
    expect(row?.bucketStart.toISOString()).toBe("2026-05-11T00:00:00.000Z");
  });

  it("increments the ledger row on subsequent consumes until the cap", async () => {
    const now = () => new Date("2026-05-11T08:30:00Z");
    for (let i = 0; i < PLACEHOLDER_DAILY_CAP; i++) {
      const ok = await tryConsumeImageGenQuota(db, userId, "placeholder", { now });
      expect(ok).toBe(true);
    }
    const row = await db.imageGenLedger.findFirst({ where: { userId, kind: "placeholder" } });
    expect(row?.count).toBe(PLACEHOLDER_DAILY_CAP);
  });

  it("rejects further consumes once the cap is reached", async () => {
    const now = () => new Date("2026-05-11T08:30:00Z");
    for (let i = 0; i < PLACEHOLDER_DAILY_CAP; i++) {
      await tryConsumeImageGenQuota(db, userId, "placeholder", { now });
    }
    const ok = await tryConsumeImageGenQuota(db, userId, "placeholder", { now });
    expect(ok).toBe(false);
    const row = await db.imageGenLedger.findFirst({ where: { userId, kind: "placeholder" } });
    expect(row?.count).toBe(PLACEHOLDER_DAILY_CAP);
  });

  it("tracks placeholder and stylization kinds independently", async () => {
    const now = () => new Date("2026-05-11T08:30:00Z");
    await tryConsumeImageGenQuota(db, userId, "placeholder", { now });
    await tryConsumeImageGenQuota(db, userId, "stylization", { now });
    const placeholder = await db.imageGenLedger.findFirst({ where: { userId, kind: "placeholder" } });
    const stylization = await db.imageGenLedger.findFirst({ where: { userId, kind: "stylization" } });
    expect(placeholder?.count).toBe(1);
    expect(stylization?.count).toBe(1);
  });

  it("opens a new ledger row at UTC midnight rollover", async () => {
    const day1 = () => new Date("2026-05-11T23:30:00Z");
    const day2 = () => new Date("2026-05-12T00:30:00Z");
    await tryConsumeImageGenQuota(db, userId, "placeholder", { now: day1 });
    await tryConsumeImageGenQuota(db, userId, "placeholder", { now: day2 });
    const rows = await db.imageGenLedger.findMany({
      where: { userId, kind: "placeholder" },
      orderBy: { bucketStart: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.bucketStart.toISOString()).toBe("2026-05-11T00:00:00.000Z");
    expect(rows[1]?.bucketStart.toISOString()).toBe("2026-05-12T00:00:00.000Z");
    expect(rows[0]?.count).toBe(1);
    expect(rows[1]?.count).toBe(1);
  });

  it("returns false when the user does not exist (FK violation)", async () => {
    const now = () => new Date("2026-05-11T08:30:00Z");
    const ok = await tryConsumeImageGenQuota(db, "no-such-user-id", "placeholder", { now });
    expect(ok).toBe(false);
  });

  it("handles a concurrent first-call race by ending at count=2", async () => {
    const now = () => new Date("2026-05-11T08:30:00Z");
    const [a, b] = await Promise.all([
      tryConsumeImageGenQuota(db, userId, "placeholder", { now }),
      tryConsumeImageGenQuota(db, userId, "placeholder", { now }),
    ]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    const row = await db.imageGenLedger.findFirst({ where: { userId, kind: "placeholder" } });
    expect(row?.count).toBe(2);
  });

  it("uses the wall-clock default `now` when none is provided", async () => {
    const ok = await tryConsumeImageGenQuota(db, userId, "placeholder");
    expect(ok).toBe(true);
    const row = await db.imageGenLedger.findFirst({ where: { userId, kind: "placeholder" } });
    expect(row?.count).toBe(1);
  });
});
