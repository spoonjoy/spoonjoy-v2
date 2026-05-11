import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Request as UndiciRequest, FormData as UndiciFormData } from "undici";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createTestRoutesStub } from "../utils";
import { db } from "~/lib/db.server";
import { loader, action } from "~/routes/cookbooks.$id";
import CookbookDetail from "~/routes/cookbooks.$id";
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

describe("Cookbooks $id Route", () => {
  let testUserId: string;
  let otherUserId: string;
  let cookbookId: string;

  beforeEach(async () => {
    await cleanupDatabase();
    const email = faker.internet.email();
    const username = faker.internet.username() + "_" + faker.string.alphanumeric(8);
    const user = await createUser(db, email, username, "testPassword123");
    testUserId = user.id;

    // Create another user for permission tests
    const otherEmail = faker.internet.email();
    const otherUsername = faker.internet.username() + "_" + faker.string.alphanumeric(8);
    const otherUser = await createUser(db, otherEmail, otherUsername, "testPassword123");
    otherUserId = otherUser.id;

    // Create a cookbook for testing
    const cookbook = await db.cookbook.create({
      data: {
        title: "Test Cookbook " + faker.string.alphanumeric(6),
        authorId: testUserId,
      },
    });
    cookbookId = cookbook.id;
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("loader", () => {
    it("should redirect when not logged in", async () => {
      const request = new UndiciRequest(`http://localhost:3000/cookbooks/${cookbookId}`);

      await expect(
        loader({
          request,
          context: { cloudflare: { env: null } },
          params: { id: cookbookId },
        } as any)
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(Response);
        expect(error.status).toBe(302);
        expect(error.headers.get("Location")).toContain("/login");
        return true;
      });
    });

    it("should return cookbook data when logged in as owner", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest(`http://localhost:3000/cookbooks/${cookbookId}`, { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: { id: cookbookId },
      } as any);

      expect(result.cookbook).toBeDefined();
      expect(result.cookbook.id).toBe(cookbookId);
      expect(result.isOwner).toBe(true);
    });

    it("should return isOwner false when logged in as non-owner", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", otherUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest(`http://localhost:3000/cookbooks/${cookbookId}`, { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: { id: cookbookId },
      } as any);

      expect(result.cookbook).toBeDefined();
      expect(result.isOwner).toBe(false);
    });

    it("should throw 404 for non-existent cookbook", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest("http://localhost:3000/cookbooks/nonexistent-id", { headers });

      await expect(
        loader({
          request,
          context: { cloudflare: { env: null } },
          params: { id: "nonexistent-id" },
        } as any)
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(Response);
        expect(error.status).toBe(404);
        return true;
      });
    });
  });

  describe("action", () => {
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

      return new UndiciRequest(`http://localhost:3000/cookbooks/${cookbookId}`, {
        method: "POST",
        body: formData,
        headers,
      });
    }

    it("should redirect when not logged in", async () => {
      const request = await createFormRequest({ intent: "delete" });

      await expect(
        action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: cookbookId },
        } as any)
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(Response);
        expect(error.status).toBe(302);
        expect(error.headers.get("Location")).toContain("/login");
        return true;
      });
    });

    it("should throw 403 when non-owner tries to modify", async () => {
      const request = await createFormRequest({ intent: "delete" }, otherUserId);

      await expect(
        action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: cookbookId },
        } as any)
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(Response);
        expect(error.status).toBe(403);
        return true;
      });
    });

    it("should update title successfully", async () => {
      const newTitle = "Updated Cookbook Title " + faker.string.alphanumeric(6);
      const request = await createFormRequest(
        { intent: "updateTitle", title: newTitle },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: cookbookId },
      } as any);

      const { data } = extractResponseData(response);
      expect(data.success).toBe(true);

      // Verify title was updated
      const cookbook = await db.cookbook.findUnique({ where: { id: cookbookId } });
      expect(cookbook?.title).toBe(newTitle);
    });

    it("should return error for empty title", async () => {
      const request = await createFormRequest(
        { intent: "updateTitle", title: "" },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: cookbookId },
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.error).toBe("Title is required");
    });

    it("should return error when updating to duplicate title", async () => {
      // Create another cookbook with a known title
      const existingTitle = "Existing Cookbook " + faker.string.alphanumeric(6);
      await db.cookbook.create({
        data: {
          title: existingTitle,
          authorId: testUserId,
        },
      });

      // Try to update the test cookbook to have the same title
      const request = await createFormRequest(
        { intent: "updateTitle", title: existingTitle },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: cookbookId },
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.error).toBe("You already have a cookbook with this title");
    });

    it("should delete cookbook and redirect", async () => {
      const request = await createFormRequest({ intent: "delete" }, testUserId);

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: cookbookId },
      } as any);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/cookbooks");

      // Verify cookbook was deleted
      const cookbook = await db.cookbook.findUnique({ where: { id: cookbookId } });
      expect(cookbook).toBeNull();
    });

    it("should add recipe to cookbook", async () => {
      // Create a recipe to add
      const recipe = await db.recipe.create({
        data: {
          title: "Test Recipe " + faker.string.alphanumeric(6),
          chefId: testUserId,
        },
      });

      const request = await createFormRequest(
        { intent: "addRecipe", recipeId: recipe.id },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: cookbookId },
      } as any);

      const { data } = extractResponseData(response);
      expect(data.success).toBe(true);

      // Verify recipe was added
      const recipeInCookbook = await db.recipeInCookbook.findFirst({
        where: { cookbookId, recipeId: recipe.id },
      });
      expect(recipeInCookbook).not.toBeNull();
    });

    it("should remove recipe from cookbook", async () => {
      // Create a recipe and add it to cookbook
      const recipe = await db.recipe.create({
        data: {
          title: "Test Recipe " + faker.string.alphanumeric(6),
          chefId: testUserId,
        },
      });

      const recipeInCookbook = await db.recipeInCookbook.create({
        data: {
          cookbookId,
          recipeId: recipe.id,
          addedById: testUserId,
        },
      });

      const request = await createFormRequest(
        { intent: "removeRecipe", recipeInCookbookId: recipeInCookbook.id },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: cookbookId },
      } as any);

      const { data } = extractResponseData(response);
      expect(data.success).toBe(true);

      // Verify recipe was removed
      const removed = await db.recipeInCookbook.findUnique({
        where: { id: recipeInCookbook.id },
      });
      expect(removed).toBeNull();
    });

    it("should throw 404 for non-existent cookbook in action", async () => {
      const request = await createFormRequest(
        { intent: "delete" },
        testUserId
      );

      await expect(
        action({
          request,
          context: { cloudflare: { env: null } },
          params: { id: "nonexistent-cookbook-id" },
        } as any)
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(Response);
        expect(error.status).toBe(404);
        return true;
      });
    });

    it("should return success when adding duplicate recipe to cookbook", async () => {
      // Create a recipe and add it to cookbook
      const recipe = await db.recipe.create({
        data: {
          title: "Test Recipe " + faker.string.alphanumeric(6),
          chefId: testUserId,
        },
      });

      await db.recipeInCookbook.create({
        data: {
          cookbookId,
          recipeId: recipe.id,
          addedById: testUserId,
        },
      });

      // Try to add same recipe again
      const request = await createFormRequest(
        { intent: "addRecipe", recipeId: recipe.id },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: cookbookId },
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      await expect(db.recipeInCookbook.count({ where: { cookbookId, recipeId: recipe.id } })).resolves.toBe(1);
    });

    it("should do nothing when addRecipe without recipeId", async () => {
      const request = await createFormRequest(
        { intent: "addRecipe" },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: cookbookId },
      } as any);

      expect(response).toBeNull();
    });

    it("should do nothing when removeRecipe without recipeInCookbookId", async () => {
      const request = await createFormRequest(
        { intent: "removeRecipe" },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: cookbookId },
      } as any);

      expect(response).toBeNull();
    });

    it("should treat repeated removeRecipe submissions as idempotent", async () => {
      const recipe = await db.recipe.create({
        data: {
          title: "Repeat Remove Recipe " + faker.string.alphanumeric(6),
          chefId: testUserId,
        },
      });
      const recipeInCookbook = await db.recipeInCookbook.create({
        data: {
          cookbookId,
          recipeId: recipe.id,
          addedById: testUserId,
        },
      });

      const firstRequest = await createFormRequest(
        { intent: "removeRecipe", recipeInCookbookId: recipeInCookbook.id },
        testUserId
      );
      const secondRequest = await createFormRequest(
        { intent: "removeRecipe", recipeInCookbookId: recipeInCookbook.id },
        testUserId
      );

      const firstResponse = await action({
        request: firstRequest,
        context: { cloudflare: { env: null } },
        params: { id: cookbookId },
      } as any);
      const secondResponse = await action({
        request: secondRequest,
        context: { cloudflare: { env: null } },
        params: { id: cookbookId },
      } as any);

      expect(extractResponseData(firstResponse).data.success).toBe(true);
      expect(extractResponseData(secondResponse).data.success).toBe(true);
      await expect(db.recipeInCookbook.findUnique({ where: { id: recipeInCookbook.id } })).resolves.toBeNull();
    });

    it("should not remove a relation that belongs to another user's cookbook", async () => {
      const otherCookbook = await db.cookbook.create({
        data: {
          title: "Other User Cookbook " + faker.string.alphanumeric(6),
          authorId: otherUserId,
        },
      });
      const otherRecipe = await db.recipe.create({
        data: {
          title: "Other User Recipe " + faker.string.alphanumeric(6),
          chefId: otherUserId,
        },
      });
      const otherRelation = await db.recipeInCookbook.create({
        data: {
          cookbookId: otherCookbook.id,
          recipeId: otherRecipe.id,
          addedById: otherUserId,
        },
      });

      const request = await createFormRequest(
        { intent: "removeRecipe", recipeInCookbookId: otherRelation.id },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: cookbookId },
      } as any);

      const { data } = extractResponseData(response);
      expect(data.success).toBe(true);
      await expect(db.recipeInCookbook.findUnique({ where: { id: otherRelation.id } })).resolves.not.toBeNull();
    });

    it("should not remove a relation from a different cookbook owned by the same user", async () => {
      const secondCookbook = await db.cookbook.create({
        data: {
          title: "Second Cookbook " + faker.string.alphanumeric(6),
          authorId: testUserId,
        },
      });
      const recipe = await db.recipe.create({
        data: {
          title: "Second Cookbook Recipe " + faker.string.alphanumeric(6),
          chefId: testUserId,
        },
      });
      const otherRelation = await db.recipeInCookbook.create({
        data: {
          cookbookId: secondCookbook.id,
          recipeId: recipe.id,
          addedById: testUserId,
        },
      });

      const request = await createFormRequest(
        { intent: "removeRecipe", recipeInCookbookId: otherRelation.id },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: cookbookId },
      } as any);

      const { data } = extractResponseData(response);
      expect(data.success).toBe(true);
      await expect(db.recipeInCookbook.findUnique({ where: { id: otherRelation.id } })).resolves.not.toBeNull();
    });

    it("should return null for unknown intent", async () => {
      const request = await createFormRequest(
        { intent: "unknownIntent" },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: cookbookId },
      } as any);

      expect(response).toBeNull();
    });

    it("should return error for whitespace-only title", async () => {
      const request = await createFormRequest(
        { intent: "updateTitle", title: "   " },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: { id: cookbookId },
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.error).toBe("Title is required");
    });

    it("should re-throw non-P2002 errors when updating title", async () => {
      // Mock db.cookbook.update to throw a non-P2002 error
      const originalUpdate = db.cookbook.update;
      db.cookbook.update = vi.fn().mockRejectedValue({ code: "OTHER_ERROR", message: "Database error" });

      try {
        const request = await createFormRequest(
          { intent: "updateTitle", title: "New Title" },
          testUserId
        );

        await expect(
          action({
            request,
            context: { cloudflare: { env: null } },
            params: { id: cookbookId },
          } as any)
        ).rejects.toMatchObject({ code: "OTHER_ERROR" });
      } finally {
        db.cookbook.update = originalUpdate;
      }
    });

    it("should re-throw non-P2002 errors when adding recipe", async () => {
      // Create a recipe to add
      const recipe = await db.recipe.create({
        data: {
          title: "Test Recipe " + faker.string.alphanumeric(6),
          chefId: testUserId,
        },
      });

      // Mock db.recipeInCookbook.create to throw a non-P2002 error
      const originalCreate = db.recipeInCookbook.create;
      db.recipeInCookbook.create = vi.fn().mockRejectedValue({ code: "OTHER_ERROR", message: "Database error" });

      try {
        const request = await createFormRequest(
          { intent: "addRecipe", recipeId: recipe.id },
          testUserId
        );

        await expect(
          action({
            request,
            context: { cloudflare: { env: null } },
            params: { id: cookbookId },
          } as any)
        ).rejects.toMatchObject({ code: "OTHER_ERROR" });
      } finally {
        db.recipeInCookbook.create = originalCreate;
      }
    });
  });

  describe("loader - availableRecipes", () => {
    it("should return available recipes when owner has recipes not in cookbook", async () => {
      // Create a recipe not in the cookbook
      const recipe = await db.recipe.create({
        data: {
          title: "Available Recipe " + faker.string.alphanumeric(6),
          chefId: testUserId,
        },
      });

      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest(`http://localhost:3000/cookbooks/${cookbookId}`, { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: { id: cookbookId },
      } as any);

      expect(result.availableRecipes).toHaveLength(1);
      expect(result.availableRecipes[0].id).toBe(recipe.id);
    });

    it("should not include deleted recipes in available recipes", async () => {
      // Create a soft-deleted recipe
      await db.recipe.create({
        data: {
          title: "Deleted Recipe " + faker.string.alphanumeric(6),
          chefId: testUserId,
          deletedAt: new Date(),
        },
      });

      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest(`http://localhost:3000/cookbooks/${cookbookId}`, { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: { id: cookbookId },
      } as any);

      expect(result.availableRecipes).toHaveLength(0);
    });

    it("should not include recipes already in cookbook", async () => {
      // Create a recipe and add it to cookbook
      const recipe = await db.recipe.create({
        data: {
          title: "In Cookbook Recipe " + faker.string.alphanumeric(6),
          chefId: testUserId,
        },
      });

      await db.recipeInCookbook.create({
        data: {
          cookbookId,
          recipeId: recipe.id,
          addedById: testUserId,
        },
      });

      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest(`http://localhost:3000/cookbooks/${cookbookId}`, { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: { id: cookbookId },
      } as any);

      expect(result.availableRecipes).toHaveLength(0);
    });

    it("should return empty availableRecipes for non-owner", async () => {
      // Create a recipe for the owner
      await db.recipe.create({
        data: {
          title: "Owner Recipe " + faker.string.alphanumeric(6),
          chefId: testUserId,
        },
      });

      const session = await sessionStorage.getSession();
      session.set("userId", otherUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest(`http://localhost:3000/cookbooks/${cookbookId}`, { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: { id: cookbookId },
      } as any);

      expect(result.isOwner).toBe(false);
      expect(result.availableRecipes).toHaveLength(0);
    });

    it("should include cookbook recipes in response", async () => {
      // Create a recipe and add it to cookbook
      const recipe = await db.recipe.create({
        data: {
          title: "Cookbook Recipe " + faker.string.alphanumeric(6),
          description: "Test description",
          chefId: testUserId,
        },
      });

      await db.recipeInCookbook.create({
        data: {
          cookbookId,
          recipeId: recipe.id,
          addedById: testUserId,
        },
      });

      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest(`http://localhost:3000/cookbooks/${cookbookId}`, { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: { id: cookbookId },
      } as any);

      expect(result.cookbook.recipes).toHaveLength(1);
      expect(result.cookbook.recipes[0].recipe.id).toBe(recipe.id);
      expect(result.cookbook.recipes[0].recipe.title).toBe(recipe.title);
    });
  });

  describe("component", () => {
    it("should render cookbook with no recipes (empty state) as owner", async () => {
      const mockData = {
        cookbook: {
          id: "cookbook-1",
          title: "My Test Cookbook",
          author: { id: "user-1", username: "testchef" },
          recipes: [],
        },
        isOwner: true,
        availableRecipes: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/cookbooks/:id",
          Component: CookbookDetail,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/cookbooks/cookbook-1"]} />);

      expect(await screen.findByText("My Test Cookbook")).toBeInTheDocument();
      expect(screen.getByText(/By/)).toBeInTheDocument();
      expect(screen.getByText("testchef")).toBeInTheDocument();
      expect(screen.getByText("0 recipes")).toBeInTheDocument();
      expect(screen.getByText("No recipes yet")).toBeInTheDocument();
      expect(screen.getByText("Add recipes to your cookbook using the form above")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "← Back to cookbooks" })).toHaveAttribute("href", "/cookbooks");
    });

    it("should render cookbook with no recipes (empty state) as non-owner", async () => {
      const mockData = {
        cookbook: {
          id: "cookbook-1",
          title: "Someone Elses Cookbook",
          author: { id: "user-2", username: "otherchef" },
          recipes: [],
        },
        isOwner: false,
        availableRecipes: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/cookbooks/:id",
          Component: CookbookDetail,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/cookbooks/cookbook-1"]} />);

      expect(await screen.findByText("Someone Elses Cookbook")).toBeInTheDocument();
      expect(screen.getByText("This cookbook is empty")).toBeInTheDocument();
      // Non-owner should not see edit/delete buttons
      expect(screen.queryByText("Edit Title")).not.toBeInTheDocument();
      expect(screen.queryByText("Delete Cookbook")).not.toBeInTheDocument();
    });

    it("should render cookbook with recipes", async () => {
      const mockData = {
        cookbook: {
          id: "cookbook-1",
          title: "Recipe Collection",
          author: { id: "user-1", username: "testchef" },
          recipes: [
            {
              id: "ric-1",
              recipe: {
                id: "recipe-1",
                title: "Spaghetti",
                description: "Classic pasta",
                coverImageUrl: "https://example.com/spaghetti.jpg",
                chef: { username: "testchef" },
              },
            },
            {
              id: "ric-2",
              recipe: {
                id: "recipe-2",
                title: "Salad",
                description: null,
                coverImageUrl: null,
                chef: { username: "testchef" },
              },
            },
          ],
        },
        isOwner: true,
        availableRecipes: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/cookbooks/:id",
          Component: CookbookDetail,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/cookbooks/cookbook-1"]} />);

      expect(await screen.findByText("Recipe Collection")).toBeInTheDocument();
      expect(screen.getByText("2 recipes")).toBeInTheDocument();
      expect(screen.getByText("Spaghetti")).toBeInTheDocument();
      expect(screen.getByText("Classic pasta")).toBeInTheDocument();
      expect(screen.getByText("Salad")).toBeInTheDocument();
      // Links to recipe pages
      expect(screen.getByRole("link", { name: /Spaghetti/ })).toHaveAttribute("href", "/recipes/recipe-1");
    });

    it("should render singular recipe count", async () => {
      const mockData = {
        cookbook: {
          id: "cookbook-1",
          title: "Single Recipe Book",
          author: { id: "user-1", username: "testchef" },
          recipes: [
            {
              id: "ric-1",
              recipe: {
                id: "recipe-1",
                title: "One Recipe",
                description: null,
                coverImageUrl: null,
                chef: { username: "testchef" },
              },
            },
          ],
        },
        isOwner: false,
        availableRecipes: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/cookbooks/:id",
          Component: CookbookDetail,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/cookbooks/cookbook-1"]} />);

      expect(await screen.findByText("1 recipe")).toBeInTheDocument();
    });

    it("should show add recipe form when owner has available recipes", async () => {
      const mockData = {
        cookbook: {
          id: "cookbook-1",
          title: "My Cookbook",
          author: { id: "user-1", username: "testchef" },
          recipes: [],
        },
        isOwner: true,
        availableRecipes: [
          { id: "recipe-1", title: "Available Recipe 1" },
          { id: "recipe-2", title: "Available Recipe 2" },
        ],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/cookbooks/:id",
          Component: CookbookDetail,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/cookbooks/cookbook-1"]} />);

      expect(await screen.findByText("Add Recipe to Cookbook")).toBeInTheDocument();
      expect(screen.getByRole("combobox")).toBeInTheDocument();
      expect(screen.getByText("Select a recipe...")).toBeInTheDocument();
      expect(screen.getByText("Available Recipe 1")).toBeInTheDocument();
      expect(screen.getByText("Available Recipe 2")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add Recipe" })).toBeInTheDocument();
    });

    it("should show owner controls (edit title, delete cookbook, remove recipe)", async () => {
      const mockData = {
        cookbook: {
          id: "cookbook-1",
          title: "Editable Cookbook",
          author: { id: "user-1", username: "testchef" },
          recipes: [
            {
              id: "ric-1",
              recipe: {
                id: "recipe-1",
                title: "Recipe in Book",
                description: null,
                coverImageUrl: null,
                chef: { username: "testchef" },
              },
            },
          ],
        },
        isOwner: true,
        availableRecipes: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/cookbooks/:id",
          Component: CookbookDetail,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/cookbooks/cookbook-1"]} />);

      expect(await screen.findByRole("button", { name: "Edit Title" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Delete Cookbook" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Remove from Cookbook" })).toBeInTheDocument();
    });

    it("should show edit title form when clicking edit title button", async () => {
      const mockData = {
        cookbook: {
          id: "cookbook-1",
          title: "Original Title",
          author: { id: "user-1", username: "testchef" },
          recipes: [],
        },
        isOwner: true,
        availableRecipes: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/cookbooks/:id",
          Component: CookbookDetail,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/cookbooks/cookbook-1"]} />);

      const editButton = await screen.findByRole("button", { name: "Edit Title" });
      fireEvent.click(editButton);

      // Now editing mode should show input and Save/Cancel buttons
      expect(screen.getByRole("textbox")).toHaveValue("Original Title");
      expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    });

    it("should cancel edit title and return to view mode", async () => {
      const mockData = {
        cookbook: {
          id: "cookbook-1",
          title: "Original Title",
          author: { id: "user-1", username: "testchef" },
          recipes: [],
        },
        isOwner: true,
        availableRecipes: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/cookbooks/:id",
          Component: CookbookDetail,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/cookbooks/cookbook-1"]} />);

      // Enter edit mode
      const editButton = await screen.findByRole("button", { name: "Edit Title" });
      fireEvent.click(editButton);

      // Cancel edit
      const cancelButton = screen.getByRole("button", { name: "Cancel" });
      fireEvent.click(cancelButton);

      // Should be back to view mode
      expect(screen.getByRole("button", { name: "Edit Title" })).toBeInTheDocument();
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });

    it("should not show edit title form when not editing as owner", async () => {
      const mockData = {
        cookbook: {
          id: "cookbook-1",
          title: "My Cookbook",
          author: { id: "user-1", username: "testchef" },
          recipes: [],
        },
        isOwner: true,
        availableRecipes: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/cookbooks/:id",
          Component: CookbookDetail,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/cookbooks/cookbook-1"]} />);

      // Should show title as heading, not in input
      expect(await screen.findByRole("heading", { name: "My Cookbook" })).toBeInTheDocument();
      // But Edit Title button should be visible
      expect(screen.getByRole("button", { name: "Edit Title" })).toBeInTheDocument();
    });

    it("should open delete cookbook dialog and allow confirmation", async () => {
      const mockData = {
        cookbook: {
          id: "cookbook-1",
          title: "Delete Me",
          author: { id: "user-1", username: "testchef" },
          recipes: [],
        },
        isOwner: true,
        availableRecipes: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/cookbooks/:id",
          Component: CookbookDetail,
          loader: () => mockData,
          action: () => null,
        },
        {
          path: "/cookbooks",
          Component: () => <div>Cookbooks List</div>,
        },
      ]);

      render(<Stub initialEntries={["/cookbooks/cookbook-1"]} />);

      // Click delete button
      const deleteButton = await screen.findByRole("button", { name: "Delete Cookbook" });
      fireEvent.click(deleteButton);

      // Dialog should be open
      expect(await screen.findByText("Banish this cookbook? 📚")).toBeInTheDocument();
      expect(screen.getByText(/This will permanently delete/)).toBeInTheDocument();

      // Click confirm button
      const confirmButton = screen.getByRole("button", { name: "Delete it" });
      fireEvent.click(confirmButton);

      // Dialog should close (may need to wait for animation)
      await waitFor(() => {
        expect(screen.queryByText("Banish this cookbook? 📚")).not.toBeInTheDocument();
      });
    });

    it("should close delete dialog when clicking cancel", async () => {
      const mockData = {
        cookbook: {
          id: "cookbook-1",
          title: "Keep Me",
          author: { id: "user-1", username: "testchef" },
          recipes: [],
        },
        isOwner: true,
        availableRecipes: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/cookbooks/:id",
          Component: CookbookDetail,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/cookbooks/cookbook-1"]} />);

      // Click delete button
      const deleteButton = await screen.findByRole("button", { name: "Delete Cookbook" });
      fireEvent.click(deleteButton);

      // Click cancel
      const cancelButton = screen.getByRole("button", { name: "Keep it" });
      fireEvent.click(cancelButton);

      // Dialog should close (may need to wait for animation)
      await waitFor(() => {
        expect(screen.queryByText("Banish this cookbook? 📚")).not.toBeInTheDocument();
      });
    });

    it("should open remove recipe dialog and allow confirmation", async () => {
      const mockData = {
        cookbook: {
          id: "cookbook-1",
          title: "My Cookbook",
          author: { id: "user-1", username: "testchef" },
          recipes: [
            {
              id: "ric-1",
              recipe: {
                id: "recipe-1",
                title: "Recipe to Remove",
                description: null,
                coverImageUrl: null,
                chef: { username: "testchef" },
              },
            },
          ],
        },
        isOwner: true,
        availableRecipes: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/cookbooks/:id",
          Component: CookbookDetail,
          loader: () => mockData,
          action: () => ({ success: true }),
        },
      ]);

      render(<Stub initialEntries={["/cookbooks/cookbook-1"]} />);

      // Click remove button
      const removeButton = await screen.findByRole("button", { name: "Remove from Cookbook" });
      fireEvent.click(removeButton);

      // Dialog should be open
      expect(await screen.findByText("Remove from cookbook? 🍳")).toBeInTheDocument();

      // Click confirm button
      const confirmButton = screen.getByRole("button", { name: "Remove it" });
      fireEvent.click(confirmButton);

      // Dialog should close after submission (may need to wait for animation)
      await waitFor(() => {
        expect(screen.queryByText("Remove from cookbook? 🍳")).not.toBeInTheDocument();
      });
    });

    it("should close remove recipe dialog when clicking cancel", async () => {
      const mockData = {
        cookbook: {
          id: "cookbook-1",
          title: "My Cookbook",
          author: { id: "user-1", username: "testchef" },
          recipes: [
            {
              id: "ric-1",
              recipe: {
                id: "recipe-1",
                title: "Recipe to Keep",
                description: null,
                coverImageUrl: null,
                chef: { username: "testchef" },
              },
            },
          ],
        },
        isOwner: true,
        availableRecipes: [],
      };

      const Stub = createTestRoutesStub([
        {
          path: "/cookbooks/:id",
          Component: CookbookDetail,
          loader: () => mockData,
        },
      ]);

      render(<Stub initialEntries={["/cookbooks/cookbook-1"]} />);

      // Click remove button
      const removeButton = await screen.findByRole("button", { name: "Remove from Cookbook" });
      fireEvent.click(removeButton);

      // Click cancel
      const cancelButton = screen.getByRole("button", { name: "Keep it" });
      fireEvent.click(cancelButton);

      // Dialog should close (may need to wait for animation)
      await waitFor(() => {
        expect(screen.queryByText("Remove from cookbook? 🍳")).not.toBeInTheDocument();
      });
    });
  });
});
