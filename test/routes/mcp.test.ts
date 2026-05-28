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

  it("handles initialize + tools/list + an authed tools/call end to end", async () => {
    const user = await db.user.create({ data: { email: uniqueEmail(), username: faker.internet.username() } });
    const { token } = await createApiCredential(db, user.id, "route token");

    const initResponse = await action(routeArgs(rpc({ jsonrpc: "2.0", id: 1, method: "initialize" })));
    expect(initResponse.status).toBe(200);
    await expect(initResponse.json()).resolves.toMatchObject({ result: { serverInfo: { name: "spoonjoy" } } });

    const listResponse = await action(routeArgs(rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" })));
    const listBody = await listResponse.json() as { result: { tools: { name: string }[] } };
    expect(listBody.result.tools.map((t) => t.name)).toContain("get_shopping_list");

    const callResponse = await action(routeArgs(rpc(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_shopping_list", arguments: {} } },
      { Authorization: `Bearer ${token}` },
    )));
    expect(callResponse.status).toBe(200);
    const callBody = await callResponse.json() as { result: { content: { text: string }[] } };
    expect(JSON.parse(callBody.result.content[0].text)).toHaveProperty("shoppingList");
  });
});
