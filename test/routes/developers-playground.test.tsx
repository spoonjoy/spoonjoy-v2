import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import routes from "~/routes";
import DeveloperPlayground, {
  loader,
  meta,
  playgroundNetworkError,
  playgroundPath,
  playgroundResponseFromFetchResult,
  playgroundRequestId,
  PLAYGROUND_ENDPOINTS,
} from "~/routes/developers.playground";
import { API_V1_SCOPE_REQUIREMENTS } from "~/lib/api-v1-contract.server";
import { createTestRoutesStub } from "../utils";

function renderPlayground() {
  const data = loader();
  const Stub = createTestRoutesStub([
    { path: "/developers/playground", Component: DeveloperPlayground, loader: () => data },
  ]);
  render(<Stub initialEntries={["/developers/playground"]} />);
}

function mockApiResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    statusText: "OK",
    headers: { "Content-Type": "application/json", "X-Request-Id": "req_playground" },
    ...init,
  });
}

describe("/developers/playground", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("is registered with API aliases before the legacy /api/* catch-all", () => {
    const routeConfig = JSON.stringify(routes);

    expect(routeConfig).toContain("developers/playground");
    expect(routeConfig).toContain("routes/developers.playground.tsx");
    expect(routeConfig.indexOf("api/playground")).toBeLessThan(routeConfig.indexOf("api/*"));
    expect(routeConfig.indexOf("api/try")).toBeLessThan(routeConfig.indexOf("api/*"));
  });

  it("publishes only safe read-only playground endpoints", () => {
    const data = loader();

    expect(data.endpoints).toEqual(PLAYGROUND_ENDPOINTS);
    expect(data.scopeRequirements).toEqual(API_V1_SCOPE_REQUIREMENTS);
    expect(data.endpoints.map((endpoint) => endpoint.path)).toEqual([
      "/api/v1",
      "/api/v1/health",
      "/api/v1/recipes",
      "/api/v1/cookbooks",
    ]);
    expect(data.endpoints.every((endpoint) => endpoint.method === "GET")).toBe(true);
    expect(JSON.stringify(data.endpoints)).not.toContain("tokens");
    expect(JSON.stringify(data.endpoints)).not.toContain("shopping-list/items");
  });

  it("declares playground metadata", () => {
    expect(meta()).toEqual([
      { title: "Spoonjoy API Playground | Spoonjoy" },
      {
        name: "description",
        content: "Try safe Spoonjoy API v1 requests from the developer playground.",
      },
    ]);
  });

  it("builds request paths without empty query parameters", () => {
    const recipeSearch = PLAYGROUND_ENDPOINTS.find((endpoint) => endpoint.id === "recipes")!;

    expect(playgroundPath(recipeSearch, { query: "pasta", limit: "10" })).toBe("/api/v1/recipes?query=pasta&limit=10");
    expect(playgroundPath(recipeSearch, { query: "", limit: "" })).toBe("/api/v1/recipes");
  });

  it("builds timestamp request IDs when crypto UUIDs are unavailable", () => {
    expect(playgroundRequestId(null, 12345)).toBe("pg_12345");
  });

  it("sends the selected request without Authorization by default", async () => {
    const fetchMock = vi.fn(async () => mockApiResponse({
      ok: true,
      requestId: "req_playground",
      data: { app: "spoonjoy" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    renderPlayground();
    expect(await screen.findByRole("heading", { name: "Spoonjoy API Playground" })).toBeInTheDocument();
    expect(screen.getByText("This request will not send an Authorization header.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Send Request" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/api/v1", {
      method: "GET",
      headers: expect.objectContaining({ "X-Request-Id": expect.stringMatching(/^pg_/) }),
    });
    expect((fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers.Authorization).toBeUndefined();
    expect(await screen.findByText("200 OK")).toBeInTheDocument();
    expect(screen.getByText("Request ID: req_playground")).toBeInTheDocument();
    expect(screen.getByText(/"app": "spoonjoy"/)).toBeInTheDocument();

    fetchMock.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Send Request" }));
    expect(await screen.findByText("0 NETWORK ERROR")).toBeInTheDocument();
    expect(screen.getByText("offline")).toBeInTheDocument();
  });

  it("uses query params and bearer auth only after the user enables it", async () => {
    const fetchMock = vi.fn(async () => mockApiResponse({
      ok: true,
      requestId: "req_playground",
      data: { recipes: [] },
    }));
    vi.stubGlobal("fetch", fetchMock);

    renderPlayground();
    fireEvent.click(await screen.findByRole("button", { name: /Recipe Search/i }));
    fireEvent.change(screen.getByLabelText("Query"), { target: { value: "pasta" } });
    fireEvent.change(screen.getByLabelText("Limit"), { target: { value: "5" } });
    fireEvent.click(screen.getByLabelText("Attach bearer token"));
    fireEvent.change(screen.getByLabelText("Bearer token"), { target: { value: "sj_test_token" } });
    fireEvent.click(screen.getByRole("button", { name: "Send Request" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/recipes?query=pasta&limit=5", {
      method: "GET",
      headers: expect.objectContaining({
        Authorization: "Bearer sj_test_token",
        "X-Request-Id": expect.stringMatching(/^pg_/),
      }),
    });
  });

  it("formats empty non-JSON responses", async () => {
    const response = await playgroundResponseFromFetchResult(new Response(null, {
      status: 204,
      headers: { "Content-Type": "text/plain" },
    }));

    expect(response).toEqual({
      status: 204,
      statusText: "OK",
      requestId: null,
      body: "(empty response)",
    });
  });

  it("formats non-OK text responses without a status text", async () => {
    const response = await playgroundResponseFromFetchResult(new Response("Too many requests", {
      status: 429,
    }));

    expect(response).toEqual({
      status: 429,
      statusText: "ERROR",
      requestId: null,
      body: "Too many requests",
    });
  });

  it("formats Error network failures", () => {
    expect(playgroundNetworkError(new Error("offline"))).toEqual({
      status: 0,
      statusText: "NETWORK ERROR",
      requestId: null,
      body: "offline",
    });
  });

  it("formats non-Error network failures", () => {
    expect(playgroundNetworkError("offline")).toEqual({
      status: 0,
      statusText: "NETWORK ERROR",
      requestId: null,
      body: "Request failed",
    });
  });
});
