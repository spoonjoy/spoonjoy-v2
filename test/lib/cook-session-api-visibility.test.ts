// @vitest-environment node
// Runs in Node with Prisma and SQLite, so it sits apart from test/workers, which the workers pool runs in workerd.
import { afterEach, describe, expect, it } from "vitest";
import { handleCookSessionProtocolRequest } from "../../workers/cook-session-api";
import { db } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1 } from "../helpers/sqlite-d1";
import { createTestUser } from "../utils";

describe("cook sessions of a private recipe", () => {
  afterEach(async () => {
    await cleanupDatabase();
  });

  it("answers another cook's private recipe as not found, and starts its own cook's", async () => {
    await cleanupDatabase();
    const owner = await db.user.create({ data: createTestUser() });
    const cook = await db.user.create({ data: createTestUser() });
    const recipe = await db.recipe.create({ data: { title: "Hidden Stew", chefId: owner.id, visibility: "private" } });
    const d1 = sqliteD1();
    try {
      const sessions = { idFromName: () => "object-1", get: () => ({ fetch: async () => Response.json({ state: null }) }) };
      const env = { COOK_SESSIONS: sessions, DB: d1.binding } as unknown as CloudflareEnvironment;
      const start = (userId: string) => handleCookSessionProtocolRequest(
        new Request(`https://spoonjoy.app/api/cook-sessions/${recipe.id}/start`, { method: "POST", headers: { "X-Spoonjoy-Cook-User": userId } }),
        env,
        userId,
        "start",
        { requireExpectedUser: true },
      );
      expect((await start(cook.id)).status).toBe(404);
      expect((await start(owner.id)).status).toBe(200);
    } finally {
      d1.close();
    }
  });
});
