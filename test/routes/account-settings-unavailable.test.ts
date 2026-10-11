// @vitest-environment node
// A settings change that meets a briefly unavailable database answers a retryable 503 the page
// shows in its banner, keeping what the chef typed, instead of a 500.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { faker } from "@faker-js/faker";
import { getLocalDb } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { createUserSessionCookie } from "~/lib/session.server";
import { D1_WRITE_UNAVAILABLE_MESSAGE, D1WriteUnavailableError } from "~/lib/d1-write-retry.server";
import { cleanupDatabase } from "../helpers/cleanup";

const revocation = vi.hoisted(() => ({ revokeAllAccountAccess: vi.fn() }));
vi.mock("~/lib/account-revocation.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/account-revocation.server")>()),
  revokeAllAccountAccess: revocation.revokeAllAccountAccess,
}));

import { action } from "~/routes/account.settings";

describe("account settings when the database is briefly unavailable", () => {
  let cookie: string;

  beforeEach(async () => {
    await cleanupDatabase();
    const db = await getLocalDb();
    const user = await createUser(db, faker.internet.email(), `chef_${faker.string.alphanumeric(8)}`, "testPassword123");
    cookie = (await createUserSessionCookie(user.id)).split(";")[0];
  });

  afterEach(async () => {
    revocation.revokeAllAccountAccess.mockReset();
    await cleanupDatabase();
  });

  function signOutEverywhere() {
    const request = new UndiciRequest("http://localhost:3000/account/settings", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ intent: "signOutEverywhere" }).toString(),
    });
    return action({ request, context: { cloudflare: { env: null } }, params: {} } as never);
  }

  it("answers a retryable 503 with the friendly message", async () => {
    revocation.revokeAllAccountAccess.mockRejectedValue(new D1WriteUnavailableError("account.revoke_all", new Error("D1_ERROR: Network connection lost.")));

    const answer = await signOutEverywhere() as unknown as { data: unknown; init: { status: number; headers: Record<string, string> } };

    expect(answer.init.status).toBe(503);
    expect(answer.init.headers).toEqual({ "Retry-After": "1", "Cache-Control": "private, no-store" });
    expect(answer.data).toEqual({ success: false, error: "temporarily_unavailable", message: D1_WRITE_UNAVAILABLE_MESSAGE });
  });

  it("passes any other failure through", async () => {
    const broken = new Error("something else");
    revocation.revokeAllAccountAccess.mockRejectedValue(broken);
    await expect(signOutEverywhere()).rejects.toBe(broken);
  });
});
