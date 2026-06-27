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
// over the MCP connector.
// - `import_recipe_from_url` server-fetches arbitrary URLs (annotated
//   `openWorldHint: true`) — the connector's only outbound web access. The
//   agent-driven flow (assistant reads the page, calls `create_recipe`) replaces
//   it for MCP clients, so it stays REST-only and the MCP surface has no web access.
// - `regenerate_recipe_cover` and `create_recipe_cover_from_spoon` produce
//   AI-generated "editorial" cover images. The Anthropic Connectors Directory lists
//   AI-generated images as an unsupported category, so these stay REST-only (the web
//   app still uses them) and are kept off the MCP surface. The plain upload tool
//   `create_recipe_cover_from_upload` (a user image, no AI) remains available.
const MCP_EXCLUDED_TOOLS = new Set([
  "import_recipe_from_url",
  "regenerate_recipe_cover",
  "create_recipe_cover_from_spoon",
]);

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
