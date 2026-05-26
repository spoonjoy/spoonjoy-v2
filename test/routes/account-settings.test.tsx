import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Request as UndiciRequest, FormData as UndiciFormData } from "undici";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTestRoutesStub } from "../utils";
import { db } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { faker } from "@faker-js/faker";

// Import loader and component from the route
import AccountSettings, { loader, action } from "~/routes/account.settings";

describe("Account Settings Route", () => {
  let testUserId: string;
  let testUserEmail: string;
  let testUsername: string;

  beforeEach(async () => {
    await cleanupDatabase();
    testUserEmail = faker.internet.email();
    testUsername = faker.internet.username() + "_" + faker.string.alphanumeric(8);
    const user = await createUser(db, testUserEmail, testUsername, "testPassword123");
    testUserId = user.id;
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("loader", () => {
    it("should redirect to login when user is not logged in", async () => {
      const request = new UndiciRequest("http://localhost:3000/account/settings");

      await expect(
        loader({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any)
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(Response);
        expect(error.status).toBe(302);
        expect(error.headers.get("Location")).toContain("/login");
        return true;
      });
    });

    it("should return user data when logged in", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest("http://localhost:3000/account/settings", { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(result.user).toBeDefined();
      expect(result.user.id).toBe(testUserId);
      expect(result.user.email).toBe(testUserEmail.toLowerCase());
      expect(result.user.username).toBe(testUsername);
    });

    it("should return user OAuth accounts when logged in", async () => {
      // Create an OAuth account for the user
      await db.oAuth.create({
        data: {
          provider: "google",
          providerUserId: "google-123",
          providerUsername: "testuser@gmail.com",
          userId: testUserId,
        },
      });

      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest("http://localhost:3000/account/settings", { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(result.user.oauthAccounts).toBeDefined();
      expect(result.user.oauthAccounts).toHaveLength(1);
      expect(result.user.oauthAccounts[0].provider).toBe("google");
      expect(result.user.oauthAccounts[0].providerUsername).toBe("testuser@gmail.com");
    });

    it("should indicate if user has a password set", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest("http://localhost:3000/account/settings", { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(result.user.hasPassword).toBe(true);
    });

    it("returns default-true notification preferences when no row exists", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest("http://localhost:3000/account/settings", { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(result.notifications.preferences).toEqual({
        notifySpoonOnMyRecipe: true,
        notifyForkOfMyRecipe: true,
        notifyCookbookSaveOfMine: true,
        notifyFellowChefOriginCook: true,
      });
    });

    it("returns persisted notification preferences when a row exists", async () => {
      await db.notificationPreference.create({
        data: {
          userId: testUserId,
          notifySpoonOnMyRecipe: false,
          notifyForkOfMyRecipe: true,
          notifyCookbookSaveOfMine: false,
          notifyFellowChefOriginCook: true,
        },
      });

      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest("http://localhost:3000/account/settings", { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(result.notifications.preferences).toEqual({
        notifySpoonOnMyRecipe: false,
        notifyForkOfMyRecipe: true,
        notifyCookbookSaveOfMine: false,
        notifyFellowChefOriginCook: true,
      });
    });

    it("should indicate if OAuth-only user has no password", async () => {
      // Create an OAuth-only user (no password)
      const oauthEmail = faker.internet.email();
      const oauthUsername = faker.internet.username() + "_" + faker.string.alphanumeric(8);
      const oauthUser = await db.user.create({
        data: {
          email: oauthEmail.toLowerCase(),
          username: oauthUsername,
          hashedPassword: null,
          salt: null,
        },
      });

      await db.oAuth.create({
        data: {
          provider: "apple",
          providerUserId: "apple-456",
          providerUsername: "Apple User",
          userId: oauthUser.id,
        },
      });

      const session = await sessionStorage.getSession();
      session.set("userId", oauthUser.id);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest("http://localhost:3000/account/settings", { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(result.user.hasPassword).toBe(false);
    });
  });

  describe("component", () => {
    it("should render account settings page with heading", async () => {
      const mockData = {
        user: {
          id: testUserId,
          email: testUserEmail.toLowerCase(),
          username: testUsername,
          hasPassword: true,
          oauthAccounts: [],
        },
        notifications: { pushSubscribed: false },
      };

      const Stub = createTestRoutesStub([
        {
          path: "/account/settings",
          Component: AccountSettings,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/account/settings"]} />);

      expect(await screen.findByRole("heading", { name: /account settings/i })).toBeInTheDocument();
    });

    it("should render user info section", async () => {
      const mockData = {
        user: {
          id: testUserId,
          email: testUserEmail.toLowerCase(),
          username: testUsername,
          hasPassword: true,
          oauthAccounts: [],
        },
        notifications: { pushSubscribed: false },
      };

      const Stub = createTestRoutesStub([
        {
          path: "/account/settings",
          Component: AccountSettings,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/account/settings"]} />);

      await screen.findByRole("heading", { name: /account settings/i });
      // User info section should show email and username
      expect(screen.getByTestId("user-info-section")).toBeInTheDocument();
      expect(screen.getByText(testUserEmail.toLowerCase())).toBeInTheDocument();
      expect(screen.getByText(testUsername)).toBeInTheDocument();
    });

    it("should render profile photo section", async () => {
      const mockData = {
        user: {
          id: testUserId,
          email: testUserEmail.toLowerCase(),
          username: testUsername,
          hasPassword: true,
          oauthAccounts: [],
        },
        notifications: { pushSubscribed: false },
      };

      const Stub = createTestRoutesStub([
        {
          path: "/account/settings",
          Component: AccountSettings,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/account/settings"]} />);

      await screen.findByRole("heading", { name: /account settings/i });
      expect(screen.getByTestId("profile-photo-section")).toBeInTheDocument();
    });

    it("should render OAuth providers section", async () => {
      const mockData = {
        user: {
          id: testUserId,
          email: testUserEmail.toLowerCase(),
          username: testUsername,
          hasPassword: true,
          oauthAccounts: [],
        },
        notifications: { pushSubscribed: false },
      };

      const Stub = createTestRoutesStub([
        {
          path: "/account/settings",
          Component: AccountSettings,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/account/settings"]} />);

      await screen.findByRole("heading", { name: /account settings/i });
      expect(screen.getByTestId("oauth-providers-section")).toBeInTheDocument();
    });

    it("should render password section", async () => {
      const mockData = {
        user: {
          id: testUserId,
          email: testUserEmail.toLowerCase(),
          username: testUsername,
          hasPassword: true,
          oauthAccounts: [],
        },
        notifications: { pushSubscribed: false },
      };

      const Stub = createTestRoutesStub([
        {
          path: "/account/settings",
          Component: AccountSettings,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/account/settings"]} />);

      await screen.findByRole("heading", { name: /account settings/i });
      expect(screen.getByTestId("password-section")).toBeInTheDocument();
    });

    it("should display linked OAuth accounts", async () => {
      const mockData = {
        user: {
          id: testUserId,
          email: testUserEmail.toLowerCase(),
          username: testUsername,
          hasPassword: true,
          oauthAccounts: [
            { provider: "google", providerUsername: "testuser@gmail.com" },
            { provider: "apple", providerUsername: "Apple User" },
          ],
        },
        notifications: { pushSubscribed: false },
      };

      const Stub = createTestRoutesStub([
        {
          path: "/account/settings",
          Component: AccountSettings,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/account/settings"]} />);

      await screen.findByRole("heading", { name: /account settings/i });
      // Should show both linked accounts
      expect(screen.getByText(/google/i)).toBeInTheDocument();
      expect(screen.getByText("testuser@gmail.com")).toBeInTheDocument();
      expect(screen.getByText(/apple/i)).toBeInTheDocument();
      expect(screen.getByText("Apple User")).toBeInTheDocument();
    });

    it("should show option to link OAuth providers when not linked", async () => {
      const mockData = {
        user: {
          id: testUserId,
          email: testUserEmail.toLowerCase(),
          username: testUsername,
          hasPassword: true,
          oauthAccounts: [],
        },
        notifications: { pushSubscribed: false },
      };

      const Stub = createTestRoutesStub([
        {
          path: "/account/settings",
          Component: AccountSettings,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/account/settings"]} />);

      await screen.findByRole("heading", { name: /account settings/i });
      // Should show buttons to link every supported OAuth provider
      expect(screen.getByRole("button", { name: /link google/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /link github/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /link apple/i })).toBeInTheDocument();
    });

    it("should show option to unlink OAuth provider when linked", async () => {
      const mockData = {
        user: {
          id: testUserId,
          email: testUserEmail.toLowerCase(),
          username: testUsername,
          hasPassword: true,
          oauthAccounts: [{ provider: "google", providerUsername: "testuser@gmail.com" }],
        },
        notifications: { pushSubscribed: false },
      };

      const Stub = createTestRoutesStub([
        {
          path: "/account/settings",
          Component: AccountSettings,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/account/settings"]} />);

      await screen.findByRole("heading", { name: /account settings/i });
      // Should show unlink button for linked Google account
      expect(screen.getByRole("button", { name: /unlink google/i })).toBeInTheDocument();
    });

    it("should show password change option when user has password", async () => {
      const mockData = {
        user: {
          id: testUserId,
          email: testUserEmail.toLowerCase(),
          username: testUsername,
          hasPassword: true,
          oauthAccounts: [],
        },
        notifications: { pushSubscribed: false },
      };

      const Stub = createTestRoutesStub([
        {
          path: "/account/settings",
          Component: AccountSettings,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/account/settings"]} />);

      await screen.findByRole("heading", { name: /account settings/i });
      expect(screen.getByRole("button", { name: /change password/i })).toBeInTheDocument();
    });

    it("should show option to set password when OAuth-only user has no password", async () => {
      const mockData = {
        user: {
          id: testUserId,
          email: testUserEmail.toLowerCase(),
          username: testUsername,
          hasPassword: false,
          oauthAccounts: [{ provider: "google", providerUsername: "testuser@gmail.com" }],
        },
        notifications: { pushSubscribed: false },
      };

      const Stub = createTestRoutesStub([
        {
          path: "/account/settings",
          Component: AccountSettings,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/account/settings"]} />);

      await screen.findByRole("heading", { name: /account settings/i });
      expect(screen.getByRole("button", { name: /set password/i })).toBeInTheDocument();
    });

    it("should show mixed link/unlink buttons when one provider is linked and one is not", async () => {
      const mockData = {
        user: {
          id: testUserId,
          email: testUserEmail.toLowerCase(),
          username: testUsername,
          hasPassword: true,
          oauthAccounts: [{ provider: "google", providerUsername: "testuser@gmail.com" }],
        },
        notifications: { pushSubscribed: false },
      };

      const Stub = createTestRoutesStub([
        {
          path: "/account/settings",
          Component: AccountSettings,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/account/settings"]} />);

      await screen.findByRole("heading", { name: /account settings/i });
      // Google is linked - should show Unlink
      expect(screen.getByRole("button", { name: /unlink google/i })).toBeInTheDocument();
      // GitHub and Apple are not linked - should show Link
      expect(screen.getByRole("button", { name: /link github/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /link apple/i })).toBeInTheDocument();
    });

    it("should have accessible button labels for screen readers", async () => {
      const mockData = {
        user: {
          id: testUserId,
          email: testUserEmail.toLowerCase(),
          username: testUsername,
          hasPassword: true,
          oauthAccounts: [{ provider: "google", providerUsername: "testuser@gmail.com" }],
        },
        notifications: { pushSubscribed: false },
      };

      const Stub = createTestRoutesStub([
        {
          path: "/account/settings",
          Component: AccountSettings,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/account/settings"]} />);

      await screen.findByRole("heading", { name: /account settings/i });

      // Verify aria-labels are set correctly
      const unlinkButton = screen.getByRole("button", { name: /unlink google/i });
      expect(unlinkButton).toHaveAttribute("aria-label", "Unlink Google");

      const linkButton = screen.getByRole("button", { name: /link apple/i });
      expect(linkButton).toHaveAttribute("aria-label", "Link Apple");
    });

    it("should render all sections with proper semantic headings", async () => {
      const mockData = {
        user: {
          id: testUserId,
          email: testUserEmail.toLowerCase(),
          username: testUsername,
          hasPassword: true,
          oauthAccounts: [],
        },
        notifications: { pushSubscribed: false },
      };

      const Stub = createTestRoutesStub([
        {
          path: "/account/settings",
          Component: AccountSettings,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/account/settings"]} />);

      await screen.findByRole("heading", { name: /account settings/i });

      expect(screen.getByRole("heading", { name: /user information/i })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: /profile photo/i })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: /connected accounts/i })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: /password/i })).toBeInTheDocument();
    });

    it("should render edit button in user info section", async () => {
      const mockData = {
        user: {
          id: testUserId,
          email: testUserEmail.toLowerCase(),
          username: testUsername,
          hasPassword: true,
          oauthAccounts: [],
        },
        notifications: { pushSubscribed: false },
      };

      const Stub = createTestRoutesStub([
        {
          path: "/account/settings",
          Component: AccountSettings,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/account/settings"]} />);

      await screen.findByRole("heading", { name: /account settings/i });
      expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
    });

    it("should show edit form when edit button is clicked", async () => {
      const user = userEvent.setup();
      const mockData = {
        user: {
          id: testUserId,
          email: testUserEmail.toLowerCase(),
          username: testUsername,
          hasPassword: true,
          oauthAccounts: [],
        },
        notifications: { pushSubscribed: false },
      };

      const Stub = createTestRoutesStub([
        {
          path: "/account/settings",
          Component: AccountSettings,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/account/settings"]} />);

      await screen.findByRole("heading", { name: /account settings/i });
      const editButton = screen.getByRole("button", { name: /edit/i });
      await user.click(editButton);

      // Edit form should now be visible with input fields
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
    });

    it("should pre-fill edit form with current user data", async () => {
      const user = userEvent.setup();
      const mockData = {
        user: {
          id: testUserId,
          email: testUserEmail.toLowerCase(),
          username: testUsername,
          hasPassword: true,
          oauthAccounts: [],
        },
        notifications: { pushSubscribed: false },
      };

      const Stub = createTestRoutesStub([
        {
          path: "/account/settings",
          Component: AccountSettings,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/account/settings"]} />);

      await screen.findByRole("heading", { name: /account settings/i });
      const editButton = screen.getByRole("button", { name: /edit/i });
      await user.click(editButton);

      const emailInput = screen.getByLabelText(/email/i) as HTMLInputElement;
      const usernameInput = screen.getByLabelText(/username/i) as HTMLInputElement;

      expect(emailInput.value).toBe(testUserEmail.toLowerCase());
      expect(usernameInput.value).toBe(testUsername);
    });

    it("should hide edit form when cancel button is clicked", async () => {
      const user = userEvent.setup();
      const mockData = {
        user: {
          id: testUserId,
          email: testUserEmail.toLowerCase(),
          username: testUsername,
          hasPassword: true,
          oauthAccounts: [],
        },
        notifications: { pushSubscribed: false },
      };

      const Stub = createTestRoutesStub([
        {
          path: "/account/settings",
          Component: AccountSettings,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/account/settings"]} />);

      await screen.findByRole("heading", { name: /account settings/i });
      const editButton = screen.getByRole("button", { name: /edit/i });
      await user.click(editButton);

      // Cancel should return to view mode
      const cancelButton = screen.getByRole("button", { name: /cancel/i });
      await user.click(cancelButton);

      // Should be back to view mode - edit button visible again
      expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
      // Save button should not be visible
      expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
    });
  });

  describe("action - user info editing", () => {
    it("should successfully update email", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const newEmail = faker.internet.email();
      const formData = new FormData();
      formData.append("email", newEmail);
      formData.append("username", testUsername);
      formData.append("intent", "updateUserInfo");

      const headers = new Headers();
      headers.set("Cookie", cookieValue);
      headers.set("Content-Type", "application/x-www-form-urlencoded");

      const request = new UndiciRequest("http://localhost:3000/account/settings", {
        method: "POST",
        headers,
        body: new URLSearchParams(formData as any).toString(),
      });

      const result = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(result.success).toBe(true);

      // Verify email was updated in database
      const updatedUser = await db.user.findUnique({ where: { id: testUserId } });
      expect(updatedUser?.email).toBe(newEmail.toLowerCase());
    });

    it("should successfully update username", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const newUsername = faker.internet.username() + "_" + faker.string.alphanumeric(8);
      const formData = new FormData();
      formData.append("email", testUserEmail);
      formData.append("username", newUsername);
      formData.append("intent", "updateUserInfo");

      const headers = new Headers();
      headers.set("Cookie", cookieValue);
      headers.set("Content-Type", "application/x-www-form-urlencoded");

      const request = new UndiciRequest("http://localhost:3000/account/settings", {
        method: "POST",
        headers,
        body: new URLSearchParams(formData as any).toString(),
      });

      const result = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(result.success).toBe(true);

      // Verify username was updated in database
      const updatedUser = await db.user.findUnique({ where: { id: testUserId } });
      expect(updatedUser?.username).toBe(newUsername);
    });

    it("should successfully update both email and username", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const newEmail = faker.internet.email();
      const newUsername = faker.internet.username() + "_" + faker.string.alphanumeric(8);
      const formData = new FormData();
      formData.append("email", newEmail);
      formData.append("username", newUsername);
      formData.append("intent", "updateUserInfo");

      const headers = new Headers();
      headers.set("Cookie", cookieValue);
      headers.set("Content-Type", "application/x-www-form-urlencoded");

      const request = new UndiciRequest("http://localhost:3000/account/settings", {
        method: "POST",
        headers,
        body: new URLSearchParams(formData as any).toString(),
      });

      const result = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(result.success).toBe(true);

      // Verify both fields were updated in database
      const updatedUser = await db.user.findUnique({ where: { id: testUserId } });
      expect(updatedUser?.email).toBe(newEmail.toLowerCase());
      expect(updatedUser?.username).toBe(newUsername);
    });

    it("should return error when email is already taken", async () => {
      // Create another user with a different email
      const existingEmail = faker.internet.email();
      const existingUsername = faker.internet.username() + "_" + faker.string.alphanumeric(8);
      await createUser(db, existingEmail, existingUsername, "testPassword123");

      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const formData = new FormData();
      formData.append("email", existingEmail); // Try to use existing email
      formData.append("username", testUsername);
      formData.append("intent", "updateUserInfo");

      const headers = new Headers();
      headers.set("Cookie", cookieValue);
      headers.set("Content-Type", "application/x-www-form-urlencoded");

      const request = new UndiciRequest("http://localhost:3000/account/settings", {
        method: "POST",
        headers,
        body: new URLSearchParams(formData as any).toString(),
      });

      const result = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(result.success).toBe(false);
      expect(result.error).toBe("email_taken");
      expect(result.message).toContain("email");
    });

    it("should return error when username is already taken", async () => {
      // Create another user with a different username
      const existingEmail = faker.internet.email();
      const existingUsername = faker.internet.username() + "_" + faker.string.alphanumeric(8);
      await createUser(db, existingEmail, existingUsername, "testPassword123");

      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const formData = new FormData();
      formData.append("email", testUserEmail);
      formData.append("username", existingUsername); // Try to use existing username
      formData.append("intent", "updateUserInfo");

      const headers = new Headers();
      headers.set("Cookie", cookieValue);
      headers.set("Content-Type", "application/x-www-form-urlencoded");

      const request = new UndiciRequest("http://localhost:3000/account/settings", {
        method: "POST",
        headers,
        body: new URLSearchParams(formData as any).toString(),
      });

      const result = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(result.success).toBe(false);
      expect(result.error).toBe("username_taken");
      expect(result.message).toContain("username");
    });

    it("should perform case-insensitive email uniqueness check", async () => {
      // Create another user with email in different case
      const existingEmail = faker.internet.email().toUpperCase();
      const existingUsername = faker.internet.username() + "_" + faker.string.alphanumeric(8);
      await createUser(db, existingEmail, existingUsername, "testPassword123");

      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const formData = new FormData();
      formData.append("email", existingEmail.toLowerCase()); // Same email, different case
      formData.append("username", testUsername);
      formData.append("intent", "updateUserInfo");

      const headers = new Headers();
      headers.set("Cookie", cookieValue);
      headers.set("Content-Type", "application/x-www-form-urlencoded");

      const request = new UndiciRequest("http://localhost:3000/account/settings", {
        method: "POST",
        headers,
        body: new URLSearchParams(formData as any).toString(),
      });

      const result = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(result.success).toBe(false);
      expect(result.error).toBe("email_taken");
    });

    it("should allow updating to same email (no change)", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const formData = new FormData();
      formData.append("email", testUserEmail); // Same email
      formData.append("username", testUsername); // Same username
      formData.append("intent", "updateUserInfo");

      const headers = new Headers();
      headers.set("Cookie", cookieValue);
      headers.set("Content-Type", "application/x-www-form-urlencoded");

      const request = new UndiciRequest("http://localhost:3000/account/settings", {
        method: "POST",
        headers,
        body: new URLSearchParams(formData as any).toString(),
      });

      const result = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(result.success).toBe(true);
    });

    it("should return error when email is empty", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const formData = new FormData();
      formData.append("email", "");
      formData.append("username", testUsername);
      formData.append("intent", "updateUserInfo");

      const headers = new Headers();
      headers.set("Cookie", cookieValue);
      headers.set("Content-Type", "application/x-www-form-urlencoded");

      const request = new UndiciRequest("http://localhost:3000/account/settings", {
        method: "POST",
        headers,
        body: new URLSearchParams(formData as any).toString(),
      });

      const result = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(result.success).toBe(false);
      expect(result.error).toBe("validation_error");
      expect(result.fieldErrors?.email).toBeDefined();
    });

    it("should return error when username is empty", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const formData = new FormData();
      formData.append("email", testUserEmail);
      formData.append("username", "");
      formData.append("intent", "updateUserInfo");

      const headers = new Headers();
      headers.set("Cookie", cookieValue);
      headers.set("Content-Type", "application/x-www-form-urlencoded");

      const request = new UndiciRequest("http://localhost:3000/account/settings", {
        method: "POST",
        headers,
        body: new URLSearchParams(formData as any).toString(),
      });

      const result = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(result.success).toBe(false);
      expect(result.error).toBe("validation_error");
      expect(result.fieldErrors?.username).toBeDefined();
    });

    it("should return error when email format is invalid", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const formData = new FormData();
      formData.append("email", "not-a-valid-email");
      formData.append("username", testUsername);
      formData.append("intent", "updateUserInfo");

      const headers = new Headers();
      headers.set("Cookie", cookieValue);
      headers.set("Content-Type", "application/x-www-form-urlencoded");

      const request = new UndiciRequest("http://localhost:3000/account/settings", {
        method: "POST",
        headers,
        body: new URLSearchParams(formData as any).toString(),
      });

      const result = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(result.success).toBe(false);
      expect(result.error).toBe("validation_error");
      expect(result.fieldErrors?.email).toBeDefined();
    });

    it("should redirect to login when not authenticated", async () => {
      const formData = new FormData();
      formData.append("email", faker.internet.email());
      formData.append("username", faker.internet.username());
      formData.append("intent", "updateUserInfo");

      const headers = new Headers();
      headers.set("Content-Type", "application/x-www-form-urlencoded");

      const request = new UndiciRequest("http://localhost:3000/account/settings", {
        method: "POST",
        headers,
        body: new URLSearchParams(formData as any).toString(),
      });

      await expect(
        action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any)
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(Response);
        expect(error.status).toBe(302);
        expect(error.headers.get("Location")).toContain("/login");
        return true;
      });
    });

    it("should normalize email to lowercase", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const newEmail = "TEST.USER@EXAMPLE.COM";
      const formData = new FormData();
      formData.append("email", newEmail);
      formData.append("username", testUsername);
      formData.append("intent", "updateUserInfo");

      const headers = new Headers();
      headers.set("Cookie", cookieValue);
      headers.set("Content-Type", "application/x-www-form-urlencoded");

      const request = new UndiciRequest("http://localhost:3000/account/settings", {
        method: "POST",
        headers,
        body: new URLSearchParams(formData as any).toString(),
      });

      const result = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(result.success).toBe(true);

      // Verify email was normalized to lowercase
      const updatedUser = await db.user.findUnique({ where: { id: testUserId } });
      expect(updatedUser?.email).toBe(newEmail.toLowerCase());
    });

    it("should return success false for unknown intent", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const formData = new FormData();
      formData.append("intent", "unknownIntent");

      const headers = new Headers();
      headers.set("Cookie", cookieValue);
      headers.set("Content-Type", "application/x-www-form-urlencoded");

      const request = new UndiciRequest("http://localhost:3000/account/settings", {
        method: "POST",
        headers,
        body: new URLSearchParams(formData as any).toString(),
      });

      const result = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(result.success).toBe(false);
    });
  });

  describe("profile photo", () => {
    // Default avatar URL - chef RJ from spoonjoy v1
    const DEFAULT_AVATAR_URL = "/images/chef-rj.png";

    describe("loader - photo data", () => {
      it("should return user photoUrl when user has a custom photo", async () => {
        // Update user with custom photo URL
        const customPhotoUrl = "https://example.com/custom-photo.jpg";
        await db.user.update({
          where: { id: testUserId },
          data: { photoUrl: customPhotoUrl },
        });

        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const headers = new Headers();
        headers.set("Cookie", cookieValue);

        const request = new UndiciRequest("http://localhost:3000/account/settings", { headers });

        const result = await loader({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.user.photoUrl).toBe(customPhotoUrl);
      });

      it("should return null photoUrl when user has no custom photo", async () => {
        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const headers = new Headers();
        headers.set("Cookie", cookieValue);

        const request = new UndiciRequest("http://localhost:3000/account/settings", { headers });

        const result = await loader({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.user.photoUrl).toBeNull();
      });
    });

    describe("component - default avatar display", () => {
      it("should display default avatar (chef RJ) when user has no photo", async () => {
        const mockData = {
          user: {
            id: testUserId,
            email: testUserEmail.toLowerCase(),
            username: testUsername,
            hasPassword: true,
            oauthAccounts: [],
            photoUrl: null,
          },
          notifications: { pushSubscribed: false },
      };

        const Stub = createTestRoutesStub([
          {
            path: "/account/settings",
            Component: AccountSettings,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/account/settings"]} />);

        await screen.findByRole("heading", { name: /account settings/i });
        const profilePhotoSection = screen.getByTestId("profile-photo-section");

        // Should display the Avatar component with default chef RJ image
        const avatarImg = profilePhotoSection.querySelector("img");
        expect(avatarImg).toBeInTheDocument();
        expect(avatarImg).toHaveAttribute("src", DEFAULT_AVATAR_URL);
        expect(avatarImg).toHaveAttribute("alt", expect.stringMatching(/profile|avatar|photo/i));
      });

      it("should display user's custom photo when they have one", async () => {
        const customPhotoUrl = "https://example.com/my-photo.jpg";
        const mockData = {
          user: {
            id: testUserId,
            email: testUserEmail.toLowerCase(),
            username: testUsername,
            hasPassword: true,
            oauthAccounts: [],
            photoUrl: customPhotoUrl,
          },
          notifications: { pushSubscribed: false },
      };

        const Stub = createTestRoutesStub([
          {
            path: "/account/settings",
            Component: AccountSettings,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/account/settings"]} />);

        await screen.findByRole("heading", { name: /account settings/i });
        const profilePhotoSection = screen.getByTestId("profile-photo-section");

        // Should display the custom photo
        const avatarImg = profilePhotoSection.querySelector("img");
        expect(avatarImg).toBeInTheDocument();
        expect(avatarImg).toHaveAttribute("src", customPhotoUrl);
      });

      it("should use Avatar component from UI library for displaying photo", async () => {
        const mockData = {
          user: {
            id: testUserId,
            email: testUserEmail.toLowerCase(),
            username: testUsername,
            hasPassword: true,
            oauthAccounts: [],
            photoUrl: null,
          },
          notifications: { pushSubscribed: false },
      };

        const Stub = createTestRoutesStub([
          {
            path: "/account/settings",
            Component: AccountSettings,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/account/settings"]} />);

        await screen.findByRole("heading", { name: /account settings/i });
        const profilePhotoSection = screen.getByTestId("profile-photo-section");

        // Avatar component uses data-slot="avatar"
        const avatar = profilePhotoSection.querySelector('[data-slot="avatar"]');
        expect(avatar).toBeInTheDocument();
      });
    });

    describe("component - photo upload UI", () => {
      it("should display upload button in profile photo section", async () => {
        const mockData = {
          user: {
            id: testUserId,
            email: testUserEmail.toLowerCase(),
            username: testUsername,
            hasPassword: true,
            oauthAccounts: [],
            photoUrl: null,
          },
          notifications: { pushSubscribed: false },
      };

        const Stub = createTestRoutesStub([
          {
            path: "/account/settings",
            Component: AccountSettings,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/account/settings"]} />);

        await screen.findByRole("heading", { name: /account settings/i });
        expect(screen.getByRole("button", { name: /upload photo/i })).toBeInTheDocument();
      });

      it("should display change photo button when user already has a photo", async () => {
        const mockData = {
          user: {
            id: testUserId,
            email: testUserEmail.toLowerCase(),
            username: testUsername,
            hasPassword: true,
            oauthAccounts: [],
            photoUrl: "https://example.com/existing-photo.jpg",
          },
          notifications: { pushSubscribed: false },
      };

        const Stub = createTestRoutesStub([
          {
            path: "/account/settings",
            Component: AccountSettings,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/account/settings"]} />);

        await screen.findByRole("heading", { name: /account settings/i });
        expect(screen.getByRole("button", { name: /change photo/i })).toBeInTheDocument();
      });

      it("should display remove photo button when user has a custom photo", async () => {
        const mockData = {
          user: {
            id: testUserId,
            email: testUserEmail.toLowerCase(),
            username: testUsername,
            hasPassword: true,
            oauthAccounts: [],
            photoUrl: "https://example.com/existing-photo.jpg",
          },
          notifications: { pushSubscribed: false },
      };

        const Stub = createTestRoutesStub([
          {
            path: "/account/settings",
            Component: AccountSettings,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/account/settings"]} />);

        await screen.findByRole("heading", { name: /account settings/i });
        expect(screen.getByRole("button", { name: /remove photo/i })).toBeInTheDocument();
      });

      it("should not display remove photo button when user has default avatar", async () => {
        const mockData = {
          user: {
            id: testUserId,
            email: testUserEmail.toLowerCase(),
            username: testUsername,
            hasPassword: true,
            oauthAccounts: [],
            photoUrl: null,
          },
          notifications: { pushSubscribed: false },
      };

        const Stub = createTestRoutesStub([
          {
            path: "/account/settings",
            Component: AccountSettings,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/account/settings"]} />);

        await screen.findByRole("heading", { name: /account settings/i });
        expect(screen.queryByRole("button", { name: /remove photo/i })).not.toBeInTheDocument();
      });

      it("should have file input for photo upload (hidden, triggered by button)", async () => {
        const mockData = {
          user: {
            id: testUserId,
            email: testUserEmail.toLowerCase(),
            username: testUsername,
            hasPassword: true,
            oauthAccounts: [],
            photoUrl: null,
          },
          notifications: { pushSubscribed: false },
      };

        const Stub = createTestRoutesStub([
          {
            path: "/account/settings",
            Component: AccountSettings,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/account/settings"]} />);

        await screen.findByRole("heading", { name: /account settings/i });
        const profilePhotoSection = screen.getByTestId("profile-photo-section");

        // File input should exist (may be hidden)
        const fileInput = profilePhotoSection.querySelector('input[type="file"]');
        expect(fileInput).toBeInTheDocument();
        expect(fileInput).toHaveAttribute("accept", expect.stringMatching(/image/i));
      });

      it("should trigger hidden file input click when upload button is clicked", async () => {
        const user = userEvent.setup();
        const mockData = {
          user: {
            id: testUserId,
            email: testUserEmail.toLowerCase(),
            username: testUsername,
            hasPassword: true,
            oauthAccounts: [],
            photoUrl: null,
          },
          notifications: { pushSubscribed: false },
      };

        const Stub = createTestRoutesStub([
          {
            path: "/account/settings",
            Component: AccountSettings,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/account/settings"]} />);

        await screen.findByRole("heading", { name: /account settings/i });

        const profilePhotoSection = screen.getByTestId("profile-photo-section");
        const fileInput = profilePhotoSection.querySelector(
          'input[type="file"]'
        ) as HTMLInputElement;

        // Mock the click method to verify it gets called
        const clickSpy = vi.spyOn(fileInput, "click");

        const uploadButton = screen.getByRole("button", { name: /upload photo/i });
        await user.click(uploadButton);

        expect(clickSpy).toHaveBeenCalled();
        clickSpy.mockRestore();
      });

      it("should auto-submit form when file is selected", async () => {
        const user = userEvent.setup();
        const mockData = {
          user: {
            id: testUserId,
            email: testUserEmail.toLowerCase(),
            username: testUsername,
            hasPassword: true,
            oauthAccounts: [],
            photoUrl: null,
          },
          notifications: { pushSubscribed: false },
      };

        let actionCalled = false;
        const Stub = createTestRoutesStub([
          {
            path: "/account/settings",
            Component: AccountSettings,
            loader: () => mockData,
            action: async () => {
              actionCalled = true;
              return { success: true, photoUrl: "https://example.com/new-photo.jpg" };
            },
          },
        ]);

        render(<Stub initialEntries={["/account/settings"]} />);

        await screen.findByRole("heading", { name: /account settings/i });

        const profilePhotoSection = screen.getByTestId("profile-photo-section");
        const fileInput = profilePhotoSection.querySelector(
          'input[type="file"]'
        ) as HTMLInputElement;

        // Create a mock file and simulate file selection
        const mockFile = new File(["fake image data"], "test-photo.jpg", {
          type: "image/jpeg",
        });

        await user.upload(fileInput, mockFile);

        // The form should have been submitted (action called)
        expect(actionCalled).toBe(true);
      });

      it("should not auto-submit form when file selection is cancelled (no file selected)", async () => {
        const mockData = {
          user: {
            id: testUserId,
            email: testUserEmail.toLowerCase(),
            username: testUsername,
            hasPassword: true,
            oauthAccounts: [],
            photoUrl: null,
          },
          notifications: { pushSubscribed: false },
      };

        let actionCalled = false;
        const Stub = createTestRoutesStub([
          {
            path: "/account/settings",
            Component: AccountSettings,
            loader: () => mockData,
            action: async () => {
              actionCalled = true;
              return { success: true, photoUrl: "https://example.com/new-photo.jpg" };
            },
          },
        ]);

        render(<Stub initialEntries={["/account/settings"]} />);

        await screen.findByRole("heading", { name: /account settings/i });

        const profilePhotoSection = screen.getByTestId("profile-photo-section");
        const fileInput = profilePhotoSection.querySelector(
          'input[type="file"]'
        ) as HTMLInputElement;

        // Simulate a change event with no file selected (e.g., user cancelled the file dialog)
        // We directly dispatch a change event with empty files
        const changeEvent = new Event("change", { bubbles: true });
        Object.defineProperty(changeEvent, "currentTarget", {
          value: fileInput,
          writable: false,
        });
        // Files is already empty by default on the input
        fileInput.dispatchEvent(changeEvent);

        // The form should NOT have been submitted (action not called)
        expect(actionCalled).toBe(false);
      });
    });

    describe("action - photo upload", () => {
      it("should successfully upload a photo", async () => {
        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new UndiciFormData();
        formData.append("intent", "uploadPhoto");
        // Simulate file upload with a mock file
        const mockFile = new File(["fake image data"], "test-photo.jpg", { type: "image/jpeg" });
        formData.append("photo", mockFile);

        const headers = new Headers();
        headers.set("Cookie", cookieValue);

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: formData,
          duplex: "half",
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(true);
        expect(result.photoUrl).toBeDefined();
        expect(typeof result.photoUrl).toBe("string");
      });

      it("should return error when no photo file is provided", async () => {
        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "uploadPhoto");
        // No photo file attached

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(false);
        expect(result.error).toBe("no_file");
        expect(result.message).toContain("photo");
      });

      it("should return error when file is not an image", async () => {
        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new UndiciFormData();
        formData.append("intent", "uploadPhoto");
        // Simulate non-image file
        const mockFile = new File(["fake text data"], "test-file.txt", { type: "text/plain" });
        formData.append("photo", mockFile);

        const headers = new Headers();
        headers.set("Cookie", cookieValue);

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: formData,
          duplex: "half",
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(false);
        expect(result.error).toBe("invalid_file_type");
        expect(result.message).toContain("image");
      });

      it("should reject SVG profile photos even though they are image files", async () => {
        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new UndiciFormData();
        formData.append("intent", "uploadPhoto");
        formData.append(
          "photo",
          new File(["<svg><script>alert(1)</script></svg>"], "avatar.svg", { type: "image/svg+xml" })
        );

        const headers = new Headers();
        headers.set("Cookie", cookieValue);

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: formData,
          duplex: "half",
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(false);
        expect(result.error).toBe("invalid_file_type");
        expect(result.message).toContain("image");
      });

      it("should return error when file is too large", async () => {
        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new UndiciFormData();
        formData.append("intent", "uploadPhoto");
        // Simulate a file larger than 5MB (simulated via size property in test)
        // Note: actual file creation would be expensive, so we'll check the implementation handles size
        const largeFileData = new Uint8Array(6 * 1024 * 1024); // 6MB
        const mockFile = new File([largeFileData], "large-photo.jpg", { type: "image/jpeg" });
        formData.append("photo", mockFile);

        const headers = new Headers();
        headers.set("Cookie", cookieValue);

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: formData,
          duplex: "half",
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(false);
        expect(result.error).toBe("file_too_large");
        expect(result.message).toContain("5MB");
      });

      it("should update user photoUrl in database after successful upload", async () => {
        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new UndiciFormData();
        formData.append("intent", "uploadPhoto");
        const mockFile = new File(["fake image data"], "test-photo.jpg", { type: "image/jpeg" });
        formData.append("photo", mockFile);

        const headers = new Headers();
        headers.set("Cookie", cookieValue);

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: formData,
          duplex: "half",
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(true);

        // Verify photoUrl was updated in database
        const updatedUser = await db.user.findUnique({ where: { id: testUserId } });
        expect(updatedUser?.photoUrl).toBe(result.photoUrl);
      });
    });

    describe("action - photo removal", () => {
      it("should successfully remove photo and reset to default", async () => {
        // First, set a custom photo
        await db.user.update({
          where: { id: testUserId },
          data: { photoUrl: "https://example.com/custom-photo.jpg" },
        });

        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "removePhoto");

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(true);

        // Verify photoUrl was reset to null in database
        const updatedUser = await db.user.findUnique({ where: { id: testUserId } });
        expect(updatedUser?.photoUrl).toBeNull();
      });

      it("should return success even if user already has no photo", async () => {
        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "removePhoto");

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(true);
      });
    });

    describe("action - photo change (replace existing)", () => {
      it("should successfully replace existing photo with new one", async () => {
        // First, set a custom photo
        await db.user.update({
          where: { id: testUserId },
          data: { photoUrl: "https://example.com/old-photo.jpg" },
        });

        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new UndiciFormData();
        formData.append("intent", "uploadPhoto");
        const mockFile = new File(["new image data"], "new-photo.png", { type: "image/png" });
        formData.append("photo", mockFile);

        const headers = new Headers();
        headers.set("Cookie", cookieValue);

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: formData,
          duplex: "half",
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(true);

        // Verify photoUrl was changed to a new URL
        const updatedUser = await db.user.findUnique({ where: { id: testUserId } });
        expect(updatedUser?.photoUrl).not.toBe("https://example.com/old-photo.jpg");
        expect(updatedUser?.photoUrl).toBe(result.photoUrl);
      });
    });

    describe("action - photo upload with R2", () => {
      it("should upload photo to R2 when bucket is available", async () => {
        const mockR2Bucket = {
          put: vi.fn().mockResolvedValue(undefined),
        };

        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new UndiciFormData();
        formData.append("intent", "uploadPhoto");
        const mockFile = new File(["fake image data"], "test-photo.jpg", { type: "image/jpeg" });
        formData.append("photo", mockFile);

        const headers = new Headers();
        headers.set("Cookie", cookieValue);

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: formData,
          duplex: "half",
        });

        const result = await action({
          request,
          context: { cloudflare: { env: { PHOTOS: mockR2Bucket } } },
          params: {},
        } as any);

        expect(result.success).toBe(true);
        expect(result.photoUrl).toMatch(/^\/photos\/profiles\//);
        expect(result.photoUrl).toMatch(/\.jpg$/);
        expect(mockR2Bucket.put).toHaveBeenCalled();

        // Verify R2 put was called with correct params
        const putCallArgs = mockR2Bucket.put.mock.calls[0];
        expect(putCallArgs[0]).toMatch(/^profiles\/[^/]+\/\d+-[a-f0-9-]+\.jpg$/);
        expect(putCallArgs[2]).toEqual({ httpMetadata: { contentType: "image/jpeg" } });
      });

      it("should extract correct extension from filename", async () => {
        const mockR2Bucket = {
          put: vi.fn().mockResolvedValue(undefined),
        };

        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new UndiciFormData();
        formData.append("intent", "uploadPhoto");
        const mockFile = new File(["fake image data"], "test-photo.png", { type: "image/png" });
        formData.append("photo", mockFile);

        const headers = new Headers();
        headers.set("Cookie", cookieValue);

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: formData,
          duplex: "half",
        });

        const result = await action({
          request,
          context: { cloudflare: { env: { PHOTOS: mockR2Bucket } } },
          params: {},
        } as any);

        expect(result.success).toBe(true);
        expect(result.photoUrl).toMatch(/\.png$/);
      });

      it("should default to jpg when file extension is empty", async () => {
        const mockR2Bucket = {
          put: vi.fn().mockResolvedValue(undefined),
        };

        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new UndiciFormData();
        formData.append("intent", "uploadPhoto");
        // File ending with a dot - split('.').pop() returns empty string, triggering 'jpg' fallback
        const mockFile = new File(["fake image data"], "photo.", { type: "image/jpeg" });
        formData.append("photo", mockFile);

        const headers = new Headers();
        headers.set("Cookie", cookieValue);

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: formData,
          duplex: "half",
        });

        const result = await action({
          request,
          context: { cloudflare: { env: { PHOTOS: mockR2Bucket } } },
          params: {},
        } as any);

        expect(result.success).toBe(true);
        // Should fall back to 'jpg' since split('.').pop() returns empty string
        expect(result.photoUrl).toMatch(/\.jpg$/);
      });
    });

    describe("action - photo removal with R2", () => {
      it("should delete photo from R2 when removing an R2-stored photo", async () => {
        const mockR2Bucket = {
          delete: vi.fn().mockResolvedValue(undefined),
        };

        // Set up user with an R2 photo URL
        await db.user.update({
          where: { id: testUserId },
          data: { photoUrl: "/photos/profiles/user123/1234567890.jpg" },
        });

        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "removePhoto");

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        const result = await action({
          request,
          context: { cloudflare: { env: { PHOTOS: mockR2Bucket } } },
          params: {},
        } as any);

        expect(result.success).toBe(true);
        expect(mockR2Bucket.delete).toHaveBeenCalledWith("profiles/user123/1234567890.jpg");

        // Verify photoUrl was reset to null in database
        const updatedUser = await db.user.findUnique({ where: { id: testUserId } });
        expect(updatedUser?.photoUrl).toBeNull();
      });

      it("should not attempt R2 delete when photo URL is not an R2 path", async () => {
        const mockR2Bucket = {
          delete: vi.fn().mockResolvedValue(undefined),
        };

        // Set up user with a non-R2 photo URL (base64 or external URL)
        await db.user.update({
          where: { id: testUserId },
          data: { photoUrl: "https://example.com/external-photo.jpg" },
        });

        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "removePhoto");

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        const result = await action({
          request,
          context: { cloudflare: { env: { PHOTOS: mockR2Bucket } } },
          params: {},
        } as any);

        expect(result.success).toBe(true);
        // Should NOT have called R2 delete since it's not an R2 path
        expect(mockR2Bucket.delete).not.toHaveBeenCalled();
      });

      it("should skip R2 delete when bucket is not available but photo URL is R2 path", async () => {
        // Set up user with an R2 photo URL
        await db.user.update({
          where: { id: testUserId },
          data: { photoUrl: "/photos/profiles/user123/1234567890.jpg" },
        });

        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "removePhoto");

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        // Call without R2 bucket (simulating local dev)
        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(true);

        // Verify photoUrl was reset to null in database (even though R2 delete didn't happen)
        const updatedUser = await db.user.findUnique({ where: { id: testUserId } });
        expect(updatedUser?.photoUrl).toBeNull();
      });
    });
  });

  describe("OAuth management", () => {
    describe("action - unlink OAuth account", () => {
      it("should successfully unlink OAuth account when user has password", async () => {
        // User already has password from beforeEach setup
        // Add an OAuth account to unlink
        await db.oAuth.create({
          data: {
            provider: "google",
            providerUserId: "google-" + faker.string.alphanumeric(10),
            providerUsername: "testuser@gmail.com",
            userId: testUserId,
          },
        });

        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "unlinkOAuth");
        formData.append("provider", "google");

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(true);

        // Verify OAuth account was deleted
        const oauthAccounts = await db.oAuth.findMany({ where: { userId: testUserId } });
        expect(oauthAccounts).toHaveLength(0);
      });

      it("should successfully unlink OAuth account when user has another OAuth provider linked", async () => {
        // Create OAuth-only user (no password)
        const oauthEmail = faker.internet.email();
        const oauthUsername = faker.internet.username() + "_" + faker.string.alphanumeric(8);
        const oauthUser = await db.user.create({
          data: {
            email: oauthEmail.toLowerCase(),
            username: oauthUsername,
            hashedPassword: null,
            salt: null,
          },
        });

        // Add two OAuth accounts
        await db.oAuth.create({
          data: {
            provider: "google",
            providerUserId: "google-" + faker.string.alphanumeric(10),
            providerUsername: "testuser@gmail.com",
            userId: oauthUser.id,
          },
        });
        await db.oAuth.create({
          data: {
            provider: "apple",
            providerUserId: "apple-" + faker.string.alphanumeric(10),
            providerUsername: "Apple User",
            userId: oauthUser.id,
          },
        });

        const session = await sessionStorage.getSession();
        session.set("userId", oauthUser.id);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "unlinkOAuth");
        formData.append("provider", "google");

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(true);

        // Verify only Google was unlinked, Apple remains
        const oauthAccounts = await db.oAuth.findMany({ where: { userId: oauthUser.id } });
        expect(oauthAccounts).toHaveLength(1);
        expect(oauthAccounts[0].provider).toBe("apple");
      });

      it("should block unlink when OAuth is the only auth method (no password)", async () => {
        // Create OAuth-only user (no password)
        const oauthEmail = faker.internet.email();
        const oauthUsername = faker.internet.username() + "_" + faker.string.alphanumeric(8);
        const oauthUser = await db.user.create({
          data: {
            email: oauthEmail.toLowerCase(),
            username: oauthUsername,
            hashedPassword: null,
            salt: null,
          },
        });

        // Add only one OAuth account - this is their only way to log in
        await db.oAuth.create({
          data: {
            provider: "google",
            providerUserId: "google-" + faker.string.alphanumeric(10),
            providerUsername: "testuser@gmail.com",
            userId: oauthUser.id,
          },
        });

        const session = await sessionStorage.getSession();
        session.set("userId", oauthUser.id);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "unlinkOAuth");
        formData.append("provider", "google");

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(false);
        expect(result.error).toBe("last_auth_method");
        expect(result.message).toContain("last");

        // Verify OAuth account was NOT deleted
        const oauthAccounts = await db.oAuth.findMany({ where: { userId: oauthUser.id } });
        expect(oauthAccounts).toHaveLength(1);
      });

      it("should return error when trying to unlink non-existent OAuth provider", async () => {
        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "unlinkOAuth");
        formData.append("provider", "google"); // User doesn't have Google linked

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(false);
        expect(result.error).toBe("provider_not_linked");
      });

      it("should return error when provider name is invalid", async () => {
        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "unlinkOAuth");
        formData.append("provider", "invalid_provider");

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(false);
        expect(result.error).toBe("invalid_provider");
      });

      it("should return error when provider is not specified", async () => {
        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "unlinkOAuth");
        // provider not specified

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(false);
        expect(result.error).toBe("invalid_provider");
      });
    });

    describe("action - link OAuth account", () => {
      it("should redirect to OAuth provider for linking", async () => {
        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "linkOAuth");
        formData.append("provider", "google");

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        await expect(
          action({
            request,
            context: { cloudflare: { env: null } },
            params: {},
          } as any)
        ).rejects.toSatisfy((error: any) => {
          expect(error).toBeInstanceOf(Response);
          expect(error.status).toBe(302);
          // Should redirect to OAuth initiation endpoint
          expect(error.headers.get("Location")).toContain("/auth/google");
          return true;
        });
      });

      it("should redirect to Apple OAuth for Apple provider", async () => {
        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "linkOAuth");
        formData.append("provider", "apple");

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        await expect(
          action({
            request,
            context: { cloudflare: { env: null } },
            params: {},
          } as any)
        ).rejects.toSatisfy((error: any) => {
          expect(error).toBeInstanceOf(Response);
          expect(error.status).toBe(302);
          expect(error.headers.get("Location")).toContain("/auth/apple");
          return true;
        });
      });

      it("should redirect to GitHub OAuth for GitHub provider", async () => {
        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "linkOAuth");
        formData.append("provider", "github");

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        await expect(
          action({
            request,
            context: { cloudflare: { env: null } },
            params: {},
          } as any)
        ).rejects.toSatisfy((error: any) => {
          expect(error).toBeInstanceOf(Response);
          expect(error.status).toBe(302);
          expect(error.headers.get("Location")).toContain("/auth/github");
          return true;
        });
      });

      it("should return error when trying to link already linked provider", async () => {
        // Add Google OAuth account to user
        await db.oAuth.create({
          data: {
            provider: "google",
            providerUserId: "google-" + faker.string.alphanumeric(10),
            providerUsername: "testuser@gmail.com",
            userId: testUserId,
          },
        });

        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "linkOAuth");
        formData.append("provider", "google");

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(false);
        expect(result.error).toBe("provider_already_linked");
      });

      it("should return error for invalid provider when linking", async () => {
        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "linkOAuth");
        formData.append("provider", "facebook"); // Not a valid provider

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(false);
        expect(result.error).toBe("invalid_provider");
      });
    });

    describe("component - OAuth interaction", () => {
      it("should show confirmation dialog when unlink button is clicked", async () => {
        const user = userEvent.setup();
        const mockData = {
          user: {
            id: testUserId,
            email: testUserEmail.toLowerCase(),
            username: testUsername,
            hasPassword: true,
            oauthAccounts: [{ provider: "google", providerUsername: "testuser@gmail.com" }],
            photoUrl: null,
          },
          notifications: { pushSubscribed: false },
      };

        const Stub = createTestRoutesStub([
          {
            path: "/account/settings",
            Component: AccountSettings,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/account/settings"]} />);

        await screen.findByRole("heading", { name: /account settings/i });
        const unlinkButton = screen.getByRole("button", { name: /unlink google/i });
        await user.click(unlinkButton);

        // Should show confirmation dialog
        expect(await screen.findByText(/are you sure/i)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /confirm/i })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
      });

      it("should close confirmation dialog when cancel is clicked", async () => {
        const user = userEvent.setup();
        const mockData = {
          user: {
            id: testUserId,
            email: testUserEmail.toLowerCase(),
            username: testUsername,
            hasPassword: true,
            oauthAccounts: [{ provider: "google", providerUsername: "testuser@gmail.com" }],
            photoUrl: null,
          },
          notifications: { pushSubscribed: false },
      };

        const Stub = createTestRoutesStub([
          {
            path: "/account/settings",
            Component: AccountSettings,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/account/settings"]} />);

        await screen.findByRole("heading", { name: /account settings/i });
        const unlinkButton = screen.getByRole("button", { name: /unlink google/i });
        await user.click(unlinkButton);

        // Confirmation dialog appears
        expect(await screen.findByText(/are you sure/i)).toBeInTheDocument();

        // Click cancel
        const cancelButton = screen.getByRole("button", { name: /cancel/i });
        await user.click(cancelButton);

        // Dialog should be closed
        expect(screen.queryByText(/are you sure/i)).not.toBeInTheDocument();
      });

      it("should display warning when OAuth is the last auth method", async () => {
        const mockData = {
          user: {
            id: testUserId,
            email: testUserEmail.toLowerCase(),
            username: testUsername,
            hasPassword: false, // No password
            oauthAccounts: [{ provider: "google", providerUsername: "testuser@gmail.com" }], // Only one OAuth
            photoUrl: null,
          },
          notifications: { pushSubscribed: false },
      };

        const Stub = createTestRoutesStub([
          {
            path: "/account/settings",
            Component: AccountSettings,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/account/settings"]} />);

        await screen.findByRole("heading", { name: /account settings/i });

        // Should show warning or disable unlink button
        const unlinkButton = screen.getByRole("button", { name: /unlink google/i });
        expect(unlinkButton).toBeDisabled();
      });

      it("should display warning message explaining why unlink is disabled", async () => {
        const mockData = {
          user: {
            id: testUserId,
            email: testUserEmail.toLowerCase(),
            username: testUsername,
            hasPassword: false, // No password
            oauthAccounts: [{ provider: "google", providerUsername: "testuser@gmail.com" }], // Only one OAuth
            photoUrl: null,
          },
          notifications: { pushSubscribed: false },
      };

        const Stub = createTestRoutesStub([
          {
            path: "/account/settings",
            Component: AccountSettings,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/account/settings"]} />);

        await screen.findByRole("heading", { name: /account settings/i });

        // Should show explanation text about needing at least one auth method
        expect(
          screen.getByText(/at least one|cannot unlink|set a password first/i)
        ).toBeInTheDocument();
      });

      it("should display error message after failed unlink attempt", async () => {
        const mockData = {
          user: {
            id: testUserId,
            email: testUserEmail.toLowerCase(),
            username: testUsername,
            hasPassword: true,
            oauthAccounts: [{ provider: "google", providerUsername: "testuser@gmail.com" }],
            photoUrl: null,
          },
          notifications: { pushSubscribed: false },
      };

        let actionResult = {
          success: false,
          error: "last_auth_method" as const,
          message: "Cannot unlink your last authentication method",
        };

        const Stub = createTestRoutesStub([
          {
            id: "account-settings",
            path: "/account/settings",
            Component: AccountSettings,
            loader: () => mockData,
            action: () => actionResult,
          },
        ]);

        render(
          <Stub
            initialEntries={["/account/settings"]}
            hydrationData={{
              loaderData: { "account-settings": mockData },
              actionData: { "account-settings": actionResult },
            }}
          />
        );

        await screen.findByRole("heading", { name: /account settings/i });

        // Error message should be displayed (using getAllByText since hydrationData provides it twice)
        const errorMessages = screen.getAllByText(/cannot unlink your last authentication method/i);
        expect(errorMessages.length).toBeGreaterThan(0);
      });

      it("should show success message after successful unlink", async () => {
        const mockData = {
          user: {
            id: testUserId,
            email: testUserEmail.toLowerCase(),
            username: testUsername,
            hasPassword: true,
            oauthAccounts: [], // After unlink, no OAuth accounts
            photoUrl: null,
          },
          notifications: { pushSubscribed: false },
      };

        let actionResult = {
          success: true,
          message: "Google account unlinked successfully",
        };

        const Stub = createTestRoutesStub([
          {
            id: "account-settings",
            path: "/account/settings",
            Component: AccountSettings,
            loader: () => mockData,
            action: () => actionResult,
          },
        ]);

        render(
          <Stub
            initialEntries={["/account/settings"]}
            hydrationData={{
              loaderData: { "account-settings": mockData },
              actionData: { "account-settings": actionResult },
            }}
          />
        );

        await screen.findByRole("heading", { name: /account settings/i });

        // Success message should be displayed
        expect(screen.getByText(/unlinked successfully/i)).toBeInTheDocument();
      });
    });

    describe("loader - OAuth available providers info", () => {
      it("should return list of available providers that can be linked", async () => {
        // User has Google linked
        await db.oAuth.create({
          data: {
            provider: "google",
            providerUserId: "google-" + faker.string.alphanumeric(10),
            providerUsername: "testuser@gmail.com",
            userId: testUserId,
          },
        });

        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const headers = new Headers();
        headers.set("Cookie", cookieValue);

        const request = new UndiciRequest("http://localhost:3000/account/settings", { headers });

        const result = await loader({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        // Should include info about which providers are available
        expect(result.user.oauthAccounts).toHaveLength(1);
        expect(result.user.oauthAccounts[0].provider).toBe("google");
      });

      it("should indicate whether user can unlink each provider safely", async () => {
        // OAuth-only user with single provider
        const oauthEmail = faker.internet.email();
        const oauthUsername = faker.internet.username() + "_" + faker.string.alphanumeric(8);
        const oauthUser = await db.user.create({
          data: {
            email: oauthEmail.toLowerCase(),
            username: oauthUsername,
            hashedPassword: null,
            salt: null,
          },
        });

        await db.oAuth.create({
          data: {
            provider: "google",
            providerUserId: "google-" + faker.string.alphanumeric(10),
            providerUsername: "testuser@gmail.com",
            userId: oauthUser.id,
          },
        });

        const session = await sessionStorage.getSession();
        session.set("userId", oauthUser.id);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const headers = new Headers();
        headers.set("Cookie", cookieValue);

        const request = new UndiciRequest("http://localhost:3000/account/settings", { headers });

        const result = await loader({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        // Loader should provide info to determine if unlink is allowed
        // hasPassword: false, oauthAccounts.length: 1 means can't unlink
        expect(result.user.hasPassword).toBe(false);
        expect(result.user.oauthAccounts).toHaveLength(1);
      });
    });
  });

  describe("Password management", () => {
    describe("action - change password", () => {
      it("should successfully change password with valid current and new password", async () => {
        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "changePassword");
        formData.append("currentPassword", "testPassword123");
        formData.append("newPassword", "newSecurePassword456!");
        formData.append("confirmPassword", "newSecurePassword456!");

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(true);
        expect(result.message).toContain("password");
      });

      it("should return error when current password is incorrect", async () => {
        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "changePassword");
        formData.append("currentPassword", "wrongPassword123");
        formData.append("newPassword", "newSecurePassword456!");
        formData.append("confirmPassword", "newSecurePassword456!");

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(false);
        expect(result.error).toBe("invalid_current_password");
        expect(result.message).toContain("current password");
      });

      it("should return error when new password confirmation does not match", async () => {
        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "changePassword");
        formData.append("currentPassword", "testPassword123");
        formData.append("newPassword", "newSecurePassword456!");
        formData.append("confirmPassword", "differentPassword789!");

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(false);
        expect(result.error).toBe("password_mismatch");
        expect(result.message).toContain("match");
      });

      it("should return error when new password is too short (less than 8 characters)", async () => {
        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "changePassword");
        formData.append("currentPassword", "testPassword123");
        formData.append("newPassword", "short");
        formData.append("confirmPassword", "short");

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(false);
        expect(result.error).toBe("password_too_short");
        expect(result.message).toContain("8");
      });

      it("should return error when new password is empty", async () => {
        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "changePassword");
        formData.append("currentPassword", "testPassword123");
        formData.append("newPassword", "");
        formData.append("confirmPassword", "");

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(false);
        expect(result.error).toBe("password_required");
      });

      it("should return error when current password is empty", async () => {
        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "changePassword");
        formData.append("currentPassword", "");
        formData.append("newPassword", "newSecurePassword456!");
        formData.append("confirmPassword", "newSecurePassword456!");

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(false);
        expect(result.error).toBe("current_password_required");
      });

      it("should return error when trying to change password for OAuth-only user (no password set)", async () => {
        // Create OAuth-only user (no password)
        const oauthEmail = faker.internet.email();
        const oauthUsername = faker.internet.username() + "_" + faker.string.alphanumeric(8);
        const oauthUser = await db.user.create({
          data: {
            email: oauthEmail.toLowerCase(),
            username: oauthUsername,
            hashedPassword: null,
            salt: null,
          },
        });

        await db.oAuth.create({
          data: {
            provider: "google",
            providerUserId: "google-" + faker.string.alphanumeric(10),
            providerUsername: "testuser@gmail.com",
            userId: oauthUser.id,
          },
        });

        const session = await sessionStorage.getSession();
        session.set("userId", oauthUser.id);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "changePassword");
        formData.append("currentPassword", "somePassword123");
        formData.append("newPassword", "newSecurePassword456!");
        formData.append("confirmPassword", "newSecurePassword456!");

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(false);
        expect(result.error).toBe("no_password_set");
        expect(result.message).toContain("set a password");
      });

      it("should update hashed password in database after successful change", async () => {
        // Get the user's current hashed password
        const userBefore = await db.user.findUnique({
          where: { id: testUserId },
          select: { hashedPassword: true },
        });

        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "changePassword");
        formData.append("currentPassword", "testPassword123");
        formData.append("newPassword", "newSecurePassword456!");
        formData.append("confirmPassword", "newSecurePassword456!");

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(true);

        // Verify password hash changed in database
        const userAfter = await db.user.findUnique({
          where: { id: testUserId },
          select: { hashedPassword: true },
        });

        expect(userAfter?.hashedPassword).not.toBe(userBefore?.hashedPassword);
      });

      it("should return error when new password is the same as current password", async () => {
        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "changePassword");
        formData.append("currentPassword", "testPassword123");
        formData.append("newPassword", "testPassword123");
        formData.append("confirmPassword", "testPassword123");

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(false);
        expect(result.error).toBe("same_password");
        expect(result.message).toContain("different");
      });
    });

    describe("action - set password (for OAuth-only users)", () => {
      it("should successfully set password for OAuth-only user", async () => {
        // Create OAuth-only user (no password)
        const oauthEmail = faker.internet.email();
        const oauthUsername = faker.internet.username() + "_" + faker.string.alphanumeric(8);
        const oauthUser = await db.user.create({
          data: {
            email: oauthEmail.toLowerCase(),
            username: oauthUsername,
            hashedPassword: null,
            salt: null,
          },
        });

        await db.oAuth.create({
          data: {
            provider: "google",
            providerUserId: "google-" + faker.string.alphanumeric(10),
            providerUsername: "testuser@gmail.com",
            userId: oauthUser.id,
          },
        });

        const session = await sessionStorage.getSession();
        session.set("userId", oauthUser.id);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "setPassword");
        formData.append("newPassword", "newSecurePassword456!");
        formData.append("confirmPassword", "newSecurePassword456!");

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(true);
        expect(result.message).toContain("password");

        // Verify password was set in database
        const updatedUser = await db.user.findUnique({
          where: { id: oauthUser.id },
          select: { hashedPassword: true, salt: true },
        });

        expect(updatedUser?.hashedPassword).not.toBeNull();
        expect(updatedUser?.salt).not.toBeNull();
      });

      it("should return error when user already has a password set", async () => {
        // testUser already has a password from beforeEach
        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "setPassword");
        formData.append("newPassword", "newSecurePassword456!");
        formData.append("confirmPassword", "newSecurePassword456!");

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(false);
        expect(result.error).toBe("password_already_set");
        expect(result.message).toContain("already");
      });

      it("should return error when password confirmation does not match", async () => {
        // Create OAuth-only user
        const oauthEmail = faker.internet.email();
        const oauthUsername = faker.internet.username() + "_" + faker.string.alphanumeric(8);
        const oauthUser = await db.user.create({
          data: {
            email: oauthEmail.toLowerCase(),
            username: oauthUsername,
            hashedPassword: null,
            salt: null,
          },
        });

        await db.oAuth.create({
          data: {
            provider: "apple",
            providerUserId: "apple-" + faker.string.alphanumeric(10),
            providerUsername: "Apple User",
            userId: oauthUser.id,
          },
        });

        const session = await sessionStorage.getSession();
        session.set("userId", oauthUser.id);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "setPassword");
        formData.append("newPassword", "newSecurePassword456!");
        formData.append("confirmPassword", "differentPassword789!");

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(false);
        expect(result.error).toBe("password_mismatch");
      });

      it("should return error when password is too short", async () => {
        // Create OAuth-only user
        const oauthEmail = faker.internet.email();
        const oauthUsername = faker.internet.username() + "_" + faker.string.alphanumeric(8);
        const oauthUser = await db.user.create({
          data: {
            email: oauthEmail.toLowerCase(),
            username: oauthUsername,
            hashedPassword: null,
            salt: null,
          },
        });

        await db.oAuth.create({
          data: {
            provider: "google",
            providerUserId: "google-" + faker.string.alphanumeric(10),
            providerUsername: "testuser@gmail.com",
            userId: oauthUser.id,
          },
        });

        const session = await sessionStorage.getSession();
        session.set("userId", oauthUser.id);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "setPassword");
        formData.append("newPassword", "short");
        formData.append("confirmPassword", "short");

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(false);
        expect(result.error).toBe("password_too_short");
      });

      it("should return error when password is empty", async () => {
        // Create OAuth-only user
        const oauthEmail = faker.internet.email();
        const oauthUsername = faker.internet.username() + "_" + faker.string.alphanumeric(8);
        const oauthUser = await db.user.create({
          data: {
            email: oauthEmail.toLowerCase(),
            username: oauthUsername,
            hashedPassword: null,
            salt: null,
          },
        });

        await db.oAuth.create({
          data: {
            provider: "google",
            providerUserId: "google-" + faker.string.alphanumeric(10),
            providerUsername: "testuser@gmail.com",
            userId: oauthUser.id,
          },
        });

        const session = await sessionStorage.getSession();
        session.set("userId", oauthUser.id);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "setPassword");
        formData.append("newPassword", "");
        formData.append("confirmPassword", "");

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(false);
        expect(result.error).toBe("password_required");
      });
    });

    describe("action - remove password", () => {
      it("should successfully remove password when user has OAuth linked", async () => {
        // Add an OAuth account to the test user (who has a password)
        await db.oAuth.create({
          data: {
            provider: "google",
            providerUserId: "google-" + faker.string.alphanumeric(10),
            providerUsername: "testuser@gmail.com",
            userId: testUserId,
          },
        });

        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "removePassword");

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(true);
        expect(result.message).toContain("removed");

        // Verify password was removed in database
        const updatedUser = await db.user.findUnique({
          where: { id: testUserId },
          select: { hashedPassword: true, salt: true },
        });

        expect(updatedUser?.hashedPassword).toBeNull();
        expect(updatedUser?.salt).toBeNull();
      });

      it("should block password removal when password is the only auth method (no OAuth)", async () => {
        // testUser only has password, no OAuth
        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "removePassword");

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(false);
        expect(result.error).toBe("last_auth_method");
        expect(result.message).toContain("at least one");

        // Verify password was NOT removed
        const user = await db.user.findUnique({
          where: { id: testUserId },
          select: { hashedPassword: true },
        });

        expect(user?.hashedPassword).not.toBeNull();
      });

      it("should return error when user has no password to remove", async () => {
        // Create OAuth-only user (no password)
        const oauthEmail = faker.internet.email();
        const oauthUsername = faker.internet.username() + "_" + faker.string.alphanumeric(8);
        const oauthUser = await db.user.create({
          data: {
            email: oauthEmail.toLowerCase(),
            username: oauthUsername,
            hashedPassword: null,
            salt: null,
          },
        });

        await db.oAuth.create({
          data: {
            provider: "google",
            providerUserId: "google-" + faker.string.alphanumeric(10),
            providerUsername: "testuser@gmail.com",
            userId: oauthUser.id,
          },
        });

        const session = await sessionStorage.getSession();
        session.set("userId", oauthUser.id);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "removePassword");

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(false);
        expect(result.error).toBe("no_password_to_remove");
      });

      it("should require current password confirmation before removing password", async () => {
        // Add an OAuth account to the test user
        await db.oAuth.create({
          data: {
            provider: "apple",
            providerUserId: "apple-" + faker.string.alphanumeric(10),
            providerUsername: "Apple User",
            userId: testUserId,
          },
        });

        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "removePassword");
        formData.append("currentPassword", "wrongPassword");

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(false);
        expect(result.error).toBe("invalid_current_password");
      });
    });

    describe("component - password section UI", () => {
      it("should show change password form when user has password", async () => {
        const user = userEvent.setup();
        const mockData = {
          user: {
            id: testUserId,
            email: testUserEmail.toLowerCase(),
            username: testUsername,
            hasPassword: true,
            oauthAccounts: [],
            photoUrl: null,
          },
          notifications: { pushSubscribed: false },
      };

        const Stub = createTestRoutesStub([
          {
            path: "/account/settings",
            Component: AccountSettings,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/account/settings"]} />);

        await screen.findByRole("heading", { name: /account settings/i });

        // Click change password button
        const changePasswordBtn = screen.getByRole("button", { name: /change password/i });
        await user.click(changePasswordBtn);

        // Should show the password change form
        expect(screen.getByLabelText(/current password/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/confirm.*password/i)).toBeInTheDocument();
      });

      it("should show set password form when OAuth-only user clicks set password", async () => {
        const user = userEvent.setup();
        const mockData = {
          user: {
            id: testUserId,
            email: testUserEmail.toLowerCase(),
            username: testUsername,
            hasPassword: false,
            oauthAccounts: [{ provider: "google", providerUsername: "testuser@gmail.com" }],
            photoUrl: null,
          },
          notifications: { pushSubscribed: false },
      };

        const Stub = createTestRoutesStub([
          {
            path: "/account/settings",
            Component: AccountSettings,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/account/settings"]} />);

        await screen.findByRole("heading", { name: /account settings/i });

        // Click set password button
        const setPasswordBtn = screen.getByRole("button", { name: /set password/i });
        await user.click(setPasswordBtn);

        // Should show the password set form (no current password field)
        expect(screen.queryByLabelText(/current password/i)).not.toBeInTheDocument();
        expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/confirm.*password/i)).toBeInTheDocument();
      });

      it("should show remove password button when user has both password and OAuth", async () => {
        const mockData = {
          user: {
            id: testUserId,
            email: testUserEmail.toLowerCase(),
            username: testUsername,
            hasPassword: true,
            oauthAccounts: [{ provider: "google", providerUsername: "testuser@gmail.com" }],
            photoUrl: null,
          },
          notifications: { pushSubscribed: false },
      };

        const Stub = createTestRoutesStub([
          {
            path: "/account/settings",
            Component: AccountSettings,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/account/settings"]} />);

        await screen.findByRole("heading", { name: /account settings/i });
        expect(screen.getByRole("button", { name: /remove password/i })).toBeInTheDocument();
      });

      it("should not show remove password button when password is only auth method", async () => {
        const mockData = {
          user: {
            id: testUserId,
            email: testUserEmail.toLowerCase(),
            username: testUsername,
            hasPassword: true,
            oauthAccounts: [],
            photoUrl: null,
          },
          notifications: { pushSubscribed: false },
      };

        const Stub = createTestRoutesStub([
          {
            path: "/account/settings",
            Component: AccountSettings,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/account/settings"]} />);

        await screen.findByRole("heading", { name: /account settings/i });
        expect(screen.queryByRole("button", { name: /remove password/i })).not.toBeInTheDocument();
      });

      it("should display password validation errors inline", async () => {
        const mockData = {
          user: {
            id: testUserId,
            email: testUserEmail.toLowerCase(),
            username: testUsername,
            hasPassword: true,
            oauthAccounts: [],
            photoUrl: null,
          },
          notifications: { pushSubscribed: false },
      };

        const actionResult = {
          success: false,
          error: "password_too_short" as const,
          message: "Password must be at least 8 characters",
          fieldErrors: {
            newPassword: "Password must be at least 8 characters",
          },
        };

        const Stub = createTestRoutesStub([
          {
            id: "account-settings",
            path: "/account/settings",
            Component: AccountSettings,
            loader: () => mockData,
            action: () => actionResult,
          },
        ]);

        render(
          <Stub
            initialEntries={["/account/settings"]}
            hydrationData={{
              loaderData: { "account-settings": mockData },
              actionData: { "account-settings": actionResult },
            }}
          />
        );

        await screen.findByRole("heading", { name: /account settings/i });

        // Error message should be displayed (may appear multiple times due to field error + hint)
        const errorMessages = screen.getAllByText(/at least 8 characters/i);
        expect(errorMessages.length).toBeGreaterThanOrEqual(1);
      });

      it("should show success message after password change", async () => {
        const mockData = {
          user: {
            id: testUserId,
            email: testUserEmail.toLowerCase(),
            username: testUsername,
            hasPassword: true,
            oauthAccounts: [],
            photoUrl: null,
          },
          notifications: { pushSubscribed: false },
      };

        const actionResult = {
          success: true,
          message: "Password changed successfully",
        };

        const Stub = createTestRoutesStub([
          {
            id: "account-settings",
            path: "/account/settings",
            Component: AccountSettings,
            loader: () => mockData,
            action: () => actionResult,
          },
        ]);

        render(
          <Stub
            initialEntries={["/account/settings"]}
            hydrationData={{
              loaderData: { "account-settings": mockData },
              actionData: { "account-settings": actionResult },
            }}
          />
        );

        await screen.findByRole("heading", { name: /account settings/i });

        // Success message should be displayed
        expect(screen.getByText(/password changed successfully/i)).toBeInTheDocument();
      });

      it("should close password form when cancel is clicked", async () => {
        const user = userEvent.setup();
        const mockData = {
          user: {
            id: testUserId,
            email: testUserEmail.toLowerCase(),
            username: testUsername,
            hasPassword: true,
            oauthAccounts: [],
            photoUrl: null,
          },
          notifications: { pushSubscribed: false },
      };

        const Stub = createTestRoutesStub([
          {
            path: "/account/settings",
            Component: AccountSettings,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/account/settings"]} />);

        await screen.findByRole("heading", { name: /account settings/i });

        // Open password change form
        const changePasswordBtn = screen.getByRole("button", { name: /change password/i });
        await user.click(changePasswordBtn);

        // Form should be visible
        expect(screen.getByLabelText(/current password/i)).toBeInTheDocument();

        // Click cancel
        const cancelBtn = screen.getByRole("button", { name: /cancel/i });
        await user.click(cancelBtn);

        // Form should be closed
        expect(screen.queryByLabelText(/current password/i)).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: /change password/i })).toBeInTheDocument();
      });

      it("should show confirmation dialog before removing password", async () => {
        const user = userEvent.setup();
        const mockData = {
          user: {
            id: testUserId,
            email: testUserEmail.toLowerCase(),
            username: testUsername,
            hasPassword: true,
            oauthAccounts: [{ provider: "google", providerUsername: "testuser@gmail.com" }],
            photoUrl: null,
          },
          notifications: { pushSubscribed: false },
      };

        const Stub = createTestRoutesStub([
          {
            path: "/account/settings",
            Component: AccountSettings,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/account/settings"]} />);

        await screen.findByRole("heading", { name: /account settings/i });

        // Click remove password button
        const removePasswordBtn = screen.getByRole("button", { name: /remove password/i });
        await user.click(removePasswordBtn);

        // Should show confirmation dialog
        expect(await screen.findByText(/are you sure/i)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /confirm/i })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
      });

      it("should close remove password confirmation when cancel is clicked", async () => {
        const user = userEvent.setup();
        const mockData = {
          user: {
            id: testUserId,
            email: testUserEmail.toLowerCase(),
            username: testUsername,
            hasPassword: true,
            oauthAccounts: [{ provider: "google", providerUsername: "testuser@gmail.com" }],
            photoUrl: null,
          },
          notifications: { pushSubscribed: false },
      };

        const Stub = createTestRoutesStub([
          {
            path: "/account/settings",
            Component: AccountSettings,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/account/settings"]} />);

        await screen.findByRole("heading", { name: /account settings/i });

        // Click remove password button
        const removePasswordBtn = screen.getByRole("button", { name: /remove password/i });
        await user.click(removePasswordBtn);

        // Confirmation dialog should be visible
        expect(await screen.findByText(/are you sure/i)).toBeInTheDocument();

        // Click cancel
        const cancelBtn = screen.getByRole("button", { name: /cancel/i });
        await user.click(cancelBtn);

        // Confirmation dialog should be closed, back to normal view
        expect(screen.queryByText(/are you sure/i)).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: /remove password/i })).toBeInTheDocument();
      });

      it("should close set password form when cancel is clicked (OAuth-only user)", async () => {
        const user = userEvent.setup();
        const mockData = {
          user: {
            id: testUserId,
            email: testUserEmail.toLowerCase(),
            username: testUsername,
            hasPassword: false,
            oauthAccounts: [{ provider: "google", providerUsername: "testuser@gmail.com" }],
            photoUrl: null,
          },
          notifications: { pushSubscribed: false },
      };

        const Stub = createTestRoutesStub([
          {
            path: "/account/settings",
            Component: AccountSettings,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/account/settings"]} />);

        await screen.findByRole("heading", { name: /account settings/i });

        // Click set password button
        const setPasswordBtn = screen.getByRole("button", { name: /set password/i });
        await user.click(setPasswordBtn);

        // Form should be visible
        expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();

        // Click cancel
        const cancelBtn = screen.getByRole("button", { name: /cancel/i });
        await user.click(cancelBtn);

        // Form should be closed, back to "Set Password" button
        expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: /set password/i })).toBeInTheDocument();
      });

      it("should display password strength indicator for new password", async () => {
        const user = userEvent.setup();
        const mockData = {
          user: {
            id: testUserId,
            email: testUserEmail.toLowerCase(),
            username: testUsername,
            hasPassword: true,
            oauthAccounts: [],
            photoUrl: null,
          },
          notifications: { pushSubscribed: false },
      };

        const Stub = createTestRoutesStub([
          {
            path: "/account/settings",
            Component: AccountSettings,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/account/settings"]} />);

        await screen.findByRole("heading", { name: /account settings/i });

        // Open password change form
        const changePasswordBtn = screen.getByRole("button", { name: /change password/i });
        await user.click(changePasswordBtn);

        // Should show password requirements hint
        expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
      });
    });

    describe("at least one auth method rule", () => {
      it("should prevent both password removal and OAuth unlink if it would leave user with no auth", async () => {
        // User with only password (no OAuth) - cannot remove password
        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "removePassword");
        formData.append("currentPassword", "testPassword123");

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(false);
        expect(result.error).toBe("last_auth_method");
      });

      it("should allow password removal if user has multiple OAuth providers", async () => {
        // Add two OAuth providers to user
        await db.oAuth.create({
          data: {
            provider: "google",
            providerUserId: "google-" + faker.string.alphanumeric(10),
            providerUsername: "testuser@gmail.com",
            userId: testUserId,
          },
        });

        await db.oAuth.create({
          data: {
            provider: "apple",
            providerUserId: "apple-" + faker.string.alphanumeric(10),
            providerUsername: "Apple User",
            userId: testUserId,
          },
        });

        const session = await sessionStorage.getSession();
        session.set("userId", testUserId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];

        const formData = new FormData();
        formData.append("intent", "removePassword");
        formData.append("currentPassword", "testPassword123");

        const headers = new Headers();
        headers.set("Cookie", cookieValue);
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const request = new UndiciRequest("http://localhost:3000/account/settings", {
          method: "POST",
          headers,
          body: new URLSearchParams(formData as any).toString(),
        });

        const result = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(result.success).toBe(true);
      });

      it("should display appropriate UI warning when user has only one auth method", async () => {
        const mockData = {
          user: {
            id: testUserId,
            email: testUserEmail.toLowerCase(),
            username: testUsername,
            hasPassword: true,
            oauthAccounts: [],
            photoUrl: null,
          },
          notifications: { pushSubscribed: false },
      };

        const Stub = createTestRoutesStub([
          {
            path: "/account/settings",
            Component: AccountSettings,
            loader: () => mockData,
          },
        ]);

        render(<Stub initialEntries={["/account/settings"]} />);

        await screen.findByRole("heading", { name: /account settings/i });

        // Should not show remove password option
        expect(screen.queryByRole("button", { name: /remove password/i })).not.toBeInTheDocument();
      });
    });

    describe("field error display in forms", () => {
      it("should display email field error when editing user info with validation error", async () => {
        const user = userEvent.setup();
        const mockData = {
          user: {
            id: testUserId,
            email: testUserEmail.toLowerCase(),
            username: testUsername,
            hasPassword: true,
            oauthAccounts: [],
            photoUrl: null,
          },
          notifications: { pushSubscribed: false },
      };

        const actionResult = {
          success: false,
          error: "email_taken" as const,
          message: "Email is already in use",
          fieldErrors: {
            email: "This email is already taken",
          },
        };

        const Stub = createTestRoutesStub([
          {
            id: "account-settings",
            path: "/account/settings",
            Component: AccountSettings,
            loader: () => mockData,
            action: () => actionResult,
          },
        ]);

        render(<Stub initialEntries={["/account/settings"]} />);

        await screen.findByRole("heading", { name: /account settings/i });

        // Click edit to enter edit mode
        const editButton = screen.getByRole("button", { name: /edit/i });
        await user.click(editButton);

        // Submit the form to trigger validation error
        const saveButton = screen.getByRole("button", { name: /save/i });
        await user.click(saveButton);

        // Error should be displayed inline for email field
        expect(await screen.findByText(/this email is already taken/i)).toBeInTheDocument();
      });

      it("should display username field error when editing user info with validation error", async () => {
        const user = userEvent.setup();
        const mockData = {
          user: {
            id: testUserId,
            email: testUserEmail.toLowerCase(),
            username: testUsername,
            hasPassword: true,
            oauthAccounts: [],
            photoUrl: null,
          },
          notifications: { pushSubscribed: false },
      };

        const actionResult = {
          success: false,
          error: "username_taken" as const,
          message: "Username is already in use",
          fieldErrors: {
            username: "This username is already taken",
          },
        };

        const Stub = createTestRoutesStub([
          {
            id: "account-settings",
            path: "/account/settings",
            Component: AccountSettings,
            loader: () => mockData,
            action: () => actionResult,
          },
        ]);

        render(<Stub initialEntries={["/account/settings"]} />);

        await screen.findByRole("heading", { name: /account settings/i });

        // Click edit to enter edit mode
        const editButton = screen.getByRole("button", { name: /edit/i });
        await user.click(editButton);

        // Submit the form to trigger validation error
        const saveButton = screen.getByRole("button", { name: /save/i });
        await user.click(saveButton);

        // Error should be displayed inline for username field
        expect(await screen.findByText(/this username is already taken/i)).toBeInTheDocument();
      });

      it("should display newPassword field error in change password form", async () => {
        const mockData = {
          user: {
            id: testUserId,
            email: testUserEmail.toLowerCase(),
            username: testUsername,
            hasPassword: true,
            oauthAccounts: [],
            photoUrl: null,
          },
          notifications: { pushSubscribed: false },
      };

        const actionResult = {
          success: false,
          error: "password_too_short" as const,
          message: "Password must be at least 8 characters",
          fieldErrors: {
            newPassword: "Password must be at least 8 characters",
          },
        };

        const Stub = createTestRoutesStub([
          {
            id: "account-settings",
            path: "/account/settings",
            Component: AccountSettings,
            loader: () => mockData,
            action: () => actionResult,
          },
        ]);

        // Render with hydrationData to simulate state after form submission with error
        render(
          <Stub
            initialEntries={["/account/settings"]}
            hydrationData={{
              loaderData: { "account-settings": mockData },
              actionData: { "account-settings": actionResult },
            }}
          />
        );

        await screen.findByRole("heading", { name: /account settings/i });

        // Due to useEffect, form should automatically open when there are newPassword field errors
        // The form should be visible with the inline error
        expect(await screen.findByLabelText(/current password/i)).toBeInTheDocument();

        // Error should be displayed inline for newPassword field (in ErrorMessage component)
        const errorMessages = await screen.findAllByText(/password must be at least 8 characters/i);
        // There should be at least one - the field error, plus potentially the hint text
        expect(errorMessages.length).toBeGreaterThanOrEqual(1);
      });

      it("should display newPassword field error in set password form (OAuth-only user)", async () => {
        const mockData = {
          user: {
            id: testUserId,
            email: testUserEmail.toLowerCase(),
            username: testUsername,
            hasPassword: false,
            oauthAccounts: [{ provider: "google", providerUsername: "testuser@gmail.com" }],
            photoUrl: null,
          },
          notifications: { pushSubscribed: false },
      };

        const actionResult = {
          success: false,
          error: "password_too_short" as const,
          message: "Password must be at least 8 characters",
          fieldErrors: {
            newPassword: "Password must be at least 8 characters",
          },
        };

        const Stub = createTestRoutesStub([
          {
            id: "account-settings",
            path: "/account/settings",
            Component: AccountSettings,
            loader: () => mockData,
            action: () => actionResult,
          },
        ]);

        // Render with hydrationData to simulate state after form submission with error
        render(
          <Stub
            initialEntries={["/account/settings"]}
            hydrationData={{
              loaderData: { "account-settings": mockData },
              actionData: { "account-settings": actionResult },
            }}
          />
        );

        await screen.findByRole("heading", { name: /account settings/i });

        // Due to useEffect, form should automatically open when there are newPassword field errors
        // For OAuth-only user (hasPassword=false), form should be in "set" mode (no current password)
        expect(await screen.findByLabelText(/new password/i)).toBeInTheDocument();
        // Set password form doesn't have "current password" field
        expect(screen.queryByLabelText(/current password/i)).not.toBeInTheDocument();

        // Error should be displayed inline for newPassword field
        const errorMessages = await screen.findAllByText(/password must be at least 8 characters/i);
        expect(errorMessages.length).toBeGreaterThanOrEqual(1);
      });

      it("should display photo upload error message in ProfilePhotoUpload", async () => {
        const mockData = {
          user: {
            id: testUserId,
            email: testUserEmail.toLowerCase(),
            username: testUsername,
            hasPassword: true,
            oauthAccounts: [],
            photoUrl: null,
          },
          notifications: { pushSubscribed: false },
      };

        const actionResult = {
          success: false,
          error: "file_too_large" as const,
          message: "File size exceeds 5MB limit",
        };

        const Stub = createTestRoutesStub([
          {
            id: "account-settings",
            path: "/account/settings",
            Component: AccountSettings,
            loader: () => mockData,
            action: () => actionResult,
          },
        ]);

        render(
          <Stub
            initialEntries={["/account/settings"]}
            hydrationData={{
              loaderData: { "account-settings": mockData },
              actionData: { "account-settings": actionResult },
            }}
          />
        );

        await screen.findByRole("heading", { name: /account settings/i });

        // Error message appears in both global banner and photo section
        // We use getAllByText to verify at least one error message is displayed
        const errorMessages = screen.getAllByText(/file size exceeds 5mb limit/i);
        expect(errorMessages.length).toBeGreaterThanOrEqual(1);

        // Verify the error appears in the profile photo section specifically
        const photoSection = screen.getByTestId("profile-photo-section");
        expect(photoSection).toHaveTextContent(/file size exceeds 5mb limit/i);
      });
    });
  });
});
