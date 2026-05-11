import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "~/lib/db.server";
import { createTestUser } from "../utils";
import { cleanupDatabase } from "../helpers/cleanup";

describe("ImageGenLedger Model", () => {
  let userId: string;

  beforeEach(async () => {
    const user = await db.user.create({ data: createTestUser() });
    userId = user.id;
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("create", () => {
    it.each(["placeholder" as const, "stylization" as const])(
      "creates a ledger row with kind %s",
      async (kind) => {
        const bucketStart = new Date("2026-05-11T00:00:00Z");
        const row = await db.imageGenLedger.create({
          data: { userId, kind, bucketStart, count: 1 },
        });
        expect(row.id).toBeDefined();
        expect(row.userId).toBe(userId);
        expect(row.kind).toBe(kind);
        expect(row.count).toBe(1);
        expect(row.bucketStart.toISOString()).toBe(bucketStart.toISOString());
      },
    );
  });

  describe("unique constraint", () => {
    it("rejects duplicate (userId, kind, bucketStart)", async () => {
      const bucketStart = new Date("2026-05-11T00:00:00Z");
      await db.imageGenLedger.create({
        data: { userId, kind: "placeholder", bucketStart, count: 1 },
      });
      await expect(
        db.imageGenLedger.create({
          data: { userId, kind: "placeholder", bucketStart, count: 1 },
        }),
      ).rejects.toThrow();
    });

    it("allows distinct kinds in the same bucket", async () => {
      const bucketStart = new Date("2026-05-11T00:00:00Z");
      await db.imageGenLedger.create({
        data: { userId, kind: "placeholder", bucketStart, count: 1 },
      });
      const second = await db.imageGenLedger.create({
        data: { userId, kind: "stylization", bucketStart, count: 1 },
      });
      expect(second.id).toBeDefined();
    });
  });

  describe("relations", () => {
    it("cascade-deletes when the user is removed", async () => {
      const bucketStart = new Date("2026-05-11T00:00:00Z");
      const row = await db.imageGenLedger.create({
        data: { userId, kind: "placeholder", bucketStart, count: 1 },
      });
      await db.user.delete({ where: { id: userId } });
      const found = await db.imageGenLedger.findUnique({ where: { id: row.id } });
      expect(found).toBeNull();
    });
  });

  describe("indexes", () => {
    it("declares the expected indexes", async () => {
      const rows = await db.$queryRawUnsafe<{ name: string }[]>(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ImageGenLedger'",
      );
      const names = rows.map((r) => r.name);
      expect(names).toEqual(
        expect.arrayContaining([
          "ImageGenLedger_userId_kind_bucketStart_key",
          "ImageGenLedger_userId_bucketStart_idx",
        ]),
      );
    });
  });
});
