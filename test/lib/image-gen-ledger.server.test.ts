import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { db } from "~/lib/db.server";
import {
  IMPORT_DAILY_CAP,
  PLACEHOLDER_DAILY_CAP,
  STYLIZATION_DAILY_CAP,
  tryConsumeImageGenQuota,
  type ImageGenKind,
} from "~/lib/image-gen-ledger.server";
import type { PostHogServerConfig } from "~/lib/analytics-server";
import { createTestUser } from "../utils";
import { cleanupDatabase } from "../helpers/cleanup";

const ENABLED_POSTHOG: PostHogServerConfig = {
  enabled: true,
  key: "phc_test",
  host: "https://ph.example.com",
};

/**
 * Minimal Prisma stub for the consume race: the initial `updateMany` misses
 * (count 0, so we fall to `create`), `create` throws the supplied error, and
 * the retry `updateMany` returns `retryCount`.
 */
function makeLedgerStub(opts: {
  createError: unknown;
  retryCount?: number;
}): { db: PrismaClient; createCalls: number; retryCalls: number } {
  const state = { createCalls: 0, retryCalls: 0 };
  let firstUpdate = true;
  const stub = {
    imageGenLedger: {
      updateMany: vi.fn(async () => {
        if (firstUpdate) {
          firstUpdate = false;
          return { count: 0 };
        }
        state.retryCalls += 1;
        return { count: opts.retryCount ?? 0 };
      }),
      create: vi.fn(async () => {
        state.createCalls += 1;
        throw opts.createError;
      }),
    },
  };
  return {
    db: stub as unknown as PrismaClient,
    get createCalls() {
      return state.createCalls;
    },
    get retryCalls() {
      return state.retryCalls;
    },
  };
}

class FakePrismaError extends Error {
  code: string;
  constructor(code: string) {
    super(`prisma ${code}`);
    this.name = "PrismaClientKnownRequestError";
    this.code = code;
  }
}

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

  describe("kind=import", () => {
    it("exposes IMPORT_DAILY_CAP = 50", () => {
      expect(IMPORT_DAILY_CAP).toBe(50);
    });

    it("ImageGenKind type includes 'import' (compile-time)", () => {
      const k: ImageGenKind = "import";
      expect(k).toBe("import");
    });

    it("creates ledger row with kind=import on first consume of day", async () => {
      const now = () => new Date("2026-05-11T08:30:00Z");
      const ok = await tryConsumeImageGenQuota(db, userId, "import", { now });
      expect(ok).toBe(true);
      const row = await db.imageGenLedger.findFirst({ where: { userId, kind: "import" } });
      expect(row?.count).toBe(1);
    });

    it("increments when row exists and count < IMPORT_DAILY_CAP", async () => {
      const now = () => new Date("2026-05-11T08:30:00Z");
      for (let i = 0; i < 3; i++) {
        const ok = await tryConsumeImageGenQuota(db, userId, "import", { now });
        expect(ok).toBe(true);
      }
      const row = await db.imageGenLedger.findFirst({ where: { userId, kind: "import" } });
      expect(row?.count).toBe(3);
    });

    it("returns false when count == IMPORT_DAILY_CAP", async () => {
      const now = () => new Date("2026-05-11T08:30:00Z");
      const bucketStart = new Date("2026-05-11T00:00:00Z");
      await db.imageGenLedger.create({
        data: { userId, kind: "import", bucketStart, count: IMPORT_DAILY_CAP },
      });
      const ok = await tryConsumeImageGenQuota(db, userId, "import", { now });
      expect(ok).toBe(false);
    });

    it("returns false when count > IMPORT_DAILY_CAP (defensive)", async () => {
      const now = () => new Date("2026-05-11T08:30:00Z");
      const bucketStart = new Date("2026-05-11T00:00:00Z");
      await db.imageGenLedger.create({
        data: { userId, kind: "import", bucketStart, count: IMPORT_DAILY_CAP + 5 },
      });
      const ok = await tryConsumeImageGenQuota(db, userId, "import", { now });
      expect(ok).toBe(false);
    });

    it("kind=import cap differs from placeholder (50 vs 30)", () => {
      expect(IMPORT_DAILY_CAP).toBe(50);
      expect(PLACEHOLDER_DAILY_CAP).toBe(30);
    });

    it("kind=import and kind=placeholder rows are independent for same user/day", async () => {
      const now = () => new Date("2026-05-11T08:30:00Z");
      await tryConsumeImageGenQuota(db, userId, "import", { now });
      await tryConsumeImageGenQuota(db, userId, "placeholder", { now });
      const importRow = await db.imageGenLedger.findFirst({ where: { userId, kind: "import" } });
      const placeholderRow = await db.imageGenLedger.findFirst({
        where: { userId, kind: "placeholder" },
      });
      expect(importRow?.count).toBe(1);
      expect(placeholderRow?.count).toBe(1);
    });

    it("concurrent first-consume race for kind=import ends with both successful", async () => {
      const now = () => new Date("2026-05-11T08:30:00Z");
      const [a, b] = await Promise.all([
        tryConsumeImageGenQuota(db, userId, "import", { now }),
        tryConsumeImageGenQuota(db, userId, "import", { now }),
      ]);
      expect(a).toBe(true);
      expect(b).toBe(true);
      const row = await db.imageGenLedger.findFirst({ where: { userId, kind: "import" } });
      expect(row?.count).toBe(2);
    });
  });
});

describe("tryConsumeImageGenQuota — consume-race error handling (M7)", () => {
  const now = () => new Date("2026-05-11T08:30:00Z");

  it("treats a P2002 unique conflict as expected: retries the increment, no rethrow", async () => {
    const stub = makeLedgerStub({
      createError: new FakePrismaError("P2002"),
      retryCount: 1,
    });
    const ok = await tryConsumeImageGenQuota(stub.db, "u1", "placeholder", { now });
    expect(ok).toBe(true);
    expect(stub.createCalls).toBe(1);
    expect(stub.retryCalls).toBe(1);
  });

  it("treats a P2003 FK violation as expected: retry misses → returns false, no rethrow", async () => {
    const stub = makeLedgerStub({
      createError: new FakePrismaError("P2003"),
      retryCount: 0,
    });
    const ok = await tryConsumeImageGenQuota(stub.db, "u1", "placeholder", { now });
    expect(ok).toBe(false);
    expect(stub.retryCalls).toBe(1);
  });

  it("rethrows an unexpected D1 error instead of masking it as quota-exhausted", async () => {
    const stub = makeLedgerStub({ createError: new Error("D1_ERROR: connection lost") });
    await expect(
      tryConsumeImageGenQuota(stub.db, "u1", "placeholder", { now }),
    ).rejects.toThrow("connection lost");
    // The unexpected path must NOT attempt the expected-race retry.
    expect(stub.retryCalls).toBe(0);
  });

  it("rethrows a Prisma error with an unrelated code (e.g. P1001)", async () => {
    const stub = makeLedgerStub({ createError: new FakePrismaError("P1001") });
    await expect(
      tryConsumeImageGenQuota(stub.db, "u1", "placeholder", { now }),
    ).rejects.toMatchObject({ code: "P1001" });
  });

  it("captures the unexpected error to PostHog when a config is provided, then rethrows", async () => {
    const bodies: unknown[] = [];
    const analyticsFetchImpl = vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response("ok");
    }) as unknown as typeof fetch;
    const stub = makeLedgerStub({ createError: new Error("D1_ERROR: boom") });

    await expect(
      tryConsumeImageGenQuota(stub.db, "user-xyz", "import", {
        now,
        postHogConfig: ENABLED_POSTHOG,
        analyticsFetchImpl,
      }),
    ).rejects.toThrow("boom");

    expect(analyticsFetchImpl).toHaveBeenCalledTimes(1);
    expect(bodies[0]).toMatchObject({
      event: "$exception",
      distinct_id: "user-xyz",
      properties: {
        feature: "image_gen_quota",
        kind: "import",
        phase: "ledgerCreate",
      },
    });
  });

  it("does not capture on the expected P2002 path even when a config is provided", async () => {
    const analyticsFetchImpl = vi.fn(
      async () => new Response("ok"),
    ) as unknown as typeof fetch;
    const stub = makeLedgerStub({
      createError: new FakePrismaError("P2002"),
      retryCount: 1,
    });

    const ok = await tryConsumeImageGenQuota(stub.db, "u1", "placeholder", {
      now,
      postHogConfig: ENABLED_POSTHOG,
      analyticsFetchImpl,
    });
    expect(ok).toBe(true);
    expect(analyticsFetchImpl).not.toHaveBeenCalled();
  });

  it("rethrows the unexpected error without capture when no config is provided", async () => {
    const stub = makeLedgerStub({ createError: new Error("D1_ERROR: silent") });
    await expect(
      tryConsumeImageGenQuota(stub.db, "u1", "placeholder", { now }),
    ).rejects.toThrow("silent");
  });

  it("treats a non-object throw (no Prisma code) as unexpected and rethrows", async () => {
    // A primitive throw has no `.code`; the code-reader's non-object guard must
    // classify it as unexpected rather than swallowing it as a quota miss.
    const stub = makeLedgerStub({ createError: "boom-string" });
    await expect(
      tryConsumeImageGenQuota(stub.db, "u1", "placeholder", { now }),
    ).rejects.toBe("boom-string");
    expect(stub.retryCalls).toBe(0);
  });
});
