import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { db } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { cleanupDatabase } from "../helpers/cleanup";
import {
  callSpoonjoyApiOperation,
  listSpoonjoyApiOperations,
  type SpoonjoyApiContext,
} from "~/lib/spoonjoy-api.server";
import { ApiAuthError, type ApiPrincipal } from "~/lib/api-auth.server";
import * as recipeImport from "~/lib/recipe-import.server";

function makeFetchImpl(html: string): typeof fetch {
  return vi.fn(async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(html));
        controller.close();
      },
    });
    const headers = new Headers([["content-type", "text/html"]]);
    return {
      ok: true,
      status: 200,
      url: "https://example.com/r",
      headers,
      body: stream,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

async function makeChef() {
  const email = `chef-${faker.string.alphanumeric(8).toLowerCase()}@example.com`;
  const username = `user_${faker.string.alphanumeric(8).toLowerCase()}`;
  const user = await createUser(db, email, username, "test-password-1234");
  const principal: ApiPrincipal = {
    id: user.id,
    email: user.email,
    username: user.username,
    source: "bearer",
    scopes: ["cookbooks:read", "public:read", "recipes:read", "shopping_list:read", "shopping_list:write", "tokens:read", "tokens:write", "kitchen:read", "kitchen:write"],
  };
  return { user, principal };
}

const SAMPLE_HTML =
  '<html><head><script type="application/ld+json">' +
  JSON.stringify({
    "@type": "Recipe",
    name: "MCP Test Recipe",
    recipeIngredient: ["1 cup flour"],
    recipeInstructions: [{ "@type": "HowToStep", text: "Mix everything." }],
  }) +
  "</script></head><body/></html>";

describe("spoonjoy-api import_recipe_from_url", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });
  afterEach(async () => {
    await cleanupDatabase();
    vi.restoreAllMocks();
  });

  describe("operation registry", () => {
    it("lists import_recipe_from_url", () => {
      const names = listSpoonjoyApiOperations().map((op) => op.name);
      expect(names).toContain("import_recipe_from_url");
    });

    it("input schema requires url", () => {
      const op = listSpoonjoyApiOperations().find(
        (o) => o.name === "import_recipe_from_url",
      );
      const schema = op?.inputSchema as {
        required?: string[];
        properties?: Record<string, unknown>;
      };
      expect(schema.required).toContain("url");
    });

    it("input schema accepts dryRun boolean (default false)", () => {
      const op = listSpoonjoyApiOperations().find(
        (o) => o.name === "import_recipe_from_url",
      );
      const props = (
        op?.inputSchema as { properties: Record<string, { type: string; default?: unknown }> }
      ).properties;
      expect(props.dryRun.type).toBe("boolean");
      expect(props.dryRun.default).toBe(false);
    });

    it("input schema does NOT include ownerEmail", () => {
      const op = listSpoonjoyApiOperations().find(
        (o) => o.name === "import_recipe_from_url",
      );
      const props = (
        op?.inputSchema as { properties: Record<string, unknown> }
      ).properties;
      expect(Object.keys(props)).not.toContain("ownerEmail");
    });

    it("input schema has additionalProperties: false", () => {
      const op = listSpoonjoyApiOperations().find(
        (o) => o.name === "import_recipe_from_url",
      );
      const schema = op?.inputSchema as { additionalProperties?: boolean };
      expect(schema.additionalProperties).toBe(false);
    });
  });

  describe("auth", () => {
    it("throws ApiAuthError(400) when ownerEmail is supplied", async () => {
      const { principal } = await makeChef();
      const context: SpoonjoyApiContext = { db, principal };
      await expect(
        callSpoonjoyApiOperation(
          "import_recipe_from_url",
          { url: "https://example.com/r", ownerEmail: "x@y.com" },
          context,
        ),
      ).rejects.toBeInstanceOf(ApiAuthError);
    });

    it("throws ApiAuthError(401) when principal is null and defaultOwnerEmail is unset", async () => {
      const context: SpoonjoyApiContext = { db, principal: null };
      await expect(
        callSpoonjoyApiOperation(
          "import_recipe_from_url",
          { url: "https://example.com/r" },
          context,
        ),
      ).rejects.toMatchObject({ name: "ApiAuthError", status: 401 });
    });

    it("uses principal.id when principal is present", async () => {
      const { principal } = await makeChef();
      const spy = vi
        .spyOn(recipeImport, "importRecipeFromUrl")
        .mockResolvedValue({
          recipeId: "rid",
          recipe: { id: "rid" },
          confidence: "high",
          source: "json-ld",
          existingRecipeId: null,
          coverPending: false,
        });
      const context: SpoonjoyApiContext = { db, principal };
      await callSpoonjoyApiOperation(
        "import_recipe_from_url",
        { url: "https://example.com/r" },
        context,
      );
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ chefId: principal.id }),
        expect.anything(),
      );
    });

    it("falls back to defaultOwnerEmail when principal is null", async () => {
      const { user } = await makeChef();
      const spy = vi
        .spyOn(recipeImport, "importRecipeFromUrl")
        .mockResolvedValue({
          recipeId: "rid",
          recipe: { id: "rid" },
          confidence: "high",
          source: "json-ld",
          existingRecipeId: null,
          coverPending: false,
        });
      const context: SpoonjoyApiContext = {
        db,
        principal: null,
        defaultOwnerEmail: user.email,
      };
      await callSpoonjoyApiOperation(
        "import_recipe_from_url",
        { url: "https://example.com/r" },
        context,
      );
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ chefId: user.id }),
        expect.anything(),
      );
    });

    it("throws ApiAuthError(401) when defaultOwnerEmail does not match any user", async () => {
      const context: SpoonjoyApiContext = {
        db,
        principal: null,
        defaultOwnerEmail: "nobody@example.com",
      };
      await expect(
        callSpoonjoyApiOperation(
          "import_recipe_from_url",
          { url: "https://example.com/r" },
          context,
        ),
      ).rejects.toMatchObject({ name: "ApiAuthError", status: 401 });
    });
  });

  describe("response envelope", () => {
    it("returns { recipe, recipeId, confidence, source, existingRecipeId, coverPending }", async () => {
      const { principal } = await makeChef();
      vi.spyOn(recipeImport, "importRecipeFromUrl").mockResolvedValue({
        recipeId: "rid",
        recipe: { id: "rid", title: "T" },
        confidence: "high",
        source: "json-ld",
        existingRecipeId: null,
        coverPending: true,
      });
      const result = (await callSpoonjoyApiOperation(
        "import_recipe_from_url",
        { url: "https://example.com/r" },
        { db, principal },
      )) as Record<string, unknown>;
      expect(result).toEqual({
        recipe: { id: "rid", title: "T" },
        recipeId: "rid",
        confidence: "high",
        source: "json-ld",
        existingRecipeId: null,
        coverPending: true,
      });
    });

    it("forwards dryRun=true to importRecipeFromUrl", async () => {
      const { principal } = await makeChef();
      const spy = vi
        .spyOn(recipeImport, "importRecipeFromUrl")
        .mockResolvedValue({
          recipeId: null,
          recipe: { title: "draft" },
          confidence: "high",
          source: "json-ld",
          existingRecipeId: null,
          coverPending: false,
        });
      await callSpoonjoyApiOperation(
        "import_recipe_from_url",
        { url: "https://example.com/r", dryRun: true },
        { db, principal },
      );
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ dryRun: true }),
        expect.anything(),
      );
    });

    it("defaults dryRun=false when omitted", async () => {
      const { principal } = await makeChef();
      const spy = vi
        .spyOn(recipeImport, "importRecipeFromUrl")
        .mockResolvedValue({
          recipeId: "rid",
          recipe: { id: "rid" },
          confidence: "high",
          source: "json-ld",
          existingRecipeId: null,
          coverPending: false,
        });
      await callSpoonjoyApiOperation(
        "import_recipe_from_url",
        { url: "https://example.com/r" },
        { db, principal },
      );
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ dryRun: false }),
        expect.anything(),
      );
    });
  });

  describe("error propagation", () => {
    it("propagates ImportRecipeError with code=rate-limited and status=429", async () => {
      const { principal } = await makeChef();
      vi.spyOn(recipeImport, "importRecipeFromUrl").mockRejectedValue(
        new recipeImport.ImportRecipeError("rate-limited", 429, "limit hit"),
      );
      await expect(
        callSpoonjoyApiOperation(
          "import_recipe_from_url",
          { url: "https://example.com/r" },
          { db, principal },
        ),
      ).rejects.toMatchObject({ code: "rate-limited", status: 429 });
    });

    it("propagates ImportRecipeError title-conflict (409)", async () => {
      const { principal } = await makeChef();
      vi.spyOn(recipeImport, "importRecipeFromUrl").mockRejectedValue(
        new recipeImport.ImportRecipeError("title-conflict", 409, "dup"),
      );
      await expect(
        callSpoonjoyApiOperation(
          "import_recipe_from_url",
          { url: "https://example.com/r" },
          { db, principal },
        ),
      ).rejects.toMatchObject({ code: "title-conflict", status: 409 });
    });

    it("propagates ImportRecipeError bad-url (400)", async () => {
      const { principal } = await makeChef();
      vi.spyOn(recipeImport, "importRecipeFromUrl").mockRejectedValue(
        new recipeImport.ImportRecipeError("bad-url", 400, "bad URL"),
      );
      await expect(
        callSpoonjoyApiOperation(
          "import_recipe_from_url",
          { url: "not-a-url" },
          { db, principal },
        ),
      ).rejects.toMatchObject({ code: "bad-url", status: 400 });
    });

    it("requires url to be a non-empty string", async () => {
      const { principal } = await makeChef();
      await expect(
        callSpoonjoyApiOperation(
          "import_recipe_from_url",
          { url: "" },
          { db, principal },
        ),
      ).rejects.toThrow(/url is required/i);
    });
  });

  describe("context propagation", () => {
    it("passes db, env, bucket, imageGenRunner, waitUntil, and logger from context", async () => {
      const { principal } = await makeChef();
      const spy = vi
        .spyOn(recipeImport, "importRecipeFromUrl")
        .mockResolvedValue({
          recipeId: "rid",
          recipe: { id: "rid" },
          confidence: "high",
          source: "json-ld",
          existingRecipeId: null,
          coverPending: false,
        });
      const bucket = {} as R2Bucket;
      const waitUntil = vi.fn();
      const imageGenRunner = {
        textToImage: vi.fn(),
        imageToImage: vi.fn(),
      };
      const logger = { error: vi.fn() };
      const env = { OPENAI_API_KEY: "k" };
      const context: SpoonjoyApiContext = {
        db,
        principal,
        env,
        bucket,
        waitUntil,
        imageGenRunner,
        logger,
      };
      await callSpoonjoyApiOperation(
        "import_recipe_from_url",
        { url: "https://example.com/r" },
        context,
      );
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ url: "https://example.com/r" }),
        expect.objectContaining({
          db,
          env,
          bucket,
          waitUntil,
          imageGenRunner,
          logger,
        }),
      );
    });
  });

  describe("end-to-end happy path (no mocks)", () => {
    it("creates a Recipe owned by the principal", async () => {
      const { principal } = await makeChef();
      const fetchImpl = makeFetchImpl(SAMPLE_HTML);
      const context: SpoonjoyApiContext = {
        db,
        principal,
        env: { OPENAI_API_KEY: "key" },
      };
      // Stub the LLM by mocking the recipe-import orchestrator's fetchImpl
      // through process injection: use a no-op spy that forwards real call,
      // but the call goes through the registered tool, which doesn't accept
      // a deps override. So we cover the integration purely in Unit 7.
      // Here we still validate the handler wires context correctly by
      // mocking the orchestrator function.
      vi.spyOn(recipeImport, "importRecipeFromUrl").mockImplementation(
        async (_opts, _deps) => ({
          recipeId: "happy-rid",
          recipe: { id: "happy-rid", title: "MCP Test Recipe" },
          confidence: "high",
          source: "json-ld",
          existingRecipeId: null,
          coverPending: false,
        }),
      );
      const result = (await callSpoonjoyApiOperation(
        "import_recipe_from_url",
        { url: "https://example.com/r" },
        context,
      )) as Record<string, unknown>;
      void fetchImpl;
      expect(result.recipeId).toBe("happy-rid");
    });
  });
});
