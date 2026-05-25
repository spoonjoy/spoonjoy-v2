import { afterEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { db } from "~/lib/db.server";
import {
  handleGitHubOAuthCallback,
  type GitHubOAuthCallbackParams,
} from "~/lib/github-oauth-callback.server";
import type { GitHubUser } from "~/lib/github-oauth.server";
import { createTestUser } from "../utils";

describe("github-oauth-callback.server", () => {
  const testUserIds: string[] = [];

  function createMockGitHubUser(overrides?: Partial<GitHubUser>): GitHubUser {
    const login = faker.internet.username().toLowerCase();
    return {
      id: faker.string.numeric(8),
      email: faker.internet.email().toLowerCase(),
      emailVerified: true,
      login,
      name: faker.person.fullName(),
      avatarUrl: `https://avatars.githubusercontent.com/u/${faker.string.numeric(8)}`,
      ...overrides,
    };
  }

  async function runCallback(
    overrides?: Partial<GitHubOAuthCallbackParams>,
    githubUser = createMockGitHubUser()
  ) {
    return handleGitHubOAuthCallback({
      db,
      githubUser,
      currentUserId: null,
      redirectTo: null,
      ...overrides,
    });
  }

  afterEach(async () => {
    for (const userId of testUserIds.reverse()) {
      try {
        await db.oAuth.deleteMany({ where: { userId } });
        await db.user.delete({ where: { id: userId } });
      } catch {
        // Tests sometimes delete through cascading setup paths.
      }
    }
    testUserIds.length = 0;
    vi.restoreAllMocks();
  });

  it("creates a new user and GitHub OAuth record", async () => {
    const githubUser = createMockGitHubUser({ login: "newchef", name: "New Chef" });
    const result = await runCallback(undefined, githubUser);
    if (result.userId) testUserIds.push(result.userId);

    expect(result).toMatchObject({
      success: true,
      action: "user_created",
      redirectTo: "/recipes",
    });

    const user = await db.user.findUnique({
      where: { id: result.userId },
      include: { OAuth: true },
    });

    expect(user?.email).toBe(githubUser.email);
    expect(user?.username).toContain("new-chef");
    expect(user?.OAuth).toHaveLength(1);
    expect(user?.OAuth[0]).toMatchObject({
      provider: "github",
      providerUserId: githubUser.id,
      providerUsername: "newchef",
    });
  });

  it("uses GitHub login when profile name is absent", async () => {
    const githubUser = createMockGitHubUser({ login: "loginchef", name: null });
    const result = await runCallback(undefined, githubUser);
    if (result.userId) testUserIds.push(result.userId);

    expect(result.success).toBe(true);
    const user = await db.user.findUnique({ where: { id: result.userId } });
    expect(user?.username).toContain("loginchef");
  });

  it("logs in an existing migrated GitHub OAuth user even without a provider email", async () => {
    const userData = createTestUser();
    const existingUser = await db.user.create({
      data: {
        ...userData,
        OAuth: {
          create: {
            provider: "github",
            providerUserId: "migrated-github-id",
            providerUsername: "migratedchef",
          },
        },
      },
    });
    testUserIds.push(existingUser.id);

    const result = await runCallback(
      { redirectTo: "/cookbooks" },
      createMockGitHubUser({
        id: "migrated-github-id",
        email: null,
        emailVerified: false,
        login: "migratedchef",
      })
    );

    expect(result).toMatchObject({
      success: true,
      userId: existingUser.id,
      action: "user_logged_in",
      redirectTo: "/cookbooks",
    });
  });

  it("links GitHub to the current user", async () => {
    const existingUser = await db.user.create({ data: createTestUser() });
    testUserIds.push(existingUser.id);
    const githubUser = createMockGitHubUser({ login: "linkchef" });

    const result = await runCallback({
      currentUserId: existingUser.id,
      redirectTo: "/account/settings",
    }, githubUser);

    expect(result).toMatchObject({
      success: true,
      userId: existingUser.id,
      action: "account_linked",
      redirectTo: "/account/settings",
    });

    const oauth = await db.oAuth.findUnique({
      where: { userId_provider: { userId: existingUser.id, provider: "github" } },
    });
    expect(oauth?.providerUserId).toBe(githubUser.id);
    expect(oauth?.providerUsername).toBe("linkchef");
  });

  it("propagates link errors when the GitHub account is already linked elsewhere", async () => {
    const githubUser = createMockGitHubUser({ login: "claimedchef" });
    const firstResult = await runCallback(undefined, githubUser);
    if (firstResult.userId) testUserIds.push(firstResult.userId);

    const secondUser = await db.user.create({ data: createTestUser() });
    testUserIds.push(secondUser.id);

    const result = await runCallback({
      currentUserId: secondUser.id,
      redirectTo: "/account/settings",
    }, githubUser);

    expect(result).toMatchObject({
      success: false,
      error: "provider_account_taken",
      redirectTo: "/account/settings",
    });
    expect(result.userId).toBeUndefined();
  });

  it("returns account_exists when a new GitHub login collides by email", async () => {
    const existingUser = await db.user.create({
      data: { ...createTestUser(), email: "Existing@Example.com" },
    });
    testUserIds.push(existingUser.id);

    const result = await runCallback(undefined, createMockGitHubUser({
      email: "existing@example.com",
    }));

    expect(result).toMatchObject({
      success: false,
      error: "account_exists",
      redirectTo: "/recipes",
    });
  });

  it("returns email_required for a new GitHub user with no verified email", async () => {
    const result = await runCallback(undefined, createMockGitHubUser({
      email: null,
      emailVerified: false,
    }));

    expect(result).toMatchObject({
      success: false,
      error: "email_required",
      redirectTo: "/recipes",
    });
    expect(result.userId).toBeUndefined();
  });
});
