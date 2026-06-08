// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import { faker } from "@faker-js/faker";
import { action, loader } from "~/routes/mcp";
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

  it("405s on GET via the loader", async () => {
    const request = new UndiciRequest("https://spoonjoy.app/mcp", { method: "GET" }) as unknown as Request;
    const response = await loader(routeArgs(request));
    expect(response.status).toBe(405);
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
    const listBody = await listResponse.json() as { result: { tools: { name: string }[] } };
    expect(listBody.result.tools.map((t) => t.name)).toContain("get_shopping_list");
    expect(listBody.result.tools.map((t) => t.name)).toEqual(expect.arrayContaining([
      "upload_recipe_image",
      "upload_spoon_photo",
    ]));

    const callResponse = await action(routeArgs(rpc(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_shopping_list", arguments: {} } },
      auth,
    )));
    expect(callResponse.status).toBe(200);
    const callBody = await callResponse.json() as { result: { content: { text: string }[] } };
    expect(JSON.parse(callBody.result.content[0].text)).toHaveProperty("shoppingList");
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
