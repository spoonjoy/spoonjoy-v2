import { afterEach, describe, expect, it } from "vitest";
import { faker } from "@faker-js/faker";
import { db } from "~/lib/db.server";
import { handleOidcOAuthCallback, type OidcOAuthCallbackParams } from "~/lib/oidc-callback.server";
import type { OidcUser } from "~/lib/oidc.server";
import { createTestUser } from "../utils";

const PROVIDER = "oidc:https://auth.example.test/realms/kitchen";

describe("oidc-callback.server", () => {
  const testUserIds: string[] = [];

  function oidcUser(overrides?: Partial<OidcUser>): OidcUser {
    return {
      id: faker.string.uuid(),
      email: faker.internet.email().toLowerCase(),
      emailVerified: true,
      name: "Owner Chef",
      username: faker.internet.username().toLowerCase(),
      ...overrides,
    };
  }

  async function run(overrides?: Partial<OidcOAuthCallbackParams>, user = oidcUser()) {
    const result = await handleOidcOAuthCallback({ db, provider: PROVIDER, oidcUser: user, currentUserId: null, redirectTo: null, ...overrides });
    if (result.userId) testUserIds.push(result.userId);
    return result;
  }

  afterEach(async () => {
    for (const userId of testUserIds.reverse()) {
      await db.oAuth.deleteMany({ where: { userId } });
      await db.user.deleteMany({ where: { id: userId } });
    }
    testUserIds.length = 0;
  });

  it("creates a verified account linked under this issuer for a new user", async () => {
    const user = oidcUser({ name: null, username: "ownerchef" });
    const result = await run(undefined, user);

    expect(result).toMatchObject({ success: true, action: "user_created", redirectTo: "/recipes" });
    const created = await db.user.findUnique({ where: { id: result.userId }, include: { OAuth: true } });
    expect(created?.email).toBe(user.email);
    expect(created?.emailVerifiedAt).not.toBeNull();
    expect(created?.username).toContain("ownerchef");
    expect(created?.OAuth).toEqual([expect.objectContaining({ provider: PROVIDER, providerUserId: user.id, providerUsername: "ownerchef" })]);
  });

  it("signs a returning user in to the linked account", async () => {
    const user = oidcUser();
    const first = await run(undefined, user);
    const again = await run({ redirectTo: "/cookbooks" }, user);
    expect(again).toEqual({ success: true, userId: first.userId, action: "user_logged_in", redirectTo: "/cookbooks" });
  });

  it("treats the same subject at another issuer as someone else", async () => {
    const user = oidcUser();
    const first = await run(undefined, user);
    const other = await run({ provider: "oidc:https://other.example.test" }, { ...user, email: faker.internet.email().toLowerCase() });
    expect(other.action).toBe("user_created");
    expect(other.userId).not.toBe(first.userId);
  });

  it("links to an existing account by an email both sides verified", async () => {
    const existing = await db.user.create({ data: { ...createTestUser(), emailVerifiedAt: new Date() } });
    testUserIds.push(existing.id);
    const result = await run(undefined, oidcUser({ email: existing.email.toUpperCase() }));
    expect(result).toMatchObject({ success: true, userId: existing.id, action: "account_linked" });
  });

  it("refuses to link to an existing account whose email Spoonjoy hasn't verified", async () => {
    const existing = await db.user.create({ data: createTestUser() });
    testUserIds.push(existing.id);
    const result = await run(undefined, oidcUser({ email: existing.email }));
    expect(result).toMatchObject({ success: false, error: "account_exists_unverified" });
  });

  it("never links by an email the provider hasn't verified", async () => {
    const existing = await db.user.create({ data: { ...createTestUser(), emailVerifiedAt: new Date() } });
    testUserIds.push(existing.id);
    const result = await run(undefined, oidcUser({ email: existing.email, emailVerified: false }));
    expect(result).toMatchObject({ success: false, error: "account_exists" });
  });

  it("needs an email to create an account", async () => {
    const result = await run(undefined, oidcUser({ email: null, emailVerified: false }));
    expect(result).toMatchObject({ success: false, error: "email_required", redirectTo: "/recipes" });
  });

  it("links the provider to the signed-in user, and verifies a matching email", async () => {
    const existing = await db.user.create({ data: createTestUser() });
    testUserIds.push(existing.id);
    const result = await run({ currentUserId: existing.id, redirectTo: "/account/settings" }, oidcUser({ email: existing.email }));

    expect(result).toEqual({ success: true, userId: existing.id, action: "account_linked", redirectTo: "/account/settings" });
    const linked = await db.user.findUnique({ where: { id: existing.id }, include: { OAuth: true } });
    expect(linked?.OAuth[0]?.provider).toBe(PROVIDER);
    expect(linked?.emailVerifiedAt).not.toBeNull();
  });

  it("refuses to link a provider identity another account holds", async () => {
    const user = oidcUser();
    await run(undefined, user);
    const other = await db.user.create({ data: createTestUser() });
    testUserIds.push(other.id);
    const result = await run({ currentUserId: other.id }, user);
    expect(result).toMatchObject({ success: false, error: "provider_account_taken" });
  });
});
