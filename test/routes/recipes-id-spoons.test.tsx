import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Request as UndiciRequest, FormData as UndiciFormData } from "undici";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { faker } from "@faker-js/faker";
import { createTestRoutesStub } from "../utils";
import { db } from "~/lib/db.server";
import { ToastProvider } from "~/components/ui/toast";

vi.mock("~/components/navigation", async () => {
  const actual = await vi.importActual<typeof import("~/components/navigation")>(
    "~/components/navigation",
  );
  return {
    ...actual,
    shareContent: vi.fn(async () => ({ success: true, method: "native" })),
    useRecipeDetailActions: vi.fn(),
  };
});

import { loader, action } from "~/routes/recipes.$id";
import RecipeDetail from "~/routes/recipes.$id";
import { createUser } from "~/lib/auth.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";

function extractResponseData(response: any): { data: any; status: number } {
  if (response && typeof response === "object" && response.type === "DataWithResponseInit") {
    return { data: response.data, status: response.init?.status || 200 };
  }
  if (response instanceof Response) {
    return { data: null, status: response.status };
  }
  return { data: response, status: 200 };
}

function uniqueEmail(prefix = "spoon") {
  return `${prefix}-${faker.string.alphanumeric(8).toLowerCase()}@example.com`;
}

function validImageFile(name: string, type: "image/png" | "image/jpeg" | "image/webp" = "image/png"): File {
  const bytes =
    type === "image/png"
      ? new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
      : type === "image/jpeg"
        ? new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xda])
        : new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
  return new File([bytes], name, { type });
}

async function createSessionCookie(userId: string): Promise<string> {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  const setCookie = await sessionStorage.commitSession(session);
  return setCookie.split(";")[0];
}

describe("Recipes $id route — spoons + provenance", () => {
  let chefUserId: string;
  let cookUserId: string;
  let recipeId: string;
  let chefSessionCookie: string;
  let cookSessionCookie: string;

  beforeEach(async () => {
    await cleanupDatabase();
    const chef = await createUser(
      db,
      uniqueEmail("chef"),
      `chef_${faker.string.alphanumeric(8).toLowerCase()}`,
      "testPassword123",
    );
    const cook = await createUser(
      db,
      uniqueEmail("cook"),
      `cook_${faker.string.alphanumeric(8).toLowerCase()}`,
      "testPassword123",
    );
    chefUserId = chef.id;
    cookUserId = cook.id;
    const recipe = await db.recipe.create({
      data: {
        title: `Spoon Detail ${faker.string.alphanumeric(6)}`,
        chefId: chefUserId,
        sourceUrl: "https://nyt.com/recipes/spoon-detail",
      },
    });
    recipeId = recipe.id;
    chefSessionCookie = await createSessionCookie(chefUserId);
    cookSessionCookie = await createSessionCookie(cookUserId);
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("loader returns spoons (recent 10), isOriginCookCandidate, and coverImageUrl", async () => {
    await db.recipeSpoon.create({
      data: { chefId: cookUserId, recipeId, note: "first" },
    });
    const request = new UndiciRequest("http://localhost/recipes/x", {
      method: "GET",
      headers: { cookie: chefSessionCookie },
    }) as unknown as Request;
    const response = await loader({
      request,
      params: { id: recipeId },
      context: { cloudflare: { env: null } } as any,
    });
    const { data } = extractResponseData(response);
    expect(data.spoons).toHaveLength(1);
    expect(data.spoons[0].note).toBe("first");
    expect(data.isOriginCookCandidate).toBe(true);
    expect(data.coverImageUrl).toBeNull();
  });

  it("loader returns isOriginCookCandidate=false when the chef already has a spoon", async () => {
    await db.recipeSpoon.create({
      data: {
        chefId: chefUserId,
        recipeId,
        photoUrl: "/photos/x.png",
      },
    });
    const request = new UndiciRequest("http://localhost/recipes/x", {
      method: "GET",
      headers: { cookie: chefSessionCookie },
    }) as unknown as Request;
    const response = await loader({
      request,
      params: { id: recipeId },
      context: { cloudflare: { env: null } } as any,
    });
    const { data } = extractResponseData(response);
    expect(data.isOriginCookCandidate).toBe(false);
  });

  it("renders RecipeProvenance when sourceUrl is set", async () => {
    const mockData = {
      recipe: {
        id: "r1",
        title: "Mock Recipe",
        description: null,
        servings: null,
        sourceUrl: "https://nyt.com/recipes/spoon-detail",
        chef: { id: "c1", username: "testchef", photoUrl: null },
        steps: [],
      },
      coverImageUrl: "/p.png",
      isOwner: false,
      cookbooks: [],
      savedInCookbookIds: [],
      hasIngredientsInShoppingList: false,
      spoons: [],
      isOriginCookCandidate: false,
    };
    const Stub = createTestRoutesStub([
      {
        path: "/recipes/:id",
        Component: () => (
          <ToastProvider>
            <RecipeDetail />
          </ToastProvider>
        ),
        loader: () => mockData,
      },
    ]);
    render(<Stub initialEntries={["/recipes/r1"]} />);
    await waitFor(() => {
      expect(screen.getByText(/originally from/i)).toBeInTheDocument();
    });
    expect(
      screen.getByRole("link", { name: /nyt\.com/i }),
    ).toHaveAttribute("href", "https://nyt.com/recipes/spoon-detail");
  });

  it("renders RecipeProvenance in the header when sourceRecipe is set without sourceUrl", async () => {
    const mockData = {
      recipe: {
        id: "r1",
        title: "Mock Fork",
        description: null,
        servings: null,
        sourceUrl: null,
        sourceRecipe: {
          id: "source-1",
          title: "Original Stew",
          deletedAt: null,
          chef: { username: "originchef" },
        },
        chef: { id: "c1", username: "testchef", photoUrl: null },
        steps: [],
      },
      coverImageUrl: "/p.png",
      isOwner: false,
      cookbooks: [],
      savedInCookbookIds: [],
      hasIngredientsInShoppingList: false,
      spoons: [],
      isOriginCookCandidate: false,
    };
    const Stub = createTestRoutesStub([
      {
        path: "/recipes/:id",
        Component: () => (
          <ToastProvider>
            <RecipeDetail />
          </ToastProvider>
        ),
        loader: () => mockData,
      },
    ]);
    render(<Stub initialEntries={["/recipes/r1"]} />);
    await waitFor(() => {
      expect(screen.getByTestId("recipe-header-provenance")).toHaveTextContent("forked from");
    });
    expect(screen.getByRole("link", { name: /originchef/i })).toHaveAttribute("href", "/recipes/source-1");
  });

  it("renders SpoonsStrip with non-deleted spoons from the loader", async () => {
    const mockData = {
      recipe: {
        id: "r1",
        title: "Mock Recipe",
        description: null,
        servings: null,
        sourceUrl: null,
        chef: { id: "c1", username: "testchef", photoUrl: null },
        steps: [],
      },
      coverImageUrl: "/p.png",
      isOwner: false,
      cookbooks: [],
      savedInCookbookIds: [],
      hasIngredientsInShoppingList: false,
      spoons: [
        {
          id: "s1",
          cookedAt: new Date().toISOString(),
          photoUrl: null,
          note: "fan note",
          nextTime: null,
          chef: { id: "c2", username: "cook", photoUrl: null },
        },
      ],
      isOriginCookCandidate: false,
    };
    const Stub = createTestRoutesStub([
      {
        path: "/recipes/:id",
        Component: () => (
          <ToastProvider>
            <RecipeDetail />
          </ToastProvider>
        ),
        loader: () => mockData,
      },
    ]);
    render(<Stub initialEntries={["/recipes/r1"]} />);
    await waitFor(() => {
      expect(screen.getByText("fan note")).toBeInTheDocument();
    });
  });

  it("clicking 'Log cook' opens then closes the SpoonDialog via Cancel", async () => {
    const mockData = {
      recipe: {
        id: "r1",
        title: "Mock Recipe",
        description: null,
        servings: null,
        sourceUrl: null,
        chef: { id: "c1", username: "testchef", photoUrl: null },
        steps: [],
      },
      coverImageUrl: "/p.png",
      isOwner: false,
      cookbooks: [],
      savedInCookbookIds: [],
      hasIngredientsInShoppingList: false,
      spoons: [],
      isOriginCookCandidate: false,
    };
    const Stub = createTestRoutesStub([
      {
        path: "/recipes/:id",
        Component: () => (
          <ToastProvider>
            <RecipeDetail />
          </ToastProvider>
        ),
        loader: () => mockData,
      },
    ]);
    render(<Stub initialEntries={["/recipes/r1"]} />);
    const open = await screen.findByRole("button", { name: /log cook/i });
    await userEvent.click(open);
    expect(await screen.findByRole("heading", { name: /log a cook/i })).toBeInTheDocument();
    const cancel = screen.getByRole("button", { name: /cancel/i });
    await userEvent.click(cancel);
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: /log a cook/i })).toBeNull();
    });
  });

  it("clicking 'Log cook' opens the SpoonDialog", async () => {
    const mockData = {
      recipe: {
        id: "r1",
        title: "Mock Recipe",
        description: null,
        servings: null,
        sourceUrl: null,
        chef: { id: "c1", username: "testchef", photoUrl: null },
        steps: [],
      },
      coverImageUrl: "/p.png",
      isOwner: false,
      cookbooks: [],
      savedInCookbookIds: [],
      hasIngredientsInShoppingList: false,
      spoons: [],
      isOriginCookCandidate: false,
    };
    const Stub = createTestRoutesStub([
      {
        path: "/recipes/:id",
        Component: () => (
          <ToastProvider>
            <RecipeDetail />
          </ToastProvider>
        ),
        loader: () => mockData,
      },
    ]);
    render(<Stub initialEntries={["/recipes/r1"]} />);
    const open = await screen.findByRole("button", { name: /log cook/i });
    await userEvent.click(open);
    expect(await screen.findByRole("heading", { name: /log a cook/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^note/i)).toBeInTheDocument();
  });

  it("closes the SpoonDialog and shows a status toast after a successful cook log", async () => {
    const mockData = {
      recipe: {
        id: "r1",
        title: "Mock Recipe",
        description: null,
        servings: null,
        sourceUrl: null,
        chef: { id: "c1", username: "testchef", photoUrl: null },
        steps: [],
      },
      coverImageUrl: "/p.png",
      isOwner: false,
      cookbooks: [],
      savedInCookbookIds: [],
      hasIngredientsInShoppingList: false,
      spoons: [],
      isOriginCookCandidate: false,
    };
    let actionCalls = 0;
    const Stub = createTestRoutesStub([
      {
        path: "/recipes/:id",
        Component: () => (
          <ToastProvider>
            <RecipeDetail />
          </ToastProvider>
        ),
        loader: () => mockData,
        action: async ({ request }: { request: Request }) => {
          actionCalls += 1;
          await request.formData();
          return { success: true, intent: "createSpoon", spoon: { id: "spoon-1" } };
        },
      },
    ]);

    render(<Stub initialEntries={["/recipes/r1"]} />);
    await userEvent.click(await screen.findByRole("button", { name: /log cook/i }));
    await userEvent.type(await screen.findByLabelText(/^note/i), "saved once");
    await userEvent.click(screen.getByRole("button", { name: /save spoon/i }));

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: /log a cook/i })).toBeNull();
    });
    expect(actionCalls).toBe(1);
    expect(screen.getByRole("status")).toHaveTextContent("Cook logged.");
  });

  it("action with intent=createSpoon creates a RecipeSpoon as the requesting user", async () => {
    const fd = new UndiciFormData();
    fd.append("intent", "createSpoon");
    fd.append("note", "delicious");
    const request = new UndiciRequest("http://localhost/recipes/x", {
      method: "POST",
      headers: { cookie: cookSessionCookie },
      body: fd,
    }) as unknown as Request;
    const response = await action({
      request,
      params: { id: recipeId },
      context: { cloudflare: { env: null } } as any,
    });
    const { data } = extractResponseData(response);
    expect(data?.success).toBe(true);
    const stored = await db.recipeSpoon.findMany({
      where: { recipeId, chefId: cookUserId },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0].note).toBe("delicious");
  });

  it("action with intent=createSpoon as the origin cook writes a RecipeCover row and attempts stylization inline", async () => {
    const fd = new UndiciFormData();
    fd.append("intent", "createSpoon");
    fd.append("photo", validImageFile("spoon.png"));
    const captured: Promise<unknown>[] = [];
    const waitUntil = vi.fn((promise: Promise<unknown>) => {
      captured.push(promise);
    });
    const request = new UndiciRequest("http://localhost/recipes/x", {
      method: "POST",
      headers: { cookie: chefSessionCookie },
      body: fd,
    }) as unknown as Request;
    const response = await action({
      request,
      params: { id: recipeId },
      context: {
        cloudflare: { env: null, ctx: { waitUntil } as any },
      } as any,
    });
    const { data } = extractResponseData(response);
    expect(data?.success).toBe(true);
    const covers = await db.recipeCover.findMany({ where: { recipeId } });
    expect(covers).toHaveLength(1);
    expect(covers[0].sourceType).toBe("spoon");
    expect(covers[0].sourceSpoonId).not.toBeNull();
    expect(waitUntil).not.toHaveBeenCalled();
    expect(captured).toHaveLength(0);
  });

  it("action with intent=createSpoon rejects a GIF spoon photo with 400", async () => {
    const fd = new UndiciFormData();
    fd.append("intent", "createSpoon");
    fd.append("photo", new File([new TextEncoder().encode("GIF89a")], "animated.gif", { type: "image/gif" }));
    const request = new UndiciRequest("http://localhost/recipes/x", {
      method: "POST",
      headers: { cookie: chefSessionCookie },
      body: fd,
    }) as unknown as Request;

    let caught: unknown = null;
    try {
      await action({
        request,
        params: { id: recipeId },
        context: { cloudflare: { env: null } } as any,
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(Response);
    expect((caught as Response).status).toBe(400);
    expect(await (caught as Response).text()).toBe("Photos must be JPG, PNG, or WebP.");
  });

  it("action with intent=createSpoon rejects an empty payload with 400", async () => {
    const fd = new UndiciFormData();
    fd.append("intent", "createSpoon");
    const request = new UndiciRequest("http://localhost/recipes/x", {
      method: "POST",
      headers: { cookie: cookSessionCookie },
      body: fd,
    }) as unknown as Request;
    let caught: unknown = null;
    try {
      await action({
        request,
        params: { id: recipeId },
        context: { cloudflare: { env: null } } as any,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Response);
    expect((caught as Response).status).toBe(400);
  });

  it("action with intent=deleteSpoon soft-deletes a spoon owned by the requester", async () => {
    const spoon = await db.recipeSpoon.create({
      data: { chefId: cookUserId, recipeId, note: "to delete" },
    });
    const fd = new UndiciFormData();
    fd.append("intent", "deleteSpoon");
    fd.append("spoonId", spoon.id);
    const request = new UndiciRequest("http://localhost/recipes/x", {
      method: "POST",
      headers: { cookie: cookSessionCookie },
      body: fd,
    }) as unknown as Request;
    const response = await action({
      request,
      params: { id: recipeId },
      context: { cloudflare: { env: null } } as any,
    });
    const { data } = extractResponseData(response);
    expect(data?.success).toBe(true);
    const reloaded = await db.recipeSpoon.findUniqueOrThrow({
      where: { id: spoon.id },
    });
    expect(reloaded.deletedAt).not.toBeNull();
  });

  it("action with intent=createSpoon stores a nextTime field when supplied", async () => {
    const fd = new UndiciFormData();
    fd.append("intent", "createSpoon");
    fd.append("nextTime", "more thyme");
    const request = new UndiciRequest("http://localhost/recipes/x", {
      method: "POST",
      headers: { cookie: cookSessionCookie },
      body: fd,
    }) as unknown as Request;
    const response = await action({
      request,
      params: { id: recipeId },
      context: {
        cloudflare: { env: { OPENAI_API_KEY: "test-key" } },
      } as any,
    });
    const { data } = extractResponseData(response);
    expect(data?.success).toBe(true);
    const spoons = await db.recipeSpoon.findMany({
      where: { recipeId, chefId: cookUserId },
    });
    expect(spoons).toHaveLength(1);
    expect(spoons[0].nextTime).toBe("more thyme");
  });

  it("action with intent=createSpoon accepts a valid cookedAt timestamp", async () => {
    const fd = new UndiciFormData();
    fd.append("intent", "createSpoon");
    fd.append("note", "ok");
    fd.append("cookedAt", "2025-08-15T10:30");
    const request = new UndiciRequest("http://localhost/recipes/x", {
      method: "POST",
      headers: { cookie: cookSessionCookie },
      body: fd,
    }) as unknown as Request;
    const response = await action({
      request,
      params: { id: recipeId },
      context: { cloudflare: { env: null } } as any,
    });
    const { data } = extractResponseData(response);
    expect(data?.success).toBe(true);
    const spoons = await db.recipeSpoon.findMany({
      where: { recipeId, chefId: cookUserId },
    });
    expect(spoons).toHaveLength(1);
  });

  it("action with intent=createSpoon rejects an invalid cookedAt with 400", async () => {
    const fd = new UndiciFormData();
    fd.append("intent", "createSpoon");
    fd.append("note", "ok");
    fd.append("cookedAt", "not a date");
    const request = new UndiciRequest("http://localhost/recipes/x", {
      method: "POST",
      headers: { cookie: cookSessionCookie },
      body: fd,
    }) as unknown as Request;
    let caught: unknown = null;
    try {
      await action({
        request,
        params: { id: recipeId },
        context: { cloudflare: { env: null } } as any,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Response);
    expect((caught as Response).status).toBe(400);
  });

  it("action with intent=createSpoon as the origin cook runs stylization inline when no waitUntil is present", async () => {
    const fd = new UndiciFormData();
    fd.append("intent", "createSpoon");
    fd.append("photo", validImageFile("spoon.png"));
    const request = new UndiciRequest("http://localhost/recipes/x", {
      method: "POST",
      headers: { cookie: chefSessionCookie },
      body: fd,
    }) as unknown as Request;
    const response = await action({
      request,
      params: { id: recipeId },
      context: { cloudflare: { env: null } } as any,
    });
    const { data } = extractResponseData(response);
    expect(data?.success).toBe(true);
    const covers = await db.recipeCover.findMany({ where: { recipeId } });
    expect(covers).toHaveLength(1);
  });

  it("action with intent=deleteSpoon requires a spoonId (400)", async () => {
    const fd = new UndiciFormData();
    fd.append("intent", "deleteSpoon");
    const request = new UndiciRequest("http://localhost/recipes/x", {
      method: "POST",
      headers: { cookie: cookSessionCookie },
      body: fd,
    }) as unknown as Request;
    let caught: unknown = null;
    try {
      await action({
        request,
        params: { id: recipeId },
        context: { cloudflare: { env: null } } as any,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Response);
    expect((caught as Response).status).toBe(400);
  });

  it("action with intent=createSpoon rethrows non-spoon errors (e.g. missing recipe FK)", async () => {
    const fd = new UndiciFormData();
    fd.append("intent", "createSpoon");
    fd.append("note", "ok");
    const request = new UndiciRequest("http://localhost/recipes/x", {
      method: "POST",
      headers: { cookie: cookSessionCookie },
      body: fd,
    }) as unknown as Request;
    await expect(
      action({
        request,
        params: { id: "missing-recipe-fk" },
        context: { cloudflare: { env: null } } as any,
      }),
    ).rejects.toThrowError();
  });

  it("action with intent=deleteSpoon returns 404 for an unknown spoonId", async () => {
    const fd = new UndiciFormData();
    fd.append("intent", "deleteSpoon");
    fd.append("spoonId", "does-not-exist");
    const request = new UndiciRequest("http://localhost/recipes/x", {
      method: "POST",
      headers: { cookie: cookSessionCookie },
      body: fd,
    }) as unknown as Request;
    let caught: unknown = null;
    try {
      await action({
        request,
        params: { id: recipeId },
        context: { cloudflare: { env: null } } as any,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Response);
    expect((caught as Response).status).toBe(404);
  });

  it("action with intent=deleteSpoon refuses to delete another user's spoon", async () => {
    const spoon = await db.recipeSpoon.create({
      data: { chefId: chefUserId, recipeId, photoUrl: "/x" },
    });
    const fd = new UndiciFormData();
    fd.append("intent", "deleteSpoon");
    fd.append("spoonId", spoon.id);
    const request = new UndiciRequest("http://localhost/recipes/x", {
      method: "POST",
      headers: { cookie: cookSessionCookie },
      body: fd,
    }) as unknown as Request;
    let caught: unknown = null;
    try {
      await action({
        request,
        params: { id: recipeId },
        context: { cloudflare: { env: null } } as any,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Response);
    expect((caught as Response).status).toBe(403);
  });
});
