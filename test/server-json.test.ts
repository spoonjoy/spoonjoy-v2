import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../server.json"), "utf8"),
) as {
  $schema: string;
  name: string;
  title: string;
  description: string;
  version: string;
  remotes: { type: string; url: string }[];
};

describe("server.json (MCP registry entry)", () => {
  it("publishes under the DNS-verified app.spoonjoy namespace", () => {
    // app.spoonjoy is the reverse-DNS of spoonjoy.app; publishing under it
    // requires the apex TXT record (see docs/mcp-registry-publishing.md).
    expect(serverJson.name.startsWith("app.spoonjoy/")).toBe(true);
    expect(serverJson.title).toBe("Spoonjoy");
    expect(serverJson.description.length).toBeGreaterThan(0);
  });

  it("points at the live remote Streamable-HTTP endpoint", () => {
    expect(serverJson.remotes).toHaveLength(1);
    expect(serverJson.remotes[0]).toEqual({
      type: "streamable-http",
      url: "https://spoonjoy.app/mcp",
    });
  });

  it("declares a schema and a semver version", () => {
    expect(serverJson.$schema).toMatch(/^https:\/\/static\.modelcontextprotocol\.io\/schemas\/.+server\.schema\.json$/);
    expect(serverJson.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
