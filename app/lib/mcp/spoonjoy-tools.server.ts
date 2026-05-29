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

export function listSpoonjoyMcpTools(): SpoonjoyMcpToolInfo[] {
  return listSpoonjoyApiOperations();
}

export async function callSpoonjoyMcpTool(
  name: string,
  args: Record<string, unknown>,
  context: SpoonjoyMcpContext
): Promise<string> {
  const result = await callSpoonjoyApiOperation(name, args, context);
  return JSON.stringify(result, null, 2);
}
