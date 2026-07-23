import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { getLocalDb } from "~/lib/db.server";
import { authenticateApiToken, createApiCredential } from "~/lib/api-auth.server";
import { buildApiV1OpenApiDocument } from "~/lib/api-v1-openapi.server";
import { callSpoonjoyMcpTool, listSpoonjoyMcpTools, type SpoonjoyMcpContext } from "~/lib/mcp/spoonjoy-tools.server";
import { ACTIVE_RECIPE_TITLE_CONFLICT_ERROR } from "~/lib/recipe-title-uniqueness.server";
import { cleanupDatabase } from "../../helpers/cleanup";

function parseJson(text: string) {
  return JSON.parse(text) as Record<string, any>;
}

const VALID_PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const GIF_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 1, 2, 3]);

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function mockR2(): R2Bucket {
  const stored = new Map<string, { value: unknown; httpMetadata?: { contentType?: string } }>();
  return {
    put: vi.fn(async (key: string, _value: unknown, options?: { httpMetadata?: { contentType?: string } }) => {
      stored.set(key, { value: _value, httpMetadata: options?.httpMetadata });
      return {};
    }),
    delete: vi.fn(async (key: string) => {
      stored.delete(key);
    }),
    get: vi.fn(async (key: string) => {
      const entry = stored.get(key);
      if (!entry) return null;
      return {
        httpMetadata: entry.httpMetadata,
        arrayBuffer: async () => {
          if (entry.value instanceof File) return entry.value.arrayBuffer();
          if (entry.value instanceof Uint8Array) {
            const bytes = entry.value;
            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
          }
          return new ArrayBuffer(0);
        },
      };
    }),
    head: vi.fn(async (key: string) => stored.has(key)
      ? ({ key, httpMetadata: stored.get(key)?.httpMetadata })
      : null),
    list: vi.fn(),
    createMultipartUpload: vi.fn(),
    resumeMultipartUpload: vi.fn(),
  } as unknown as R2Bucket;
}

function uniqueEmail(prefix = "chef") {
  return `${prefix}-${faker.string.alphanumeric(8).toLowerCase()}@example.com`;
}

function withD1TransactionGuard(db: SpoonjoyMcpContext["db"]): SpoonjoyMcpContext["db"] {
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property !== "$transaction") {
        return Reflect.get(target, property, receiver);
      }

      return (input: unknown, ...rest: unknown[]) => {
        if (typeof input === "function") {
          throw new Error("D1 interactive transactions are not supported");
        }

        const transaction = Reflect.get(target, property, receiver) as (...args: unknown[]) => unknown;
        return transaction.apply(target, [input, ...rest]);
      };
    },
  });
}

function toolByName(name: string) {
  return listSpoonjoyMcpTools().find((tool) => tool.name === name);
}

function schemaProperty(toolName: string, propertyName: string) {
  const tool = toolByName(toolName);
  const properties = (tool?.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties;
  return properties?.[propertyName] as Record<string, unknown> | undefined;
}

function expectPropertyDescription(toolName: string, propertyName: string, expectedText: string) {
  const property = schemaProperty(toolName, propertyName);
  expect(property, `${toolName}.${propertyName}`).toBeDefined();
  expect(property?.description, `${toolName}.${propertyName}`).toEqual(expect.stringContaining(expectedText));
}

const LEGACY_SHOPPING_IDENTITY_INDEX = "ShoppingListItem_shoppingListId_unitId_ingredientRefId_key";
const ACTIVE_SHOPPING_IDENTITY_INDEX = "ShoppingListItem_active_identity_key";

async function withActiveShoppingIdentityIndex<T>(
  db: SpoonjoyMcpContext["db"],
  run: () => Promise<T>,
): Promise<T> {
  try {
    await db.$executeRawUnsafe(`DROP INDEX IF EXISTS "${ACTIVE_SHOPPING_IDENTITY_INDEX}"`);
    await db.$executeRawUnsafe(`DROP INDEX IF EXISTS "${LEGACY_SHOPPING_IDENTITY_INDEX}"`);
    await db.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "${ACTIVE_SHOPPING_IDENTITY_INDEX}"
      ON "ShoppingListItem" ("shoppingListId", "ingredientRefId", COALESCE('u:' || "unitId", 'n:'))
      WHERE "deletedAt" IS NULL
    `);
    return await run();
  } finally {
    await db.shoppingListItem.deleteMany({});
    await db.$executeRawUnsafe(`DROP INDEX IF EXISTS "${LEGACY_SHOPPING_IDENTITY_INDEX}"`);
    await db.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "${ACTIVE_SHOPPING_IDENTITY_INDEX}"
      ON "ShoppingListItem" ("shoppingListId", "ingredientRefId", COALESCE('u:' || "unitId", 'n:'))
      WHERE "deletedAt" IS NULL
    `);
  }
}

describe("spoonjoy MCP tools", () => {
  let context: SpoonjoyMcpContext;

  beforeEach(async () => {
    await cleanupDatabase();
    context = { db: await getLocalDb(), defaultOwnerEmail: uniqueEmail("agent") };
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("lists stable MCP tool metadata", () => {
    expect(listSpoonjoyMcpTools().map((tool) => tool.name)).toEqual([
      "health",
      "auth_status",
      "start_agent_connection",
      "poll_agent_connection",
      "create_api_token",
      "list_api_tokens",
      "revoke_api_token",
      "search_spoonjoy",
      "search_recipes",
      "search_shopping_list",
      "get_recipe",
      "list_recipe_covers",
      "list_recipe_spoon_images",
      "create_recipe_cover_from_upload",
      "generate_recipe_cover_placeholder",
      "regenerate_recipe_cover",
      "get_cover_generation_status",
      "set_active_recipe_cover",
      "set_recipe_no_cover",
      "archive_recipe_cover",
      "create_recipe",
      "update_recipe",
      "delete_recipe",
      "upload_recipe_image",
      "upload_spoon_photo",
      "fork_recipe",
      "add_recipe_to_shopping_list",
      "list_cookbooks",
      "get_cookbook",
      "create_cookbook",
      "add_recipe_to_cookbook",
      "remove_recipe_from_cookbook",
      "add_shopping_list_item",
      "set_shopping_list_item_checked",
      "remove_shopping_list_item",
      "get_shopping_list",
      "create_spoon",
      "update_spoon",
      "delete_spoon",
      "list_spoons_for_recipe",
      "list_spoons_by_chef",
    ]);
  });

  it("excludes import_recipe_from_url from the MCP surface and rejects calling it", async () => {
    // `import_recipe_from_url` server-fetches arbitrary URLs (open-world) and is
    // intentionally REST-only — it must not be advertised over MCP nor callable
    // by name. The agent-driven import path (read the page, call create_recipe)
    // replaces it for MCP clients.
    expect(listSpoonjoyMcpTools().map((tool) => tool.name)).not.toContain("import_recipe_from_url");

    await expect(callSpoonjoyMcpTool("import_recipe_from_url", { url: "https://example.com/recipe" }, context))
      .rejects.toThrow("Unknown Spoonjoy operation: import_recipe_from_url");
  });

  it("exposes bounded Photo Studio tools while keeping spoon-source helper REST-only", async () => {
    // MCP clients now own the same bounded Photo Studio lifecycle as native/web:
    // upload a first photo, generate a placeholder, regenerate with prompt
    // additions, poll, activate, no-cover, and archive. The spoon-source helper
    // stays REST-only because agents can create a Spoon with optional fields and
    // then use the normal cover workflow from that preserved original photo.
    const names = listSpoonjoyMcpTools().map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining([
      "create_recipe_cover_from_upload",
      "generate_recipe_cover_placeholder",
      "regenerate_recipe_cover",
      "get_cover_generation_status",
      "list_recipe_covers",
      "set_active_recipe_cover",
      "set_recipe_no_cover",
      "archive_recipe_cover",
    ]));
    expect(names).not.toContain("create_recipe_cover_from_spoon");

    await expect(callSpoonjoyMcpTool("create_recipe_cover_from_spoon", { recipeId: "r", spoonId: "s" }, context))
      .rejects.toThrow("Unknown Spoonjoy operation: create_recipe_cover_from_spoon");
  });

  it("annotates every tool with a title and behavioral hints (directory requirement)", () => {
    // Connector directories reject tools missing a title or read/destructive
    // hints. Asserting every tool here also enforces annotation completeness:
    // a tool without a map entry would surface as a missing title.
    for (const tool of listSpoonjoyMcpTools()) {
      expect(typeof tool.title, tool.name).toBe("string");
      expect(tool.title.length, tool.name).toBeGreaterThan(0);
      expect(tool.annotations, tool.name).toBeDefined();
      expect(tool.annotations.title, tool.name).toBe(tool.title);
      expect(typeof tool.annotations.readOnlyHint, tool.name).toBe("boolean");
      if (tool.annotations.readOnlyHint) {
        // Read-only tools never carry a destructive hint.
        expect(tool.annotations.destructiveHint, tool.name).toBeUndefined();
      } else {
        // Writes must declare destructiveness explicitly (no relying on defaults).
        expect(typeof tool.annotations.destructiveHint, tool.name).toBe("boolean");
      }
    }
  });

  it("classifies reads, writes, and deletes correctly", () => {
    const byName = new Map(listSpoonjoyMcpTools().map((tool) => [tool.name, tool.annotations]));

    expect(byName.get("get_recipe")).toMatchObject({ readOnlyHint: true });
    expect(byName.get("list_recipe_covers")).toMatchObject({ readOnlyHint: true });
    expect(byName.get("list_recipe_spoon_images")).toMatchObject({ readOnlyHint: true });
    expect(byName.get("create_recipe_cover_from_upload")).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
    expect(byName.get("generate_recipe_cover_placeholder")).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
    expect(byName.get("regenerate_recipe_cover")).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
    expect(byName.get("get_cover_generation_status")).toMatchObject({ readOnlyHint: true });
    expect(byName.get("set_active_recipe_cover")).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
    expect(byName.get("set_recipe_no_cover")).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true });
    expect(byName.get("archive_recipe_cover")).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true });
    expect(byName.get("create_recipe")).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(byName.get("update_recipe")).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(byName.get("delete_recipe")).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true });
    expect(byName.get("upload_recipe_image")).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(byName.get("upload_spoon_photo")).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    // The open-world `import_recipe_from_url` op is deliberately not on the MCP
    // surface (REST-only), so it never appears here to be classified.
    expect(byName.has("import_recipe_from_url")).toBe(false);
    expect(byName.get("add_recipe_to_cookbook")).toMatchObject({ idempotentHint: true });
  });

  it("publishes upload schemas with required image fields and kitchen write scopes", () => {
    const byName = new Map(listSpoonjoyMcpTools().map((tool) => [tool.name, tool]));

    for (const toolName of ["upload_recipe_image", "upload_spoon_photo"]) {
      const tool = byName.get(toolName);
      expect(tool?.requiredScopes).toEqual(["kitchen:write"]);
      expect(tool?.inputSchema).toMatchObject({
        type: "object",
        required: ["imageBase64", "mimeType", "filename"],
        properties: {
          imageBase64: { type: "string" },
          mimeType: { type: "string", enum: ["image/jpeg", "image/png", "image/webp"] },
          filename: { type: "string" },
        },
        additionalProperties: false,
      });
    }
  });

  it("publishes recipe cover browse schemas with safe read annotations", () => {
    const byName = new Map(listSpoonjoyMcpTools().map((tool) => [tool.name, tool]));

    expect(byName.get("list_recipe_covers")).toMatchObject({
      requiredScopes: ["recipes:read"],
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object",
        required: ["recipeId"],
        properties: {
          recipeId: { type: "string" },
          includeArchived: { type: "boolean" },
          limit: { type: "number", minimum: 1, maximum: 25 },
          offset: { type: "number", minimum: 0 },
        },
        additionalProperties: false,
      },
    });
    expect(byName.get("list_recipe_spoon_images")).toMatchObject({
      requiredScopes: ["kitchen:write"],
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object",
        required: ["recipeId"],
        properties: {
          recipeId: { type: "string" },
          limit: { type: "number", minimum: 1, maximum: 25 },
          offset: { type: "number", minimum: 0 },
        },
        additionalProperties: false,
      },
    });
  });

  it("publishes recipe cover mutation schemas with idempotent write annotations", () => {
    const byName = new Map(listSpoonjoyMcpTools().map((tool) => [tool.name, tool]));

    expect(byName.get("create_recipe_cover_from_upload")).toMatchObject({
      requiredScopes: ["kitchen:write"],
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: {
        type: "object",
        required: ["recipeId", "imageUrl"],
        properties: {
          recipeId: { type: "string" },
          imageUrl: { type: "string" },
          activateWhenReady: { type: "boolean" },
          generateEditorial: { type: "boolean" },
          promptAddition: { type: "string", maxLength: 240 },
          postAsSpoon: { type: "boolean" },
          note: { type: "string" },
          nextTime: { type: "string" },
          cookedAt: { type: "string", format: "date-time" },
          idempotencyKey: { type: "string" },
          dryRun: { type: "boolean" },
        },
        additionalProperties: false,
      },
    });
    expect(byName.get("generate_recipe_cover_placeholder")).toMatchObject({
      requiredScopes: ["kitchen:write"],
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: {
        type: "object",
        required: ["recipeId", "idempotencyKey"],
        properties: {
          recipeId: { type: "string" },
          promptAddition: { type: "string", maxLength: 240 },
          activateWhenReady: { type: "boolean" },
          idempotencyKey: { type: "string" },
          dryRun: { type: "boolean" },
        },
        additionalProperties: false,
      },
    });
    expect(byName.get("regenerate_recipe_cover")).toMatchObject({
      requiredScopes: ["kitchen:write"],
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: {
        type: "object",
        required: ["recipeId", "coverId", "idempotencyKey"],
        properties: {
          recipeId: { type: "string" },
          coverId: { type: "string" },
          promptAddition: { type: "string", maxLength: 240 },
          activateWhenReady: { type: "boolean" },
          idempotencyKey: { type: "string" },
          dryRun: { type: "boolean" },
        },
        additionalProperties: false,
      },
    });
    expect(byName.get("get_cover_generation_status")).toMatchObject({
      requiredScopes: ["kitchen:write"],
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object",
        required: ["recipeId", "coverId"],
        properties: {
          recipeId: { type: "string" },
          coverId: { type: "string" },
        },
        additionalProperties: false,
      },
    });
    expect(byName.get("set_active_recipe_cover")).toMatchObject({
      requiredScopes: ["kitchen:write"],
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: {
        type: "object",
        required: ["recipeId", "coverId", "variant"],
        properties: {
          recipeId: { type: "string" },
          coverId: { type: "string" },
          variant: { type: "string", enum: ["image", "stylized"] },
          idempotencyKey: { type: "string" },
        },
        additionalProperties: false,
      },
    });
    expect(byName.get("set_recipe_no_cover")).toMatchObject({
      requiredScopes: ["kitchen:write"],
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      inputSchema: {
        type: "object",
        required: ["recipeId", "confirmNoCover", "idempotencyKey"],
        properties: {
          recipeId: { type: "string" },
          confirmNoCover: { const: true },
          idempotencyKey: { type: "string" },
        },
        additionalProperties: false,
      },
    });
    expect(byName.get("archive_recipe_cover")).toMatchObject({
      requiredScopes: ["kitchen:write"],
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      inputSchema: {
        type: "object",
        required: ["recipeId", "coverId"],
        properties: {
          recipeId: { type: "string" },
          coverId: { type: "string" },
          replacementCoverId: { type: "string" },
          replacementVariant: { type: "string", enum: ["image", "stylized"] },
          confirmNoCover: { type: "boolean" },
          deleteSafeObjects: { type: "boolean" },
          idempotencyKey: { type: "string" },
        },
        additionalProperties: false,
      },
    });
  });

  it("keeps first-photo activation field names aligned across REST and MCP surfaces", () => {
    const document = buildApiV1OpenApiDocument();
    const restProperties = document.components.schemas.RecipeImageUploadRequest.properties;
    const mcpProperties = (toolByName("create_recipe_cover_from_upload")?.inputSchema as {
      properties?: Record<string, unknown>;
    } | undefined)?.properties ?? {};
    const activationFields = ["activate", "activateWhenReady"] as const;

    expect(activationFields.filter((field) => field in restProperties)).toEqual(["activateWhenReady"]);
    expect(activationFields.filter((field) => field in mcpProperties)).toEqual(["activateWhenReady"]);
  });

  it("describes Photo Studio schema fields so agents can choose the right cover workflow", () => {
    expect(toolByName("create_recipe_cover_from_upload")?.description)
      .toEqual(expect.stringContaining("uploaded"));
    expect(toolByName("generate_recipe_cover_placeholder")?.description)
      .toEqual(expect.stringContaining("AI placeholder"));
    expect(toolByName("regenerate_recipe_cover")?.description)
      .toEqual(expect.stringContaining("prompt"));
    expect(toolByName("set_recipe_no_cover")?.description)
      .toEqual(expect.stringContaining("no-cover"));

    expectPropertyDescription("create_recipe_cover_from_upload", "imageUrl", "uploaded recipe or spoon photo URL");
    expectPropertyDescription("create_recipe_cover_from_upload", "generateEditorial", "editorialized cover");
    expectPropertyDescription("create_recipe_cover_from_upload", "promptAddition", "bounded instruction");
    expectPropertyDescription("create_recipe_cover_from_upload", "postAsSpoon", "preserve the original photo");
    expectPropertyDescription("create_recipe_cover_from_upload", "note", "Spoon note");
    expectPropertyDescription("create_recipe_cover_from_upload", "nextTime", "next-time note");
    expectPropertyDescription("create_recipe_cover_from_upload", "cookedAt", "ISO");
    expectPropertyDescription("create_recipe_cover_from_upload", "activateWhenReady", "editorial image is ready");

    expectPropertyDescription("generate_recipe_cover_placeholder", "promptAddition", "bounded instruction");
    expectPropertyDescription("generate_recipe_cover_placeholder", "activateWhenReady", "generated cover is ready");
    expectPropertyDescription("regenerate_recipe_cover", "promptAddition", "bounded instruction");
    expectPropertyDescription("regenerate_recipe_cover", "activateWhenReady", "regenerated cover is ready");
    expectPropertyDescription("get_cover_generation_status", "coverId", "cover candidate");
    expectPropertyDescription("set_active_recipe_cover", "variant", "image or stylized");
    expectPropertyDescription("set_recipe_no_cover", "confirmNoCover", "explicit confirmation");
    expectPropertyDescription("archive_recipe_cover", "confirmNoCover", "explicit no-cover");
  });

  it("validates new Photo Studio arguments before handler execution", async () => {
    const owner = await context.db.user.create({
      data: {
        email: uniqueEmail("cover-schema-chef"),
        username: `cover_schema_chef_${faker.string.alphanumeric(6).toLowerCase()}`,
      },
    });
    const principal = {
      id: owner.id,
      email: owner.email,
      username: owner.username,
      source: "bearer" as const,
      scopes: ["recipes:read", "kitchen:write"],
    };
    const mcpContext = { db: context.db, principal };

    await expect(callSpoonjoyMcpTool(
      "create_recipe_cover_from_upload",
      {
        recipeId: "missing_recipe",
        imageUrl: "/photos/recipes/owner/uploads/raw.jpg",
        generateEditorial: true,
        promptAddition: "warmer light",
        postAsSpoon: true,
        note: "weeknight cook",
        nextTime: "more lemon",
        cookedAt: "2026-02-03T04:05:06.000Z",
        activateWhenReady: true,
        idempotencyKey: "mcp-upload-schema",
      },
      mcpContext,
    )).rejects.toThrow("Recipe not found");

    await expect(callSpoonjoyMcpTool(
      "generate_recipe_cover_placeholder",
      {
        recipeId: "missing_recipe",
        promptAddition: "bright herbs",
        activateWhenReady: true,
        idempotencyKey: "mcp-generate-schema",
      },
      mcpContext,
    )).rejects.toThrow("Recipe not found");

    await expect(callSpoonjoyMcpTool(
      "regenerate_recipe_cover",
      {
        recipeId: "missing_recipe",
        coverId: "cover_missing",
        promptAddition: "keep the plate",
        activateWhenReady: true,
        idempotencyKey: "mcp-regenerate-schema",
      },
      mcpContext,
    )).rejects.toThrow("Recipe not found");

    await expect(callSpoonjoyMcpTool(
      "set_recipe_no_cover",
      {
        recipeId: "missing_recipe",
        confirmNoCover: true,
        idempotencyKey: "mcp-no-cover-schema",
      },
      mcpContext,
    )).rejects.toThrow("Recipe not found");
  });

  it("round-trips recipe cover and spoon-image browse results over MCP JSON", async () => {
    const chef = await context.db.user.create({
      data: {
        email: uniqueEmail("cover-chef"),
        username: `cover_chef_${faker.string.alphanumeric(6).toLowerCase()}`,
      },
    });
    const principal = {
      id: chef.id,
      email: chef.email,
      username: chef.username,
      source: "bearer" as const,
      scopes: ["recipes:read", "kitchen:write"],
    };
    const recipe = await context.db.recipe.create({
      data: {
        title: `MCP Covers ${faker.string.alphanumeric(6)}`,
        chefId: chef.id,
      },
    });
    const spoon = await context.db.recipeSpoon.create({
      data: {
        recipeId: recipe.id,
        chefId: chef.id,
        photoUrl: "/photos/spoons/mcp.jpg",
      },
    });
    const cover = await context.db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/raw.jpg",
        stylizedImageUrl: "/photos/editorial.jpg",
        sourceType: "spoon",
        sourceSpoonId: spoon.id,
        status: "ready",
        generationStatus: "succeeded",
      },
    });
    await context.db.recipe.update({
      where: { id: recipe.id },
      data: { activeCoverId: cover.id, activeCoverVariant: "stylized", coverMode: "manual" },
    });

    const covers = parseJson(await callSpoonjoyMcpTool(
      "list_recipe_covers",
      { recipeId: recipe.id },
      { db: context.db, principal },
    ));
    expect(covers.activeCover).toMatchObject({
      id: cover.id,
      displayUrl: "/photos/editorial.jpg",
      provenanceLabel: "Editorial photo",
    });

    const spoonImages = parseJson(await callSpoonjoyMcpTool(
      "list_recipe_spoon_images",
      { recipeId: recipe.id },
      { db: context.db, principal },
    ));
    expect(spoonImages.spoonImages).toEqual([
      expect.objectContaining({
        id: spoon.id,
        photoUrl: "/photos/spoons/mcp.jpg",
      }),
    ]);
  });

  it("round-trips recipe cover mutation results over MCP JSON", async () => {
    const chef = await context.db.user.create({
      data: {
        email: uniqueEmail("cover-write-chef"),
        username: `cover_write_chef_${faker.string.alphanumeric(6).toLowerCase()}`,
      },
    });
    const principal = {
      id: chef.id,
      email: chef.email,
      username: chef.username,
      source: "bearer" as const,
      scopes: ["recipes:read", "kitchen:write"],
    };
    const recipe = await context.db.recipe.create({
      data: {
        title: `MCP Cover Write ${faker.string.alphanumeric(6)}`,
        chefId: chef.id,
      },
    });

    const dryRun = parseJson(await callSpoonjoyMcpTool(
      "create_recipe_cover_from_upload",
      {
        recipeId: recipe.id,
        imageUrl: `data:image/png;base64,${b64(VALID_PNG_BYTES)}`,
        generateEditorial: false,
        dryRun: true,
      },
      { db: context.db, principal, allowLocalImageFallback: true },
    ));
    expect(dryRun).toMatchObject({
      createdCover: null,
      generationStatus: "dry_run",
      warnings: [],
    });

    const created = parseJson(await callSpoonjoyMcpTool(
      "create_recipe_cover_from_upload",
      {
        recipeId: recipe.id,
        imageUrl: `data:image/png;base64,${b64(VALID_PNG_BYTES)}`,
        generateEditorial: false,
      },
      { db: context.db, principal, allowLocalImageFallback: true },
    ));
    expect(created.createdCover).toMatchObject({
      recipeId: recipe.id,
      sourceType: "chef-upload",
      status: "ready",
      generationStatus: "none",
    });

    const status = parseJson(await callSpoonjoyMcpTool(
      "get_cover_generation_status",
      { recipeId: recipe.id, coverId: created.createdCover.id },
      { db: context.db, principal },
    ));
    expect(status.cover).toMatchObject({
      id: created.createdCover.id,
      generationStatus: "none",
      status: "ready",
    });
  });

  it("creates uploaded covers as Spoons and forwards MCP prompt additions for editorialization", async () => {
    const chef = await context.db.user.create({
      data: {
        email: uniqueEmail("cover-upload-spoon-chef"),
        username: `cover_upload_spoon_chef_${faker.string.alphanumeric(6).toLowerCase()}`,
      },
    });
    const principal = {
      id: chef.id,
      email: chef.email,
      username: chef.username,
      source: "bearer" as const,
      scopes: ["recipes:read", "kitchen:write"],
    };
    const recipe = await context.db.recipe.create({
      data: {
        title: `MCP Upload Spoon ${faker.string.alphanumeric(6)}`,
        chefId: chef.id,
      },
    });
    const runner = {
      textToImage: vi.fn(),
      imageToImage: vi.fn().mockResolvedValue({ bytes: VALID_PNG_BYTES, contentType: "image/png" }),
    };

    const created = parseJson(await callSpoonjoyMcpTool(
      "create_recipe_cover_from_upload",
      {
        recipeId: recipe.id,
        imageUrl: `data:image/png;base64,${b64(VALID_PNG_BYTES)}`,
        generateEditorial: true,
        postAsSpoon: true,
        note: "  weeknight cook  ",
        nextTime: "  more lemon  ",
        cookedAt: "2026-02-03T04:05:06.000Z",
        promptAddition: "  brighter   table  ",
        activateWhenReady: true,
        idempotencyKey: "mcp-upload-spoon-editorial",
      },
      { db: context.db, principal, allowLocalImageFallback: true, imageGenRunner: runner },
    ));

    expect(created).toMatchObject({
      activeCover: { id: created.createdCover.id, activeVariant: "stylized" },
      previousActiveCover: null,
      createdCover: {
        recipeId: recipe.id,
        sourceType: "spoon",
        status: "ready",
        generationStatus: "succeeded",
        stylizedImageUrl: `data:image/png;base64,${b64(VALID_PNG_BYTES)}`,
      },
      generationStatus: "succeeded",
      mutation: { idempotencyKey: "mcp-upload-spoon-editorial", replayed: false },
    });
    expect(runner.imageToImage).toHaveBeenCalledWith(
      expect.any(File),
      expect.stringContaining("Additional direction: brighter table."),
      expect.any(Object),
    );
    await expect(context.db.recipeSpoon.findMany({
      where: { recipeId: recipe.id, chefId: chef.id },
      select: { id: true, note: true, nextTime: true, cookedAt: true, photoUrl: true },
    })).resolves.toEqual([
      expect.objectContaining({
        id: created.createdCover.sourceSpoonId,
        note: "weeknight cook",
        nextTime: "more lemon",
        cookedAt: new Date("2026-02-03T04:05:06.000Z"),
        photoUrl: `data:image/png;base64,${b64(VALID_PNG_BYTES)}`,
      }),
    ]);
    await expect(context.db.recipeCover.findUniqueOrThrow({
      where: { id: created.createdCover.id },
      select: { sourceSpoonId: true, promptAddition: true },
    })).resolves.toEqual({
      sourceSpoonId: created.createdCover.sourceSpoonId,
      promptAddition: "brighter table",
    });
  });

  it("generates AI placeholder cover candidates and reports provider blockers over MCP JSON", async () => {
    const chef = await context.db.user.create({
      data: {
        email: uniqueEmail("cover-placeholder-chef"),
        username: `cover_placeholder_chef_${faker.string.alphanumeric(6).toLowerCase()}`,
      },
    });
    const principal = {
      id: chef.id,
      email: chef.email,
      username: chef.username,
      source: "bearer" as const,
      scopes: ["recipes:read", "kitchen:write"],
    };
    const recipe = await context.db.recipe.create({
      data: {
        title: `MCP Placeholder ${faker.string.alphanumeric(6)}`,
        description: "A bright dinner salad",
        chefId: chef.id,
      },
    });
    const activeCover = await context.db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/current.jpg",
        stylizedImageUrl: "/photos/current-editorial.jpg",
        sourceType: "chef-upload",
        status: "ready",
        generationStatus: "succeeded",
        createdById: chef.id,
      },
    });
    await context.db.recipe.update({
      where: { id: recipe.id },
      data: { activeCoverId: activeCover.id, activeCoverVariant: "stylized", coverMode: "manual" },
    });

    const promptAddition = `  brighter   herbs\nand tighter crop ${"x".repeat(260)}  `;
    const generated = parseJson(await callSpoonjoyMcpTool(
      "generate_recipe_cover_placeholder",
      {
        recipeId: recipe.id,
        promptAddition,
        activateWhenReady: true,
        idempotencyKey: "mcp-placeholder-provider-blocker",
      },
      { db: context.db, principal },
    ));

    expect(generated).toMatchObject({
      activeCover: { id: activeCover.id, activeVariant: "stylized" },
      previousActiveCover: { id: activeCover.id, activeVariant: "stylized" },
      createdCover: {
        recipeId: recipe.id,
        sourceType: "ai-placeholder",
        status: "failed",
        generationStatus: "failed",
        failureReason: expect.stringContaining("missing_image_provider_config"),
        sourceSpoonId: null,
      },
      generationStatus: "failed",
      warnings: [],
      mutation: { idempotencyKey: "mcp-placeholder-provider-blocker", replayed: false },
    });
    await expect(context.db.recipeCover.findUniqueOrThrow({
      where: { id: generated.createdCover.id },
      select: { sourceType: true, promptAddition: true, failureReason: true },
    })).resolves.toEqual({
      sourceType: "ai-placeholder",
      promptAddition: `brighter herbs and tighter crop ${"x".repeat(208)}`,
      failureReason: "missing_image_provider_config",
    });
  });

  it("regenerates recipe covers with MCP prompt additions and persisted lineage", async () => {
    const chef = await context.db.user.create({
      data: {
        email: uniqueEmail("cover-regenerate-chef"),
        username: `cover_regenerate_chef_${faker.string.alphanumeric(6).toLowerCase()}`,
      },
    });
    const principal = {
      id: chef.id,
      email: chef.email,
      username: chef.username,
      source: "bearer" as const,
      scopes: ["recipes:read", "kitchen:write"],
    };
    const recipe = await context.db.recipe.create({
      data: {
        title: `MCP Regenerate ${faker.string.alphanumeric(6)}`,
        chefId: chef.id,
      },
    });
    const cover = await context.db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: `data:image/png;base64,${b64(VALID_PNG_BYTES)}`,
        sourceImageUrl: `data:image/png;base64,${b64(VALID_PNG_BYTES)}`,
        sourceType: "chef-upload",
        status: "ready",
        generationStatus: "none",
        createdById: chef.id,
      },
    });
    await context.db.recipe.update({
      where: { id: recipe.id },
      data: { activeCoverId: cover.id, activeCoverVariant: "image", coverMode: "manual" },
    });
    const runner = {
      textToImage: vi.fn(),
      imageToImage: vi.fn().mockResolvedValue({ bytes: VALID_PNG_BYTES, contentType: "image/png" }),
    };

    const regenerated = parseJson(await callSpoonjoyMcpTool(
      "regenerate_recipe_cover",
      {
        recipeId: recipe.id,
        coverId: cover.id,
        promptAddition: `  keep   same\nplate ${"x".repeat(260)}  `,
        activateWhenReady: true,
        idempotencyKey: "mcp-regenerate-prompt-addition",
      },
      { db: context.db, principal, allowLocalImageFallback: true, imageGenRunner: runner },
    ));

    expect(regenerated).toMatchObject({
      activeCover: { id: cover.id, activeVariant: "stylized", generationStatus: "succeeded" },
      previousActiveCover: { id: cover.id, activeVariant: "image" },
      createdCover: {
        id: cover.id,
        status: "ready",
        generationStatus: "succeeded",
        stylizedImageUrl: `data:image/png;base64,${b64(VALID_PNG_BYTES)}`,
      },
      generationStatus: "succeeded",
      mutation: { idempotencyKey: "mcp-regenerate-prompt-addition", replayed: false },
    });
    expect(runner.imageToImage).toHaveBeenCalledTimes(1);
    expect(runner.imageToImage).toHaveBeenCalledWith(
      expect.any(File),
      expect.stringContaining(`Additional direction: keep same plate ${"x".repeat(224)}.`),
      expect.any(Object),
    );
    await expect(context.db.recipeCover.findUniqueOrThrow({
      where: { id: cover.id },
      select: { promptAddition: true, parentCoverId: true },
    })).resolves.toEqual({
      promptAddition: `keep same plate ${"x".repeat(224)}`,
      parentCoverId: cover.id,
    });
  });

  it("rejects non-string MCP prompt additions before cover generation", async () => {
    const owner = await context.db.user.create({
      data: {
        email: uniqueEmail("cover-invalid-prompt-chef"),
        username: `cover_invalid_prompt_chef_${faker.string.alphanumeric(6).toLowerCase()}`,
      },
    });
    const principal = {
      id: owner.id,
      email: owner.email,
      username: owner.username,
      source: "bearer" as const,
      scopes: ["recipes:read", "kitchen:write"],
    };
    const authedContext = { db: context.db, principal };
    const recipe = await context.db.recipe.create({
      data: {
        title: `MCP Invalid Prompt ${faker.string.alphanumeric(6)}`,
        chefId: owner.id,
      },
    });
    const cover = await context.db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: `data:image/png;base64,${b64(VALID_PNG_BYTES)}`,
        sourceImageUrl: `data:image/png;base64,${b64(VALID_PNG_BYTES)}`,
        sourceType: "chef-upload",
        status: "ready",
        generationStatus: "none",
        createdById: owner.id,
      },
    });

    await expect(callSpoonjoyMcpTool(
      "generate_recipe_cover_placeholder",
      {
        recipeId: recipe.id,
        promptAddition: { nope: true },
        idempotencyKey: "mcp-placeholder-invalid-prompt",
      },
      authedContext,
    )).rejects.toThrow("promptAddition must be a string");

    await expect(callSpoonjoyMcpTool(
      "regenerate_recipe_cover",
      {
        recipeId: recipe.id,
        coverId: cover.id,
        promptAddition: { nope: true },
        idempotencyKey: "mcp-regenerate-invalid-prompt",
      },
      authedContext,
    )).rejects.toThrow("promptAddition must be a string");
  });

  it("replays no-key recipe cover creation over MCP JSON", async () => {
    const chef = await context.db.user.create({
      data: {
        email: uniqueEmail("cover-replay-chef"),
        username: `cover_replay_chef_${faker.string.alphanumeric(6).toLowerCase()}`,
      },
    });
    const principal = {
      id: chef.id,
      email: chef.email,
      username: chef.username,
      source: "bearer" as const,
      scopes: ["recipes:read", "kitchen:write"],
    };
    const recipe = await context.db.recipe.create({
      data: {
        title: `MCP Cover Replay ${faker.string.alphanumeric(6)}`,
        chefId: chef.id,
      },
    });
    const args = {
      recipeId: recipe.id,
      imageUrl: `data:image/png;base64,${b64(VALID_PNG_BYTES)}`,
      generateEditorial: false,
    };

    const first = parseJson(await callSpoonjoyMcpTool(
      "create_recipe_cover_from_upload",
      args,
      { db: context.db, principal, allowLocalImageFallback: true },
    ));
    const replay = parseJson(await callSpoonjoyMcpTool(
      "create_recipe_cover_from_upload",
      args,
      { db: context.db, principal, allowLocalImageFallback: true },
    ));

    expect(replay.createdCover.id).toBe(first.createdCover.id);
    expect(replay.mutation).toEqual({ idempotencyKey: null, replayed: true });
    await expect(context.db.recipeCover.count({ where: { recipeId: recipe.id } })).resolves.toBe(1);
  });

  it("round-trips active-cover set and archive results over MCP JSON", async () => {
    const chef = await context.db.user.create({
      data: {
        email: uniqueEmail("cover-lifecycle-chef"),
        username: `cover_lifecycle_chef_${faker.string.alphanumeric(6).toLowerCase()}`,
      },
    });
    const principal = {
      id: chef.id,
      email: chef.email,
      username: chef.username,
      source: "bearer" as const,
      scopes: ["recipes:read", "kitchen:write"],
    };
    const recipe = await context.db.recipe.create({
      data: {
        title: `MCP Cover Lifecycle ${faker.string.alphanumeric(6)}`,
        chefId: chef.id,
      },
    });
    const current = await context.db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/current.jpg",
        sourceType: "chef-upload",
        status: "ready",
      },
    });
    const replacement = await context.db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/replacement.jpg",
        stylizedImageUrl: "/photos/replacement-editorial.jpg",
        sourceType: "chef-upload",
        status: "ready",
        generationStatus: "succeeded",
      },
    });
    await context.db.recipe.update({
      where: { id: recipe.id },
      data: { activeCoverId: current.id, activeCoverVariant: "image", coverMode: "manual" },
    });

    const set = parseJson(await callSpoonjoyMcpTool(
      "set_active_recipe_cover",
      {
        recipeId: recipe.id,
        coverId: replacement.id,
        variant: "stylized",
      },
      { db: context.db, principal },
    ));
    expect(set).toMatchObject({
      activeCover: { id: replacement.id, activeVariant: "stylized" },
      previousActiveCover: { id: current.id, activeVariant: "image" },
      archivedCover: null,
      warnings: [],
    });

    const archived = parseJson(await callSpoonjoyMcpTool(
      "archive_recipe_cover",
      {
        recipeId: recipe.id,
        coverId: current.id,
      },
      { db: context.db, principal },
    ));
    expect(archived).toMatchObject({
      activeCover: { id: replacement.id, activeVariant: "stylized" },
      previousActiveCover: { id: replacement.id, activeVariant: "stylized" },
      archivedCover: { id: current.id, status: "archived" },
      warnings: [],
    });
    expect(archived.archivedCover.archivedAt).toEqual(expect.any(String));
  });

  it("sets explicit no-cover state over MCP JSON with idempotent replay", async () => {
    const chef = await context.db.user.create({
      data: {
        email: uniqueEmail("cover-none-chef"),
        username: `cover_none_chef_${faker.string.alphanumeric(6).toLowerCase()}`,
      },
    });
    const principal = {
      id: chef.id,
      email: chef.email,
      username: chef.username,
      source: "bearer" as const,
      scopes: ["recipes:read", "kitchen:write"],
    };
    const recipe = await context.db.recipe.create({
      data: {
        title: `MCP No Cover ${faker.string.alphanumeric(6)}`,
        chefId: chef.id,
      },
    });
    const cover = await context.db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/current.jpg",
        stylizedImageUrl: "/photos/current-editorial.jpg",
        sourceType: "chef-upload",
        status: "ready",
        generationStatus: "succeeded",
        createdById: chef.id,
      },
    });
    await context.db.recipe.update({
      where: { id: recipe.id },
      data: { activeCoverId: cover.id, activeCoverVariant: "stylized", coverMode: "manual" },
    });
    const args = {
      recipeId: recipe.id,
      confirmNoCover: true,
      idempotencyKey: "mcp-set-no-cover",
    };

    await expect(callSpoonjoyMcpTool(
      "set_recipe_no_cover",
      { ...args, confirmNoCover: false, idempotencyKey: "mcp-set-no-cover-denied" },
      { db: context.db, principal },
    )).rejects.toMatchObject({
      status: 400,
      message: "confirmNoCover must be true",
    });

    const first = parseJson(await callSpoonjoyMcpTool("set_recipe_no_cover", args, { db: context.db, principal }));
    const replay = parseJson(await callSpoonjoyMcpTool("set_recipe_no_cover", args, { db: context.db, principal }));

    expect(first).toMatchObject({
      activeCover: null,
      previousActiveCover: { id: cover.id, activeVariant: "stylized" },
      archivedCover: null,
      warnings: [],
      nextActions: ["list_recipe_covers", "get_recipe"],
      mutation: { idempotencyKey: "mcp-set-no-cover", replayed: false },
    });
    expect(replay).toMatchObject({
      activeCover: null,
      previousActiveCover: { id: cover.id, activeVariant: "stylized" },
      mutation: { idempotencyKey: "mcp-set-no-cover", replayed: true },
    });
    await expect(context.db.recipe.findUniqueOrThrow({
      where: { id: recipe.id },
      select: { activeCoverId: true, activeCoverVariant: true, coverMode: true },
    })).resolves.toEqual({
      activeCoverId: null,
      activeCoverVariant: null,
      coverMode: "none",
    });
  });

  it("uploads recipe and spoon photos to owner-scoped R2 namespaces", async () => {
    const bucket = mockR2();
    const recipePayload = parseJson(await callSpoonjoyMcpTool("upload_recipe_image", {
      imageBase64: b64(VALID_PNG_BYTES),
      mimeType: "image/png",
      filename: "raw.png",
    }, { ...context, bucket }));
    const owner = await context.db.user.findUniqueOrThrow({ where: { email: context.defaultOwnerEmail! } });

    expect(recipePayload).toMatchObject({
      imageUrl: expect.stringMatching(new RegExp(`^/photos/recipes/${owner.id}/uploads/\\d+-[a-f0-9-]+\\.png$`)),
      mimeType: "image/png",
      sizeBytes: VALID_PNG_BYTES.length,
    });

    const spoonPayload = parseJson(await callSpoonjoyMcpTool("upload_spoon_photo", {
      imageBase64: b64(VALID_PNG_BYTES),
      mimeType: "image/png",
      filename: "spoon.png",
    }, { ...context, bucket }));

    expect(spoonPayload).toMatchObject({
      imageUrl: expect.stringMatching(new RegExp(`^/photos/spoons/${owner.id}/uploads/\\d+-[a-f0-9-]+\\.png$`)),
      mimeType: "image/png",
      sizeBytes: VALID_PNG_BYTES.length,
    });
    expect(bucket.put).toHaveBeenCalledTimes(2);
    expect(bucket.put).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^recipes/${owner.id}/uploads/\\d+-[a-f0-9-]+\\.png$`)),
      expect.any(File),
      expect.objectContaining({ httpMetadata: { contentType: "image/png" } }),
    );
  });

  it("rejects invalid, GIF, and non-food upload payloads before storage", async () => {
    await expect(callSpoonjoyMcpTool("upload_recipe_image", {
      imageBase64: "not valid base64!",
      mimeType: "image/png",
      filename: "raw.png",
    }, { ...context, bucket: mockR2() })).rejects.toThrow(/base64/i);

    await expect(callSpoonjoyMcpTool("upload_recipe_image", {
      imageBase64: b64(GIF_BYTES),
      mimeType: "image/png",
      filename: "raw.png",
    }, { ...context, bucket: mockR2() })).rejects.toThrow("Photos must be JPG, PNG, or WebP.");

    await expect(callSpoonjoyMcpTool("upload_spoon_photo", {
      imageBase64: b64(GIF_BYTES),
      mimeType: "image/gif",
      filename: "raw.gif",
    }, { ...context, bucket: mockR2() })).rejects.toThrow("Photos must be JPG, PNG, or WebP.");
  });

  it("rejects production-like missing image buckets unless local fallback is explicit", async () => {
    await expect(callSpoonjoyMcpTool("upload_recipe_image", {
      imageBase64: b64(VALID_PNG_BYTES),
      mimeType: "image/png",
      filename: "raw.png",
    }, context)).rejects.toMatchObject({
      status: 503,
      message: "Image uploads require the PHOTOS bucket.",
    });

    const fallback = parseJson(await callSpoonjoyMcpTool("upload_recipe_image", {
      imageBase64: b64(VALID_PNG_BYTES),
      mimeType: "image/png",
      filename: "raw.png",
    }, { ...context, allowLocalImageFallback: true }));
    expect(fallback.imageUrl).toBe(`data:image/png;base64,${b64(VALID_PNG_BYTES)}`);
  });

  it("reports health and writable state", async () => {
    expect(parseJson(await callSpoonjoyMcpTool("health", {}, context))).toMatchObject({
      ok: true,
      app: "spoonjoy-v2",
      authenticated: false,
      defaultOwnerEmail: context.defaultOwnerEmail,
      writable: true,
    });

    expect(parseJson(await callSpoonjoyMcpTool("health", {}, { db: context.db }))).toMatchObject({
      authenticated: false,
      defaultOwnerEmail: null,
      writable: false,
    });
  });

  it("reports agent auth status without asking for user credentials", async () => {
    expect(parseJson(await callSpoonjoyMcpTool("auth_status", {}, { db: context.db }))).toMatchObject({
      authenticated: false,
      principal: null,
      defaultOwnerEmail: null,
      defaultOwner: null,
      writable: false,
      standards: [
        "Custom Spoonjoy delegated approval link",
        "MCP OAuth authorization",
      ],
      guidance: expect.stringContaining("never ask for their password"),
    });

    const uncreatedOwner = parseJson(await callSpoonjoyMcpTool("auth_status", {}, context));
    expect(uncreatedOwner).toMatchObject({
      authenticated: false,
      principal: null,
      defaultOwnerEmail: context.defaultOwnerEmail,
      defaultOwner: null,
      writable: true,
      guidance: expect.stringContaining("Never ask for raw Spoonjoy credentials"),
    });

    const created = parseJson(await callSpoonjoyMcpTool("create_api_token", {
      name: "Status token",
    }, context));
    const ownerStatus = parseJson(await callSpoonjoyMcpTool("auth_status", {}, context));
    expect(ownerStatus.defaultOwner).toMatchObject({
      email: context.defaultOwnerEmail,
      username: context.defaultOwnerEmail?.split("@")[0],
    });

    const principal = await authenticateApiToken(context.db, created.token as string);
    const authed = parseJson(await callSpoonjoyMcpTool("auth_status", {}, { db: context.db, principal }));

    expect(authed).toMatchObject({
      authenticated: true,
      principal: {
        email: context.defaultOwnerEmail,
        username: context.defaultOwnerEmail?.split("@")[0],
        authSource: "bearer",
        credentialId: created.credential.id,
      },
      writable: true,
    });

    const sessionAuthed = parseJson(await callSpoonjoyMcpTool("auth_status", {}, {
      db: context.db,
      principal: { ...principal, credentialId: undefined, source: "session" },
    }));
    expect(sessionAuthed.principal).toMatchObject({
      authSource: "session",
      credentialId: null,
    });
  });

  it("starts and polls delegated agent connections over MCP", async () => {
    const user = await context.db.user.create({
      data: { email: uniqueEmail("delegated"), username: faker.internet.username() },
    });

    const started = parseJson(await callSpoonjoyMcpTool("start_agent_connection", {
      agentName: "slugger",
      baseUrl: "https://spoonjoy.app",
    }, context));
    expect(started).toMatchObject({
      deviceCode: expect.stringMatching(/^sjdc_/),
      userCode: expect.stringMatching(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/),
      authorizationUrl: expect.stringContaining("https://spoonjoy.app/agent/connect/"),
      verificationUri: "https://spoonjoy.app/agent/connect",
      verificationUriComplete: expect.stringContaining("https://spoonjoy.app/agent/connect/"),
      interval: 2,
      message: expect.stringContaining("Never ask"),
    });

    const envFallback = parseJson(await callSpoonjoyMcpTool("start_agent_connection", {
      agentName: "slugger",
    }, {
      ...context,
      env: { SPOONJOY_BASE_URL: "https://spoonjoy.app" },
    }));
    expect(envFallback.authorizationUrl).toContain("https://spoonjoy.app/agent/connect/");

    const canonicalEnv = parseJson(await callSpoonjoyMcpTool("start_agent_connection", {
      agentName: "slugger",
      baseUrl: "https://spoonjoy.com",
    }, {
      ...context,
      env: { SPOONJOY_BASE_URL: "https://spoonjoy.app" },
    }));
    expect(canonicalEnv.authorizationUrl).toContain("https://spoonjoy.app/agent/connect/");

    const pending = parseJson(await callSpoonjoyMcpTool("poll_agent_connection", {
      deviceCode: started.deviceCode,
      baseUrl: "https://spoonjoy.app",
    }, context));
    expect(pending).toMatchObject({
      status: "pending",
      userCode: started.userCode,
      authorizationUrl: started.authorizationUrl,
    });

    const requestId = new URL(started.authorizationUrl).pathname.split("/").pop()!;
    await context.db.agentConnectionRequest.update({
      where: { id: requestId },
      data: { status: "approved", approvedById: user.id, approvedAt: new Date() },
    });
    const approved = parseJson(await callSpoonjoyMcpTool("poll_agent_connection", {
      deviceCode: started.deviceCode,
      tokenName: "Slugger test token",
    }, context));
    expect(approved).toMatchObject({
      status: "approved",
      token: expect.stringMatching(/^sj_/),
      credential: { name: "Slugger test token" },
      storage: { vaultItem: "spoonjoy.app", passwordField: "password" },
    });

    await expect(callSpoonjoyMcpTool("poll_agent_connection", {}, context))
      .rejects.toThrow("deviceCode is required");
  });

  it("creates, lists, revokes, and authorizes owner-scoped API tokens", async () => {
    const created = parseJson(await callSpoonjoyMcpTool("create_api_token", {
      name: "Ouro vault token",
    }, context));
    expect(created.token).toMatch(/^sj_/);
    expect(created.credential).toMatchObject({
      name: "Ouro vault token",
      tokenPrefix: created.token.slice(0, 12),
      lastUsedAt: null,
      revokedAt: null,
    });

    const stored = await context.db.apiCredential.findUniqueOrThrow({ where: { id: created.credential.id } });
    expect(stored.tokenHash).not.toBe(created.token);

    const defaultNamed = parseJson(await callSpoonjoyMcpTool("create_api_token", {}, context));
    expect(defaultNamed.credential).toMatchObject({ name: "Spoonjoy API token" });

    const principal = await authenticateApiToken(context.db, created.token as string);
    expect(principal).toMatchObject({
      email: context.defaultOwnerEmail,
      source: "bearer",
      credentialId: created.credential.id,
    });

    const authedContext: SpoonjoyMcpContext = { db: context.db, principal };
    const health = parseJson(await callSpoonjoyMcpTool("health", {}, authedContext));
    expect(health).toMatchObject({ authenticated: true, authSource: "bearer", writable: true });

    const limited = await createApiCredential(context.db, principal.id, "Limited issuer", {
      scopes: ["recipes:read", "tokens:write"],
    });
    const limitedPrincipal = await authenticateApiToken(context.db, limited.token);
    const limitedContext: SpoonjoyMcpContext = { db: context.db, principal: limitedPrincipal };
    const inherited = parseJson(await callSpoonjoyMcpTool("create_api_token", {
      name: "Inherited limited token",
    }, limitedContext));
    await expect(context.db.apiCredential.findUniqueOrThrow({ where: { id: inherited.credential.id } }))
      .resolves.toMatchObject({ scopes: "recipes:read tokens:write" });
    const subset = parseJson(await callSpoonjoyMcpTool("create_api_token", {
      name: "Recipe reader child",
      scopes: ["recipes:read"],
    }, limitedContext));
    await expect(context.db.apiCredential.findUniqueOrThrow({ where: { id: subset.credential.id } }))
      .resolves.toMatchObject({ scopes: "recipes:read" });
    await expect(callSpoonjoyMcpTool("create_api_token", {
      name: "Too broad",
      scopes: ["shopping_list:write"],
    }, limitedContext)).rejects.toThrow("outside the caller's scopes");

    const listed = parseJson(await callSpoonjoyMcpTool("list_api_tokens", {}, authedContext));
    expect(listed.credentials).toHaveLength(5);
    expect(listed.credentials).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: created.credential.id, name: "Ouro vault token" }),
      expect.objectContaining({ id: defaultNamed.credential.id, name: "Spoonjoy API token" }),
    ]));
    expect(listed.credentials[0].token).toBeUndefined();

    await expect(callSpoonjoyMcpTool("add_shopping_list_item", {
      ownerEmail: uniqueEmail("token-attacker"),
      name: "Milk",
    }, authedContext)).rejects.toThrow("different owner");

    const revoked = parseJson(await callSpoonjoyMcpTool("revoke_api_token", {
      credentialId: created.credential.id,
    }, authedContext));
    expect(revoked).toMatchObject({ revoked: true, credential: { id: created.credential.id } });
    expect(revoked.credential.revokedAt).toEqual(expect.any(String));

    const revokedAgain = parseJson(await callSpoonjoyMcpTool("revoke_api_token", {
      credentialId: created.credential.id,
    }, authedContext));
    expect(revokedAgain.revoked).toBe(false);
    await expect(authenticateApiToken(context.db, created.token as string)).rejects.toThrow("Invalid API token");
  });

  it("creates, searches, and fetches recipes with steps and ingredients", async () => {
    const first = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      title: "Agent Pancakes",
      description: "Breakfast fit for drones",
      servings: "2",
      sourceUrl: "https://spoonjoy.app/agent-pancakes",
      steps: [
        {
          title: "Mix",
          description: "Mix the batter",
          duration: 5,
          ingredients: [
            { name: "Flour", quantity: 2, unit: "Cup" },
            { name: "Milk", quantity: 1.5, unit: "Cup" },
          ],
        },
        { description: "Cook until golden", ingredients: [{ name: "Butter", quantity: 1, unit: "Tbsp" }] },
      ],
    }, context));

    expect(first.recipe).toMatchObject({
      title: "Agent Pancakes",
      description: "Breakfast fit for drones",
      servings: "2",
      sourceUrl: "https://spoonjoy.app/agent-pancakes",
      ingredientCount: 3,
      steps: [
        { stepNum: 1, title: "Mix", duration: 5 },
        { stepNum: 2, title: null, duration: null },
      ],
    });
    expect(first.recipe.steps[0].ingredients.map((ingredient: { name: string }) => ingredient.name)).toEqual(["flour", "milk"]);

    const byId = parseJson(await callSpoonjoyMcpTool("get_recipe", { id: first.recipe.id }, context));
    expect(byId.recipe.title).toBe("Agent Pancakes");

    const byTitle = parseJson(await callSpoonjoyMcpTool("get_recipe", { title: "Agent Pancakes" }, context));
    expect(byTitle.recipe.id).toBe(first.recipe.id);

    const search = parseJson(await callSpoonjoyMcpTool("search_recipes", { query: "Pancakes", chefEmail: context.defaultOwnerEmail, limit: 25 }, context));
    expect(search.recipes).toHaveLength(1);
    expect(search.recipes[0]).toMatchObject({ title: "Agent Pancakes", stepCount: 2, ingredientNames: ["butter", "flour", "milk"] });

    const ingredientSearch = parseJson(await callSpoonjoyMcpTool("search_recipes", { query: "Butter" }, context));
    expect(ingredientSearch.recipes[0]).toMatchObject({ id: first.recipe.id, title: "Agent Pancakes" });

    const missingChefSearch = parseJson(await callSpoonjoyMcpTool("search_recipes", {
      query: "Pancakes",
      chefEmail: uniqueEmail("missing-chef"),
    }, context));
    expect(missingChefSearch.recipes).toEqual([]);
  });

  it("creates and updates recipe covers from uploaded image URLs with stylization scheduled", async () => {
    const bucket = mockR2();
    const captured: Promise<unknown>[] = [];
    const runner = {
      textToImage: vi.fn(),
      imageToImage: vi.fn().mockResolvedValue({ bytes: VALID_PNG_BYTES, contentType: "image/png" }),
    };
    const upload = parseJson(await callSpoonjoyMcpTool("upload_recipe_image", {
      imageBase64: b64(VALID_PNG_BYTES),
      mimeType: "image/png",
      filename: "cover.png",
    }, { ...context, bucket }));

    const created = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      title: "Uploaded Cover Soup",
      imageUrl: upload.imageUrl,
    }, { ...context, bucket, waitUntil: (p) => captured.push(p), imageGenRunner: runner }));

    expect(created.recipe.imageUrl).toMatch(/^\/photos\/covers\/\d+-[a-f0-9-]+\.png$/);
    const firstCover = await context.db.recipeCover.findFirstOrThrow({
      where: { recipeId: created.recipe.id },
      orderBy: { createdAt: "desc" },
    });
    expect(firstCover).toMatchObject({
      imageUrl: upload.imageUrl,
      sourceType: "chef-upload",
    });
    const createdRecipe = await context.db.recipe.findUniqueOrThrow({
      where: { id: created.recipe.id },
      select: { activeCoverId: true, activeCoverVariant: true, coverMode: true },
    });
    expect(createdRecipe).toMatchObject({
      activeCoverId: firstCover.id,
      activeCoverVariant: "stylized",
      coverMode: "manual",
    });
    expect(captured).toHaveLength(0);
    expect(runner.imageToImage).toHaveBeenCalledTimes(1);

    const secondUpload = parseJson(await callSpoonjoyMcpTool("upload_recipe_image", {
      imageBase64: b64(VALID_PNG_BYTES),
      mimeType: "image/png",
      filename: "replacement.png",
    }, { ...context, bucket }));
    const updated = parseJson(await callSpoonjoyMcpTool("update_recipe", {
      id: created.recipe.id,
      imageUrl: secondUpload.imageUrl,
    }, { ...context, bucket, waitUntil: (p) => captured.push(p), imageGenRunner: runner }));

    expect(updated.recipe.imageUrl).toMatch(/^\/photos\/covers\/\d+-[a-f0-9-]+\.png$/);
    await expect(context.db.recipeCover.count({ where: { recipeId: created.recipe.id } })).resolves.toBe(2);
    const activeAfterUpdate = await context.db.recipe.findUniqueOrThrow({
      where: { id: created.recipe.id },
      select: { activeCoverId: true, activeCoverVariant: true, coverMode: true },
    });
    const replacementCover = await context.db.recipeCover.findFirstOrThrow({
      where: { recipeId: created.recipe.id },
      orderBy: { createdAt: "desc" },
    });
    expect(activeAfterUpdate).toMatchObject({
      activeCoverId: replacementCover.id,
      activeCoverVariant: "stylized",
      coverMode: "manual",
    });
    expect(captured).toHaveLength(0);
    expect(runner.imageToImage).toHaveBeenCalledTimes(2);
  });

  it("round-trips explicit local recipe image data URLs when no bucket is available", async () => {
    const captured: Promise<unknown>[] = [];
    const runner = {
      textToImage: vi.fn(),
      imageToImage: vi.fn().mockResolvedValue({ bytes: VALID_PNG_BYTES, contentType: "image/png" }),
    };
    const upload = parseJson(await callSpoonjoyMcpTool("upload_recipe_image", {
      imageBase64: b64(VALID_PNG_BYTES),
      mimeType: "image/png",
      filename: "cover.png",
    }, { ...context, allowLocalImageFallback: true }));

    const created = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      title: "Local Data Cover Soup",
      imageUrl: upload.imageUrl,
    }, {
      ...context,
      allowLocalImageFallback: true,
      waitUntil: (p) => captured.push(p),
      imageGenRunner: runner,
    }));

    expect(created.recipe.imageUrl).toBe(`data:image/png;base64,${b64(VALID_PNG_BYTES)}`);
    let cover = await context.db.recipeCover.findFirstOrThrow({ where: { recipeId: created.recipe.id } });
    expect(cover.imageUrl).toBe(created.recipe.imageUrl);
    expect(captured).toHaveLength(0);
    cover = await context.db.recipeCover.findUniqueOrThrow({ where: { id: cover.id } });
    expect(cover.stylizedImageUrl).toBe(`data:image/png;base64,${b64(VALID_PNG_BYTES)}`);

    const updated = parseJson(await callSpoonjoyMcpTool("update_recipe", {
      id: created.recipe.id,
      imageUrl: upload.imageUrl,
    }, {
      ...context,
      allowLocalImageFallback: true,
      waitUntil: (p) => captured.push(p),
      imageGenRunner: runner,
    }));

    expect(updated.recipe.imageUrl).toBe(upload.imageUrl);
    await expect(context.db.recipeCover.count({ where: { recipeId: created.recipe.id } })).resolves.toBe(2);
    expect(captured).toHaveLength(0);
    expect(runner.imageToImage).toHaveBeenCalledTimes(2);
  });

  it("rejects unsafe recipe cover image assignments", async () => {
    const bucket = mockR2();
    const upload = parseJson(await callSpoonjoyMcpTool("upload_recipe_image", {
      imageBase64: b64(VALID_PNG_BYTES),
      mimeType: "image/png",
      filename: "cover.png",
    }, { ...context, bucket }));
    const owner = await context.db.user.findUniqueOrThrow({ where: { email: context.defaultOwnerEmail! } });
    const invalidTitles = [
      "External Cover Soup",
      "Foreign Cover Soup",
      "Missing Cover Soup",
      "Generated Cover Soup",
      "Bucket Data Cover Soup",
    ];

    await expect(callSpoonjoyMcpTool("create_recipe", {
      title: invalidTitles[0],
      imageUrl: "https://photos.example/cover.png",
    }, { ...context, bucket })).rejects.toThrow("Recipe imageUrl must be a Spoonjoy uploaded image URL.");

    await expect(callSpoonjoyMcpTool("create_recipe", {
      title: invalidTitles[1],
      imageUrl: upload.imageUrl.replace(`/recipes/${owner.id}/`, "/recipes/other-user/"),
    }, { ...context, bucket })).rejects.toThrow("Recipe imageUrl must belong to the recipe owner.");

    await expect(callSpoonjoyMcpTool("create_recipe", {
      title: invalidTitles[2],
      imageUrl: `/photos/recipes/${owner.id}/uploads/missing.png`,
    }, { ...context, bucket })).rejects.toThrow("Recipe imageUrl does not exist in storage.");

    await expect(callSpoonjoyMcpTool("create_recipe", {
      title: invalidTitles[3],
      imageUrl: "/photos/covers/generated.png",
    }, { ...context, bucket })).rejects.toThrow("Recipe imageUrl must belong to the recipe owner.");

    await expect(callSpoonjoyMcpTool("create_recipe", {
      title: invalidTitles[4],
      imageUrl: `data:image/png;base64,${b64(VALID_PNG_BYTES)}`,
    }, { ...context, bucket })).rejects.toThrow("Data URL recipe images require missing bucket storage and explicit local image fallback.");
    await expect(context.db.recipe.count({ where: { title: { in: invalidTitles } } })).resolves.toBe(0);

    const stable = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      title: "Stable Image Assignment Recipe",
    }, { ...context, bucket }));
    await expect(callSpoonjoyMcpTool("update_recipe", {
      id: stable.recipe.id,
      title: "Should Not Stick",
      imageUrl: "https://photos.example/replacement.png",
    }, { ...context, bucket })).rejects.toThrow("Recipe imageUrl must be a Spoonjoy uploaded image URL.");
    await expect(context.db.recipe.findUniqueOrThrow({
      where: { id: stable.recipe.id },
      select: { title: true },
    })).resolves.toEqual({ title: "Stable Image Assignment Recipe" });
    await expect(context.db.recipeCover.count({ where: { recipeId: stable.recipe.id } })).resolves.toBe(0);
  });

  it("creates minimal recipes and finds null for missing recipes", async () => {
    const recipe = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      ownerEmail: uniqueEmail("explicit"),
      title: "No Step Snack",
    }, { db: context.db }));

    expect(recipe.recipe.steps).toEqual([]);
    await expect(callSpoonjoyMcpTool("get_recipe", {}, context)).rejects.toThrow("id or title is required");
    expect(parseJson(await callSpoonjoyMcpTool("get_recipe", { id: "missing" }, context))).toEqual({ recipe: null });
  });

  it("updates owner recipes with replacement steps and ingredients without interactive transactions", async () => {
    const created = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      title: "Draft Agent Pancakes",
      description: "Early breakfast notes",
      servings: "2",
      sourceUrl: "https://spoonjoy.app/draft-agent-pancakes",
      steps: [
        {
          title: "Mix",
          description: "Mix the batter",
          duration: 5,
          ingredients: [
            { name: "Flour", quantity: 2, unit: "Cup" },
            { name: "Milk", quantity: 1, unit: "Cup" },
          ],
        },
        { description: "Cook", ingredients: [{ name: "Butter", quantity: 1, unit: "Tbsp" }] },
      ],
    }, context));

    await context.db.stepOutputUse.create({
      data: {
        recipeId: created.recipe.id,
        outputStepNum: 1,
        inputStepNum: 2,
      },
    });

    const guardedContext = {
      ...context,
      db: withD1TransactionGuard(context.db),
    };

    const updated = parseJson(await callSpoonjoyMcpTool("update_recipe", {
      id: created.recipe.id,
      title: "Finished Agent Pancakes",
      description: "Breakfast fit for a full MCP pass",
      servings: null,
      sourceUrl: null,
      steps: [
        {
          title: "Whisk",
          description: "Whisk until glossy",
          duration: 6,
          ingredients: [{ name: "Egg", quantity: 2, unit: "Whole" }],
        },
        { description: "Serve warm", ingredients: [] },
      ],
    }, guardedContext));

    expect(updated.recipe).toMatchObject({
      id: created.recipe.id,
      title: "Finished Agent Pancakes",
      description: "Breakfast fit for a full MCP pass",
      servings: null,
      sourceUrl: null,
      ingredientCount: 1,
      steps: [
        { stepNum: 1, title: "Whisk", description: "Whisk until glossy", duration: 6 },
        { stepNum: 2, title: null, description: "Serve warm", duration: null, ingredients: [] },
      ],
    });
    expect(updated.recipe.steps[0].ingredients).toEqual([
      expect.objectContaining({ name: "egg", quantity: 2, unit: "whole" }),
    ]);
    await expect(context.db.stepOutputUse.count({ where: { recipeId: created.recipe.id } })).resolves.toBe(0);
    await expect(context.db.ingredient.count({ where: { recipeId: created.recipe.id } })).resolves.toBe(1);
  });

  it("keeps untouched fields when updating only part of a recipe", async () => {
    const created = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      title: "Partial Update Soup",
      description: "Keep this description",
      servings: "4",
      sourceUrl: "https://spoonjoy.app/partial-update-soup",
      steps: [{ description: "Simmer", ingredients: [{ name: "Beans", quantity: 1, unit: "Can" }] }],
    }, context));

    const updated = parseJson(await callSpoonjoyMcpTool("update_recipe", {
      id: created.recipe.id,
      title: "Partial Update Stew",
    }, context));

    expect(updated.recipe).toMatchObject({
      id: created.recipe.id,
      title: "Partial Update Stew",
      description: "Keep this description",
      servings: "4",
      sourceUrl: "https://spoonjoy.app/partial-update-soup",
      ingredientCount: 1,
      steps: [{ description: "Simmer" }],
    });

    const cleared = parseJson(await callSpoonjoyMcpTool("update_recipe", {
      id: created.recipe.id,
      description: "",
    }, context));
    expect(cleared.recipe).toMatchObject({
      title: "Partial Update Stew",
      description: null,
      servings: "4",
    });

    const stepsOnly = parseJson(await callSpoonjoyMcpTool("update_recipe", {
      id: created.recipe.id,
      steps: [{ description: "Finish with herbs", ingredients: [] }],
    }, context));
    expect(stepsOnly.recipe).toMatchObject({
      title: "Partial Update Stew",
      description: null,
      ingredientCount: 0,
      steps: [{ stepNum: 1, description: "Finish with herbs", ingredients: [] }],
    });
  });

  it("rejects invalid or unauthorized recipe updates", async () => {
    const first = parseJson(await callSpoonjoyMcpTool("create_recipe", { title: "Update Owner Recipe" }, context));
    await callSpoonjoyMcpTool("create_recipe", { title: "Update Duplicate Recipe" }, context);

    await expect(callSpoonjoyMcpTool("update_recipe", {}, context)).rejects.toThrow("id is required");
    await expect(callSpoonjoyMcpTool("update_recipe", { id: first.recipe.id, title: "" }, context)).rejects.toThrow("title is required");
    await expect(callSpoonjoyMcpTool("update_recipe", {
      id: first.recipe.id,
      title: "Update Duplicate Recipe",
    }, context)).rejects.toThrow(ACTIVE_RECIPE_TITLE_CONFLICT_ERROR);
    await expect(callSpoonjoyMcpTool("update_recipe", {
      ownerEmail: uniqueEmail("other-owner"),
      id: first.recipe.id,
      title: "Stolen Update",
    }, context)).rejects.toThrow("Recipe not found");
    await expect(callSpoonjoyMcpTool("update_recipe", {
      id: first.recipe.id,
      steps: {},
    }, context)).rejects.toThrow("steps must be an array");
    await expect(callSpoonjoyMcpTool("update_recipe", {
      id: first.recipe.id,
      description: 42,
    }, context)).rejects.toThrow("description must be a string or null");
    await expect(callSpoonjoyMcpTool("update_recipe", { id: "missing-recipe", title: "Missing" }, context)).rejects.toThrow("Recipe not found");
  });

  it("soft-deletes owner recipes through MCP for agent cleanup", async () => {
    const created = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      title: "Temporary MCP Cleanup Soup",
      steps: [{ description: "Simmer", ingredients: [{ name: "Carrot", quantity: 2, unit: "Whole" }] }],
    }, context));

    const deleted = parseJson(await callSpoonjoyMcpTool("delete_recipe", {
      id: created.recipe.id,
    }, context));
    expect(deleted).toMatchObject({
      deleted: true,
      recipe: {
        id: created.recipe.id,
        title: "Temporary MCP Cleanup Soup",
        deletedAt: expect.any(String),
      },
    });

    expect(parseJson(await callSpoonjoyMcpTool("get_recipe", { id: created.recipe.id }, context))).toEqual({ recipe: null });
    await expect(callSpoonjoyMcpTool("update_recipe", {
      id: created.recipe.id,
      title: "Still Temporary",
    }, context)).rejects.toThrow("Recipe not found");

    const deletedAgain = parseJson(await callSpoonjoyMcpTool("delete_recipe", {
      id: created.recipe.id,
    }, context));
    expect(deletedAgain).toMatchObject({
      deleted: false,
      recipe: {
        id: created.recipe.id,
        deletedAt: deleted.recipe.deletedAt,
      },
    });
  });

  it("rejects invalid or unauthorized recipe deletes", async () => {
    const created = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      title: "Protected MCP Cleanup Soup",
    }, context));

    await expect(callSpoonjoyMcpTool("delete_recipe", {}, context)).rejects.toThrow("id is required");
    await expect(callSpoonjoyMcpTool("delete_recipe", {
      ownerEmail: uniqueEmail("other-owner"),
      id: created.recipe.id,
    }, context)).rejects.toThrow("Recipe not found");
    await expect(callSpoonjoyMcpTool("delete_recipe", {
      id: "missing-recipe",
    }, context)).rejects.toThrow("Recipe not found");

    const recipe = await context.db.recipe.findUniqueOrThrow({ where: { id: created.recipe.id } });
    expect(recipe.deletedAt).toBeNull();
  });

  it("handles unusual owner emails and ingredient-free steps", async () => {
    const emptyLocal = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      ownerEmail: "@example.com",
      title: "Empty Local Owner",
      steps: [{ description: "Rest with no ingredients" }],
    }, context));
    const symbolLocal = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      ownerEmail: "!!!@example.com",
      title: "Symbol Local Owner",
    }, context));

    expect(emptyLocal.recipe.chef.username).toBe("agent");
    expect(emptyLocal.recipe.steps[0]).toMatchObject({ description: "Rest with no ingredients", ingredients: [] });
    expect(symbolLocal.recipe.chef.username).toBe("agent-2");
  });

  it("reuses existing owner usernames, units, and ingredient refs", async () => {
    const email = uniqueEmail("same-local");
    const baseUsername = email.split("@")[0];
    await context.db.user.create({ data: { email: uniqueEmail("other"), username: baseUsername } });

    const created = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      ownerEmail: email,
      title: "Reuse Soup",
      steps: [{ description: "Stir", ingredients: [{ name: "Salt", quantity: 1, unit: "Tsp" }] }],
    }, context));
    const second = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      ownerEmail: email,
      title: "Reuse Stew",
      steps: [{ description: "Stir more", ingredients: [{ name: "Salt", quantity: 2, unit: "Tsp" }] }],
    }, context));

    expect(created.recipe.chef.username).toBe(`${baseUsername}-2`);
    expect(second.recipe.steps[0].ingredients[0]).toMatchObject({ name: "salt", unit: "tsp" });
    await expect(context.db.unit.count()).resolves.toBe(1);
    await expect(context.db.ingredientRef.count()).resolves.toBe(1);
  });

  it("adds recipe ingredients to a shopping list and merges duplicates", async () => {
    const recipe = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      title: "Shopping Cake",
      steps: [{ description: "Mix", ingredients: [{ name: "Sugar", quantity: 1, unit: "Cup" }] }],
    }, context));

    const first = parseJson(await callSpoonjoyMcpTool("add_recipe_to_shopping_list", { recipeId: recipe.recipe.id }, context));
    expect(first).toMatchObject({ created: 1, updated: 0 });
    expect(first.shoppingList.items[0]).toMatchObject({ name: "sugar", quantity: 1, checked: false });

    const second = parseJson(await callSpoonjoyMcpTool("add_recipe_to_shopping_list", { recipeId: recipe.recipe.id }, context));
    expect(second).toMatchObject({ created: 0, updated: 1 });
    expect(second.shoppingList.items[0]).toMatchObject({ name: "sugar", quantity: 2, checked: false });
  });

  it("handles a recipe with no ingredients without touching the shopping list", async () => {
    // The batched path short-circuits both the existing-items findMany and
    // the transaction when there's nothing to add. This guards both empty
    // branches: aggregatedRows.length === 0 and ops.length === 0.
    const recipe = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      title: "Empty Sketch",
      steps: [{ description: "Just an idea." }],
    }, context));

    const added = parseJson(await callSpoonjoyMcpTool("add_recipe_to_shopping_list", { recipeId: recipe.recipe.id }, context));
    expect(added).toMatchObject({ created: 0, updated: 0 });
    expect(added.shoppingList.items).toEqual([]);
  });

  it("aggregates duplicate (unit, ingredient) pairs within a single recipe into one item", async () => {
    // Two steps both list the same (Sugar, Cup) — the batched path must sum
    // them in memory before writing, otherwise the second create hits the
    // unique constraint. Behavior should match the original per-iteration loop
    // which happened to update the just-created row.
    const recipe = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      title: "Double Sugar Cake",
      steps: [
        { description: "Mix first batch", ingredients: [{ name: "Sugar", quantity: 1, unit: "Cup" }] },
        { description: "Mix second batch", ingredients: [{ name: "Sugar", quantity: 2, unit: "Cup" }] },
      ],
    }, context));

    const added = parseJson(await callSpoonjoyMcpTool("add_recipe_to_shopping_list", { recipeId: recipe.recipe.id }, context));
    expect(added).toMatchObject({ created: 1, updated: 0 });
    expect(added.shoppingList.items).toHaveLength(1);
    expect(added.shoppingList.items[0]).toMatchObject({ name: "sugar", unit: "cup", quantity: 3 });
  });

  it("coalesces shared recipe adds by deterministic step and ingredient order without changing the MCP shape", async () => {
    const suffix = faker.string.alphanumeric(8).toLowerCase();
    const owner = await context.db.user.create({
      data: { email: context.defaultOwnerEmail!, username: `ordered-${suffix}` },
    });
    const recipe = await context.db.recipe.create({
      data: { chefId: owner.id, title: `Ordered shared recipe ${suffix}` },
    });
    const unit = await context.db.unit.create({ data: { name: `ordered-unit-${suffix}` } });
    const alpha = await context.db.ingredientRef.create({ data: { name: `ordered-alpha-${suffix}` } });
    const beta = await context.db.ingredientRef.create({ data: { name: `ordered-beta-${suffix}` } });

    await context.db.recipeStep.create({
      data: { recipeId: recipe.id, stepNum: 2, description: "Second step inserted first" },
    });
    await context.db.recipeStep.create({
      data: { recipeId: recipe.id, stepNum: 1, description: "First step inserted second" },
    });
    await context.db.ingredient.create({
      data: {
        id: `ingredient-step-2-${suffix}`,
        recipeId: recipe.id,
        stepNum: 2,
        quantity: 3,
        unitId: unit.id,
        ingredientRefId: alpha.id,
      },
    });
    await context.db.ingredient.create({
      data: {
        id: `ingredient-a-${suffix}`,
        recipeId: recipe.id,
        stepNum: 1,
        quantity: 1,
        unitId: unit.id,
        ingredientRefId: alpha.id,
      },
    });
    await context.db.ingredient.create({
      data: {
        id: `ingredient-A-${suffix}`,
        recipeId: recipe.id,
        stepNum: 1,
        quantity: 2,
        unitId: unit.id,
        ingredientRefId: beta.id,
      },
    });

    const added = parseJson(await callSpoonjoyMcpTool(
      "add_recipe_to_shopping_list",
      { recipeId: recipe.id },
      context,
    ));

    expect(added).toEqual({
      created: 2,
      updated: 0,
      shoppingList: {
        id: expect.any(String),
        ownerId: owner.id,
        items: [
          {
            id: expect.any(String),
            quantity: 2,
            unit: unit.name,
            name: beta.name,
            checked: false,
            categoryKey: null,
            iconKey: null,
            sortIndex: 0,
          },
          {
            id: expect.any(String),
            quantity: 4,
            unit: unit.name,
            name: alpha.name,
            checked: false,
            categoryKey: null,
            iconKey: null,
            sortIndex: 1,
          },
        ],
      },
    });
    await expect(context.db.shoppingListItem.count()).resolves.toBe(2);
  });

  it("rejects a non-finite shared recipe aggregate before writing any shopping item", async () => {
    const suffix = faker.string.alphanumeric(8).toLowerCase();
    const owner = await context.db.user.create({
      data: { email: context.defaultOwnerEmail!, username: `finite-${suffix}` },
    });
    const recipe = await context.db.recipe.create({
      data: { chefId: owner.id, title: `Finite shared recipe ${suffix}` },
    });
    const step = await context.db.recipeStep.create({
      data: { recipeId: recipe.id, stepNum: 1, description: "Overflow deliberately" },
    });
    const unit = await context.db.unit.create({ data: { name: `finite-unit-${suffix}` } });
    const ingredientRef = await context.db.ingredientRef.create({ data: { name: `finite-ref-${suffix}` } });
    await context.db.ingredient.createMany({
      data: [
        {
          id: `finite-a-${suffix}`,
          recipeId: recipe.id,
          stepNum: step.stepNum,
          quantity: Number.MAX_VALUE,
          unitId: unit.id,
          ingredientRefId: ingredientRef.id,
        },
        {
          id: `finite-b-${suffix}`,
          recipeId: recipe.id,
          stepNum: step.stepNum,
          quantity: Number.MAX_VALUE,
          unitId: unit.id,
          ingredientRefId: ingredientRef.id,
        },
      ],
    });

    await expect(callSpoonjoyMcpTool(
      "add_recipe_to_shopping_list",
      { recipeId: recipe.id },
      context,
    )).rejects.toThrow();
    await expect(context.db.shoppingListItem.count()).resolves.toBe(0);
  });

  it("rolls back every shared recipe item when a later coalesced identity fails", async () => {
    const recipe = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      title: "Atomic shared shopping recipe",
      steps: [{
        description: "Add two identities",
        ingredients: [
          { name: "Atomic shared apples", quantity: 2, unit: "Each" },
          { name: "Atomic shared flour", quantity: 3, unit: "Cup" },
        ],
      }],
    }, context));
    const ingredients = await context.db.ingredient.findMany({
      where: { recipeId: recipe.recipe.id },
      orderBy: [{ stepNum: "asc" }, { id: "asc" }],
    });
    const rejectedIdentity = ingredients[1].ingredientRefId;
    await context.db.$executeRawUnsafe(`
      CREATE TRIGGER "compat_shared_bulk_abort"
      BEFORE INSERT ON "ShoppingListItem"
      WHEN NEW."ingredientRefId" = '${rejectedIdentity}'
      BEGIN
        SELECT RAISE(ABORT, 'compat_shared_bulk_failure');
      END
    `);

    try {
      await expect(callSpoonjoyMcpTool(
        "add_recipe_to_shopping_list",
        { recipeId: recipe.recipe.id },
        context,
      )).rejects.toThrow();
      await expect(context.db.shoppingListItem.count()).resolves.toBe(0);
    } finally {
      await context.db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "compat_shared_bulk_abort"');
    }
  });

  it("uses one atomic shared recipe transaction when an identity appears before execution", async () => {
    const recipe = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      title: "Racing shared shopping recipe",
      steps: [{
        description: "Add two identities",
        ingredients: [
          { name: "Racing shared apples", quantity: 2, unit: "Each" },
          { name: "Racing shared flour", quantity: 3, unit: "Cup" },
        ],
      }],
    }, context));
    const owner = await context.db.user.findUniqueOrThrow({ where: { email: context.defaultOwnerEmail } });
    const shoppingList = await context.db.shoppingList.create({ data: { authorId: owner.id } });
    const racedIngredient = await context.db.ingredient.findFirstOrThrow({
      where: { recipeId: recipe.recipe.id },
      orderBy: [{ stepNum: "asc" }, { id: "asc" }],
    });
    let transactionCalls = 0;
    const transactionOperationArrays: unknown[][] = [];
    const racingDb = new Proxy(context.db, {
      get(target, property, receiver) {
        if (property !== "$transaction") return Reflect.get(target, property, receiver);
        const transaction = Reflect.get(target, property, receiver) as (...args: unknown[]) => Promise<unknown>;
        return async (input: unknown, ...rest: unknown[]) => {
          transactionCalls += 1;
          if (!Array.isArray(input)) throw new Error("Expected a batched shopping-list transaction");
          transactionOperationArrays.push(input);
          if (transactionCalls === 1) {
            await target.shoppingListItem.create({
              data: {
                id: `shared-race-${faker.string.alphanumeric(8).toLowerCase()}`,
                shoppingListId: shoppingList.id,
                ingredientRefId: racedIngredient.ingredientRefId,
                unitId: racedIngredient.unitId,
                quantity: 4,
                sortIndex: 0,
              },
            });
          }
          return transaction.apply(target, [input, ...rest]);
        };
      },
    }) as SpoonjoyMcpContext["db"];

    const added = parseJson(await callSpoonjoyMcpTool(
      "add_recipe_to_shopping_list",
      { recipeId: recipe.recipe.id },
      { ...context, db: racingDb },
    ));

    expect(transactionCalls).toBe(1);
    expect(transactionOperationArrays.map((operations) => operations.length)).toEqual([2]);
    expect(added).toMatchObject({
      created: 1,
      updated: 1,
      shoppingList: {
        ownerId: owner.id,
        items: expect.arrayContaining([
          expect.objectContaining({ quantity: 4 + racedIngredient.quantity }),
        ]),
      },
    });
    await expect(context.db.shoppingListItem.count({ where: { shoppingListId: shoppingList.id } })).resolves.toBe(2);
  });

  it("updates the active shared recipe identity even when an earlier tombstone also matches", async () => {
    const recipe = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      title: "Active-first shared shopping recipe",
      steps: [{
        description: "Use the migrated survivor",
        ingredients: [{ name: "Active-first shared beans", quantity: 2, unit: "Can" }],
      }],
    }, context));
    const owner = await context.db.user.findUniqueOrThrow({ where: { email: context.defaultOwnerEmail } });
    const shoppingList = await context.db.shoppingList.create({ data: { authorId: owner.id } });
    const ingredient = await context.db.ingredient.findFirstOrThrow({ where: { recipeId: recipe.recipe.id } });
    const suffix = faker.string.alphanumeric(8).toLowerCase();

    await withActiveShoppingIdentityIndex(context.db, async () => {
      const active = await context.db.shoppingListItem.create({
        data: {
          id: `recipe-active-z-${suffix}`,
          shoppingListId: shoppingList.id,
          ingredientRefId: ingredient.ingredientRefId,
          unitId: ingredient.unitId,
          quantity: 5,
          sortIndex: 4,
        },
      });
      const tombstone = await context.db.shoppingListItem.create({
        data: {
          id: `recipe-deleted-a-${suffix}`,
          shoppingListId: shoppingList.id,
          ingredientRefId: ingredient.ingredientRefId,
          unitId: ingredient.unitId,
          quantity: 100,
          sortIndex: 0,
          deletedAt: new Date("2025-01-01T00:00:00.000Z"),
        },
      });

      const added = parseJson(await callSpoonjoyMcpTool(
        "add_recipe_to_shopping_list",
        { recipeId: recipe.recipe.id },
        context,
      ));

      expect(added).toEqual({
        created: 0,
        updated: 1,
        shoppingList: {
          id: shoppingList.id,
          ownerId: owner.id,
          items: [{
            id: active.id,
            quantity: 7,
            unit: recipe.recipe.steps[0].ingredients[0].unit,
            name: recipe.recipe.steps[0].ingredients[0].name,
            checked: false,
            categoryKey: null,
            iconKey: null,
            sortIndex: 4,
          }],
        },
      });
      await expect(context.db.shoppingListItem.findUniqueOrThrow({ where: { id: tombstone.id } }))
        .resolves.toMatchObject({ quantity: 100, deletedAt: expect.any(Date) });
    });
  });

  it("creates a fresh shared recipe item without reviving a post-0025 tombstone", async () => {
    const recipe = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      title: "Tombstone-only shared shopping recipe",
      steps: [{
        description: "Restore the deterministic survivor",
        ingredients: [{ name: "Tombstone-only shared beans", quantity: 2, unit: "Can" }],
      }],
    }, context));
    const owner = await context.db.user.findUniqueOrThrow({ where: { email: context.defaultOwnerEmail } });
    const shoppingList = await context.db.shoppingList.create({ data: { authorId: owner.id } });
    const ingredient = await context.db.ingredient.findFirstOrThrow({ where: { recipeId: recipe.recipe.id } });
    const suffix = faker.string.alphanumeric(8).toLowerCase();

    await withActiveShoppingIdentityIndex(context.db, async () => {
      const earliest = await context.db.shoppingListItem.create({
        data: {
          id: `recipe-deleted-A-same-sort-${suffix}`,
          shoppingListId: shoppingList.id,
          ingredientRefId: ingredient.ingredientRefId,
          unitId: ingredient.unitId,
          quantity: 5,
          checked: true,
          checkedAt: new Date("2025-03-01T00:00:00.000Z"),
          sortIndex: 1,
          categoryKey: "pantry",
          iconKey: "jar",
          deletedAt: new Date("2025-03-01T00:00:00.000Z"),
        },
      });
      const laterBySort = await context.db.shoppingListItem.create({
        data: {
          id: `recipe-deleted-A-later-sort-${suffix}`,
          shoppingListId: shoppingList.id,
          ingredientRefId: ingredient.ingredientRefId,
          unitId: ingredient.unitId,
          quantity: 100,
          sortIndex: 3,
          deletedAt: new Date("2025-01-01T00:00:00.000Z"),
        },
      });
      const laterByBinaryId = await context.db.shoppingListItem.create({
        data: {
          id: `recipe-deleted-a-same-sort-${suffix}`,
          shoppingListId: shoppingList.id,
          ingredientRefId: ingredient.ingredientRefId,
          unitId: ingredient.unitId,
          quantity: 20,
          sortIndex: 1,
          deletedAt: new Date("2025-02-01T00:00:00.000Z"),
        },
      });

      const added = parseJson(await callSpoonjoyMcpTool(
        "add_recipe_to_shopping_list",
        { recipeId: recipe.recipe.id },
        context,
      ));

      expect(added).toEqual({
        created: 1,
        updated: 0,
        shoppingList: {
          id: shoppingList.id,
          ownerId: owner.id,
          items: [{
            id: expect.any(String),
            quantity: 2,
            unit: recipe.recipe.steps[0].ingredients[0].unit,
            name: recipe.recipe.steps[0].ingredients[0].name,
            checked: false,
            categoryKey: null,
            iconKey: null,
            sortIndex: 0,
          }],
        },
      });
      expect(added.shoppingList.items[0].id).not.toBe(earliest.id);
      await expect(context.db.shoppingListItem.findUniqueOrThrow({ where: { id: earliest.id } }))
        .resolves.toMatchObject({ quantity: 5, checked: true, deletedAt: expect.any(Date) });
      await expect(context.db.shoppingListItem.findUniqueOrThrow({ where: { id: laterByBinaryId.id } }))
        .resolves.toMatchObject({ quantity: 20, deletedAt: expect.any(Date) });
      await expect(context.db.shoppingListItem.findUniqueOrThrow({ where: { id: laterBySort.id } }))
        .resolves.toMatchObject({ quantity: 100, deletedAt: expect.any(Date) });
    });
  });

  it("rejects adding a soft-deleted recipe to a shopping list", async () => {
    const recipe = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      title: "Deleted Shopping Cake",
      steps: [{ description: "Mix", ingredients: [{ name: "Sugar", quantity: 1, unit: "Cup" }] }],
    }, context));
    await context.db.recipe.update({
      where: { id: recipe.recipe.id },
      data: { deletedAt: new Date() },
    });

    await expect(
      callSpoonjoyMcpTool("add_recipe_to_shopping_list", { recipeId: recipe.recipe.id }, context)
    ).rejects.toThrow("Recipe not found");
  });

  it("creates, lists, and fetches cookbooks idempotently for the configured owner", async () => {
    const first = parseJson(await callSpoonjoyMcpTool("create_cookbook", {
      title: "Agent Dinner Plans",
    }, context));
    expect(first).toMatchObject({
      created: true,
      cookbook: {
        title: "Agent Dinner Plans",
        recipeCount: 0,
        recipes: [],
      },
    });

    const duplicate = parseJson(await callSpoonjoyMcpTool("create_cookbook", {
      title: "Agent Dinner Plans",
    }, context));
    expect(duplicate).toMatchObject({
      created: false,
      cookbook: { id: first.cookbook.id, title: "Agent Dinner Plans" },
    });

    const explicitOwner = parseJson(await callSpoonjoyMcpTool("create_cookbook", {
      ownerEmail: uniqueEmail("cookbook-owner"),
      title: "Agent Dinner Plans",
    }, context));
    expect(explicitOwner).toMatchObject({
      created: true,
      cookbook: { title: "Agent Dinner Plans" },
    });
    expect(explicitOwner.cookbook.id).not.toBe(first.cookbook.id);

    const list = parseJson(await callSpoonjoyMcpTool("list_cookbooks", {
      query: "Dinner",
      limit: 3,
    }, context));
    expect(list.cookbooks).toHaveLength(1);
    expect(list.cookbooks[0]).toMatchObject({
      id: first.cookbook.id,
      title: "Agent Dinner Plans",
      recipeCount: 0,
      recipes: [],
    });

    const byId = parseJson(await callSpoonjoyMcpTool("get_cookbook", {
      cookbookId: first.cookbook.id,
    }, context));
    expect(byId.cookbook).toMatchObject({
      id: first.cookbook.id,
      title: "Agent Dinner Plans",
      recipeCount: 0,
      recipes: [],
    });

    const byTitle = parseJson(await callSpoonjoyMcpTool("get_cookbook", {
      cookbookTitle: "Agent Dinner Plans",
    }, context));
    expect(byTitle.cookbook.id).toBe(first.cookbook.id);
  });

  it("lists cookbook summaries without loading deep recipe step payloads", async () => {
    const ownerEmail = context.defaultOwnerEmail!;
    const owner = await context.db.user.create({
      data: {
        email: ownerEmail,
        username: `summary-${faker.string.alphanumeric(8).toLowerCase()}`,
      },
    });
    await context.db.cookbook.create({
      data: {
        title: "Lean Cookbook Summary",
        authorId: owner.id,
      },
    });

    const cookbookFindManyArgs: unknown[] = [];
    const db = new Proxy(context.db, {
      get(target, property, receiver) {
        if (property !== "cookbook") {
          return Reflect.get(target, property, receiver);
        }

        const cookbookDelegate = Reflect.get(target, property, receiver);
        return new Proxy(cookbookDelegate, {
          get(delegateTarget, delegateProperty, delegateReceiver) {
            if (delegateProperty !== "findMany") {
              return Reflect.get(delegateTarget, delegateProperty, delegateReceiver);
            }

            const findMany = Reflect.get(delegateTarget, delegateProperty, delegateReceiver) as (args: unknown) => unknown;
            return (args: unknown) => {
              cookbookFindManyArgs.push(args);
              return findMany.call(delegateTarget, args);
            };
          },
        });
      },
    }) as SpoonjoyMcpContext["db"];

    const list = parseJson(await callSpoonjoyMcpTool("list_cookbooks", {}, { ...context, db }));

    expect(list.cookbooks).toHaveLength(1);
    expect(list.cookbooks[0]).toMatchObject({
      title: "Lean Cookbook Summary",
      recipeCount: 0,
      recipes: [],
    });
    expect(JSON.stringify(cookbookFindManyArgs)).not.toContain("steps");
    expect(JSON.stringify(cookbookFindManyArgs)).not.toContain("ingredients");
  });

  it("adds and removes recipes from owner-scoped cookbooks idempotently", async () => {
    const cookbook = parseJson(await callSpoonjoyMcpTool("create_cookbook", {
      title: "Harness Menus",
    }, context));
    const recipe = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      title: "Organized Soup",
      description: "Soup for MCP memory",
      steps: [{ description: "Simmer", ingredients: [{ name: "Carrot", quantity: 2, unit: "Each" }] }],
    }, context));

    const added = parseJson(await callSpoonjoyMcpTool("add_recipe_to_cookbook", {
      cookbookId: cookbook.cookbook.id,
      recipeId: recipe.recipe.id,
    }, context));
    expect(added.added).toBe(true);
    expect(added.cookbook).toMatchObject({
      id: cookbook.cookbook.id,
      recipeCount: 1,
      recipes: [
        {
          addedById: recipe.recipe.chef.id,
          recipe: {
            id: recipe.recipe.id,
            title: "Organized Soup",
            ingredientNames: ["carrot"],
          },
        },
      ],
    });
    expect(typeof added.cookbook.recipes[0].relationId).toBe("string");
    expect(typeof added.cookbook.recipes[0].addedAt).toBe("string");

    const duplicate = parseJson(await callSpoonjoyMcpTool("add_recipe_to_cookbook", {
      title: "Harness Menus",
      recipeId: recipe.recipe.id,
    }, context));
    expect(duplicate.added).toBe(false);
    expect(duplicate.cookbook.recipeCount).toBe(1);

    const listed = parseJson(await callSpoonjoyMcpTool("list_cookbooks", {}, context));
    expect(listed.cookbooks[0]).toMatchObject({
      id: cookbook.cookbook.id,
      recipeCount: 1,
      recipes: [{ id: recipe.recipe.id, title: "Organized Soup" }],
    });

    const removed = parseJson(await callSpoonjoyMcpTool("remove_recipe_from_cookbook", {
      cookbookTitle: "Harness Menus",
      recipeId: recipe.recipe.id,
    }, context));
    expect(removed).toMatchObject({
      removed: true,
      cookbook: { recipeCount: 0, recipes: [] },
    });

    const removedAgain = parseJson(await callSpoonjoyMcpTool("remove_recipe_from_cookbook", {
      cookbookId: cookbook.cookbook.id,
      recipeId: recipe.recipe.id,
    }, context));
    expect(removedAgain).toMatchObject({
      removed: false,
      cookbook: { recipeCount: 0, recipes: [] },
    });
  });

  it("runs owner-scoped write tools without callback-style transactions", async () => {
    const guardedContext = {
      ...context,
      db: withD1TransactionGuard(context.db),
    };

    const cookbook = parseJson(await callSpoonjoyMcpTool("create_cookbook", {
      title: "D1 Safe Menus",
    }, guardedContext));
    const recipe = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      title: "D1 Safe Soup",
      description: "Soup for D1 runtime parity",
      steps: [{ description: "Simmer", ingredients: [{ name: "Carrot", quantity: 2, unit: "Each" }] }],
    }, guardedContext));
    const added = parseJson(await callSpoonjoyMcpTool("add_recipe_to_cookbook", {
      cookbookId: cookbook.cookbook.id,
      recipeId: recipe.recipe.id,
    }, guardedContext));
    const fromRecipe = parseJson(await callSpoonjoyMcpTool("add_recipe_to_shopping_list", {
      recipeId: recipe.recipe.id,
    }, guardedContext));
    const manualItem = parseJson(await callSpoonjoyMcpTool("add_shopping_list_item", {
      name: "Milk",
      quantity: 1,
      unit: "Gallon",
    }, guardedContext));
    const milkItem = manualItem.shoppingList.items.find((item: { name: string }) => item.name === "milk");
    if (!milkItem) throw new Error("Expected milk item");
    const checked = parseJson(await callSpoonjoyMcpTool("set_shopping_list_item_checked", {
      itemId: milkItem.id,
      checked: true,
    }, guardedContext));
    const removedItem = parseJson(await callSpoonjoyMcpTool("remove_shopping_list_item", {
      itemId: milkItem.id,
    }, guardedContext));
    const removedRecipe = parseJson(await callSpoonjoyMcpTool("remove_recipe_from_cookbook", {
      cookbookId: cookbook.cookbook.id,
      recipeId: recipe.recipe.id,
    }, guardedContext));

    expect(added).toMatchObject({
      added: true,
      cookbook: {
        id: cookbook.cookbook.id,
        recipeCount: 1,
        recipes: [{ recipe: { id: recipe.recipe.id, title: "D1 Safe Soup" } }],
      },
    });
    expect(fromRecipe).toMatchObject({ created: 1, updated: 0 });
    expect(checked.shoppingList.items).toContainEqual(expect.objectContaining({ name: "milk", checked: true }));
    expect(removedItem.shoppingList.items).not.toContainEqual(expect.objectContaining({ name: "milk" }));
    expect(removedRecipe).toMatchObject({ removed: true, cookbook: { recipeCount: 0, recipes: [] } });
  });

  it("keeps cookbook MCP reads and writes scoped to the owning agent", async () => {
    const cookbook = parseJson(await callSpoonjoyMcpTool("create_cookbook", {
      title: "Private Agent Book",
    }, context));
    const recipe = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      title: "Private Agent Recipe",
    }, context));
    const otherEmail = uniqueEmail("other-cookbook-agent");

    expect(parseJson(await callSpoonjoyMcpTool("get_cookbook", {
      ownerEmail: otherEmail,
      cookbookId: cookbook.cookbook.id,
    }, context))).toEqual({ cookbook: null });

    await expect(callSpoonjoyMcpTool("add_recipe_to_cookbook", {
      ownerEmail: otherEmail,
      cookbookId: cookbook.cookbook.id,
      recipeId: recipe.recipe.id,
    }, context)).rejects.toThrow("Cookbook not found");

    await expect(callSpoonjoyMcpTool("remove_recipe_from_cookbook", {
      ownerEmail: otherEmail,
      cookbookId: cookbook.cookbook.id,
      recipeId: recipe.recipe.id,
    }, context)).rejects.toThrow("Cookbook not found");

    const stillEmpty = parseJson(await callSpoonjoyMcpTool("get_cookbook", {
      cookbookId: cookbook.cookbook.id,
    }, context));
    expect(stillEmpty.cookbook).toMatchObject({ recipeCount: 0, recipes: [] });
  });

  it("groups multiple recipes per cookbook in list_cookbooks (batched-fetch regression)", async () => {
    // The batched listCookbooks fetches every cookbook's recipes in one
    // findMany and groups them in memory. With 2+ recipes per cookbook the
    // "append to existing list" branch fires; with a single recipe it doesn't.
    // This test exercises that branch.
    const cookbook = parseJson(await callSpoonjoyMcpTool("create_cookbook", {
      title: "Big Box",
    }, context));
    const r1 = parseJson(await callSpoonjoyMcpTool("create_recipe", { title: "Salt Soup" }, context));
    const r2 = parseJson(await callSpoonjoyMcpTool("create_recipe", { title: "Pepper Soup" }, context));
    await callSpoonjoyMcpTool("add_recipe_to_cookbook", {
      cookbookId: cookbook.cookbook.id,
      recipeId: r1.recipe.id,
    }, context);
    await callSpoonjoyMcpTool("add_recipe_to_cookbook", {
      cookbookId: cookbook.cookbook.id,
      recipeId: r2.recipe.id,
    }, context);

    const listed = parseJson(await callSpoonjoyMcpTool("list_cookbooks", {}, context));
    expect(listed.cookbooks).toHaveLength(1);
    expect(listed.cookbooks[0].recipeCount).toBe(2);
    const titles = listed.cookbooks[0].recipes.map((r: { title: string }) => r.title).sort();
    expect(titles).toEqual(["Pepper Soup", "Salt Soup"]);
  });

  it("excludes deleted recipes from cookbook MCP payloads", async () => {
    const cookbook = parseJson(await callSpoonjoyMcpTool("create_cookbook", {
      title: "Active Only",
    }, context));
    const recipe = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      title: "Soon Deleted Recipe",
    }, context));
    await callSpoonjoyMcpTool("add_recipe_to_cookbook", {
      cookbookId: cookbook.cookbook.id,
      recipeId: recipe.recipe.id,
    }, context);

    await context.db.recipe.update({
      where: { id: recipe.recipe.id },
      data: { deletedAt: new Date() },
    });

    const fetched = parseJson(await callSpoonjoyMcpTool("get_cookbook", {
      cookbookId: cookbook.cookbook.id,
    }, context));
    expect(fetched.cookbook).toMatchObject({ recipeCount: 0, recipes: [] });

    const listed = parseJson(await callSpoonjoyMcpTool("list_cookbooks", {}, context));
    expect(listed.cookbooks[0]).toMatchObject({ recipeCount: 0, recipes: [] });

    await expect(callSpoonjoyMcpTool("add_recipe_to_cookbook", {
      cookbookId: cookbook.cookbook.id,
      recipeId: recipe.recipe.id,
    }, context)).rejects.toThrow("Recipe not found");
  });

  it("treats an existing null shopping-list quantity as zero when merging", async () => {
    const recipe = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      title: "Null Quantity Beans",
      steps: [{ description: "Open", ingredients: [{ name: "Beans", quantity: 3, unit: "Can" }] }],
    }, context));
    const owner = await context.db.user.findUniqueOrThrow({ where: { email: context.defaultOwnerEmail } });
    const shoppingList = await context.db.shoppingList.create({ data: { authorId: owner.id } });
    const ingredient = await context.db.ingredient.findFirstOrThrow({ where: { recipeId: recipe.recipe.id } });
    await context.db.shoppingListItem.create({
      data: {
        shoppingListId: shoppingList.id,
        ingredientRefId: ingredient.ingredientRefId,
        unitId: ingredient.unitId,
        quantity: null,
      },
    });

    const result = parseJson(await callSpoonjoyMcpTool("add_recipe_to_shopping_list", { recipeId: recipe.recipe.id }, context));
    expect(result).toMatchObject({ created: 0, updated: 1 });
    expect(result.shoppingList.items[0]).toMatchObject({ name: "beans", quantity: 3 });
  });

  it("gets shopping lists and filters deleted items including unitless items", async () => {
    const owner = await context.db.user.create({ data: { email: uniqueEmail("shopper"), username: faker.internet.username() } });
    const list = await context.db.shoppingList.create({ data: { authorId: owner.id } });
    const ingredientRef = await context.db.ingredientRef.create({ data: { name: `beans-${faker.string.alphanumeric(5).toLowerCase()}` } });
    const secondRef = await context.db.ingredientRef.create({ data: { name: `apples-${faker.string.alphanumeric(5).toLowerCase()}` } });
    await context.db.shoppingListItem.create({ data: { shoppingListId: list.id, ingredientRefId: ingredientRef.id, sortIndex: 1 } });
    await context.db.shoppingListItem.create({ data: { shoppingListId: list.id, ingredientRefId: secondRef.id, sortIndex: 1 } });
    await context.db.shoppingListItem.create({ data: { shoppingListId: list.id, ingredientRefId: ingredientRef.id, sortIndex: 2, deletedAt: new Date() } });

    const result = parseJson(await callSpoonjoyMcpTool("get_shopping_list", { ownerEmail: owner.email }, context));
    expect(result.shoppingList.items.map((item: { name: string }) => item.name)).toEqual([secondRef.name, ingredientRef.name].sort());
    expect(result.shoppingList.items[0]).toEqual(expect.objectContaining({ quantity: null, unit: null, sortIndex: 1 }));
  });

  it("manages direct shopping-list item adds, checks, removes, and restores", async () => {
    const first = parseJson(await callSpoonjoyMcpTool("add_shopping_list_item", {
      name: "Milk",
      quantity: 1,
      unit: "Gallon",
      categoryKey: "dairy",
      iconKey: "milk",
    }, context));
    expect(first).toMatchObject({ created: 1, updated: 0 });
    expect(first.shoppingList.items[0]).toMatchObject({
      name: "milk",
      quantity: 1,
      unit: "gallon",
      checked: false,
      categoryKey: "dairy",
      iconKey: "milk",
    });

    const itemId = first.shoppingList.items[0].id;
    const merged = parseJson(await callSpoonjoyMcpTool("add_shopping_list_item", {
      name: "Milk",
      quantity: 2,
      unit: "Gallon",
    }, context));
    expect(merged).toMatchObject({ created: 0, updated: 1 });
    expect(merged.shoppingList.items[0]).toMatchObject({
      id: itemId,
      quantity: 3,
      categoryKey: "dairy",
      iconKey: "milk",
    });

    const unchangedQuantity = parseJson(await callSpoonjoyMcpTool("add_shopping_list_item", {
      name: "Milk",
      unit: "Gallon",
    }, context));
    expect(unchangedQuantity).toMatchObject({ created: 0, updated: 1 });
    expect(unchangedQuantity.shoppingList.items[0]).toMatchObject({ id: itemId, quantity: 3 });

    const checked = parseJson(await callSpoonjoyMcpTool("set_shopping_list_item_checked", {
      itemId,
      checked: true,
    }, context));
    expect(checked.shoppingList.items[0]).toMatchObject({ id: itemId, checked: true });

    const unchecked = parseJson(await callSpoonjoyMcpTool("set_shopping_list_item_checked", {
      itemId,
      checked: false,
    }, context));
    expect(unchecked.shoppingList.items[0]).toMatchObject({ id: itemId, checked: false });

    const removed = parseJson(await callSpoonjoyMcpTool("remove_shopping_list_item", { itemId }, context));
    expect(removed.shoppingList.items).toEqual([]);

    const removedAgain = parseJson(await callSpoonjoyMcpTool("remove_shopping_list_item", { itemId }, context));
    expect(removedAgain.shoppingList.items).toEqual([]);

    const restored = parseJson(await callSpoonjoyMcpTool("add_shopping_list_item", {
      name: "Milk",
      quantity: 1,
      unit: "Gallon",
    }, context));
    expect(restored).toMatchObject({ created: 1, updated: 0 });
    expect(restored.shoppingList.items[0]).toMatchObject({ quantity: 1, checked: false });
    expect(restored.shoppingList.items[0].id).not.toBe(itemId);
  });

  it("keeps shared check ordering at zero when the active list disappears before max lookup", async () => {
    const added = parseJson(await callSpoonjoyMcpTool("add_shopping_list_item", {
      name: "Check Race Milk",
      quantity: 1,
    }, context));
    const item = await context.db.shoppingListItem.findUniqueOrThrow({
      where: { id: added.shoppingList.items[0].id },
    });
    const findFirst = vi.spyOn(context.db.shoppingListItem, "findFirst")
      .mockResolvedValueOnce(item)
      .mockResolvedValueOnce(null);

    const checked = parseJson(await callSpoonjoyMcpTool("set_shopping_list_item_checked", {
      itemId: item.id,
      checked: true,
    }, context));

    expect(checked.shoppingList.items[0]).toMatchObject({
      id: item.id,
      checked: true,
      sortIndex: 0,
    });
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it("always updates the active manual identity before considering a matching tombstone", async () => {
    const suffix = faker.string.alphanumeric(8).toLowerCase();
    const owner = await context.db.user.create({
      data: { email: context.defaultOwnerEmail!, username: `manual-active-${suffix}` },
    });
    const shoppingList = await context.db.shoppingList.create({ data: { authorId: owner.id } });
    const unit = await context.db.unit.create({ data: { name: `manual-active-unit-${suffix}` } });
    const ingredientRef = await context.db.ingredientRef.create({ data: { name: `manual-active-ref-${suffix}` } });

    await withActiveShoppingIdentityIndex(context.db, async () => {
      const tombstone = await context.db.shoppingListItem.create({
        data: {
          id: `manual-deleted-a-${suffix}`,
          shoppingListId: shoppingList.id,
          ingredientRefId: ingredientRef.id,
          unitId: unit.id,
          quantity: 100,
          sortIndex: 0,
          deletedAt: new Date("2025-01-01T00:00:00.000Z"),
        },
      });
      const active = await context.db.shoppingListItem.create({
        data: {
          id: `manual-active-z-${suffix}`,
          shoppingListId: shoppingList.id,
          ingredientRefId: ingredientRef.id,
          unitId: unit.id,
          quantity: 1,
          sortIndex: 4,
          categoryKey: "pantry",
          iconKey: "jar",
        },
      });

      const added = parseJson(await callSpoonjoyMcpTool("add_shopping_list_item", {
        name: ingredientRef.name,
        quantity: 2,
        unit: unit.name,
      }, context));

      expect(added).toEqual({
        created: 0,
        updated: 1,
        shoppingList: {
          id: shoppingList.id,
          ownerId: owner.id,
          items: [{
            id: active.id,
            quantity: 3,
            unit: unit.name,
            name: ingredientRef.name,
            checked: false,
            categoryKey: "pantry",
            iconKey: "jar",
            sortIndex: 4,
          }],
        },
      });
      await expect(context.db.shoppingListItem.findUniqueOrThrow({ where: { id: tombstone.id } }))
        .resolves.toMatchObject({ quantity: 100, deletedAt: expect.any(Date) });
    });
  });

  it("creates a fresh manual item when no active identity exists", async () => {
    const suffix = faker.string.alphanumeric(8).toLowerCase();
    const owner = await context.db.user.create({
      data: { email: context.defaultOwnerEmail!, username: `manual-deleted-${suffix}` },
    });
    const shoppingList = await context.db.shoppingList.create({ data: { authorId: owner.id } });
    const unit = await context.db.unit.create({ data: { name: `manual-deleted-unit-${suffix}` } });
    const ingredientRef = await context.db.ingredientRef.create({ data: { name: `manual-deleted-ref-${suffix}` } });

    await withActiveShoppingIdentityIndex(context.db, async () => {
      await context.db.shoppingListItem.create({
        data: {
          id: `manual-deleted-a-${suffix}`,
          shoppingListId: shoppingList.id,
          ingredientRefId: ingredientRef.id,
          unitId: unit.id,
          quantity: 100,
          sortIndex: 1,
          deletedAt: new Date("2025-01-01T00:00:00.000Z"),
        },
      });
      const earliest = await context.db.shoppingListItem.create({
        data: {
          id: `manual-deleted-A-${suffix}`,
          shoppingListId: shoppingList.id,
          ingredientRefId: ingredientRef.id,
          unitId: unit.id,
          quantity: 10,
          sortIndex: 1,
          categoryKey: "pantry",
          deletedAt: new Date("2025-02-01T00:00:00.000Z"),
        },
      });

      const restored = parseJson(await callSpoonjoyMcpTool("add_shopping_list_item", {
        name: ingredientRef.name,
        quantity: 2,
        unit: unit.name,
        iconKey: "jar",
      }, context));

      expect(restored).toEqual({
        created: 1,
        updated: 0,
        shoppingList: {
          id: shoppingList.id,
          ownerId: owner.id,
          items: [{
            id: expect.any(String),
            quantity: 2,
            unit: unit.name,
            name: ingredientRef.name,
            checked: false,
            categoryKey: null,
            iconKey: "jar",
            sortIndex: 0,
          }],
        },
      });
      expect(restored.shoppingList.items[0].id).not.toBe(earliest.id);
      await expect(context.db.shoppingListItem.findUniqueOrThrow({ where: { id: earliest.id } }))
        .resolves.toMatchObject({ quantity: 10, deletedAt: expect.any(Date) });
    });
  });

  it("uses atomic SQL without invoking the Prisma create delegate", async () => {
    type ShoppingCreateArgs = Parameters<SpoonjoyMcpContext["db"]["shoppingListItem"]["create"]>[0];
    const racedId = `manual-race-${faker.string.alphanumeric(8).toLowerCase()}`;
    let injected = false;
    const racingDb = new Proxy(context.db, {
      get(target, property, receiver) {
        if (property !== "shoppingListItem") return Reflect.get(target, property, receiver);
        const delegate = Reflect.get(target, property, receiver);
        return new Proxy(delegate, {
          get(delegateTarget, delegateProperty, delegateReceiver) {
            if (delegateProperty !== "create") {
              return Reflect.get(delegateTarget, delegateProperty, delegateReceiver);
            }
            const create = Reflect.get(delegateTarget, delegateProperty, delegateReceiver) as (
              args: ShoppingCreateArgs,
            ) => Promise<unknown>;
            return async (args: ShoppingCreateArgs) => {
              if (!injected) {
                injected = true;
                await create.call(delegateTarget, {
                  ...args,
                  data: { ...args.data, id: racedId, quantity: 5 },
                });
              }
              return create.call(delegateTarget, args);
            };
          },
        });
      },
    }) as SpoonjoyMcpContext["db"];

    const added = parseJson(await callSpoonjoyMcpTool("add_shopping_list_item", {
      name: "Manual race milk",
      quantity: 2,
      unit: "Gallon",
      categoryKey: "dairy",
      iconKey: "milk",
    }, { ...context, db: racingDb }));

    expect(injected).toBe(false);
    expect(added).toEqual({
      created: 1,
      updated: 0,
      shoppingList: {
        id: expect.any(String),
        ownerId: expect.any(String),
        items: [{
          id: expect.any(String),
          quantity: 2,
          unit: "gallon",
          name: "manual race milk",
          checked: false,
          categoryKey: "dairy",
          iconKey: "milk",
          sortIndex: 0,
        }],
      },
    });
    await expect(context.db.shoppingListItem.count()).resolves.toBe(1);
  });

  it("exposes unified full-text search and private shopping-list search to Ouroboros agents", async () => {
    const recipe = parseJson(await callSpoonjoyMcpTool("create_recipe", {
      title: "Harness Tomato Toast",
      description: "Agent-searchable brunch",
      steps: [{ description: "Toast and top", ingredients: [{ name: "Tomato", quantity: 1, unit: "Each" }] }],
    }, context));
    const cookbook = parseJson(await callSpoonjoyMcpTool("create_cookbook", {
      title: "Harness Brunch Plans",
    }, context));
    await callSpoonjoyMcpTool("add_recipe_to_cookbook", {
      cookbookId: cookbook.cookbook.id,
      recipeId: recipe.recipe.id,
    }, context);
    const shopping = parseJson(await callSpoonjoyMcpTool("add_shopping_list_item", {
      name: "Harness Tomatoes",
      quantity: 2,
      unit: "Each",
      categoryKey: "produce",
      iconKey: "tomato",
    }, context));

    const unified = parseJson(await callSpoonjoyMcpTool("search_spoonjoy", {
      query: "Harness",
      scope: "all",
    }, context));
    expect(unified.scope).toBe("all");
    expect(unified.results.map((result: { id: string }) => result.id)).toEqual(
      expect.arrayContaining([recipe.recipe.id, cookbook.cookbook.id, shopping.shoppingList.items[0].id])
    );
    expect(unified.results.find((result: { id: string }) => result.id === shopping.shoppingList.items[0].id)).toMatchObject({
      type: "shopping-list-item",
      title: "harness tomatoes",
      metadata: { quantity: 2, unit: "each", checked: false },
    });

    const shoppingSearch = parseJson(await callSpoonjoyMcpTool("search_shopping_list", {
      query: "produce",
      limit: 1,
    }, context));
    expect(shoppingSearch).toMatchObject({
      query: "produce",
      items: [
        {
          id: shopping.shoppingList.items[0].id,
          type: "shopping-list-item",
          href: "/shopping-list",
        },
      ],
    });

    const aliasScope = parseJson(await callSpoonjoyMcpTool("search_spoonjoy", {
      query: "tomatoes",
      scope: "shopping",
    }, context));
    expect(aliasScope.scope).toBe("shopping-list");
    expect(aliasScope.results).toHaveLength(1);

    const noOwnerSearch = parseJson(await callSpoonjoyMcpTool("search_spoonjoy", {
      query: "Harness",
    }, { db: context.db }));
    expect(noOwnerSearch.results.some((result: { type: string }) => result.type === "shopping-list-item")).toBe(false);

    const recents = parseJson(await callSpoonjoyMcpTool("search_spoonjoy", {}, context));
    expect(recents).toMatchObject({ query: "", scope: "all" });
    expect(recents.results.length).toBeGreaterThan(0);

    const allShopping = parseJson(await callSpoonjoyMcpTool("search_shopping_list", {}, context));
    expect(allShopping.query).toBe("");
    expect(allShopping.items.length).toBeGreaterThan(0);
  });

  it("supports unitless direct shopping-list items", async () => {
    const result = parseJson(await callSpoonjoyMcpTool("add_shopping_list_item", {
      name: "Bananas",
    }, context));

    expect(result).toMatchObject({ created: 1, updated: 0 });
    expect(result.shoppingList.items[0]).toMatchObject({
      name: "bananas",
      quantity: null,
      unit: null,
    });

    const merged = parseJson(await callSpoonjoyMcpTool("add_shopping_list_item", {
      name: "Bananas",
      quantity: 6,
    }, context));
    expect(merged).toMatchObject({ created: 0, updated: 1 });
    expect(merged.shoppingList.items[0]).toMatchObject({
      name: "bananas",
      quantity: 6,
      unit: null,
    });
  });

  it("scopes direct shopping-list item mutations to the owner", async () => {
    const otherEmail = uniqueEmail("other-agent");
    const added = parseJson(await callSpoonjoyMcpTool("add_shopping_list_item", {
      name: "Apples",
      quantity: 3,
    }, context));
    const itemId = added.shoppingList.items[0].id;

    await expect(callSpoonjoyMcpTool("set_shopping_list_item_checked", {
      ownerEmail: otherEmail,
      itemId,
      checked: true,
    }, context)).rejects.toThrow("Shopping list item not found");
    await expect(callSpoonjoyMcpTool("remove_shopping_list_item", {
      ownerEmail: otherEmail,
      itemId,
    }, context)).rejects.toThrow("Shopping list item not found");

    const unchanged = parseJson(await callSpoonjoyMcpTool("get_shopping_list", {}, context));
    expect(unchanged.shoppingList.items[0]).toMatchObject({
      id: itemId,
      name: "apples",
      checked: false,
    });
  });

  it("normalizes search limits", async () => {
    await callSpoonjoyMcpTool("create_recipe", { title: "Limit One" }, context);
    await callSpoonjoyMcpTool("create_recipe", { title: "Limit Two" }, context);
    await callSpoonjoyMcpTool("create_recipe", { title: "Limit Three" }, context);

    expect(parseJson(await callSpoonjoyMcpTool("search_recipes", { limit: 0 }, context)).recipes).toHaveLength(1);
    expect(parseJson(await callSpoonjoyMcpTool("search_recipes", { limit: 2.7 }, context)).recipes).toHaveLength(2);
    expect(parseJson(await callSpoonjoyMcpTool("search_recipes", { limit: 999 }, context)).recipes.length).toBeGreaterThanOrEqual(3);
    expect(parseJson(await callSpoonjoyMcpTool("search_recipes", { limit: "bad" }, context)).recipes).toHaveLength(3);
    expect(parseJson(await callSpoonjoyMcpTool("search_recipes", { query: "absent-match" }, context)).recipes).toEqual([]);
  });

  it("validates write tool inputs", async () => {
    await callSpoonjoyMcpTool("create_recipe", { title: "Duplicate MCP Recipe" }, context);
    await expect(callSpoonjoyMcpTool("create_recipe", { title: "Duplicate MCP Recipe" }, context)).rejects.toThrow(ACTIVE_RECIPE_TITLE_CONFLICT_ERROR);
    await expect(callSpoonjoyMcpTool("create_recipe", {
      title: "Unknown Image Payload Recipe",
      imageBase64: b64(VALID_PNG_BYTES),
    }, context)).rejects.toThrow("create_recipe.imageBase64 is not allowed");
    await expect(context.db.recipe.count({ where: { title: "Unknown Image Payload Recipe" } })).resolves.toBe(0);
    await expect(callSpoonjoyMcpTool("create_recipe", { title: "No owner" }, { db: context.db })).rejects.toThrow("ownerEmail is required");
    await expect(callSpoonjoyMcpTool("create_recipe", { title: "Bad steps", steps: {} }, context)).rejects.toThrow("steps must be an array");
    await expect(callSpoonjoyMcpTool("create_recipe", { title: "Bad step", steps: [null] }, context)).rejects.toThrow("steps[0] must be an object");
    await expect(callSpoonjoyMcpTool("create_recipe", { title: "Bad ingredient", steps: [{ description: "x", ingredients: [null] }] }, context)).rejects.toThrow("steps.ingredients[0] must be an object");
    await expect(callSpoonjoyMcpTool("create_recipe", {
      title: "Bad Nested Shape",
      steps: [{ description: "x", unexpected: true }],
    }, context)).rejects.toThrow("create_recipe.steps[0].unexpected is not allowed");
    await expect(callSpoonjoyMcpTool("create_recipe", {
      title: "Bad Nested Owner Email",
      steps: [{ description: "x", ownerEmail: "nested@example.com" }],
    }, context)).rejects.toThrow("create_recipe.steps[0].ownerEmail is not allowed");
    await expect(callSpoonjoyMcpTool("create_recipe", { title: "Bad quantity", steps: [{ description: "x", ingredients: [{ name: "x", quantity: 0, unit: "cup" }] }] }, context)).rejects.toThrow("quantity must be a positive number");
    await expect(callSpoonjoyMcpTool("create_recipe", { title: "Bad unit", steps: [{ description: "x", ingredients: [{ name: "x", quantity: 1, unit: "" }] }] }, context)).rejects.toThrow("unit is required");
    await expect(callSpoonjoyMcpTool("update_recipe", { id: "recipe", title: "No owner" }, { db: context.db })).rejects.toThrow("ownerEmail is required");
    await expect(callSpoonjoyMcpTool("missing", {}, context)).rejects.toThrow("Unknown Spoonjoy operation");
    await expect(callSpoonjoyMcpTool("add_recipe_to_shopping_list", {}, context)).rejects.toThrow("recipeId is required");
    await expect(callSpoonjoyMcpTool("create_cookbook", { title: "No owner" }, { db: context.db })).rejects.toThrow("ownerEmail is required");
    await expect(callSpoonjoyMcpTool("create_cookbook", { title: "" }, context)).rejects.toThrow("title is required");
    await expect(callSpoonjoyMcpTool("get_cookbook", {}, context)).rejects.toThrow("cookbookId or title is required");
    await expect(callSpoonjoyMcpTool("list_cookbooks", { limit: 0 }, context)).resolves.toContain('"cookbooks"');
    await expect(callSpoonjoyMcpTool("add_recipe_to_cookbook", { cookbookId: "book" }, context)).rejects.toThrow("recipeId is required");
    await expect(callSpoonjoyMcpTool("add_recipe_to_cookbook", { recipeId: "recipe" }, context)).rejects.toThrow("cookbookId or title is required");
    await expect(callSpoonjoyMcpTool("add_recipe_to_cookbook", { cookbookId: "book", recipeId: "recipe" }, context)).rejects.toThrow("Cookbook not found");
    const cookbook = parseJson(await callSpoonjoyMcpTool("create_cookbook", { title: "Validation Cookbook" }, context));
    await expect(callSpoonjoyMcpTool("add_recipe_to_cookbook", { cookbookId: cookbook.cookbook.id, recipeId: "missing-recipe" }, context)).rejects.toThrow("Recipe not found");
    await expect(callSpoonjoyMcpTool("remove_recipe_from_cookbook", { cookbookId: "book" }, context)).rejects.toThrow("recipeId is required");
    await expect(callSpoonjoyMcpTool("remove_recipe_from_cookbook", { recipeId: "recipe" }, context)).rejects.toThrow("cookbookId or title is required");
    await expect(callSpoonjoyMcpTool("remove_recipe_from_cookbook", { cookbookId: "book", recipeId: "recipe" }, context)).rejects.toThrow("Cookbook not found");
    await expect(callSpoonjoyMcpTool("add_shopping_list_item", { name: "No owner" }, { db: context.db })).rejects.toThrow("ownerEmail is required");
    await expect(callSpoonjoyMcpTool("search_shopping_list", { query: "No owner" }, { db: context.db })).rejects.toThrow("ownerEmail is required");
    await expect(callSpoonjoyMcpTool("add_shopping_list_item", { name: "Bad quantity", quantity: 0 }, context)).rejects.toThrow("quantity must be a positive number");
    await expect(callSpoonjoyMcpTool("add_shopping_list_item", { quantity: 1 }, context)).rejects.toThrow("name is required");
    await expect(callSpoonjoyMcpTool("set_shopping_list_item_checked", { itemId: "item", checked: "yes" }, context)).rejects.toThrow("checked must be a boolean");
    await expect(callSpoonjoyMcpTool("set_shopping_list_item_checked", { checked: true }, context)).rejects.toThrow("itemId is required");
    await expect(callSpoonjoyMcpTool("remove_shopping_list_item", {}, context)).rejects.toThrow("itemId is required");
    await expect(callSpoonjoyMcpTool("create_api_token", { name: "No owner" }, { db: context.db })).rejects.toThrow("ownerEmail is required");
    await expect(callSpoonjoyMcpTool("revoke_api_token", {}, context)).rejects.toThrow("credentialId is required");
    await expect(callSpoonjoyMcpTool("revoke_api_token", { credentialId: "missing" }, context)).rejects.toThrow("API token not found");
  });
});
