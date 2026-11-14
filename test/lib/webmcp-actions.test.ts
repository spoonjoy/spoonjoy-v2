import { describe, expect, it, vi } from "vitest";
import webmcp from "../../actions/generated/webmcp.json";
import {
  browserModelContext,
  declaredWebMcpTool,
  registerShoppingListWebMcpTools,
  type ModelContextLike,
} from "~/lib/webmcp-actions";

type Registered = Parameters<ModelContextLike["registerTool"]>[0];

function fakeContext(registration?: unknown) {
  const tools: Registered[] = [];
  const context = {
    registerTool: vi.fn((tool: Registered) => {
      tools.push(tool);
      return registration;
    }),
    unregisterTool: vi.fn(),
  };
  return { context, tools };
}

function deps(response: Response) {
  return {
    fetch: vi.fn(async () => response) as unknown as typeof fetch & ReturnType<typeof vi.fn>,
    newMutationId: () => "mutation-1",
    onAdded: vi.fn(),
  };
}

describe("WebMCP tools from Spoonjoy's declared actions", () => {
  it("finds the browser's WebMCP only where it can register tools", () => {
    const context = { registerTool: () => undefined };
    expect(browserModelContext({ modelContext: context })).toBe(context);
    expect(browserModelContext({ modelContext: {} })).toBeNull();
    expect(browserModelContext({})).toBeNull();
    expect(browserModelContext(undefined)).toBeNull();
  });

  it("registers add_shopping_list_item exactly as declared, and never a person-only action", () => {
    const { context, tools } = fakeContext();
    registerShoppingListWebMcpTools(context, deps(new Response("{}")));
    expect(tools.map(({ execute, ...tool }) => tool)).toEqual([declaredWebMcpTool("add_shopping_list_item")]);
    expect(Object.keys(webmcp.refusals)).toContain("approve_agent_connection");
    expect(tools.map((tool) => tool.name)).not.toContain("approve_agent_connection");
  });

  it("adds through the signed-in person's API, then refreshes the page", async () => {
    const { context, tools } = fakeContext();
    const d = deps(new Response('{"item":{"name":"oat milk"}}', { status: 201 }));
    registerShoppingListWebMcpTools(context, d);

    const result = await tools[0].execute({ name: "oat milk", quantity: 2, unit: "cartons", ownerEmail: "someone@example.com" });

    expect(result).toEqual({ content: [{ type: "text", text: '{"item":{"name":"oat milk"}}' }] });
    expect(d.fetch).toHaveBeenCalledWith("/api/v1/shopping-list/items", expect.objectContaining({ method: "POST", credentials: "same-origin" }));
    const body = JSON.parse((d.fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toEqual({ clientMutationId: "mutation-1", name: "oat milk", quantity: 2, unit: "cartons" });
    expect(d.onAdded).toHaveBeenCalledOnce();
  });

  it("sends an agent's idempotency key as the mutation id, and its aisle and icon keys", async () => {
    const { context, tools } = fakeContext();
    const d = deps(new Response("{}", { status: 201 }));
    registerShoppingListWebMcpTools(context, d);

    await tools[0].execute({ name: "flour", categoryKey: "pantry", iconKey: "wheat", idempotencyKey: "retry-7" });

    const body = JSON.parse((d.fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toEqual({ clientMutationId: "retry-7", name: "flour", categoryKey: "pantry", iconKey: "wheat" });
  });

  it("answers a failed add with the API's error as a tool error, and leaves the page alone", async () => {
    const { context, tools } = fakeContext();
    const d = deps(new Response('{"error":{"code":"validation_failed"}}', { status: 400 }));
    registerShoppingListWebMcpTools(context, d);

    const result = await tools[0].execute({ name: "" });

    expect(result).toEqual({ content: [{ type: "text", text: '{"error":{"code":"validation_failed"}}' }], isError: true });
    expect(d.onAdded).not.toHaveBeenCalled();
  });

  it("removes its tool with the registration's unregister, or by name where there is none", () => {
    const registration = { unregister: vi.fn() };
    const withHandle = fakeContext(registration);
    registerShoppingListWebMcpTools(withHandle.context, deps(new Response("{}")))();
    expect(registration.unregister).toHaveBeenCalledOnce();
    expect(withHandle.context.unregisterTool).not.toHaveBeenCalled();

    const byName = fakeContext();
    registerShoppingListWebMcpTools(byName.context, deps(new Response("{}")))();
    expect(byName.context.unregisterTool).toHaveBeenCalledWith("add_shopping_list_item");

    const neither = { registerTool: vi.fn() };
    expect(() => registerShoppingListWebMcpTools(neither, deps(new Response("{}")))()).not.toThrow();
  });

  it("does nothing where the browser has no WebMCP", () => {
    expect(() => registerShoppingListWebMcpTools(null, deps(new Response("{}")))()).not.toThrow();
  });

  it("refuses to register a tool nobody declared", () => {
    expect(() => declaredWebMcpTool("place_grocery_order")).toThrow("No declared WebMCP tool named place_grocery_order");
  });
});
