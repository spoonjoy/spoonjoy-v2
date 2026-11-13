// The MCP side of Spoonjoy's declared actions (actions/spoonjoy.actions.mts), read from what Ouro UI's action model
// generates: each declared tool's name, title, description, input schema and annotations, and the typed refusal a
// person-only action answers with. Serving these, rather than a second hand-written copy, is what keeps the MCP door
// equal to its declaration; test/lib/mcp/declared-actions.server.test.ts compares the live tools/list with it.
import generated from "../../../actions/generated/mcp.json";

export interface DeclaredMcpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; openWorldHint: boolean };
}

/** The refused outcome a person-only action answers on every agent door: web's AX outcome, state "refused". */
export interface PersonOnlyRefusal {
  state: "refused";
  summary: string;
  error: { code: "person-only"; exit: number; message: string };
  [key: string]: unknown;
}

const declaredTools = new Map<string, DeclaredMcpTool>(
  (generated.tools as DeclaredMcpTool[]).map((tool) => [tool.name, tool]),
);
const refusals = new Map<string, PersonOnlyRefusal>(
  Object.entries(generated.refusals as Record<string, PersonOnlyRefusal>),
);

/** A declared tool, by name. Throws on a name the declarations lack, so a typo can't ship a tool with no declaration. */
export function declaredMcpTool(name: string): DeclaredMcpTool {
  const tool = declaredTools.get(name);
  if (!tool) throw new Error(`No declared action named ${name}: declare it in actions/spoonjoy.actions.mts and run pnpm actions:generate.`);
  return tool;
}

/**
 * The MCP result for a call to a person-only action: a tool error whose text is the refusal's message and whose
 * structured content is the whole refused outcome, so an agent can tell the person how to do it. Null for any other
 * name.
 */
export function personOnlyMcpResult(name: string) {
  const refusal = refusals.get(name);
  if (!refusal) return null;
  return {
    content: [{ type: "text", text: refusal.error.message }],
    structuredContent: refusal,
    isError: true,
  };
}
