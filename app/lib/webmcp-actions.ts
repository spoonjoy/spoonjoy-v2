import webmcp from "../../actions/generated/webmcp.json";

// WebMCP lets an agent in the person's browser call a page's tools as that person. The tools are the
// declared ones in actions/generated/webmcp.json, so their names, descriptions and schemas never
// drift from MCP's or the App Intent's. A person-only action is never registered here.

type WebMcpTool = (typeof webmcp.tools)[number];

export type WebMcpToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

type RegisteredTool = WebMcpTool & { execute: (input: Record<string, unknown>) => Promise<WebMcpToolResult> };

export type ModelContextLike = {
  registerTool: (tool: RegisteredTool) => unknown;
  unregisterTool?: (name: string) => unknown;
};

/** The browser's WebMCP entry point, or null where the browser has none. */
export function browserModelContext(nav: unknown): ModelContextLike | null {
  const context = (nav as { modelContext?: Partial<ModelContextLike> } | undefined)?.modelContext;
  return typeof context?.registerTool === "function" ? (context as ModelContextLike) : null;
}

export function declaredWebMcpTool(name: string): WebMcpTool {
  const tool = webmcp.tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`No declared WebMCP tool named ${name}`);
  return tool;
}

type AddDeps = {
  fetch: typeof fetch;
  newMutationId: () => string;
  /** Runs after an add lands, so the page shows the new item. */
  onAdded: () => void;
};

async function addShoppingListItem(input: Record<string, unknown>, deps: AddDeps): Promise<WebMcpToolResult> {
  const body: Record<string, unknown> = {
    clientMutationId: typeof input.idempotencyKey === "string" ? input.idempotencyKey : deps.newMutationId(),
    name: input.name,
  };
  for (const key of ["quantity", "unit", "categoryKey", "iconKey"] as const) {
    if (input[key] !== undefined) body[key] = input[key];
  }
  // ownerEmail is for a local MCP server with nobody signed in; here the signed-in person always acts on their own list.
  const response = await deps.fetch("/api/v1/shopping-list/items", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) return { content: [{ type: "text", text }], isError: true };
  deps.onAdded();
  return { content: [{ type: "text", text }] };
}

/**
 * Registers the shopping list's declared tools with WebMCP, and returns a function that removes them.
 * Does nothing where the browser has no WebMCP.
 */
export function registerShoppingListWebMcpTools(context: ModelContextLike | null, deps: AddDeps): () => void {
  if (!context) return () => {};
  const tool = declaredWebMcpTool("add_shopping_list_item");
  const registration = context.registerTool({ ...tool, execute: (input) => addShoppingListItem(input, deps) });
  return () => {
    const unregister = (registration as { unregister?: () => void } | undefined)?.unregister;
    if (typeof unregister === "function") unregister.call(registration);
    else context.unregisterTool?.(tool.name);
  };
}
