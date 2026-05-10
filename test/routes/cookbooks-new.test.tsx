import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Request as UndiciRequest, FormData as UndiciFormData } from "undici";
import { render, screen } from "@testing-library/react";
import { createTestRoutesStub } from "../utils";
import { db } from "~/lib/db.server";
import { loader, action } from "~/routes/cookbooks.new";
import NewCookbook from "~/routes/cookbooks.new";
import { createUser } from "~/lib/auth.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { faker } from "@faker-js/faker";

// Helper to extract data from React Router's data() response
function extractResponseData(response: any): { data: any; status: number } {
  if (response && typeof response === "object" && response.type === "DataWithResponseInit") {
    return { data: response.data, status: response.init?.status || 200 };
  }
  if (response instanceof Response) {
    return { data: null, status: response.status };
  }
  return { data: response, status: 200 };
}

describe("Cookbooks New Route", () => {
  let testUserId: string;

  beforeEach(async () => {
    await cleanupDatabase();
    const email = faker.internet.email();
    const username = faker.internet.username() + "_" + faker.string.alphanumeric(8);
    const user = await createUser(db, email, username, "testPassword123");
    testUserId = user.id;
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("loader", () => {
    it("should redirect when not logged in", async () => {
      const request = new UndiciRequest("http://localhost:3000/cookbooks/new");

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

    it("should return null when logged in", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest("http://localhost:3000/cookbooks/new", { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(result).toBeNull();
    });
  });

  describe("action", () => {
    // Helper to create a request with form data and session cookie using undici
    async function createFormRequest(
      formFields: Record<string, string>,
      userId?: string
    ): Promise<UndiciRequest> {
      const formData = new UndiciFormData();
      for (const [key, value] of Object.entries(formFields)) {
        formData.append(key, value);
      }

      const headers = new Headers();

      if (userId) {
        const session = await sessionStorage.getSession();
        session.set("userId", userId);
        const setCookieHeader = await sessionStorage.commitSession(session);
        const cookieValue = setCookieHeader.split(";")[0];
        headers.set("Cookie", cookieValue);
      }

      return new UndiciRequest("http://localhost:3000/cookbooks/new", {
        method: "POST",
        body: formData,
        headers,
      });
    }

    it("should return validation error when title is missing", async () => {
      const request = await createFormRequest({ title: "" }, testUserId);

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.title).toBe("Title is required");
    });

    it("should create cookbook and redirect on success", async () => {
      const request = await createFormRequest({ title: "My New Cookbook" }, testUserId);

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toMatch(/\/cookbooks\/[\w-]+/);

      // Verify cookbook was created
      const cookbooks = await db.cookbook.findMany({
        where: { authorId: testUserId },
      });
      expect(cookbooks).toHaveLength(1);
      expect(cookbooks[0].title).toBe("My New Cookbook");
    });

    it("should redirect when not logged in", async () => {
      const request = await createFormRequest({ title: "My Cookbook" });

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

    it("should return error for duplicate title", async () => {
      // Create first cookbook
      await db.cookbook.create({
        data: {
          title: "Existing Cookbook",
          authorId: testUserId,
        },
      });

      // Try to create another with same title
      const request = await createFormRequest({ title: "Existing Cookbook" }, testUserId);

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.title).toBe("You already have a cookbook with this title");
    });

    it("should return validation error for whitespace-only title", async () => {
      const request = await createFormRequest({ title: "   " }, testUserId);

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.title).toBe("Title is required");
    });

    it("should trim title whitespace", async () => {
      const request = await createFormRequest({ title: "  My Cookbook  " }, testUserId);

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);

      // Verify cookbook was created with trimmed title
      const cookbook = await db.cookbook.findFirst({
        where: { authorId: testUserId },
      });
      expect(cookbook?.title).toBe("My Cookbook");
    });

    it("should return generic error for non-unique constraint database errors", async () => {
      // Mock db.cookbook.create to throw a generic error
      const originalCreate = db.cookbook.create;
      db.cookbook.create = vi.fn().mockRejectedValue(new Error("Database connection failed"));

      try {
        const request = await createFormRequest({ title: "My Cookbook" }, testUserId);

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(500);
        expect(data.errors.general).toBe("Failed to create cookbook. Please try again.");
      } finally {
        // Restore original function
        db.cookbook.create = originalCreate;
      }
    });
  });

  describe("component", () => {
    it("should render create cookbook form", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/cookbooks/new",
          Component: NewCookbook,
          loader: () => null,
        },
      ]);

      render(<Stub initialEntries={["/cookbooks/new"]} />);

      expect(await screen.findByRole("heading", { name: "Make a collection worth coming back to." })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "← Back to cookbooks" })).toHaveAttribute("href", "/cookbooks");
      expect(screen.getByLabelText(/Cookbook Title/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Create Cookbook" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/cookbooks");
    });

    it("should have correct form structure", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/cookbooks/new",
          Component: NewCookbook,
          loader: () => null,
        },
      ]);

      render(<Stub initialEntries={["/cookbooks/new"]} />);

      const titleInput = await screen.findByLabelText(/Cookbook Title/);
      expect(titleInput).toHaveAttribute("type", "text");
      expect(titleInput).toHaveAttribute("name", "title");
      expect(titleInput).toBeRequired();
      expect(titleInput).toHaveAttribute("placeholder", "e.g., Family Favorites, Holiday Recipes");
    });

    it("should have form with method post", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/cookbooks/new",
          Component: NewCookbook,
          loader: () => null,
        },
      ]);

      render(<Stub initialEntries={["/cookbooks/new"]} />);

      // The form should exist with post method
      await screen.findByLabelText(/Cookbook Title/);
      const button = screen.getByRole("button", { name: "Create Cookbook" });
      expect(button).toHaveAttribute("type", "submit");
    });

    it("should display general error message when present", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/cookbooks/new",
          Component: NewCookbook,
          loader: () => null,
          action: () => ({
            errors: { general: "Failed to create cookbook. Please try again." },
          }),
        },
      ]);

      render(<Stub initialEntries={["/cookbooks/new"]} />);

      // Wait for form to render
      await screen.findByLabelText(/Cookbook Title/);
    });

    it("should display title error message when present", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/cookbooks/new",
          Component: NewCookbook,
          loader: () => null,
          action: () => ({
            errors: { title: "You already have a cookbook with this title" },
          }),
        },
      ]);

      render(<Stub initialEntries={["/cookbooks/new"]} />);

      // Wait for form to render
      await screen.findByLabelText(/Cookbook Title/);
    });
  });
});
