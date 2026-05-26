import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Request as UndiciRequest, FormData as UndiciFormData } from "undici";
import { db } from "~/lib/db.server";
import { loader, action, parseShoppingItemFallback, __internal__ } from "~/routes/shopping-list";
import { createUser } from "~/lib/auth.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { faker } from "@faker-js/faker";

describe("Shopping List Route", () => {
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
      const request = new UndiciRequest("http://localhost:3000/shopping-list");

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

    it("should create shopping list if not exists and return empty items", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest("http://localhost:3000/shopping-list", { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(result.shoppingList).toBeDefined();
      expect(result.shoppingList.authorId).toBe(testUserId);
      expect(result.shoppingList.items).toEqual([]);
      expect(result.recipes).toEqual([]);
    });

    it("should return existing shopping list with items", async () => {
      // Create shopping list with items
      const shoppingList = await db.shoppingList.create({
        data: { authorId: testUserId },
      });

      const ingredientRef = await db.ingredientRef.create({
        data: { name: "apples" },
      });

      await db.shoppingListItem.create({
        data: {
          shoppingListId: shoppingList.id,
          ingredientRefId: ingredientRef.id,
          quantity: 5,
        },
      });

      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest("http://localhost:3000/shopping-list", { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(result.shoppingList.items).toHaveLength(1);
      expect(result.shoppingList.items[0].quantity).toBe(5);
      expect(result.shoppingList.items[0].ingredientRef.name).toBe("apples");
    });

    it("should return user recipes for adding to shopping list", async () => {
      await db.recipe.create({
        data: {
          title: "Test Recipe",
          chefId: testUserId,
        },
      });

      const session = await sessionStorage.getSession();
      session.set("userId", testUserId);
      const setCookieHeader = await sessionStorage.commitSession(session);
      const cookieValue = setCookieHeader.split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest("http://localhost:3000/shopping-list", { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(result.recipes).toHaveLength(1);
      expect(result.recipes[0].title).toBe("Test Recipe");
    });
  });

  describe("action - addItem", () => {
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

      return new UndiciRequest("http://localhost:3000/shopping-list", {
        method: "POST",
        body: formData,
        headers,
      });
    }

    it("should add new item to shopping list", async () => {
      const request = await createFormRequest(
        {
          intent: "addItem",
          ingredientName: "bananas",
          quantity: "3",
          unitName: "pieces",
        },
        testUserId
      );

      await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const shoppingList = await db.shoppingList.findUnique({
        where: { authorId: testUserId },
        include: {
          items: {
            include: { ingredientRef: true },
          },
        },
      });

      expect(shoppingList?.items).toHaveLength(1);
      expect(shoppingList?.items[0].ingredientRef.name).toBe("bananas");
      expect(shoppingList?.items[0].quantity).toBe(3);
      expect(shoppingList?.items[0].sortIndex).toBe(0);
      expect(shoppingList?.items[0].deletedAt).toBeNull();
    });

    it("should add item with unit", async () => {
      const request = await createFormRequest(
        {
          intent: "addItem",
          ingredientName: "milk",
          quantity: "2",
          unitName: "cups",
        },
        testUserId
      );

      await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const shoppingList = await db.shoppingList.findUnique({
        where: { authorId: testUserId },
        include: {
          items: {
            include: { ingredientRef: true, unit: true },
          },
        },
      });

      expect(shoppingList?.items).toHaveLength(1);
      expect(shoppingList?.items[0].ingredientRef.name).toBe("milk");
      expect(shoppingList?.items[0].unit?.name).toBe("cups");
      expect(shoppingList?.items[0].quantity).toBe(2);
    });

    it("should update quantity if item already exists", async () => {
      // Create initial shopping list and item with unit
      const shoppingList = await db.shoppingList.create({
        data: { authorId: testUserId },
      });

      const ingredientRef = await db.ingredientRef.create({
        data: { name: "oranges" },
      });

      const unit = await db.unit.findFirst({ where: { name: "pieces" } }) ||
        await db.unit.create({ data: { name: "pieces" } });

      await db.shoppingListItem.create({
        data: {
          shoppingListId: shoppingList.id,
          ingredientRefId: ingredientRef.id,
          unitId: unit.id,
          quantity: 5,
        },
      });

      // Add more of the same item
      const request = await createFormRequest(
        {
          intent: "addItem",
          ingredientName: "oranges",
          unitName: "pieces",
          quantity: "3",
        },
        testUserId
      );

      await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const updatedList = await db.shoppingList.findUnique({
        where: { authorId: testUserId },
        include: {
          items: {
            include: { ingredientRef: true },
          },
        },
      });

      expect(updatedList?.items).toHaveLength(1);
      expect(updatedList?.items[0].quantity).toBe(8); // 5 + 3
    });

    it("should parse free-text item into structured fields", async () => {
      delete process.env.OPENAI_API_KEY;

      const request = await createFormRequest(
        {
          intent: "addItem",
          ingredientText: "2 lbs chicken breast",
        },
        testUserId
      );

      await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const shoppingList = await db.shoppingList.findUnique({
        where: { authorId: testUserId },
        include: {
          items: {
            include: { ingredientRef: true, unit: true },
          },
        },
      });

      expect(shoppingList?.items).toHaveLength(1);
      expect(shoppingList?.items[0].quantity).toBe(2);
      expect(shoppingList?.items[0].unit?.name).toBe("lbs");
      expect(shoppingList?.items[0].ingredientRef.name).toBe("chicken breast");
    });

    it("should parse dozen phrasing from free-text item", async () => {
      delete process.env.OPENAI_API_KEY;

      const request = await createFormRequest(
        {
          intent: "addItem",
          ingredientText: "a dozen eggs",
        },
        testUserId
      );

      await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const shoppingList = await db.shoppingList.findUnique({
        where: { authorId: testUserId },
        include: {
          items: {
            include: { ingredientRef: true, unit: true },
          },
        },
      });

      expect(shoppingList?.items).toHaveLength(1);
      expect(shoppingList?.items[0].quantity).toBe(12);
      expect(shoppingList?.items[0].unit?.name).toBe("whole");
      expect(shoppingList?.items[0].ingredientRef.name).toBe("eggs");
    });

    it("should return parse draft for ambiguous free-text", async () => {
      delete process.env.OPENAI_API_KEY;

      const request = await createFormRequest(
        {
          intent: "addItem",
          ingredientText: "fresh basil",
        },
        testUserId
      );

      const result = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(result).toMatchObject({
        type: "DataWithResponseInit",
        init: { status: 400 },
        data: {
          errors: {
            parse: "Couldn't confidently parse one item. Review and correct before adding.",
          },
          parseDraft: {
            quantity: "",
            unitName: "",
            ingredientName: "fresh basil",
            isAmbiguous: true,
          },
        },
      });
    });
  });

  describe("action - toggleCheck", () => {
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

      return new UndiciRequest("http://localhost:3000/shopping-list", {
        method: "POST",
        body: formData,
        headers,
      });
    }

    it("should toggle item checked status", async () => {
      const shoppingList = await db.shoppingList.create({
        data: { authorId: testUserId },
      });

      const ingredientRef = await db.ingredientRef.create({
        data: { name: "bread" },
      });

      const item = await db.shoppingListItem.create({
        data: {
          shoppingListId: shoppingList.id,
          ingredientRefId: ingredientRef.id,
          checked: false,
        },
      });

      const request = await createFormRequest(
        {
          intent: "toggleCheck",
          itemId: item.id,
        },
        testUserId
      );

      await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const updatedItem = await db.shoppingListItem.findUnique({
        where: { id: item.id },
      });

      expect(updatedItem?.checked).toBe(true);
      expect(updatedItem?.checkedAt).not.toBeNull();
    });

    it("should move checked item to the bottom by persisted sortIndex", async () => {
      const shoppingList = await db.shoppingList.create({
        data: { authorId: testUserId },
      });

      const [a, b, c] = await Promise.all([
        db.ingredientRef.create({ data: { name: `item_a_${faker.string.alphanumeric(5)}` } }),
        db.ingredientRef.create({ data: { name: `item_b_${faker.string.alphanumeric(5)}` } }),
        db.ingredientRef.create({ data: { name: `item_c_${faker.string.alphanumeric(5)}` } }),
      ]);

      const [itemA, itemB, itemC] = await Promise.all([
        db.shoppingListItem.create({ data: { shoppingListId: shoppingList.id, ingredientRefId: a.id, sortIndex: 0 } }),
        db.shoppingListItem.create({ data: { shoppingListId: shoppingList.id, ingredientRefId: b.id, sortIndex: 1 } }),
        db.shoppingListItem.create({ data: { shoppingListId: shoppingList.id, ingredientRefId: c.id, sortIndex: 2 } }),
      ]);

      const request = await createFormRequest(
        {
          intent: "toggleCheck",
          itemId: itemB.id,
          nextChecked: "true",
        },
        testUserId
      );

      await action({ request, context: { cloudflare: { env: null } }, params: {} } as any);

      const ordered = await db.shoppingListItem.findMany({
        where: { shoppingListId: shoppingList.id, deletedAt: null },
        orderBy: { sortIndex: "asc" },
      });

      expect(ordered.map((item) => item.id)).toEqual([itemA.id, itemC.id, itemB.id]);
      expect(ordered[2].checkedAt).not.toBeNull();
    });
  });

  describe("action - clearCompleted", () => {
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

      return new UndiciRequest("http://localhost:3000/shopping-list", {
        method: "POST",
        body: formData,
        headers,
      });
    }

    it("should delete only checked items", async () => {
      const shoppingList = await db.shoppingList.create({
        data: { authorId: testUserId },
      });

      const ingredientRef1 = await db.ingredientRef.create({
        data: { name: "item1_" + faker.string.alphanumeric(6) },
      });

      const ingredientRef2 = await db.ingredientRef.create({
        data: { name: "item2_" + faker.string.alphanumeric(6) },
      });

      await db.shoppingListItem.create({
        data: {
          shoppingListId: shoppingList.id,
          ingredientRefId: ingredientRef1.id,
          checked: true,
          checkedAt: new Date(),
        },
      });

      await db.shoppingListItem.create({
        data: {
          shoppingListId: shoppingList.id,
          ingredientRefId: ingredientRef2.id,
          checked: false,
        },
      });

      const request = await createFormRequest(
        { intent: "clearCompleted" },
        testUserId
      );

      await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const items = await db.shoppingListItem.findMany({
        where: { shoppingListId: shoppingList.id, deletedAt: null },
      });

      expect(items).toHaveLength(1);
      expect(items[0].checked).toBe(false);
    });

    it("should clear legacy checked rows even when checkedAt is missing", async () => {
      const shoppingList = await db.shoppingList.create({
        data: { authorId: testUserId },
      });

      const ingredientRef = await db.ingredientRef.create({
        data: { name: "legacy_checked_" + faker.string.alphanumeric(6) },
      });

      const legacyItem = await db.shoppingListItem.create({
        data: {
          shoppingListId: shoppingList.id,
          ingredientRefId: ingredientRef.id,
          checked: true,
          checkedAt: null,
        },
      });

      const request = await createFormRequest(
        { intent: "clearCompleted" },
        testUserId
      );

      await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const clearedItem = await db.shoppingListItem.findUnique({
        where: { id: legacyItem.id },
      });

      expect(clearedItem?.deletedAt).not.toBeNull();
    });
  });

  describe("action - removeItem", () => {
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

      return new UndiciRequest("http://localhost:3000/shopping-list", {
        method: "POST",
        body: formData,
        headers,
      });
    }

    it("should remove item from shopping list", async () => {
      const shoppingList = await db.shoppingList.create({
        data: { authorId: testUserId },
      });

      const ingredientRef = await db.ingredientRef.create({
        data: { name: "removable_" + faker.string.alphanumeric(6) },
      });

      const item = await db.shoppingListItem.create({
        data: {
          shoppingListId: shoppingList.id,
          ingredientRefId: ingredientRef.id,
        },
      });

      const request = await createFormRequest(
        {
          intent: "removeItem",
          itemId: item.id,
        },
        testUserId
      );

      await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const deletedItem = await db.shoppingListItem.findUnique({
        where: { id: item.id },
      });

      expect(deletedItem?.deletedAt).not.toBeNull();
    });

    it("should not remove another user's shopping-list item", async () => {
      await db.shoppingList.create({
        data: { authorId: testUserId },
      });
      const otherUser = await createUser(
        db,
        faker.internet.email(),
        faker.internet.username() + "_" + faker.string.alphanumeric(8),
        "testPassword123"
      );
      const otherShoppingList = await db.shoppingList.create({
        data: { authorId: otherUser.id },
      });
      const ingredientRef = await db.ingredientRef.create({
        data: { name: "other_remove_" + faker.string.alphanumeric(6) },
      });
      const otherItem = await db.shoppingListItem.create({
        data: {
          shoppingListId: otherShoppingList.id,
          ingredientRefId: ingredientRef.id,
          deletedAt: null,
        },
      });

      const request = await createFormRequest(
        {
          intent: "removeItem",
          itemId: otherItem.id,
        },
        testUserId
      );

      const result = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const unchangedItem = await db.shoppingListItem.findUnique({
        where: { id: otherItem.id },
      });
      expect(result).toEqual({ data: { success: true }, init: null, type: "DataWithResponseInit" });
      expect(unchangedItem?.deletedAt).toBeNull();
    });

    it("should do nothing when itemId is not provided", async () => {
      await db.shoppingList.create({
        data: { authorId: testUserId },
      });

      const request = await createFormRequest(
        { intent: "removeItem" },
        testUserId
      );

      // Should not throw - returns success even when no action taken
      const result = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(result).toEqual({ data: { success: true }, init: null, type: "DataWithResponseInit" });
    });
  });

  describe("action - clearAll", () => {
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

      return new UndiciRequest("http://localhost:3000/shopping-list", {
        method: "POST",
        body: formData,
        headers,
      });
    }

    it("should delete all items from shopping list", async () => {
      const shoppingList = await db.shoppingList.create({
        data: { authorId: testUserId },
      });

      const ingredientRef1 = await db.ingredientRef.create({
        data: { name: "clearall1_" + faker.string.alphanumeric(6) },
      });

      const ingredientRef2 = await db.ingredientRef.create({
        data: { name: "clearall2_" + faker.string.alphanumeric(6) },
      });

      await db.shoppingListItem.create({
        data: {
          shoppingListId: shoppingList.id,
          ingredientRefId: ingredientRef1.id,
          checked: true,
          checkedAt: new Date(),
        },
      });

      await db.shoppingListItem.create({
        data: {
          shoppingListId: shoppingList.id,
          ingredientRefId: ingredientRef2.id,
          checked: false,
        },
      });

      const request = await createFormRequest(
        { intent: "clearAll" },
        testUserId
      );

      await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const items = await db.shoppingListItem.findMany({
        where: { shoppingListId: shoppingList.id, deletedAt: null },
      });

      expect(items).toHaveLength(0);
    });
  });

  describe("action - addFromRecipe", () => {
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

      return new UndiciRequest("http://localhost:3000/shopping-list", {
        method: "POST",
        body: formData,
        headers,
      });
    }

    it("should add all ingredients from a recipe", async () => {
      // Create recipe with steps and ingredients
      const recipe = await db.recipe.create({
        data: {
          title: "Test Recipe for Shopping",
          chefId: testUserId,
        },
      });

      const step = await db.recipeStep.create({
        data: {
          recipeId: recipe.id,
          stepNum: 1,
          description: "Mix ingredients",
        },
      });

      const unit = await db.unit.create({
        data: { name: "cup_" + faker.string.alphanumeric(6) },
      });

      const ingredientRef = await db.ingredientRef.create({
        data: { name: "flour_" + faker.string.alphanumeric(6) },
      });

      await db.ingredient.create({
        data: {
          recipeId: recipe.id,
          stepNum: step.stepNum,
          quantity: 2,
          unitId: unit.id,
          ingredientRefId: ingredientRef.id,
        },
      });

      const request = await createFormRequest(
        {
          intent: "addFromRecipe",
          recipeId: recipe.id,
        },
        testUserId
      );

      await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const shoppingList = await db.shoppingList.findUnique({
        where: { authorId: testUserId },
        include: {
          items: {
            include: { ingredientRef: true, unit: true },
          },
        },
      });

      expect(shoppingList?.items).toHaveLength(1);
      expect(shoppingList?.items[0].ingredientRef.name).toBe(ingredientRef.name);
      expect(shoppingList?.items[0].quantity).toBe(2);
      expect(shoppingList?.items[0].unit?.name).toBe(unit.name);
    });

    it("should multiply quantities by submitted scaleFactor when adding from recipe", async () => {
      const recipe = await db.recipe.create({
        data: {
          title: "Scaled Shopping Recipe",
          chefId: testUserId,
        },
      });

      await db.recipeStep.create({
        data: {
          recipeId: recipe.id,
          stepNum: 1,
          description: "Scale me",
        },
      });

      const unit = await db.unit.create({
        data: { name: "cup_scaled_" + faker.string.alphanumeric(6) },
      });
      const ingredientRef = await db.ingredientRef.create({
        data: { name: "milk_scaled_" + faker.string.alphanumeric(6) },
      });

      await db.ingredient.create({
        data: {
          recipeId: recipe.id,
          stepNum: 1,
          quantity: 1.5,
          unitId: unit.id,
          ingredientRefId: ingredientRef.id,
        },
      });

      const request = await createFormRequest(
        {
          intent: "addFromRecipe",
          recipeId: recipe.id,
          scaleFactor: "2",
        },
        testUserId
      );

      await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const shoppingList = await db.shoppingList.findUnique({
        where: { authorId: testUserId },
        include: {
          items: {
            include: { ingredientRef: true, unit: true },
          },
        },
      });

      expect(shoppingList?.items).toHaveLength(1);
      expect(shoppingList?.items[0].ingredientRef.name).toBe(ingredientRef.name);
      expect(shoppingList?.items[0].quantity).toBe(3);
      expect(shoppingList?.items[0].unit?.name).toBe(unit.name);
    });

    it("should add ingredients from multiple steps", async () => {
      // Create recipe with multiple steps
      const recipe = await db.recipe.create({
        data: {
          title: "Multi Step Recipe",
          chefId: testUserId,
        },
      });

      await db.recipeStep.create({
        data: {
          recipeId: recipe.id,
          stepNum: 1,
          description: "Step 1",
        },
      });

      await db.recipeStep.create({
        data: {
          recipeId: recipe.id,
          stepNum: 2,
          description: "Step 2",
        },
      });

      const unit1 = await db.unit.create({
        data: { name: "tsp_" + faker.string.alphanumeric(6) },
      });

      const unit2 = await db.unit.create({
        data: { name: "tbsp_" + faker.string.alphanumeric(6) },
      });

      const ingredientRef1 = await db.ingredientRef.create({
        data: { name: "salt_" + faker.string.alphanumeric(6) },
      });

      const ingredientRef2 = await db.ingredientRef.create({
        data: { name: "pepper_" + faker.string.alphanumeric(6) },
      });

      await db.ingredient.create({
        data: {
          recipeId: recipe.id,
          stepNum: 1,
          quantity: 1,
          unitId: unit1.id,
          ingredientRefId: ingredientRef1.id,
        },
      });

      await db.ingredient.create({
        data: {
          recipeId: recipe.id,
          stepNum: 2,
          quantity: 0.5,
          unitId: unit2.id,
          ingredientRefId: ingredientRef2.id,
        },
      });

      const request = await createFormRequest(
        {
          intent: "addFromRecipe",
          recipeId: recipe.id,
        },
        testUserId
      );

      await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const shoppingList = await db.shoppingList.findUnique({
        where: { authorId: testUserId },
        include: { items: true },
      });

      expect(shoppingList?.items).toHaveLength(2);
    });

    it("should update quantity when ingredient already exists in shopping list", async () => {
      // Create shopping list with existing item
      const shoppingList = await db.shoppingList.create({
        data: { authorId: testUserId },
      });

      const unit = await db.unit.create({
        data: { name: "cup_existing_" + faker.string.alphanumeric(6) },
      });

      const ingredientRef = await db.ingredientRef.create({
        data: { name: "sugar_existing_" + faker.string.alphanumeric(6) },
      });

      await db.shoppingListItem.create({
        data: {
          shoppingListId: shoppingList.id,
          quantity: 1,
          unitId: unit.id,
          ingredientRefId: ingredientRef.id,
          checked: true,
          checkedAt: new Date(),
        },
      });

      // Create recipe with same ingredient
      const recipe = await db.recipe.create({
        data: {
          title: "Recipe with existing ingredient",
          chefId: testUserId,
        },
      });

      await db.recipeStep.create({
        data: {
          recipeId: recipe.id,
          stepNum: 1,
          description: "Mix",
        },
      });

      await db.ingredient.create({
        data: {
          recipeId: recipe.id,
          stepNum: 1,
          quantity: 2,
          unitId: unit.id,
          ingredientRefId: ingredientRef.id,
        },
      });

      const request = await createFormRequest(
        {
          intent: "addFromRecipe",
          recipeId: recipe.id,
        },
        testUserId
      );

      await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const updatedList = await db.shoppingList.findUnique({
        where: { authorId: testUserId },
        include: { items: true },
      });

      expect(updatedList?.items).toHaveLength(1);
      expect(updatedList?.items[0].quantity).toBe(3); // 1 + 2
      expect(updatedList?.items[0].checked).toBe(false);
      expect(updatedList?.items[0].checkedAt).toBeNull();
    });

    it("should restore a soft-deleted recipe ingredient as unchecked at the end", async () => {
      const shoppingList = await db.shoppingList.create({
        data: { authorId: testUserId },
      });

      const activeRef = await db.ingredientRef.create({
        data: { name: "recipe_restore_anchor_" + faker.string.alphanumeric(6) },
      });
      await db.shoppingListItem.create({
        data: {
          shoppingListId: shoppingList.id,
          ingredientRefId: activeRef.id,
          sortIndex: 0,
        },
      });

      const unit = await db.unit.create({
        data: { name: "cup_recipe_restore_" + faker.string.alphanumeric(6) },
      });
      const ingredientRef = await db.ingredientRef.create({
        data: { name: "beans_recipe_restore_" + faker.string.alphanumeric(6) },
      });
      const deletedItem = await db.shoppingListItem.create({
        data: {
          shoppingListId: shoppingList.id,
          quantity: 1,
          unitId: unit.id,
          ingredientRefId: ingredientRef.id,
          checked: true,
          checkedAt: new Date(),
          deletedAt: new Date(),
          sortIndex: 0,
        },
      });

      const recipe = await db.recipe.create({
        data: {
          title: "Recipe restoring deleted shopping item",
          chefId: testUserId,
        },
      });
      await db.recipeStep.create({
        data: {
          recipeId: recipe.id,
          stepNum: 1,
          description: "Restore",
        },
      });
      await db.ingredient.create({
        data: {
          recipeId: recipe.id,
          stepNum: 1,
          quantity: 2,
          unitId: unit.id,
          ingredientRefId: ingredientRef.id,
        },
      });

      const request = await createFormRequest(
        {
          intent: "addFromRecipe",
          recipeId: recipe.id,
        },
        testUserId
      );

      await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const restored = await db.shoppingListItem.findUnique({
        where: { id: deletedItem.id },
      });

      expect(restored?.quantity).toBe(3);
      expect(restored?.checked).toBe(false);
      expect(restored?.checkedAt).toBeNull();
      expect(restored?.deletedAt).toBeNull();
      expect(restored?.sortIndex).toBe(1);
    });

    it("should do nothing when recipeId is not provided", async () => {
      await db.shoppingList.create({
        data: { authorId: testUserId },
      });

      const request = await createFormRequest(
        { intent: "addFromRecipe" },
        testUserId
      );

      const result = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      // Returns success even when no action taken (no recipeId provided)
      expect(result).toEqual({ data: { success: true }, init: null, type: "DataWithResponseInit" });
    });

    it("should throw 404 when recipe does not exist", async () => {
      await db.shoppingList.create({
        data: { authorId: testUserId },
      });

      const request = await createFormRequest(
        {
          intent: "addFromRecipe",
          recipeId: "nonexistent-recipe-id",
        },
        testUserId
      );

      await expect(
        action({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any)
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(Response);
        expect(error.status).toBe(404);
        return true;
      });
    });
  });

  describe("action - addItem edge cases", () => {
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

      return new UndiciRequest("http://localhost:3000/shopping-list", {
        method: "POST",
        body: formData,
        headers,
      });
    }

    it("should add item with unit", async () => {
      const ingredientName = "eggs_" + faker.string.alphanumeric(6);
      const request = await createFormRequest(
        {
          intent: "addItem",
          ingredientName: ingredientName,
          quantity: "12",
          unitName: "pieces_" + faker.string.alphanumeric(6),
        },
        testUserId
      );

      await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const shoppingList = await db.shoppingList.findUnique({
        where: { authorId: testUserId },
        include: {
          items: {
            include: { ingredientRef: true, unit: true },
          },
        },
      });

      expect(shoppingList?.items).toHaveLength(1);
      expect(shoppingList?.items[0].quantity).toBe(12);
      expect(shoppingList?.items[0].unitId).not.toBeNull();
    });

    it("should add item without quantity (but with unit)", async () => {
      const ingredientName = "avocados_" + faker.string.alphanumeric(6);
      const unitName = "whole_" + faker.string.alphanumeric(6);
      const request = await createFormRequest(
        {
          intent: "addItem",
          ingredientName: ingredientName,
          unitName: unitName,
        },
        testUserId
      );

      await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const shoppingList = await db.shoppingList.findUnique({
        where: { authorId: testUserId },
        include: {
          items: {
            include: { ingredientRef: true },
          },
        },
      });

      expect(shoppingList?.items).toHaveLength(1);
      expect(shoppingList?.items[0].quantity).toBeNull();
      expect(shoppingList?.items[0].ingredientRef.name).toBe(ingredientName.toLowerCase());
    });

    it("should do nothing when ingredientName is empty", async () => {
      await db.shoppingList.create({
        data: { authorId: testUserId },
      });

      const request = await createFormRequest(
        {
          intent: "addItem",
          ingredientName: "",
          quantity: "5",
        },
        testUserId
      );

      await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const shoppingList = await db.shoppingList.findUnique({
        where: { authorId: testUserId },
        include: { items: true },
      });

      expect(shoppingList?.items).toHaveLength(0);
    });

    it("should update existing item quantity when quantity is not provided for new add", async () => {
      // Create initial shopping list and item
      // Note: names must be lowercase to match how the action normalizes them
      const shoppingList = await db.shoppingList.create({
        data: { authorId: testUserId },
      });

      const ingredientName = ("tomatoes_" + faker.string.alphanumeric(6)).toLowerCase();
      const unitName = ("lbs_" + faker.string.alphanumeric(6)).toLowerCase();

      const ingredientRef = await db.ingredientRef.create({
        data: { name: ingredientName },
      });

      const unit = await db.unit.create({
        data: { name: unitName },
      });

      await db.shoppingListItem.create({
        data: {
          shoppingListId: shoppingList.id,
          ingredientRefId: ingredientRef.id,
          unitId: unit.id,
          quantity: 5,
        },
      });

      // Add same item again without quantity (same unit - action normalizes to lowercase)
      const request = await createFormRequest(
        {
          intent: "addItem",
          ingredientName: ingredientName,
          unitName: unitName,
        },
        testUserId
      );

      await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const updatedList = await db.shoppingList.findUnique({
        where: { authorId: testUserId },
        include: { items: true },
      });

      // Should still be 1 item with same quantity (no quantity added)
      expect(updatedList?.items).toHaveLength(1);
      expect(updatedList?.items[0].quantity).toBe(5);
    });

    it("should reactivate a checked manual item as unchecked when adding it again", async () => {
      const shoppingList = await db.shoppingList.create({
        data: { authorId: testUserId },
      });

      const ingredientName = ("checked_restore_" + faker.string.alphanumeric(6)).toLowerCase();
      const unitName = ("bunch_" + faker.string.alphanumeric(6)).toLowerCase();
      const ingredientRef = await db.ingredientRef.create({ data: { name: ingredientName } });
      const unit = await db.unit.create({ data: { name: unitName } });

      const existingItem = await db.shoppingListItem.create({
        data: {
          shoppingListId: shoppingList.id,
          ingredientRefId: ingredientRef.id,
          unitId: unit.id,
          quantity: 1,
          checked: true,
          checkedAt: new Date(),
          sortIndex: 0,
        },
      });

      const request = await createFormRequest(
        {
          intent: "addItem",
          ingredientName,
          unitName,
          quantity: "2",
        },
        testUserId
      );

      await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const restored = await db.shoppingListItem.findUnique({
        where: { id: existingItem.id },
      });

      expect(restored?.quantity).toBe(3);
      expect(restored?.checked).toBe(false);
      expect(restored?.checkedAt).toBeNull();
      expect(restored?.deletedAt).toBeNull();
      expect(restored?.sortIndex).toBe(1);
    });

    it("should restore a soft-deleted manual item at the end of the active list", async () => {
      const shoppingList = await db.shoppingList.create({
        data: { authorId: testUserId },
      });

      const activeRef = await db.ingredientRef.create({
        data: { name: "active_restore_anchor_" + faker.string.alphanumeric(6) },
      });
      await db.shoppingListItem.create({
        data: {
          shoppingListId: shoppingList.id,
          ingredientRefId: activeRef.id,
          sortIndex: 0,
        },
      });

      const ingredientName = ("deleted_restore_" + faker.string.alphanumeric(6)).toLowerCase();
      const unitName = ("bag_" + faker.string.alphanumeric(6)).toLowerCase();
      const ingredientRef = await db.ingredientRef.create({ data: { name: ingredientName } });
      const unit = await db.unit.create({ data: { name: unitName } });

      const deletedItem = await db.shoppingListItem.create({
        data: {
          shoppingListId: shoppingList.id,
          ingredientRefId: ingredientRef.id,
          unitId: unit.id,
          quantity: 4,
          checked: true,
          checkedAt: new Date(),
          deletedAt: new Date(),
          sortIndex: 0,
        },
      });

      const request = await createFormRequest(
        {
          intent: "addItem",
          ingredientName,
          unitName,
          quantity: "1",
        },
        testUserId
      );

      await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const restored = await db.shoppingListItem.findUnique({
        where: { id: deletedItem.id },
      });

      expect(restored?.quantity).toBe(5);
      expect(restored?.checked).toBe(false);
      expect(restored?.checkedAt).toBeNull();
      expect(restored?.deletedAt).toBeNull();
      expect(restored?.sortIndex).toBe(1);
    });
  });

  describe("action - toggleCheck edge cases", () => {
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

      return new UndiciRequest("http://localhost:3000/shopping-list", {
        method: "POST",
        body: formData,
        headers,
      });
    }

    it("should do nothing when itemId is not provided", async () => {
      await db.shoppingList.create({
        data: { authorId: testUserId },
      });

      const request = await createFormRequest(
        { intent: "toggleCheck" },
        testUserId
      );

      const result = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      // Returns success even when no action taken (no itemId provided)
      expect(result).toEqual({ data: { success: true }, init: null, type: "DataWithResponseInit" });
    });

    it("should do nothing when item does not exist", async () => {
      await db.shoppingList.create({
        data: { authorId: testUserId },
      });

      const request = await createFormRequest(
        {
          intent: "toggleCheck",
          itemId: "nonexistent-item-id",
        },
        testUserId
      );

      const result = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      // Returns success even when no action taken (item not found)
      expect(result).toEqual({ data: { success: true }, init: null, type: "DataWithResponseInit" });
    });

    it("should not toggle another user's shopping-list item", async () => {
      await db.shoppingList.create({
        data: { authorId: testUserId },
      });
      const otherUser = await createUser(
        db,
        faker.internet.email(),
        faker.internet.username() + "_" + faker.string.alphanumeric(8),
        "testPassword123"
      );
      const otherShoppingList = await db.shoppingList.create({
        data: { authorId: otherUser.id },
      });
      const ingredientRef = await db.ingredientRef.create({
        data: { name: "other_toggle_" + faker.string.alphanumeric(6) },
      });
      const otherItem = await db.shoppingListItem.create({
        data: {
          shoppingListId: otherShoppingList.id,
          ingredientRefId: ingredientRef.id,
          checked: false,
          checkedAt: null,
        },
      });

      const request = await createFormRequest(
        {
          intent: "toggleCheck",
          itemId: otherItem.id,
          nextChecked: "true",
        },
        testUserId
      );

      const result = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const unchangedItem = await db.shoppingListItem.findUnique({
        where: { id: otherItem.id },
      });
      expect(result).toEqual({ data: { success: true }, init: null, type: "DataWithResponseInit" });
      expect(unchangedItem?.checked).toBe(false);
      expect(unchangedItem?.checkedAt).toBeNull();
    });

    it("should toggle checked item back to unchecked", async () => {
      const shoppingList = await db.shoppingList.create({
        data: { authorId: testUserId },
      });

      const ingredientRef = await db.ingredientRef.create({
        data: { name: "toggle_back_" + faker.string.alphanumeric(6) },
      });

      const item = await db.shoppingListItem.create({
        data: {
          shoppingListId: shoppingList.id,
          ingredientRefId: ingredientRef.id,
          checked: true,
          checkedAt: new Date(),
        },
      });

      const request = await createFormRequest(
        {
          intent: "toggleCheck",
          itemId: item.id,
        },
        testUserId
      );

      await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const updatedItem = await db.shoppingListItem.findUnique({
        where: { id: item.id },
      });

      expect(updatedItem?.checked).toBe(false);
      expect(updatedItem?.checkedAt).toBeNull();
    });
  });

  describe("action - unknown intent", () => {
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

      return new UndiciRequest("http://localhost:3000/shopping-list", {
        method: "POST",
        body: formData,
        headers,
      });
    }

    it("should return null for unknown intent", async () => {
      await db.shoppingList.create({
        data: { authorId: testUserId },
      });

      const request = await createFormRequest(
        { intent: "unknownIntent" },
        testUserId
      );

      const result = await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(result).toBeNull();
    });
  });

  describe("action - creates shopping list if not exists", () => {
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

      return new UndiciRequest("http://localhost:3000/shopping-list", {
        method: "POST",
        body: formData,
        headers,
      });
    }

    it("should create shopping list when adding item if none exists", async () => {
      // Ensure no shopping list exists
      const existingList = await db.shoppingList.findUnique({
        where: { authorId: testUserId },
      });
      expect(existingList).toBeNull();

      const request = await createFormRequest(
        {
          intent: "addItem",
          ingredientName: "new_list_item_" + faker.string.alphanumeric(6),
          quantity: "1",
          unitName: "unit_" + faker.string.alphanumeric(6),
        },
        testUserId
      );

      await action({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      const shoppingList = await db.shoppingList.findUnique({
        where: { authorId: testUserId },
        include: { items: true },
      });

      expect(shoppingList).not.toBeNull();
      expect(shoppingList?.items).toHaveLength(1);
    });
  });

  describe("parseShoppingItemFallback", () => {
    it("parses quantity/unit/ingredient from standard text", () => {
      expect(parseShoppingItemFallback("2 lbs chicken breast")).toMatchObject({
        quantity: "2",
        unitName: "lbs",
        ingredientName: "chicken breast",
        isAmbiguous: false,
      });
    });

    it("parses dozen phrasing", () => {
      expect(parseShoppingItemFallback("a dozen eggs")).toMatchObject({
        quantity: "12",
        unitName: "whole",
        ingredientName: "eggs",
        isAmbiguous: false,
      });
    });

    it("flags ambiguous text without quantity", () => {
      expect(parseShoppingItemFallback("olive oil")).toMatchObject({
        quantity: "",
        unitName: "",
        ingredientName: "olive oil",
        isAmbiguous: true,
      });
    });

    it("should parse mixed fractions, simple fractions, and whole-count items", () => {
      expect(parseShoppingItemFallback("1 1/2 cups oats")).toMatchObject({
        quantity: "1.5",
        unitName: "cups",
        ingredientName: "oats",
        isAmbiguous: false,
      });
      expect(parseShoppingItemFallback("1/2 tsp salt")).toMatchObject({
        quantity: "0.5",
        unitName: "tsp",
        ingredientName: "salt",
        isAmbiguous: false,
      });
      expect(parseShoppingItemFallback("2 apples")).toMatchObject({
        quantity: "2",
        unitName: "whole",
        ingredientName: "apples",
        isAmbiguous: false,
      });
    });

    it("should flag empty and invalid quantity text as ambiguous", () => {
      expect(parseShoppingItemFallback("   ")).toMatchObject({
        quantity: "",
        unitName: "",
        ingredientName: "",
        isAmbiguous: true,
        originalText: "   ",
      });
      expect(parseShoppingItemFallback("1/0 cup flour")).toMatchObject({
        quantity: "",
        unitName: "",
        ingredientName: "1/0 cup flour",
        isAmbiguous: true,
      });
      expect(parseShoppingItemFallback("1 1/0 cup flour")).toMatchObject({
        quantity: "",
        unitName: "",
        ingredientName: "1 1/0 cup flour",
        isAmbiguous: true,
      });
      expect(__internal__.parseFractionToken("not-a-number")).toBeNull();
    });
  });
});
