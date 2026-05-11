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
    expect(typeof data.coverImageUrl).toBe("string");
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
    const Stub = createTestRoutesStub([
      {
        path: "/recipes/:id",
        loader,
        action,
        Component: () => (
          <ToastProvider>
            <RecipeDetail />
          </ToastProvider>
        ),
      },
    ]);
    render(
      <Stub
        initialEntries={[`/recipes/${recipeId}`]}
        hydrationData={{ loaderData: {} as any }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/originally from/i)).toBeInTheDocument();
    });
    expect(
      screen.getByRole("link", { name: /nyt\.com/i }),
    ).toHaveAttribute("href", "https://nyt.com/recipes/spoon-detail");
  });

  it("renders SpoonsStrip with non-deleted spoons from the loader", async () => {
    await db.recipeSpoon.create({
      data: { chefId: cookUserId, recipeId, note: "fan note" },
    });
    const Stub = createTestRoutesStub([
      {
        path: "/recipes/:id",
        loader,
        action,
        Component: () => (
          <ToastProvider>
            <RecipeDetail />
          </ToastProvider>
        ),
      },
    ]);
    render(
      <Stub
        initialEntries={[`/recipes/${recipeId}`]}
        hydrationData={{ loaderData: {} as any }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("fan note")).toBeInTheDocument();
    });
  });

  it("clicking 'Log a cook' opens the SpoonDialog", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/recipes/:id",
        loader,
        action,
        Component: () => (
          <ToastProvider>
            <RecipeDetail />
          </ToastProvider>
        ),
      },
    ]);
    render(
      <Stub
        initialEntries={[`/recipes/${recipeId}`]}
        hydrationData={{ loaderData: {} as any }}
      />,
    );
    const open = await screen.findByRole("button", { name: /log a cook|i cooked this/i });
    await userEvent.click(open);
    expect(await screen.findByText(/log a cook/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/note/i)).toBeInTheDocument();
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

  it("action with intent=createSpoon as the origin cook writes a RecipeCover row and schedules stylization", async () => {
    const fd = new UndiciFormData();
    fd.append("intent", "createSpoon");
    fd.append(
      "photo",
      new File([new Uint8Array(8)], "spoon.png", { type: "image/png" }),
    );
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
    expect(waitUntil).toHaveBeenCalledTimes(1);
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
