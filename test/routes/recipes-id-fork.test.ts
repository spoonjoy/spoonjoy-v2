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
import {
  drainScheduled,
  exceptionPosts,
  makePostHogFetchSpy,
  type PostHogFetchSpy,
} from "../helpers/posthog-capture";

const requireUserIdMock = vi.mocked(requireUserId);
const forkRecipeMock = vi.mocked(forkRecipe);

function makeRequest(): Request {
  return new Request("http://localhost/recipes/abc/fork", { method: "POST" });
}

function makeArgs(overrides?: {
  id?: string | undefined;
  idAbsent?: boolean;
  env?: Record<string, unknown> | null;
  scheduled?: Promise<unknown>[];
}) {
  const idAbsent = overrides?.idAbsent === true;
  const id = idAbsent ? undefined : overrides?.id ?? "abc";
  // `env === undefined` → bare context (existing tests). `env` provided →
  // cloudflare context; `scheduled` provided adds ctx.waitUntil, omitting it
  // exercises the fire-and-forget `void capture` fallback branch.
  let context: unknown = {};
  if (overrides?.env !== undefined) {
    const cloudflare: Record<string, unknown> = { env: overrides.env };
    if (overrides.scheduled) {
      cloudflare.ctx = { waitUntil: (p: Promise<unknown>) => overrides.scheduled!.push(p) };
    }
    context = { cloudflare };
  }
  return {
    request: makeRequest(),
    params: { id },
    context: context as unknown as Parameters<typeof action>[0]["context"],
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

  describe("unexpected-failure telemetry", () => {
    let origFetch: typeof globalThis.fetch;
    let spy: PostHogFetchSpy;

    beforeEach(() => {
      requireUserIdMock.mockResolvedValue("viewer-1");
      origFetch = globalThis.fetch;
      spy = makePostHogFetchSpy();
      globalThis.fetch = spy.impl;
    });

    afterEach(() => {
      globalThis.fetch = origFetch;
    });

    it("captures the unexpected fork failure before re-throwing when POSTHOG_KEY is set", async () => {
      const boom = new Error("fork blew up");
      forkRecipeMock.mockRejectedValue(boom);
      const scheduled: Promise<unknown>[] = [];

      await expect(
        action(makeArgs({ env: { POSTHOG_KEY: "ph_test" }, scheduled })),
      ).rejects.toBe(boom);

      expect(scheduled.length).toBeGreaterThan(0);
      await drainScheduled(scheduled);

      const captures = exceptionPosts(spy.postHogPosts);
      expect(captures).toHaveLength(1);
      expect(captures[0]!.properties).toMatchObject({
        $exception_message: "fork blew up",
        route: "/recipes/abc/fork",
        method: "POST",
        action: "fork_recipe",
        source_recipe_id: "abc",
        $lib: "spoonjoy-server",
      });
    });

    it("does NOT capture expected 404 (source-not-found) outcomes", async () => {
      forkRecipeMock.mockRejectedValue(new ForkSourceNotFoundError("abc"));
      const scheduled: Promise<unknown>[] = [];

      await expect(
        action(makeArgs({ env: { POSTHOG_KEY: "ph_test" }, scheduled })),
      ).rejects.toBeInstanceOf(Response);

      await drainScheduled(scheduled);
      expect(exceptionPosts(spy.postHogPosts)).toHaveLength(0);
    });

    it("does NOT capture expected 409 (title-exhausted) outcomes", async () => {
      forkRecipeMock.mockRejectedValue(new ForkTitleExhaustedError("Pasta"));
      const scheduled: Promise<unknown>[] = [];

      await expect(
        action(makeArgs({ env: { POSTHOG_KEY: "ph_test" }, scheduled })),
      ).rejects.toBeInstanceOf(Response);

      await drainScheduled(scheduled);
      expect(exceptionPosts(spy.postHogPosts)).toHaveLength(0);
    });

    it("does NOT capture when POSTHOG_KEY is absent (config resolves disabled → no-op)", async () => {
      forkRecipeMock.mockRejectedValue(new Error("fork blew up"));
      const scheduled: Promise<unknown>[] = [];

      await expect(
        action(makeArgs({ env: {}, scheduled })),
      ).rejects.toBeInstanceOf(Error);

      await drainScheduled(scheduled);
      expect(exceptionPosts(spy.postHogPosts)).toHaveLength(0);
    });

    it("captures fire-and-forget when no ctx.waitUntil is available (void-capture branch)", async () => {
      const boom = new Error("fork blew up");
      forkRecipeMock.mockRejectedValue(boom);

      // env set but no scheduled collector → context omits ctx.waitUntil.
      await expect(
        action(makeArgs({ env: { POSTHOG_KEY: "ph_test" } })),
      ).rejects.toBe(boom);

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(exceptionPosts(spy.postHogPosts)).toHaveLength(1);
    });
  });
});
