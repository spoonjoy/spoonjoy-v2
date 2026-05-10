import {
  callSpoonjoyApiOperation,
  listSpoonjoyApiOperations,
  type SpoonjoyApiContext,
} from "~/lib/spoonjoy-api.server";

export type SpoonjoyMcpContext = SpoonjoyApiContext;

export interface SpoonjoyMcpToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

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
