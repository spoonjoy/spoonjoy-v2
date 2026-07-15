// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import { faker } from "@faker-js/faker";
import { action, loader, meta } from "~/routes/mcp";
import { createApiCredential } from "~/lib/api-auth.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";

function uniqueEmail(prefix = "mcproute") {
  return `${prefix}-${faker.string.alphanumeric(8).toLowerCase()}@example.com`;
}

function routeArgs(request: Request) {
  return { request, params: {}, context: { cloudflare: { env: null } } } as never;
}

function rpc(body: unknown, headers: Record<string, string> = {}) {
  return new UndiciRequest("https://spoonjoy.app/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  }) as unknown as Request;
}

describe("/mcp route", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });
  afterEach(async () => {
    await cleanupDatabase();
  });

  it("exposes human-facing metadata", () => {
    expect(meta({} as never)).toEqual(expect.arrayContaining([
      { title: "Spoonjoy MCP" },
      expect.objectContaining({
        name: "description",
        content: expect.stringContaining("agents"),
      }),
    ]));
  });

  it("returns landing-page data on GET via the loader", async () => {
    const request = new UndiciRequest("https://spoonjoy.app/mcp", { method: "GET" }) as unknown as Request;
    await expect(loader(routeArgs(request))).resolves.toEqual({
      endpoint: "https://spoonjoy.app/mcp",
      protectedResourceMetadataUrl: "https://spoonjoy.app/.well-known/oauth-protected-resource/mcp",
    });
  });

  it("challenges an unauthenticated request via the action", async () => {
    const response = await action(routeArgs(rpc({ jsonrpc: "2.0", id: 1, method: "initialize" })));
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("resource_metadata=");
  });

  it("handles initialize + tools/list + a tools/call end to end when authenticated", async () => {
    const user = await db.user.create({ data: { email: uniqueEmail(), username: faker.internet.username() } });
    const { token } = await createApiCredential(db, user.id, "route token");
    const auth = { Authorization: `Bearer ${token}` };

    const initResponse = await action(routeArgs(rpc({ jsonrpc: "2.0", id: 1, method: "initialize" }, auth)));
    expect(initResponse.status).toBe(200);
    await expect(initResponse.json()).resolves.toMatchObject({ result: { serverInfo: { name: "spoonjoy" } } });

    const listResponse = await action(routeArgs(rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, auth)));
    const listBody = await listResponse.json() as {
      result: {
        tools: Array<{
          name: string;
          description?: string;
          inputSchema?: { properties?: Record<string, unknown>; required?: string[] };
        }>;
      };
    };
    expect(listBody.result.tools.map((t) => t.name)).toContain("get_shopping_list");
    expect(listBody.result.tools.map((t) => t.name)).toEqual(expect.arrayContaining([
      "upload_recipe_image",
      "upload_spoon_photo",
      "create_recipe_cover_from_upload",
      "generate_recipe_cover_placeholder",
      "regenerate_recipe_cover",
      "set_recipe_no_cover",
    ]));
    const byName = new Map(listBody.result.tools.map((tool) => [tool.name, tool]));
    expect(byName.get("generate_recipe_cover_placeholder")).toMatchObject({
      description: expect.stringContaining("AI placeholder"),
      inputSchema: {
        required: ["recipeId", "idempotencyKey"],
        properties: {
          promptAddition: expect.objectContaining({ maxLength: 240 }),
          activateWhenReady: expect.any(Object),
        },
      },
    });
    expect(byName.get("regenerate_recipe_cover")).toMatchObject({
      inputSchema: {
        required: ["recipeId", "coverId", "idempotencyKey"],
        properties: {
          promptAddition: expect.objectContaining({ maxLength: 240 }),
        },
      },
    });

    const callResponse = await action(routeArgs(rpc(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_shopping_list", arguments: {} } },
      auth,
    )));
    expect(callResponse.status).toBe(200);
    const callBody = await callResponse.json() as { result: { content: { text: string }[] } };
    expect(JSON.parse(callBody.result.content[0].text)).toHaveProperty("shoppingList");
  });

  it("round-trips generated placeholder cover results through tools/call", async () => {
    const user = await db.user.create({ data: { email: uniqueEmail("placeholder-route"), username: faker.internet.username() } });
    const recipe = await db.recipe.create({
      data: {
        title: `MCP Route Placeholder ${faker.string.alphanumeric(6)}`,
        description: "Route-level placeholder test",
        chefId: user.id,
      },
    });
    const { token } = await createApiCredential(db, user.id, "route cover token", { scopes: ["recipes:read", "kitchen:write"] });

    const response = await action(routeArgs(rpc(
      {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "generate_recipe_cover_placeholder",
          arguments: {
            recipeId: recipe.id,
            promptAddition: "brighter greens",
            activateWhenReady: true,
            idempotencyKey: "route-placeholder-cover",
          },
        },
      },
      { Authorization: `Bearer ${token}` },
    )));
    expect(response.status).toBe(200);
    const body = await response.json() as { result: { content: { text: string }[] } };
    expect(body).toMatchObject({ result: { content: [{ text: expect.any(String) }] } });
    expect(JSON.parse(body.result.content[0].text)).toMatchObject({
      createdCover: {
        recipeId: recipe.id,
        sourceType: "ai-placeholder",
        generationStatus: "failed",
        failureReason: expect.stringContaining("missing_image_provider_config"),
      },
      generationStatus: "failed",
      mutation: { idempotencyKey: "route-placeholder-cover", replayed: false },
    });
  });

  it("round-trips explicit no-cover results through tools/call", async () => {
    const user = await db.user.create({ data: { email: uniqueEmail("no-cover-route"), username: faker.internet.username() } });
    const recipe = await db.recipe.create({
      data: {
        title: `MCP Route No Cover ${faker.string.alphanumeric(6)}`,
        chefId: user.id,
      },
    });
    const cover = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/current.jpg",
        stylizedImageUrl: "/photos/current-editorial.jpg",
        sourceType: "chef-upload",
        status: "ready",
        generationStatus: "succeeded",
        createdById: user.id,
      },
    });
    await db.recipe.update({
      where: { id: recipe.id },
      data: { activeCoverId: cover.id, activeCoverVariant: "stylized", coverMode: "manual" },
    });
    const { token } = await createApiCredential(db, user.id, "route no-cover token", { scopes: ["recipes:read", "kitchen:write"] });

    const response = await action(routeArgs(rpc(
      {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: {
          name: "set_recipe_no_cover",
          arguments: {
            recipeId: recipe.id,
            confirmNoCover: true,
            idempotencyKey: "route-set-no-cover",
          },
        },
      },
      { Authorization: `Bearer ${token}` },
    )));
    expect(response.status).toBe(200);
    const body = await response.json() as { result: { content: { text: string }[] } };
    expect(body).toMatchObject({ result: { content: [{ text: expect.any(String) }] } });
    expect(JSON.parse(body.result.content[0].text)).toMatchObject({
      activeCover: null,
      previousActiveCover: { id: cover.id, activeVariant: "stylized" },
      mutation: { idempotencyKey: "route-set-no-cover", replayed: false },
    });
  });

  it("accepts OAuth tokens bound to /mcp and rejects tokens bound elsewhere", async () => {
    const user = await db.user.create({ data: { email: uniqueEmail(), username: faker.internet.username() } });
    const matching = await createApiCredential(db, user.id, "MCP OAuth token", {
      scopes: ["kitchen:read", "kitchen:write"],
      oauthClientId: "oauth_client_mcp_match",
      oauthResource: "https://spoonjoy.app/mcp",
    });
    const mismatched = await createApiCredential(db, user.id, "Other OAuth token", {
      scopes: ["kitchen:read", "kitchen:write"],
      oauthClientId: "oauth_client_mcp_mismatch",
      oauthResource: "https://elsewhere.example/mcp",
    });

    const matchingResponse = await action(routeArgs(rpc(
      { jsonrpc: "2.0", id: 4, method: "tools/list" },
      { Authorization: `Bearer ${matching.token}` },
    )));
    expect(matchingResponse.status).toBe(200);
    await expect(matchingResponse.json()).resolves.toMatchObject({ result: { tools: expect.any(Array) } });

    const mismatchedResponse = await action(routeArgs(rpc(
      { jsonrpc: "2.0", id: 5, method: "tools/list" },
      { Authorization: `Bearer ${mismatched.token}` },
    )));
    expect(mismatchedResponse.status).toBe(403);
    await expect(mismatchedResponse.json()).resolves.toEqual({
      error: "invalid_token",
      message: "OAuth access token is not audience-bound to this MCP resource.",
    });
  });
});
