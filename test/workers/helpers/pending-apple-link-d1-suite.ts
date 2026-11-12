import { env } from "cloudflare:test";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDb } from "../../../app/lib/db.server";
import { claimPendingAppleLink, createPendingAppleLink } from "../../../app/lib/pending-apple-link.server";
import { applyRepositoryMigrations } from "./repository-migrations";

// The pending Apple link table comes from migrations/0037_pending_apple_link.sql. These run the
// link's create, expiry and single-use spend through Prisma's D1 adapter against Wrangler's real
// D1, where DateTime values are stored as text and compared by the code.

const PREFIX = "pending-apple-d1";
let prisma: PrismaClient;

function database(): D1Database {
  return env.DB as D1Database;
}

describe("pending Apple links on D1", () => {
  beforeAll(async () => {
    await applyRepositoryMigrations(database());
    prisma = await getDb({ DB: database() });
    await database().prepare(`INSERT INTO "User" ("id", "email", "username", "createdAt", "updatedAt")
      VALUES (?, ?, ?, ?, ?)`).bind(`${PREFIX}-chef`, `${PREFIX}@example.com`, `${PREFIX}_chef`, "2026-11-11T00:00:00.000Z", "2026-11-11T00:00:00.000Z").run();
  });

  afterAll(async () => {
    await database().prepare(`DELETE FROM "OAuth" WHERE "userId" LIKE '${PREFIX}-%'`).run();
    await database().prepare(`DELETE FROM "PendingAppleLink" WHERE "appleSub" LIKE '${PREFIX}-%'`).run();
    await database().prepare(`DELETE FROM "User" WHERE "id" LIKE '${PREFIX}-%'`).run();
  });

  it("links once within thirty minutes, and not after", async () => {
    const created = new Date("2026-11-11T12:00:00.000Z");
    const fresh = await createPendingAppleLink(prisma, { appleSub: `${PREFIX}-sub`, providerUsername: null }, { now: created });
    const stale = await createPendingAppleLink(prisma, { appleSub: `${PREFIX}-stale`, providerUsername: null }, { now: created });
    const almost = new Date(created.getTime() + 29 * 60 * 1000);

    await expect(claimPendingAppleLink(prisma, stale.token, `${PREFIX}-chef`, { now: stale.expiresAt })).resolves.toBe("expired");
    await expect(claimPendingAppleLink(prisma, fresh.token, `${PREFIX}-chef`, { now: almost })).resolves.toBe("linked");
    await expect(claimPendingAppleLink(prisma, fresh.token, `${PREFIX}-chef`, { now: almost })).resolves.toBe("consumed");
    // A link made after the stale one expired clears it; the fresh, spent one stays.
    await createPendingAppleLink(prisma, { appleSub: `${PREFIX}-later`, providerUsername: null }, { now: new Date(stale.expiresAt.getTime() + 1) });
    await expect(database().prepare(`SELECT COUNT(*) AS "n" FROM "PendingAppleLink" WHERE "appleSub" = ?`)
      .bind(`${PREFIX}-stale`).first<{ n: number }>()).resolves.toEqual({ n: 0 });
    await expect(database().prepare(`SELECT "userId" FROM "OAuth" WHERE "provider" = 'apple' AND "providerUserId" = ?`)
      .bind(`${PREFIX}-sub`).first<{ userId: string }>()).resolves.toEqual({ userId: `${PREFIX}-chef` });
  });
});
