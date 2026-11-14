import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkGenerated, compareMcp, renderActions } from "../../../tools/ouro-actions/ouro-actions.mts";
import spoonjoyActions from "../../../actions/spoonjoy.actions.mts";
import undeclared from "../../../actions/undeclared-mcp-tools.json";
import inputsBefore from "../../fixtures/mcp/tool-inputs-before-declarations.json";
import { declaredMcpTool, personOnlyMcpResult } from "~/lib/mcp/declared-actions.server";
import { listSpoonjoyMcpTools, refuseSpoonjoyMcpTool } from "~/lib/mcp/spoonjoy-tools.server";

// Vitest runs from the repository root.
const root = process.cwd();
/**
 * A JSON Schema with what doesn't change the inputs it accepts taken out: descriptions, and equivalent spellings
 * (anyOf [T, null] is type [T, null]; const: true is a boolean; a oneOf's option order; the order of required).
 */
type Schema = unknown;
function accepted(s: Schema): Schema {
  if (Array.isArray(s)) return s.map(accepted);
  if (typeof s !== "object" || s === null) return s;
  const out: Record<string, Schema> = Object.fromEntries(Object.entries(s).filter(([k]) => k !== "description").map(([k, v]) => [k, accepted(v)]));
  for (const key of ["anyOf", "oneOf"]) {
    if (!(key in out)) continue;
    const options = out[key] as Record<string, Schema>[];
    delete out[key];
    const types = options.map((o) => o.type);
    if (options.length === 2 && options.every((o) => Object.keys(o).length === 1) && types.includes("null")) out.type = types.filter((t) => t !== "null").concat("null");
    else out.oneOf = [...options].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (Array.isArray(out.type)) out.type = [...(out.type as string[])].sort();
  if (out.const === true && !("type" in out)) out.type = "boolean";
  if (Array.isArray(out.required)) out.required = [...(out.required as string[])].sort();
  if (Array.isArray(out.required) && out.required.length === 0) delete out.required;
  return out;
}
const canonical = (s: Schema): string => JSON.stringify(s, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));

const sha256 = async (path: string) => createHash("sha256").update(await readFile(join(root, path))).digest("hex");

describe("Spoonjoy's declared actions (Ouro UI's one action model)", () => {
  it("vendors the generator and its claims from ouro-ui-core v0.10.0, byte for byte", async () => {
    // The release's dist-manifest.json: https://github.com/ourostack/ouro-ui-core/releases/tag/v0.10.0
    expect(await sha256("tools/ouro-actions/ouro-actions.mts")).toBe("e343d27993276dbd4bbd9a5351f1c3935eebd8db19039d37671a774d8dbefa84");
    expect(await sha256("tools/ouro-actions/actions.claims.json")).toBe("944f48be5f9409dd70e0774dfe4976fef9cc3ba3f4ab4b9231df428700523f1a");
  });

  it("commits exactly what the declarations generate", async () => {
    const dir = join(root, "actions/generated");
    const found = new Map<string, string>();
    for (const name of (await readdir(dir)).sort()) found.set(name, await readFile(join(dir, name), "utf8"));
    expect(checkGenerated(spoonjoyActions, found)).toEqual([]);
  });

  it("keeps every MCP tool's accepted input as it was before the tool was declared", () => {
    const served = Object.fromEntries(listSpoonjoyMcpTools().map((tool) => [tool.name, canonical(accepted(tool.inputSchema))]));
    const before = Object.fromEntries(Object.entries(inputsBefore.tools).map(([name, schema]) => [name, canonical(accepted(schema))]));
    expect(served).toEqual(before);
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
