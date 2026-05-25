import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Request as UndiciRequest } from "undici";
import { render, screen } from "@testing-library/react";
import { createTestRoutesStub } from "../utils";
import { db } from "~/lib/db.server";
import { loader, action } from "~/routes/signup";
import Signup from "~/routes/signup";
import { createUser } from "~/lib/auth.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { faker } from "@faker-js/faker";

// Helper to extract data from React Router's data() response
function extractResponseData(response: any): { data: any; status: number } {
  // React Router v7 data() returns DataWithResponseInit object with type, data, and init properties
  if (response && typeof response === "object" && response.type === "DataWithResponseInit") {
    return { data: response.data, status: response.init?.status || 200 };
  }
  // For regular Response objects (redirects)
  if (response instanceof Response) {
    return { data: null, status: response.status };
  }
  return { data: response, status: 200 };
}

describe("Signup Route", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("loader", () => {
    it("should return configured OAuth providers when user is not logged in", async () => {
      const request = new UndiciRequest("http://localhost:3000/signup");

      const result = await loader({
        request,
        context: {
          cloudflare: {
            env: {
              APPLE_CLIENT_ID: "apple-client",
              APPLE_TEAM_ID: "team",
              APPLE_KEY_ID: "key",
              APPLE_PRIVATE_KEY: "private-key",
            },
          },
        },
        params: {},
      } as any);

      expect(result).toEqual({ oauthProviders: ["apple"] });
    });

    it("should redirect when user is already logged in", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", "test-user-id");
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest("http://localhost:3000/signup", { headers });

      await expect(
        loader({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any)
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(Response);
        expect(error.status).toBe(302);
        expect(error.headers.get("Location")).toBe("/");
        return true;
      });
    });

    it("should return oauthError when present in URL search params", async () => {
      const request = new UndiciRequest("http://localhost:3000/signup?oauthError=account_exists");

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(result).toEqual({ oauthError: "account_exists", oauthProviders: [] });
    });
  });

  describe("action", () => {
    it("should return validation errors for invalid email", async () => {
      const formData = new FormData();
      formData.set("email", "invalid-email");
      formData.set("username", "testuser");
      formData.set("password", "password123");
      formData.set("confirmPassword", "password123");

      const request = new Request("http://localhost:3000/signup", {
        method: "POST",
        body: formData,
      });

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.email).toBe("Valid email is required");
    });

    it("should return validation errors for short username", async () => {
      const formData = new FormData();
      formData.set("email", "test@example.com");
      formData.set("username", "ab");
      formData.set("password", "password123");
      formData.set("confirmPassword", "password123");

      const request = new Request("http://localhost:3000/signup", {
        method: "POST",
        body: formData,
      });

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.username).toBe("Username must be at least 3 characters");
    });

    it("should return validation errors for short password", async () => {
      const formData = new FormData();
      formData.set("email", "test@example.com");
      formData.set("username", "testuser");
      formData.set("password", "short");
      formData.set("confirmPassword", "short");

      const request = new Request("http://localhost:3000/signup", {
        method: "POST",
        body: formData,
      });

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.password).toBe("Password must be at least 8 characters");
    });

    it("should return validation errors for mismatched passwords", async () => {
      const formData = new FormData();
      formData.set("email", "test@example.com");
      formData.set("username", "testuser");
      formData.set("password", "password123");
      formData.set("confirmPassword", "different123");

      const request = new Request("http://localhost:3000/signup", {
        method: "POST",
        body: formData,
      });

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.confirmPassword).toBe("Passwords do not match");
    });

    it("should return error if email already exists", async () => {
      const existingEmail = faker.internet.email();
      const username = faker.internet.username() + "_" + faker.string.alphanumeric(8);
      await createUser(db, existingEmail, username, "password123");

      const formData = new FormData();
      formData.set("email", existingEmail);
      formData.set("username", "newuser_" + faker.string.alphanumeric(8));
      formData.set("password", "password123");
      formData.set("confirmPassword", "password123");

      const request = new Request("http://localhost:3000/signup", {
        method: "POST",
        body: formData,
      });

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.email).toBe("An account with this email already exists");
    });

    it("should return error if username already exists", async () => {
      const existingUsername = "existinguser_" + faker.string.alphanumeric(8);
      await createUser(db, faker.internet.email(), existingUsername, "password123");

      const formData = new FormData();
      formData.set("email", faker.internet.email());
      formData.set("username", existingUsername);
      formData.set("password", "password123");
      formData.set("confirmPassword", "password123");

      const request = new Request("http://localhost:3000/signup", {
        method: "POST",
        body: formData,
      });

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.username).toBe("This username is already taken");
    });

    it("should create user and redirect on successful signup", async () => {
      const email = faker.internet.email();
      const username = faker.internet.username() + "_" + faker.string.alphanumeric(8);

      const formData = new FormData();
      formData.set("email", email);
      formData.set("username", username);
      formData.set("password", "password123");
      formData.set("confirmPassword", "password123");

      const request = new Request("http://localhost:3000/signup", {
        method: "POST",
        body: formData,
      });

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/recipes");
      expect(response.headers.get("Set-Cookie")).toBeDefined();

      // Verify user was created
      const user = await db.user.findUnique({
        where: { email: email.toLowerCase() },
      });
      expect(user).not.toBeNull();
      expect(user?.username).toBe(username);
    });

    it("should handle multiple validation errors at once", async () => {
      const formData = new FormData();
      formData.set("email", "");
      formData.set("username", "");
      formData.set("password", "");
      formData.set("confirmPassword", "different");

      const request = new Request("http://localhost:3000/signup", {
        method: "POST",
        body: formData,
      });

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.email).toBeDefined();
      expect(data.errors.username).toBeDefined();
      expect(data.errors.password).toBeDefined();
      expect(data.errors.confirmPassword).toBeDefined();
    });

    it("should skip email existence check when email format is invalid", async () => {
      // When email is invalid, we shouldn't check database for existing email
      const formData = new FormData();
      formData.set("email", "not-an-email");
      formData.set("username", "validuser");
      formData.set("password", "password123");
      formData.set("confirmPassword", "password123");

      const request = new Request("http://localhost:3000/signup", {
        method: "POST",
        body: formData,
      });

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.email).toBe("Valid email is required");
      // No "already exists" error because we didn't check database
      expect(data.errors.email).not.toBe("An account with this email already exists");
    });

    it("should skip username existence check when username is too short", async () => {
      // When username is too short, we shouldn't check database for existing username
      const formData = new FormData();
      formData.set("email", "test@example.com");
      formData.set("username", "ab");
      formData.set("password", "password123");
      formData.set("confirmPassword", "password123");

      const request = new Request("http://localhost:3000/signup", {
        method: "POST",
        body: formData,
      });

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.username).toBe("Username must be at least 3 characters");
      // No "already taken" error because we didn't check database
      expect(data.errors.username).not.toBe("This username is already taken");
    });

    it("should return error for missing email", async () => {
      const formData = new FormData();
      formData.set("email", "");
      formData.set("username", "testuser");
      formData.set("password", "password123");
      formData.set("confirmPassword", "password123");

      const request = new Request("http://localhost:3000/signup", {
        method: "POST",
        body: formData,
      });

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.email).toBe("Valid email is required");
    });

    it("should return error for missing username", async () => {
      const formData = new FormData();
      formData.set("email", "test@example.com");
      formData.set("username", "");
      formData.set("password", "password123");
      formData.set("confirmPassword", "password123");

      const request = new Request("http://localhost:3000/signup", {
        method: "POST",
        body: formData,
      });

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.username).toBe("Username must be at least 3 characters");
    });

    it("should return error for missing password", async () => {
      const formData = new FormData();
      formData.set("email", "test@example.com");
      formData.set("username", "testuser");
      formData.set("password", "");
      formData.set("confirmPassword", "");

      const request = new Request("http://localhost:3000/signup", {
        method: "POST",
        body: formData,
      });

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.password).toBe("Password must be at least 8 characters");
    });
  });

  describe("component", () => {
    it("should render signup form", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/signup",
          Component: Signup,
          loader: () => ({ oauthProviders: [] }),
        },
      ]);

      render(<Stub initialEntries={["/signup"]} />);

      expect(await screen.findByRole("heading", { name: "Sign Up" })).toBeInTheDocument();
      expect(screen.getByLabelText(/Email/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Username/)).toBeInTheDocument();
      expect(screen.getByLabelText("Password")).toBeInTheDocument();
      expect(screen.getByLabelText("Confirm Password")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Sign Up" })).toBeInTheDocument();
    });

    it("should have correct form field attributes", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/signup",
          Component: Signup,
          loader: () => ({ oauthProviders: [] }),
        },
      ]);

      render(<Stub initialEntries={["/signup"]} />);

      const emailInput = await screen.findByLabelText(/Email/);
      expect(emailInput).toHaveAttribute("type", "email");
      expect(emailInput).toHaveAttribute("name", "email");
      expect(emailInput).toBeRequired();

      const usernameInput = screen.getByLabelText(/Username/);
      expect(usernameInput).toHaveAttribute("type", "text");
      expect(usernameInput).toHaveAttribute("name", "username");
      expect(usernameInput).toBeRequired();
      expect(usernameInput).toHaveAttribute("minLength", "3");

      const passwordInput = screen.getByLabelText("Password");
      expect(passwordInput).toHaveAttribute("type", "password");
      expect(passwordInput).toHaveAttribute("name", "password");
      expect(passwordInput).toBeRequired();
      expect(passwordInput).toHaveAttribute("minLength", "8");

      const confirmPasswordInput = screen.getByLabelText("Confirm Password");
      expect(confirmPasswordInput).toHaveAttribute("type", "password");
      expect(confirmPasswordInput).toHaveAttribute("name", "confirmPassword");
      expect(confirmPasswordInput).toBeRequired();
    });

    it("should have login link", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/signup",
          Component: Signup,
          loader: () => ({ oauthProviders: [] }),
        },
      ]);

      render(<Stub initialEntries={["/signup"]} />);

      await screen.findByRole("heading", { name: "Sign Up" });
      expect(screen.getByText("Already have an account?")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
    });

    describe("OAuth buttons", () => {
      it("should render Google sign-up button", async () => {
        const Stub = createTestRoutesStub([
          {
            path: "/signup",
            Component: Signup,
            loader: () => ({ oauthProviders: ["google"] }),
          },
        ]);

        render(<Stub initialEntries={["/signup"]} />);

        await screen.findByRole("heading", { name: "Sign Up" });
        expect(screen.getByRole("button", { name: /continue with google/i })).toBeInTheDocument();
      });

      it("should render Apple sign-up button", async () => {
        const Stub = createTestRoutesStub([
          {
            path: "/signup",
            Component: Signup,
            loader: () => ({ oauthProviders: ["apple"] }),
          },
        ]);

        render(<Stub initialEntries={["/signup"]} />);

        await screen.findByRole("heading", { name: "Sign Up" });
        expect(screen.getByRole("button", { name: /continue with apple/i })).toBeInTheDocument();
      });

      it("should have Google button that links to Google OAuth initiation route", async () => {
        const Stub = createTestRoutesStub([
          {
            path: "/signup",
            Component: Signup,
            loader: () => ({ oauthProviders: ["google"] }),
          },
        ]);

        render(<Stub initialEntries={["/signup"]} />);

        await screen.findByRole("heading", { name: "Sign Up" });
        const googleButton = screen.getByRole("button", { name: /continue with google/i });
        // The button should be inside a form that posts to the OAuth initiation route
        const form = googleButton.closest("form");
        expect(form).toHaveAttribute("action", "/auth/google");
        expect(form).toHaveAttribute("method", "post");
      });

      it("should have Apple button that links to Apple OAuth initiation route", async () => {
        const Stub = createTestRoutesStub([
          {
            path: "/signup",
            Component: Signup,
            loader: () => ({ oauthProviders: ["apple"] }),
          },
        ]);

        render(<Stub initialEntries={["/signup"]} />);

        await screen.findByRole("heading", { name: "Sign Up" });
        const appleButton = screen.getByRole("button", { name: /continue with apple/i });
        // The button should be inside a form that posts to the OAuth initiation route
        const form = appleButton.closest("form");
        expect(form).toHaveAttribute("action", "/auth/apple");
        expect(form).toHaveAttribute("method", "post");
      });

      it("should display OAuth separator between password form and OAuth buttons", async () => {
        const Stub = createTestRoutesStub([
          {
            path: "/signup",
            Component: Signup,
            loader: () => ({ oauthProviders: ["google", "apple"] }),
          },
        ]);

        render(<Stub initialEntries={["/signup"]} />);

        await screen.findByRole("heading", { name: "Sign Up" });
        // Look for a separator element that says "or" as a standalone element
        expect(screen.getByTestId("oauth-separator")).toBeInTheDocument();
      });

      it("should hide OAuth separator and buttons when no providers are configured", async () => {
        const Stub = createTestRoutesStub([
          {
            path: "/signup",
            Component: Signup,
            loader: () => ({ oauthProviders: [] }),
          },
        ]);

        render(<Stub initialEntries={["/signup"]} />);

        await screen.findByRole("heading", { name: "Sign Up" });
        expect(screen.queryByTestId("oauth-separator")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /continue with google/i })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /continue with apple/i })).not.toBeInTheDocument();
      });
    });

    describe("OAuth error messages", () => {
      it("should display email collision error message when redirected from OAuth", async () => {
        const Stub = createTestRoutesStub([
          {
            path: "/signup",
            Component: Signup,
            loader: () => ({ oauthError: "account_exists" }),
          },
        ]);

        render(<Stub initialEntries={["/signup"]} />);

        await screen.findByRole("heading", { name: "Sign Up" });
        expect(screen.getByText(/an account with this email already exists/i)).toBeInTheDocument();
        expect(screen.getByText(/log in.*to link/i)).toBeInTheDocument();
      });

      it("should display generic OAuth error message", async () => {
        const Stub = createTestRoutesStub([
          {
            path: "/signup",
            Component: Signup,
            loader: () => ({ oauthError: "oauth_error" }),
          },
        ]);

        render(<Stub initialEntries={["/signup"]} />);

        await screen.findByRole("heading", { name: "Sign Up" });
        expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
      });
    });

    describe("Catalyst component structure", () => {
      it("should use Catalyst Heading for page title", async () => {
        const Stub = createTestRoutesStub([
          {
            path: "/signup",
            Component: Signup,
            loader: () => ({ oauthProviders: [] }),
          },
        ]);

        render(<Stub initialEntries={["/signup"]} />);

        const heading = await screen.findByRole("heading", { level: 1, name: "Sign Up" });
        expect(heading).toBeInTheDocument();
        expect(heading).toHaveTextContent("Sign Up");
      });

      it("should use Catalyst Input components for form fields", async () => {
        const Stub = createTestRoutesStub([
          {
            path: "/signup",
            Component: Signup,
            loader: () => ({ oauthProviders: [] }),
          },
        ]);

        const { container } = render(<Stub initialEntries={["/signup"]} />);

        await screen.findByRole("heading", { name: "Sign Up" });

        // Inputs should not have inline styles
        const inputs = container.querySelectorAll('input');
        inputs.forEach((input) => {
          expect(input).not.toHaveAttribute("style");
        });
      });

      it("should use Catalyst Button for submit", async () => {
        const Stub = createTestRoutesStub([
          {
            path: "/signup",
            Component: Signup,
            loader: () => ({ oauthProviders: [] }),
          },
        ]);

        const { container } = render(<Stub initialEntries={["/signup"]} />);

        await screen.findByRole("heading", { name: "Sign Up" });

        // Buttons should not have inline styles
        const buttons = container.querySelectorAll('button');
        buttons.forEach((button) => {
          expect(button).not.toHaveAttribute("style");
        });
      });

      it("should have accessible form labels", async () => {
        const Stub = createTestRoutesStub([
          {
            path: "/signup",
            Component: Signup,
            loader: () => ({ oauthProviders: [] }),
          },
        ]);

        render(<Stub initialEntries={["/signup"]} />);

        await screen.findByRole("heading", { name: "Sign Up" });

        expect(screen.getByLabelText("Email")).toBeInTheDocument();
        expect(screen.getByLabelText("Username")).toBeInTheDocument();
        expect(screen.getByLabelText("Password")).toBeInTheDocument();
        expect(screen.getByLabelText("Confirm Password")).toBeInTheDocument();
      });
    });
  });
});
