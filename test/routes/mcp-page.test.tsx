import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import McpPage, { loader } from "~/routes/mcp";
import { createTestRoutesStub } from "../utils";

function routeArgs(url = "https://spoonjoy.app/mcp") {
  return { request: new Request(url), params: {}, context: { cloudflare: { env: null } } } as never;
}

describe("/mcp landing page", () => {
  it("renders human-facing setup guidance without treating browser GET as the protocol call", async () => {
    const data = await loader(routeArgs());
    const Stub = createTestRoutesStub([
      { path: "/mcp", Component: McpPage, loader: () => data },
    ]);

    render(createElement(Stub, { initialEntries: ["/mcp"] }));

    await screen.findByRole("heading", { name: "Spoonjoy MCP" });
    const pageText = document.body.textContent ?? "";

    expect(pageText).toContain("TL;DR");
    expect(pageText).toContain("Authorize Spoonjoy once");
    expect(pageText).toContain("https://spoonjoy.app/mcp");
    expect(pageText).toContain("POST");
    expect(pageText).toContain("JSON-RPC");
    expect(pageText).toContain("Authorization: Bearer");
    expect(pageText).toContain("claude mcp add");
    expect(pageText).toContain("recipes");
    expect(pageText).toContain("cookbooks");
    expect(pageText).toContain("shopping list");
    expect(pageText).toContain("no SSE");
    expect(pageText).toContain("no batching");
    expect(screen.getByRole("link", { name: /protected-resource metadata/i })).toHaveAttribute(
      "href",
      "/.well-known/oauth-protected-resource/mcp",
    );
    expect(screen.getByRole("link", { name: /developer platform/i })).toHaveAttribute("href", "/api");
  });
});
