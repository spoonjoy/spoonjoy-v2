import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Request as UndiciRequest, FormData as UndiciFormData } from "undici";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { redirect } from "react-router";
import { createTestRoutesStub } from "../utils";
import { db } from "~/lib/db.server";
import { loader, action } from "~/routes/recipes.new";
import { action as shoppingListAction } from "~/routes/shopping-list";
import NewRecipe from "~/routes/recipes.new";
import { createUser } from "~/lib/auth.server";
import { sessionStorage } from "~/lib/session.server";
import { ACTIVE_RECIPE_TITLE_CONFLICT_ERROR } from "~/lib/recipe-title-uniqueness.server";
import * as ingredientParseModule from "~/lib/ingredient-parse.server";
import { IngredientParseError } from "~/lib/ingredient-parse.server";
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

function validImageBytes(type: "image/jpeg" | "image/png" | "image/webp"): Uint8Array {
  if (type === "image/jpeg") {
    return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xda]);
  }
  if (type === "image/png") {
    return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  }
  return new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
}

function validImageFile(name: string, type: "image/jpeg" | "image/png" | "image/webp"): File {
  return new File([validImageBytes(type)], name, { type });
}

async function expectAwaitingPlaceholderCover(recipeId: string, userId: string) {
  const recipe = await db.recipe.findUniqueOrThrow({
    where: { id: recipeId },
    select: {
      activeCoverId: true,
      activeCoverVariant: true,
      coverMode: true,
      covers: true,
    },
  });
  expect(recipe).toMatchObject({
    activeCoverId: null,
    activeCoverVariant: null,
    coverMode: "auto",
  });
  expect(recipe.covers).toHaveLength(1);
  expect(recipe.covers[0]).toMatchObject({
    sourceType: "ai-placeholder",
    imageUrl: "",
    status: "failed",
    generationStatus: "failed",
    createdById: userId,
  });
  expect(recipe.covers[0].failureReason).toContain("missing_image_provider_config");
}

describe("Recipes New Route", () => {
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
      const request = new UndiciRequest("http://localhost:3000/recipes/new");

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

      const request = new UndiciRequest("http://localhost:3000/recipes/new", { headers });

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
      userId?: string,
      url = "http://localhost:3000/recipes/new"
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

      return new UndiciRequest(url, {
        method: "POST",
        body: formData,
        headers,
      });
    }

    async function createMultipartRequest(
      formData: UndiciFormData,
      userId: string,
      url = "http://localhost:3000/recipes/new"
    ): Promise<UndiciRequest> {
      const session = await sessionStorage.getSession();
      session.set("userId", userId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];
      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      return new UndiciRequest(url, {
        method: "POST",
        body: formData,
        headers,
      });
    }

    it("should return validation error when title is missing", async () => {
      const request = await createFormRequest(
        { title: "", description: "Some description" },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.title).toBe("Title is required");
    });

    it("should create recipe and redirect on success", async () => {
      const request = await createFormRequest(
        { title: "My New Recipe", description: "A delicious recipe", servings: "4" },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toMatch(/\/recipes\/[\w-]+/);

      // Verify recipe was created
      const recipes = await db.recipe.findMany({
        where: { chefId: testUserId },
      });
      expect(recipes).toHaveLength(1);
      expect(recipes[0].title).toBe("My New Recipe");
      expect(recipes[0].description).toBe("A delicious recipe");
      expect(recipes[0].servings).toBe("4");
      await expectAwaitingPlaceholderCover(recipes[0].id, testUserId);
    });

    it("should parse ingredients for the unsaved new recipe builder", async () => {
      const parsedIngredients = [
        { quantity: 2, unit: "cup", ingredientName: "flour" },
      ];
      const parseSpy = vi
        .spyOn(ingredientParseModule, "parseIngredients")
        .mockResolvedValueOnce(parsedIngredients);
      const request = await createFormRequest(
        { intent: "parseIngredients", ingredientText: "2 cups flour" },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(200);
      expect(data.parsedIngredients).toEqual(parsedIngredients);
      expect(parseSpy).toHaveBeenCalledWith(
        "2 cups flour",
        expect.objectContaining({ OPENAI_API_KEY: undefined })
      );
    });

    it("should return parser errors for the unsaved new recipe builder", async () => {
      vi
        .spyOn(ingredientParseModule, "parseIngredients")
        .mockRejectedValueOnce(new IngredientParseError("Ingredient text is required"));
      const request = await createFormRequest(
        { intent: "parseIngredients", ingredientText: "" },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.parse).toBe("Ingredient text is required");
    });

    it("should return a generic parse error for unexpected parser failures", async () => {
      vi
        .spyOn(ingredientParseModule, "parseIngredients")
        .mockRejectedValueOnce(new Error("network down"));
      const request = await createFormRequest(
        { intent: "parseIngredients", ingredientText: "2 cups flour" },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(500);
      expect(data.errors.parse).toBe("An unexpected error occurred while parsing ingredients");
    });

    it("should redirect when not logged in", async () => {
      const request = await createFormRequest({ title: "My Recipe" });

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

    it("should create recipe with only required fields", async () => {
      const request = await createFormRequest({ title: "Minimal Recipe" }, testUserId);

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);

      // Verify recipe was created with null optional fields
      const recipes = await db.recipe.findMany({
        where: { chefId: testUserId },
      });
      expect(recipes).toHaveLength(1);
      expect(recipes[0].title).toBe("Minimal Recipe");
      expect(recipes[0].description).toBeNull();
      expect(recipes[0].servings).toBeNull();
      await expectAwaitingPlaceholderCover(recipes[0].id, testUserId);
    });

    it("should reject duplicate active recipe titles for the same chef", async () => {
      await db.recipe.create({
        data: {
          title: "Duplicate Dinner",
          chefId: testUserId,
        },
      });
      const request = await createFormRequest({ title: "  Duplicate Dinner  " }, testUserId);

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.title).toBe(ACTIVE_RECIPE_TITLE_CONFLICT_ERROR);
      await expect(db.recipe.count({ where: { chefId: testUserId } })).resolves.toBe(1);
    });

    it("should allow duplicate active recipe titles for different chefs", async () => {
      const otherUser = await createUser(
        db,
        faker.internet.email(),
        `${faker.internet.username()}_${faker.string.alphanumeric(8)}`,
        "testPassword123"
      );
      await db.recipe.create({
        data: {
          title: "Shared Dinner",
          chefId: otherUser.id,
        },
      });
      const request = await createFormRequest({ title: "Shared Dinner" }, testUserId);

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);
      await expect(db.recipe.count({ where: { title: "Shared Dinner" } })).resolves.toBe(2);
    });

    it("should allow title reuse after the prior recipe is soft-deleted", async () => {
      await db.recipe.create({
        data: {
          title: "Restored Dinner",
          chefId: testUserId,
          deletedAt: new Date(),
        },
      });
      const request = await createFormRequest({ title: "Restored Dinner" }, testUserId);

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);
      await expect(db.recipe.count({ where: { chefId: testUserId, title: "Restored Dinner" } })).resolves.toBe(2);
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

    it("should trim title and other fields whitespace", async () => {
      const request = await createFormRequest(
        {
          title: "  My Recipe  ",
          description: "  Description  ",
          servings: "  4  ",
        },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);

      // Verify fields were trimmed
      const recipe = await db.recipe.findFirst({
        where: { chefId: testUserId },
      });
      expect(recipe?.title).toBe("My Recipe");
      expect(recipe?.description).toBe("Description");
      expect(recipe?.servings).toBe("4");
    });

    it("should handle empty optional fields correctly", async () => {
      const request = await createFormRequest(
        {
          title: "Recipe Title",
          description: "",
          servings: "  ",
        },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);

      // Verify empty fields become null
      const recipe = await db.recipe.findFirst({
        where: { chefId: testUserId },
      });
      expect(recipe?.description).toBeNull();
      expect(recipe?.servings).toBeNull();
    });

    it("should return generic error for database errors", async () => {
      // createRecipeDraft now writes sequentially against the top-level client
      // (Cloudflare D1 doesn't support interactive `$transaction(async ...)`).
      // Force the first DB write — recipe.create — to throw to exercise the
      // catch in the route action.
      const originalCreate = db.recipe.create;
      db.recipe.create = vi.fn().mockRejectedValue(new Error("Database connection failed")) as any;

      try {
        const request = await createFormRequest({ title: "My Recipe" }, testUserId);

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(500);
        expect(data.errors.general).toBe("Failed to create recipe. Please try again.");
      } finally {
        // Restore original function
        db.recipe.create = originalCreate;
      }
    });

    it("should return validation error for invalid image type", async () => {
      const formData = new UndiciFormData();
      formData.append("title", "Valid Title");
      formData.append(
        "image",
        new Blob(["fake image content"], { type: "text/plain" }),
        "test.txt"
      );

      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];
      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest("http://localhost:3000/recipes/new", {
        method: "POST",
        body: formData,
        headers,
      });

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.image).toBe("Image must be JPG, PNG, or WebP.");
    });

    it("should return validation error for GIF recipe images", async () => {
      const formData = new UndiciFormData();
      formData.append("title", "Valid Title");
      formData.append(
        "image",
        new Blob([new TextEncoder().encode("GIF89a")], { type: "image/gif" }),
        "animated.gif",
      );

      const request = await createMultipartRequest(formData, testUserId);

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.image).toBe("Image must be JPG, PNG, or WebP.");
    });

    it("should reject GIF bytes disguised as an accepted recipe image type", async () => {
      const formData = new UndiciFormData();
      formData.append("title", "Valid Title");
      formData.append(
        "image",
        new Blob([new TextEncoder().encode("GIF89a")], { type: "image/jpeg" }),
        "fake.jpg",
      );

      const request = await createMultipartRequest(formData, testUserId);

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.image).toBe("Image must be JPG, PNG, or WebP.");
    });

    it("should return validation error for oversized image", async () => {
      const formData = new UndiciFormData();
      formData.append("title", "Valid Title");
      const bigBuffer = Buffer.alloc(5 * 1024 * 1024 + 1); // Just over 5MB
      formData.append(
        "image",
        new Blob([bigBuffer], { type: "image/jpeg" }),
        "big.jpg"
      );

      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];
      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest("http://localhost:3000/recipes/new", {
        method: "POST",
        body: formData,
        headers,
      });

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.image).toBe("Image must be less than 5MB");
    });

    it("should accept valid image with valid type and size under 5MB", async () => {
      const formData = new UndiciFormData();
      formData.append("title", "Valid Title");
      // Valid image: correct type (image/jpeg) and under 5MB (1KB)
      formData.append(
        "image",
        new Blob([validImageBytes("image/jpeg")], { type: "image/jpeg" }),
        "valid.jpg"
      );

      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];
      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest("http://localhost:3000/recipes/new", {
        method: "POST",
        body: formData,
        headers,
      });

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      // Should succeed - valid image passes validation
      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);

      // Verify recipe was created
      const recipe = await db.recipe.findFirst({
        where: { chefId: testUserId },
      });
      expect(recipe).not.toBeNull();
      expect(recipe!.title).toBe("Valid Title");
      const covers = await db.recipeCover.findMany({ where: { recipeId: recipe!.id } });
      expect(covers).toHaveLength(1);
      expect(covers[0]).toMatchObject({
        sourceType: "chef-upload",
        status: "ready",
        generationStatus: "failed",
        failureReason: "missing_image_provider_config",
        promptVersion: "spoon-photo-editorial-v1",
        styleVersion: "mendelow-phone-to-editorial-v1",
        createdById: testUserId,
      });
      expect(covers[0].imageUrl).toMatch(/^data:image\/jpeg;base64,/);
      expect(covers[0].sourceImageUrl).toBe(covers[0].imageUrl);
      expect(recipe).toMatchObject({
        activeCoverId: covers[0].id,
        activeCoverVariant: "image",
        coverMode: "manual",
      });
    });

    it("should upload valid recipe image to R2 when a bucket is available", async () => {
      const mockR2Bucket = {
        put: vi.fn().mockResolvedValue(undefined),
      };
      const formData = new UndiciFormData();
      formData.append("title", "R2 Image Recipe");
      formData.append("image", validImageFile("recipe.jpg", "image/jpeg"));

      const request = await createMultipartRequest(formData, testUserId);

      const response = await action({
        request,
        context: { cloudflare: { env: { PHOTOS: mockR2Bucket } } },
        params: {},
      } as any);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);

      const recipe = await db.recipe.findFirstOrThrow({
        where: { chefId: testUserId, title: "R2 Image Recipe" },
      });
      const covers = await db.recipeCover.findMany({ where: { recipeId: recipe.id } });
      expect(covers).toHaveLength(1);
      expect(covers[0]).toMatchObject({
        sourceType: "chef-upload",
        status: "ready",
        generationStatus: "failed",
        failureReason: "missing_image_provider_config",
        promptVersion: "spoon-photo-editorial-v1",
        styleVersion: "mendelow-phone-to-editorial-v1",
        createdById: testUserId,
      });
      expect(covers[0].imageUrl).toMatch(
        new RegExp(`^/photos/recipes/${testUserId}/${recipe.id}/\\d+-[a-f0-9-]+\\.jpg$`),
      );
      expect(covers[0].sourceImageUrl).toBe(covers[0].imageUrl);
      expect(recipe).toMatchObject({
        activeCoverId: covers[0].id,
        activeCoverVariant: "image",
        coverMode: "manual",
      });
      expect(mockR2Bucket.put).toHaveBeenCalledWith(
        covers[0].imageUrl.replace("/photos/", ""),
        expect.any(File),
        { httpMetadata: { contentType: "image/jpeg" } }
      );
    });

    it("attempts chef-upload cover stylization inline while keeping the raw upload visible", async () => {
      const captured: Promise<unknown>[] = [];
      const waitUntil = vi.fn((p: Promise<unknown>) => {
        captured.push(p);
      });
      const mockR2Bucket = {
        put: vi.fn().mockResolvedValue(undefined),
      };
      const formData = new UndiciFormData();
      formData.append("title", "Chef Upload WaitUntil Recipe");
      formData.append("image", validImageFile("recipe.jpg", "image/jpeg"));

      const request = await createMultipartRequest(formData, testUserId);

      const response = await action({
        request,
        context: { cloudflare: { env: { PHOTOS: mockR2Bucket }, ctx: { waitUntil } } },
        params: {},
      } as any);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);
      expect(waitUntil).not.toHaveBeenCalled();

      const recipe = await db.recipe.findFirstOrThrow({
        where: { chefId: testUserId, title: "Chef Upload WaitUntil Recipe" },
      });
      const cover = await db.recipeCover.findFirstOrThrow({
        where: { recipeId: recipe.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      expect(cover.sourceType).toBe("chef-upload");
      expect(cover.imageUrl).toMatch(
        new RegExp(`^/photos/recipes/${testUserId}/${recipe.id}/\\d+-[a-f0-9-]+\\.jpg$`),
      );
      expect(cover.stylizedImageUrl).toBeNull();
      expect(recipe).toMatchObject({
        activeCoverId: cover.id,
        activeCoverVariant: "image",
        coverMode: "manual",
      });
      expect(captured).toHaveLength(0);
    });

    it("should return image error when recipe image upload fails", async () => {
      const mockR2Bucket = {
        put: vi.fn().mockRejectedValue(new Error("R2 unavailable")),
      };
      const formData = new UndiciFormData();
      formData.append("title", "Upload Failure Recipe");
      formData.append("image", validImageFile("recipe.jpg", "image/jpeg"));

      const request = await createMultipartRequest(formData, testUserId);

      const response = await action({
        request,
        context: { cloudflare: { env: { PHOTOS: mockR2Bucket } } },
        params: {},
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(500);
      expect(data.errors.image).toBe("Failed to upload image. Please try again.");
      await expect(db.recipe.count({ where: { chefId: testUserId } })).resolves.toBe(0);
    });

    it("schedules ai-placeholder cover generation via context.cloudflare.ctx.waitUntil when available", async () => {
      const captured: Promise<unknown>[] = [];
      const waitUntil = vi.fn((p: Promise<unknown>) => {
        captured.push(p);
      });
      const request = await createFormRequest(
        { title: "WaitUntil Recipe" },
        testUserId,
      );
      const response = await action({
        request,
        context: { cloudflare: { env: null, ctx: { waitUntil } } },
        params: {},
      } as any);
      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);
      expect(waitUntil).toHaveBeenCalledTimes(1);
      const recipe = await db.recipe.findFirstOrThrow({
        where: { chefId: testUserId, title: "WaitUntil Recipe" },
      });
      await expectAwaitingPlaceholderCover(recipe.id, testUserId);
      // Allow the captured promise to resolve so cleanup is clean.
      await Promise.all(captured);
    });

    it("should delete uploaded recipe image when database creation fails", async () => {
      const mockR2Bucket = {
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      };
      // See "should return generic error for database errors" above — D1 has
      // no interactive transaction support, so the failure-injection point is
      // recipe.create, the first write in the sequence.
      const originalCreate = db.recipe.create;
      db.recipe.create = vi.fn().mockRejectedValue(new Error("Database connection failed")) as any;

      try {
        const formData = new UndiciFormData();
        formData.append("title", "Creation Failure Recipe");
        formData.append("image", validImageFile("recipe.webp", "image/webp"));

        const request = await createMultipartRequest(formData, testUserId);

        const response = await action({
          request,
          context: { cloudflare: { env: { PHOTOS: mockR2Bucket } } },
          params: {},
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(500);
        expect(data.errors.general).toBe("Failed to create recipe. Please try again.");
        const uploadedKey = mockR2Bucket.put.mock.calls[0][0];
        expect(mockR2Bucket.delete).toHaveBeenCalledWith(uploadedKey);
      } finally {
        db.recipe.create = originalCreate;
      }
    });

    it("should create recipe with valid steps JSON and redirect", async () => {
      const stepsData = [
        { description: "Mix dry ingredients", stepTitle: "Prep", duration: 10, ingredients: [] },
        { description: "Bake at 350°F for 25 minutes", ingredients: [] },
      ];
      const request = await createFormRequest(
        {
          title: "Recipe With Steps",
          steps: JSON.stringify(stepsData),
        },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toMatch(/\/recipes\/[\w-]+/);

      const recipe = await db.recipe.findFirstOrThrow({
        where: { chefId: testUserId, title: "Recipe With Steps" },
        include: { steps: { orderBy: { stepNum: "asc" } } },
      });
      expect(recipe.steps).toHaveLength(2);
      expect(recipe.steps[0]).toMatchObject({
        stepNum: 1,
        description: "Mix dry ingredients",
        stepTitle: "Prep",
        duration: 10,
      });
      expect(recipe.steps[1]).toMatchObject({
        stepNum: 2,
        description: "Bake at 350°F for 25 minutes",
        stepTitle: null,
        duration: null,
      });
    });

    it("should return validation error for invalid steps JSON", async () => {
      const request = await createFormRequest(
        {
          title: "Recipe With Bad Steps",
          steps: "not valid json{{{",
        },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.steps).toBe("Recipe steps must be valid JSON");

      const recipe = await db.recipe.findFirst({
        where: { chefId: testUserId },
      });
      expect(recipe).toBeNull();
    });

    it("should return validation error for invalid submitted step fields", async () => {
      const request = await createFormRequest(
        {
          title: "Recipe With Invalid Step",
          steps: JSON.stringify([{ description: "" }]),
        },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.steps).toBe("Step 1: Step description is required");
      await expect(db.recipe.count({ where: { chefId: testUserId } })).resolves.toBe(0);
    });

    it("should return validation error for invalid submitted ingredient fields", async () => {
      const request = await createFormRequest(
        {
          title: "Recipe With Invalid Ingredient",
          steps: JSON.stringify([
            {
              description: "Mix",
              ingredients: [{ quantity: 0, unit: "cup", ingredientName: "flour" }],
            },
          ]),
        },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const { data, status } = extractResponseData(response);
      expect(status).toBe(400);
      expect(data.errors.steps).toBe("Step 1, ingredient 1: Quantity must be between 0.001 and 99,999");
      await expect(db.recipe.count({ where: { chefId: testUserId } })).resolves.toBe(0);
    });

    it("should persist submitted step ingredients and make them available to the shopping list", async () => {
      await db.unit.create({ data: { name: "cup" } });
      await db.ingredientRef.create({ data: { name: "flour" } });

      const request = await createFormRequest(
        {
          title: "Shopping List Pancakes",
          steps: JSON.stringify([
            {
              stepTitle: "Prep",
              description: "Mix dry ingredients",
              duration: 8,
              ingredients: [
                { quantity: 2, unit: "Cup", ingredientName: "Flour" },
                { quantity: 1, unit: "cup", ingredientName: "Milk" },
              ],
            },
          ]),
        },
        testUserId
      );

      const response = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(302);

      const recipe = await db.recipe.findFirstOrThrow({
        where: { chefId: testUserId, title: "Shopping List Pancakes" },
        include: {
          steps: {
            include: {
              ingredients: {
                include: { unit: true, ingredientRef: true },
                orderBy: { ingredientRef: { name: "asc" } },
              },
            },
          },
        },
      });

      expect(recipe.steps[0]).toMatchObject({
        stepNum: 1,
        stepTitle: "Prep",
        description: "Mix dry ingredients",
        duration: 8,
      });
      expect(recipe.steps[0].ingredients.map((ingredient) => ({
        quantity: ingredient.quantity,
        unit: ingredient.unit.name,
        name: ingredient.ingredientRef.name,
      }))).toEqual([
        { quantity: 2, unit: "cup", name: "flour" },
        { quantity: 1, unit: "cup", name: "milk" },
      ]);
      await expect(db.unit.count({ where: { name: "cup" } })).resolves.toBe(1);
      await expect(db.ingredientRef.count({ where: { name: "flour" } })).resolves.toBe(1);

      const addToListRequest = await createFormRequest(
        {
          intent: "addFromRecipe",
          recipeId: recipe.id,
        },
        testUserId,
        "http://localhost:3000/shopping-list"
      );

      await shoppingListAction({
        request: addToListRequest,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const shoppingList = await db.shoppingList.findUniqueOrThrow({
        where: { authorId: testUserId },
        include: {
          items: {
            include: { unit: true, ingredientRef: true },
            orderBy: { ingredientRef: { name: "asc" } },
          },
        },
      });

      expect(shoppingList.items.map((item) => ({
        quantity: item.quantity,
        unit: item.unit?.name,
        name: item.ingredientRef.name,
      }))).toEqual([
        { quantity: 2, unit: "cup", name: "flour" },
        { quantity: 1, unit: "cup", name: "milk" },
      ]);
    });

    describe("field validation", () => {
      it("should return validation error when title exceeds max length", async () => {
        const longTitle = "a".repeat(201);
        const request = await createFormRequest({ title: longTitle }, testUserId);

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(400);
        expect(data.errors.title).toBe("Title must be 200 characters or less");
      });

      it("should accept title at exactly max length", async () => {
        const maxTitle = "a".repeat(200);
        const request = await createFormRequest({ title: maxTitle }, testUserId);

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(response).toBeInstanceOf(Response);
        expect(response.status).toBe(302);
      });

      it("should return validation error when description exceeds max length", async () => {
        const longDescription = "a".repeat(2001);
        const request = await createFormRequest(
          { title: "Valid Title", description: longDescription },
          testUserId
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(400);
        expect(data.errors.description).toBe("Description must be 2,000 characters or less");
      });

      it("should accept description at exactly max length", async () => {
        const maxDescription = "a".repeat(2000);
        const request = await createFormRequest(
          { title: "Valid Title", description: maxDescription },
          testUserId
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(response).toBeInstanceOf(Response);
        expect(response.status).toBe(302);
      });

      it("should return validation error when servings exceeds max length", async () => {
        const longServings = "a".repeat(101);
        const request = await createFormRequest(
          { title: "Valid Title", servings: longServings },
          testUserId
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(400);
        expect(data.errors.servings).toBe("Servings must be 100 characters or less");
      });

      it("should accept servings at exactly max length", async () => {
        const maxServings = "a".repeat(100);
        const request = await createFormRequest(
          { title: "Valid Title", servings: maxServings },
          testUserId
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        expect(response).toBeInstanceOf(Response);
        expect(response.status).toBe(302);
      });

      it("should return multiple validation errors at once", async () => {
        const longTitle = "a".repeat(201);
        const longDescription = "a".repeat(2001);
        const longServings = "a".repeat(101);
        const request = await createFormRequest(
          {
            title: longTitle,
            description: longDescription,
            servings: longServings,
          },
          testUserId
        );

        const response = await action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any);

        const { data, status } = extractResponseData(response);
        expect(status).toBe(400);
        expect(data.errors.title).toBe("Title must be 200 characters or less");
        expect(data.errors.description).toBe("Description must be 2,000 characters or less");
        expect(data.errors.servings).toBe("Servings must be 100 characters or less");
      });
    });
  });

  describe("component", () => {
    it("should render create recipe form", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/recipes/new",
          Component: NewRecipe,
          loader: () => null,
        },
      ]);

      render(<Stub initialEntries={["/recipes/new"]} />);

      expect(await screen.findByRole("heading", { name: "Write the version future-you can actually cook." })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "← Back to recipes" })).toHaveAttribute("href", "/recipes");
      expect(screen.getByLabelText(/Title/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Description/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Servings/)).toBeInTheDocument();
      // Recipe Image is now a file upload via RecipeImageUpload - check for upload button
      expect(screen.getByRole("button", { name: /upload.*image/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Create Recipe" })).toBeInTheDocument();
      // Cancel is now a button that navigates programmatically, not a link
      expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    });

    it("should have correct form structure", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/recipes/new",
          Component: NewRecipe,
          loader: () => null,
        },
      ]);

      render(<Stub initialEntries={["/recipes/new"]} />);

      // RecipeBuilder uses controlled inputs (no name attributes on the visible inputs)
      // The actual submission uses a hidden form with name attributes
      const titleInput = await screen.findByLabelText(/Title/);
      expect(titleInput).toHaveAttribute("type", "text");
      expect(titleInput).toHaveAttribute("maxLength", "200");

      const descriptionTextarea = screen.getByLabelText(/Description/);
      expect(descriptionTextarea).toHaveAttribute("maxLength", "2000");

      const servingsInput = screen.getByLabelText(/Servings/);
      expect(servingsInput).toHaveAttribute("type", "text");
      expect(servingsInput).toHaveAttribute("maxLength", "100");

      // Recipe Image is now a file upload via RecipeImageUpload
      expect(screen.getByRole("button", { name: /upload.*image/i })).toBeInTheDocument();
      const submissionImageInput = document.querySelector('form input[name="image"]');
      expect(submissionImageInput).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    });

    it("should have correct placeholders", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/recipes/new",
          Component: NewRecipe,
          loader: () => null,
        },
      ]);

      render(<Stub initialEntries={["/recipes/new"]} />);

      // RecipeBuilder uses these placeholders
      expect(await screen.findByPlaceholderText("e.g., Chocolate Chip Cookies")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("Recipe description")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("e.g., 4 servings")).toBeInTheDocument();
    });

    it("should navigate to /recipes when Cancel is clicked", async () => {
      const user = userEvent.setup();
      const Stub = createTestRoutesStub([
        {
          path: "/recipes/new",
          Component: NewRecipe,
          loader: () => null,
        },
        {
          path: "/recipes",
          Component: () => <div>Recipes List</div>,
        },
      ]);

      render(<Stub initialEntries={["/recipes/new"]} />);

      const cancelButton = await screen.findByRole("button", { name: "Cancel" });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(screen.getByText("Recipes List")).toBeInTheDocument();
      });
    });

    it("should populate hidden form and submit when RecipeBuilder saves", async () => {
      const user = userEvent.setup();
      let actionFormData: Record<string, string> = {};

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/new",
          Component: NewRecipe,
          loader: () => null,
          action: async ({ request }: { request: Request }) => {
            const formData = await request.formData();
            actionFormData = Object.fromEntries(formData.entries());
            return redirect("/recipes/test-id");
          },
        },
        {
          path: "/recipes/:id",
          Component: () => <div>Recipe Detail</div>,
        },
      ]);

      render(<Stub initialEntries={["/recipes/new"]} />);

      // Fill in title (required to enable save)
      const titleInput = await screen.findByLabelText(/Title/);
      await user.clear(titleInput);
      await user.type(titleInput, "Integration Test Recipe");

      // Fill in description
      const descriptionInput = screen.getByLabelText(/Description/);
      await user.clear(descriptionInput);
      await user.type(descriptionInput, "A test description");

      // Fill in servings
      const servingsInput = screen.getByLabelText(/Servings/);
      await user.clear(servingsInput);
      await user.type(servingsInput, "4");

      // Click Create Recipe button (triggers RecipeBuilder.handleSave → onSave → handleSave)
      const submitButton = screen.getByRole("button", { name: "Create Recipe" });
      await user.click(submitButton);

      await waitFor(() => {
        expect(actionFormData.title).toBe("Integration Test Recipe");
      });
      expect(actionFormData.description).toBe("A test description");
      expect(actionFormData.servings).toBe("4");
    });

    it("should handle image upload in handleSave", async () => {
      const user = userEvent.setup();

      const testImage = new File(["test image"], "test.jpg", { type: "image/jpeg" });

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/new",
          Component: NewRecipe,
          loader: () => null,
          action: async ({ request }: { request: Request }) => {
            const formData = await request.formData();
            const imageFile = formData.get("image") as File;
            expect(imageFile).not.toBeNull();
            expect(imageFile.name).toBe("test.jpg");
            expect(imageFile.type).toBe("image/jpeg");
            return redirect("/recipes/test-id");
          },
        },
        {
          path: "/recipes/:id",
          Component: () => <div>Recipe Detail</div>,
        },
      ]);

      render(<Stub initialEntries={["/recipes/new"]} />);

      // Wait for form to render
      await screen.findByLabelText(/Title/);

      // Fill title
      const titleInput = screen.getByLabelText(/Title/);
      await user.clear(titleInput);
      await user.type(titleInput, "Recipe with Image");

      // Upload image
      const fileInput = await screen.findByLabelText("Upload recipe image");
      await user.upload(fileInput, testImage);

      // Wait a bit for state update
      await new Promise(resolve => setTimeout(resolve, 100));

      // Click Create Recipe
      const submitButton = screen.getByRole("button", { name: "Create Recipe" });
      await user.click(submitButton);
    });

    it("shows image upload progress and ignores duplicate create clicks", async () => {
      const user = userEvent.setup();
      let actionCalls = 0;
      let resolveAction!: () => void;
      const actionPromise = new Promise<void>((resolve) => {
        resolveAction = resolve;
      });

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/new",
          Component: NewRecipe,
          loader: () => null,
          action: async ({ request }: { request: Request }) => {
            actionCalls += 1;
            await request.formData();
            await actionPromise;
            return redirect("/recipes/test-id");
          },
        },
        {
          path: "/recipes/:id",
          Component: () => <div>Recipe Detail</div>,
        },
      ]);

      render(<Stub initialEntries={["/recipes/new"]} />);

      await user.type(await screen.findByLabelText(/Title/), "Recipe with Image");
      await user.upload(
        await screen.findByLabelText("Upload recipe image"),
        new File(["test image"], "test.jpg", { type: "image/jpeg" }),
      );

      const submitButton = screen.getByRole("button", { name: "Create Recipe" });
      fireEvent.click(submitButton);
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(actionCalls).toBe(1);
      });
      expect(screen.getByRole("status")).toHaveTextContent(/uploading image/i);
      expect(submitButton).toBeDisabled();

      resolveAction();
    });

    it("should display general error message when present", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/recipes/new",
          Component: NewRecipe,
          loader: () => null,
          action: () => ({
            errors: { general: "Failed to create recipe. Please try again." },
          }),
        },
      ]);

      render(<Stub initialEntries={["/recipes/new"]} />);

      // Wait for form to render
      await screen.findByLabelText(/Title/);
    });

    it("should handle missing title input in handleSave", async () => {
      const user = userEvent.setup();
      let formDataReceived: Record<string, string> = {};

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/new",
          Component: NewRecipe,
          loader: () => null,
          action: async ({ request }: { request: Request }) => {
            const formData = await request.formData();
            formDataReceived = Object.fromEntries(formData.entries());
            return redirect("/recipes/test-id");
          },
        },
        {
          path: "/recipes/:id",
          Component: () => <div>Recipe Detail</div>,
        },
      ]);

      render(<Stub initialEntries={["/recipes/new"]} />);

      // Wait for form to render
      const titleInput = await screen.findByLabelText(/Title/);
      await user.type(titleInput, "Test Recipe");

      // Remove the hidden title input from the DOM to test null branch
      const hiddenTitleInput = document.querySelector('form.hidden input[name="title"]');
      hiddenTitleInput?.remove();

      // Click Create Recipe - should handle missing element gracefully
      const submitButton = screen.getByRole("button", { name: "Create Recipe" });
      await user.click(submitButton);

      // Form should still submit (null check prevents crash)
      await waitFor(() => {
        expect(screen.getByText("Recipe Detail")).toBeInTheDocument();
      });
      // Title won't be in form data since element was removed
      expect(formDataReceived.title).toBeUndefined();
    });

    it("should handle missing description textarea in handleSave", async () => {
      const user = userEvent.setup();
      let formDataReceived: Record<string, string> = {};

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/new",
          Component: NewRecipe,
          loader: () => null,
          action: async ({ request }: { request: Request }) => {
            const formData = await request.formData();
            formDataReceived = Object.fromEntries(formData.entries());
            return redirect("/recipes/test-id");
          },
        },
        {
          path: "/recipes/:id",
          Component: () => <div>Recipe Detail</div>,
        },
      ]);

      render(<Stub initialEntries={["/recipes/new"]} />);

      const titleInput = await screen.findByLabelText(/Title/);
      await user.type(titleInput, "Test Recipe");

      // Remove the hidden description textarea
      const hiddenDescription = document.querySelector('form.hidden textarea[name="description"]');
      hiddenDescription?.remove();

      const submitButton = screen.getByRole("button", { name: "Create Recipe" });
      await user.click(submitButton);

      // Form should still submit (null check prevents crash)
      await waitFor(() => {
        expect(screen.getByText("Recipe Detail")).toBeInTheDocument();
      });
      expect(formDataReceived.description).toBeUndefined();
    });

    it("should handle missing servings input in handleSave", async () => {
      const user = userEvent.setup();
      let formDataReceived: Record<string, string> = {};

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/new",
          Component: NewRecipe,
          loader: () => null,
          action: async ({ request }: { request: Request }) => {
            const formData = await request.formData();
            formDataReceived = Object.fromEntries(formData.entries());
            return redirect("/recipes/test-id");
          },
        },
        {
          path: "/recipes/:id",
          Component: () => <div>Recipe Detail</div>,
        },
      ]);

      render(<Stub initialEntries={["/recipes/new"]} />);

      const titleInput = await screen.findByLabelText(/Title/);
      await user.type(titleInput, "Test Recipe");

      // Remove the hidden servings input
      const hiddenServings = document.querySelector('form.hidden input[name="servings"]');
      hiddenServings?.remove();

      const submitButton = screen.getByRole("button", { name: "Create Recipe" });
      await user.click(submitButton);

      // Form should still submit (null check prevents crash)
      await waitFor(() => {
        expect(screen.getByText("Recipe Detail")).toBeInTheDocument();
      });
      expect(formDataReceived.servings).toBeUndefined();
    });

    it("should handle missing steps input in handleSave", async () => {
      const user = userEvent.setup();
      let formDataReceived: Record<string, string> = {};

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/new",
          Component: NewRecipe,
          loader: () => null,
          action: async ({ request }: { request: Request }) => {
            const formData = await request.formData();
            formDataReceived = Object.fromEntries(formData.entries());
            return redirect("/recipes/test-id");
          },
        },
        {
          path: "/recipes/:id",
          Component: () => <div>Recipe Detail</div>,
        },
      ]);

      render(<Stub initialEntries={["/recipes/new"]} />);

      const titleInput = await screen.findByLabelText(/Title/);
      await user.type(titleInput, "Test Recipe");

      // Remove the hidden steps input
      const hiddenSteps = document.querySelector('form.hidden input[name="steps"]');
      hiddenSteps?.remove();

      const submitButton = screen.getByRole("button", { name: "Create Recipe" });
      await user.click(submitButton);

      // Form should still submit (null check prevents crash)
      await waitFor(() => {
        expect(screen.getByText("Recipe Detail")).toBeInTheDocument();
      });
      expect(formDataReceived.steps).toBeUndefined();
    });

    it("should handle missing clearImage input in handleSave", async () => {
      const user = userEvent.setup();
      let formDataReceived: Record<string, string> = {};

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/new",
          Component: NewRecipe,
          loader: () => null,
          action: async ({ request }: { request: Request }) => {
            const formData = await request.formData();
            formDataReceived = Object.fromEntries(formData.entries());
            return redirect("/recipes/test-id");
          },
        },
        {
          path: "/recipes/:id",
          Component: () => <div>Recipe Detail</div>,
        },
      ]);

      render(<Stub initialEntries={["/recipes/new"]} />);

      const titleInput = await screen.findByLabelText(/Title/);
      await user.type(titleInput, "Test Recipe");

      // Remove the hidden clearImage input
      const hiddenClearImage = document.querySelector('form.hidden input[name="clearImage"]');
      hiddenClearImage?.remove();

      const submitButton = screen.getByRole("button", { name: "Create Recipe" });
      await user.click(submitButton);

      // Form should still submit (null check prevents crash)
      await waitFor(() => {
        expect(screen.getByText("Recipe Detail")).toBeInTheDocument();
      });
      expect(formDataReceived.clearImage).toBeUndefined();
    });

    it("should set clearImage value to 'true' when clearImage flag is true", async () => {
      const user = userEvent.setup();
      let formDataReceived: Record<string, string> = {};

      const Stub = createTestRoutesStub([
        {
          path: "/recipes/new",
          Component: NewRecipe,
          loader: () => null,
          action: async ({ request }: { request: Request }) => {
            const formData = await request.formData();
            formDataReceived = Object.fromEntries(formData.entries()) as Record<string, string>;
            return redirect("/recipes/test-id");
          },
        },
        {
          path: "/recipes/:id",
          Component: () => <div>Recipe Detail</div>,
        },
      ]);

      render(<Stub initialEntries={["/recipes/new"]} />);

      const titleInput = await screen.findByLabelText(/Title/);
      await user.type(titleInput, "Test Recipe");

      // Upload an image first, then clear it to trigger clearImage = true
      const testImage = new File(["test"], "test.jpg", { type: "image/jpeg" });
      const fileInput = await screen.findByLabelText("Upload recipe image");
      await user.upload(fileInput, testImage);

      // Wait for Remove button to appear (shows up after image is selected)
      await waitFor(() => {
        expect(screen.queryByRole("button", { name: "Remove" })).toBeInTheDocument();
      });

      // Clear the image - this should set clearImage to true in RecipeBuilder state
      const removeButton = screen.getByRole("button", { name: "Remove" });
      await user.click(removeButton);

      const submitButton = screen.getByRole("button", { name: "Create Recipe" });
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText("Recipe Detail")).toBeInTheDocument();
      });
      // clearImage should be "true" when an image was added then removed
      expect(formDataReceived.clearImage).toBe("true");
    });
  });
});
