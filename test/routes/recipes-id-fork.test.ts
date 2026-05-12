import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock session so we can control auth in tests.
vi.mock("~/lib/session.server", () => ({
  requireUserId: vi.fn(),
}));

// Mock route platform so we don't touch the real Prisma client.
const mockDb = {} as unknown;
vi.mock("~/lib/route-platform.server", () => ({
  getRequestDb: vi.fn(async () => mockDb),
}));

// Mock the recipe-fork.server module so we isolate the route from DB concerns.
vi.mock("~/lib/recipe-fork.server", () => {
  class ForkSourceNotFoundError extends Error {
    constructor(id: string) {
      super(`Source recipe not found: ${id}`);
      this.name = "ForkSourceNotFoundError";
    }
  }
  class ForkTitleExhaustedError extends Error {
    constructor(t: string) {
      super(`Title exhausted: ${t}`);
      this.name = "ForkTitleExhaustedError";
    }
  }
  return {
    forkRecipe: vi.fn(),
    ForkSourceNotFoundError,
    ForkTitleExhaustedError,
  };
});

import { requireUserId } from "~/lib/session.server";
import {
  forkRecipe,
  ForkSourceNotFoundError,
  ForkTitleExhaustedError,
} from "~/lib/recipe-fork.server";
import { action } from "~/routes/recipes.$id.fork";

const requireUserIdMock = vi.mocked(requireUserId);
const forkRecipeMock = vi.mocked(forkRecipe);

function makeRequest(): Request {
  return new Request("http://localhost/recipes/abc/fork", { method: "POST" });
}

function makeArgs(overrides?: { id?: string | undefined; idAbsent?: boolean }) {
  const idAbsent = overrides?.idAbsent === true;
  const id = idAbsent ? undefined : overrides?.id ?? "abc";
  return {
    request: makeRequest(),
    params: { id },
    context: {} as unknown as Parameters<typeof action>[0]["context"],
  } as unknown as Parameters<typeof action>[0];
}

describe("recipes.$id.fork action", () => {
  beforeEach(() => {
    requireUserIdMock.mockReset();
    forkRecipeMock.mockReset();
  });

  it("rethrows the redirect Response when the user is not authenticated", async () => {
    const redirectResponse = new Response(null, {
      status: 302,
      headers: { Location: "/login?redirectTo=/recipes/abc/fork" },
    });
    requireUserIdMock.mockImplementation(() => {
      throw redirectResponse;
    });

    let thrown: unknown;
    try {
      await action(makeArgs());
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(302);
  });

  it("returns a 302 redirect to the new recipe on success", async () => {
    requireUserIdMock.mockResolvedValue("viewer-1");
    forkRecipeMock.mockResolvedValue({
      recipe: { id: "new-recipe-id" } as never,
      attribution: {
        sourceRecipeId: "abc",
        sourceChef: { id: "chef-1", username: "alice" },
      },
      appliedTitle: "Pasta",
      titleWasSuffixed: false,
    });

    const result = (await action(makeArgs())) as Response;

    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toBe("/recipes/new-recipe-id");
    expect(forkRecipeMock).toHaveBeenCalledWith(mockDb, {
      sourceRecipeId: "abc",
      viewerId: "viewer-1",
    });
  });

  it("throws a 404 Response when params.id is missing", async () => {
    requireUserIdMock.mockResolvedValue("viewer-1");

    let thrown: unknown;
    try {
      await action(makeArgs({ idAbsent: true }));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(404);
  });

  it("throws a 404 Response when the source recipe is not found", async () => {
    requireUserIdMock.mockResolvedValue("viewer-1");
    forkRecipeMock.mockRejectedValue(new ForkSourceNotFoundError("abc"));

    let thrown: unknown;
    try {
      await action(makeArgs());
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(404);
  });

  it("throws a 409 Response when title resolution is exhausted", async () => {
    requireUserIdMock.mockResolvedValue("viewer-1");
    forkRecipeMock.mockRejectedValue(new ForkTitleExhaustedError("Pasta"));

    let thrown: unknown;
    try {
      await action(makeArgs());
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(409);
  });

  it("re-throws unexpected errors unchanged", async () => {
    requireUserIdMock.mockResolvedValue("viewer-1");
    const boom = new Error("boom");
    forkRecipeMock.mockRejectedValue(boom);

    await expect(action(makeArgs())).rejects.toBe(boom);
  });
});
