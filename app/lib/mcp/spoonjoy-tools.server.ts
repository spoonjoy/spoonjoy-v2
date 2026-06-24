import {
  callSpoonjoyApiOperation,
  listSpoonjoyApiOperations,
  type SpoonjoyApiContext,
  type SpoonjoyMcpToolDescriptor,
} from "~/lib/spoonjoy-api.server";

export type SpoonjoyMcpContext = SpoonjoyApiContext;

// Tool metadata surfaced through MCP `tools/list`, including the `title` and
// behavioral annotations connector directories require. Mirrors the operation
// layer so the two never drift.
export type SpoonjoyMcpToolInfo = SpoonjoyMcpToolDescriptor;

// Operations that exist in the REST/API layer but are deliberately NOT exposed
// over the MCP connector. `import_recipe_from_url` server-fetches arbitrary URLs
// (annotated `openWorldHint: true`) — it is the connector's only outbound web
// access. The agent-driven flow (assistant reads the page, calls `create_recipe`)
// is the supported import path for MCP clients, so this tool stays in REST (the
// web app uses it) but is filtered out of the MCP surface. Excluding it here means
// the MCP connector no longer has any web access.
const MCP_EXCLUDED_TOOLS = new Set(["import_recipe_from_url"]);

export function listSpoonjoyMcpTools(): SpoonjoyMcpToolInfo[] {
  return listSpoonjoyApiOperations().filter((tool) => !MCP_EXCLUDED_TOOLS.has(tool.name));
}

export async function callSpoonjoyMcpTool(
  name: string,
  args: Record<string, unknown>,
  context: SpoonjoyMcpContext
): Promise<string> {
  // Reject excluded operations with the same shape `callSpoonjoyApiOperation`
  // uses for an unknown op, so an MCP client cannot reach a REST-only tool by
  // name even though the operation still exists in the API registry.
  if (MCP_EXCLUDED_TOOLS.has(name)) {
    throw new Error(`Unknown Spoonjoy operation: ${name}`);
  }
  const result = await callSpoonjoyApiOperation(name, args, context);
  return JSON.stringify(result, null, 2);
}
