// @vitest-environment node
import {
  Client,
  StreamableHTTPClientTransport,
  type VersionNegotiationMode,
} from "@modelcontextprotocol/client";
import { faker } from "@faker-js/faker";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiCredential } from "~/lib/api-auth.server";
import { getLocalDb } from "~/lib/db.server";
import { action, loader } from "~/routes/mcp";
import { cleanupDatabase } from "../helpers/cleanup";

const MCP_URL = new URL("https://spoonjoy.app/mcp");

function routeArgs(request: Request) {
  return { request, params: {}, context: { cloudflare: { env: null } } } as never;
}

function routeFetch(): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const result = request.method === "GET"
      ? await loader(routeArgs(request))
      : await action(routeArgs(request));
    if (!(result instanceof Response)) {
      throw new Error("The MCP protocol route returned landing data.");
    }
    return result;
  };
}

function sdkClient(
  token: string,
  mode: VersionNegotiationMode,
  supportedProtocolVersions: string[],
) {
  const client = new Client(
    { name: "spoonjoy-sdk-conformance", version: "1.0.0" },
    { versionNegotiation: { mode }, supportedProtocolVersions },
  );
  const transport = new StreamableHTTPClientTransport(MCP_URL, {
    fetch: routeFetch(),
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  return { client, transport };
}

describe("official TypeScript MCP SDK against /mcp", () => {
  let token: string;

  beforeEach(async () => {
    await cleanupDatabase();
    const db = await getLocalDb();
    const user = await db.user.create({
      data: {
        email: `mcp-sdk-${faker.string.alphanumeric(8).toLowerCase()}@example.com`,
        username: faker.internet.username(),
      },
    });
    token = (await createApiCredential(db, user.id, "MCP SDK conformance")).token;
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("negotiates exact legacy 2025-06-18 and exercises tools through the SDK", async () => {
    const { client, transport } = sdkClient(token, "legacy", ["2025-06-18"]);
    try {
      await client.connect(transport);

      expect(client.getProtocolEra()).toBe("legacy");
      expect(client.getNegotiatedProtocolVersion()).toBe("2025-06-18");
      expect((await client.listTools()).tools.map((tool) => tool.name)).toContain("get_shopping_list");
      const result = await client.callTool({
        name: "get_shopping_list",
        arguments: {},
      });
      expect(result).toMatchObject({ content: [{ type: "text", text: expect.any(String) }] });
      const content = result.content[0];
      if (content?.type !== "text") throw new Error("Expected a text tool result.");
      expect(JSON.parse(content.text)).toHaveProperty("shoppingList");
    } finally {
      await client.close();
    }
  });

  it("pins modern 2026-07-28 and exercises tools through the SDK", async () => {
    const { client, transport } = sdkClient(token, { pin: "2026-07-28" }, ["2026-07-28"]);
    try {
      await client.connect(transport);

      expect(client.getProtocolEra()).toBe("modern");
      expect(client.getNegotiatedProtocolVersion()).toBe("2026-07-28");
      expect(client.getDiscoverResult()?.supportedVersions).toEqual(["2026-07-28"]);
      expect((await client.listTools()).tools.map((tool) => tool.name)).toContain("get_shopping_list");
      const result = await client.callTool({
        name: "get_shopping_list",
        arguments: {},
      });
      expect(result).toMatchObject({ content: [{ type: "text", text: expect.any(String) }] });
      const content = result.content[0];
      if (content?.type !== "text") throw new Error("Expected a text tool result.");
      expect(JSON.parse(content.text)).toHaveProperty("shoppingList");
    } finally {
      await client.close();
    }
  });
});
