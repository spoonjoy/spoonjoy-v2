import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkGenerated, compareMcp, renderActions } from "../../../tools/ouro-actions/ouro-actions.mts";
import spoonjoyActions from "../../../actions/spoonjoy.actions.mts";
import undeclared from "../../../actions/undeclared-mcp-tools.json";
import { declaredMcpTool, personOnlyMcpResult } from "~/lib/mcp/declared-actions.server";
import { listSpoonjoyMcpTools, refuseSpoonjoyMcpTool } from "~/lib/mcp/spoonjoy-tools.server";

// Vitest runs from the repository root.
const root = process.cwd();
const sha256 = async (path: string) => createHash("sha256").update(await readFile(join(root, path))).digest("hex");

describe("Spoonjoy's declared actions (Ouro UI's one action model)", () => {
  it("vendors the generator and its claims from ouro-ui-core v0.6.0, byte for byte", async () => {
    // The release's dist-manifest.json: https://github.com/ourostack/ouro-ui-core/releases/tag/v0.6.0
    expect(await sha256("tools/ouro-actions/ouro-actions.mts")).toBe("128a284d575a27f47d4e0ccfbe6c241eeaf2c0b0a4f09000564a2e8f8f9bc827");
    expect(await sha256("tools/ouro-actions/actions.claims.json")).toBe("944f48be5f9409dd70e0774dfe4976fef9cc3ba3f4ab4b9231df428700523f1a");
  });

  it("commits exactly what the declarations generate", async () => {
    const dir = join(root, "actions/generated");
    const found = new Map<string, string>();
    for (const name of (await readdir(dir)).sort()) found.set(name, await readFile(join(dir, name), "utf8"));
    expect(checkGenerated(spoonjoyActions, found)).toEqual([]);
  });

  it("serves the declared MCP tools exactly, and every other tool is on the undeclared list, which only shrinks", () => {
    expect(compareMcp(spoonjoyActions, { tools: listSpoonjoyMcpTools() }, { undeclared })).toEqual([]);
    const tool = listSpoonjoyMcpTools().find((candidate) => candidate.name === "add_shopping_list_item");
    expect(tool).toMatchObject({ title: "Add to list", requiredScopes: ["shopping_list:write"] });
    expect(tool?.annotations).toEqual({ title: "Add to list", readOnlyHint: false, destructiveHint: false, openWorldHint: false });
    // A tool that drifted from its declaration fails the comparison.
    const drifted = listSpoonjoyMcpTools().map((candidate) => candidate.name === "add_shopping_list_item" ? { ...candidate, description: "Adds an item." } : candidate);
    expect(compareMcp(spoonjoyActions, { tools: drifted }, { undeclared })[0]).toMatch(/^add_shopping_list_item: description drifted/);
  });

  it("lists no person-only action, and refuses a call to one with the declared refusal", () => {
    expect(listSpoonjoyMcpTools().some((tool) => tool.name === "approve_agent_connection")).toBe(false);
    const refused = refuseSpoonjoyMcpTool("approve_agent_connection");
    const mcp = JSON.parse(renderActions(spoonjoyActions).get("mcp.json")!) as { refusals: Record<string, unknown> };
    expect(refused).toEqual({
      content: [{ type: "text", text: (mcp.refusals.approve_agent_connection as { error: { message: string } }).error.message }],
      structuredContent: mcp.refusals.approve_agent_connection,
      isError: true,
    });
    expect(personOnlyMcpResult("add_shopping_list_item")).toBeNull();
  });

  it("refuses to serve a tool with no declaration", () => {
    expect(() => declaredMcpTool("add_shopping_item")).toThrow("No declared action named add_shopping_item: declare it in actions/spoonjoy.actions.mts and run pnpm actions:generate.");
  });
});
