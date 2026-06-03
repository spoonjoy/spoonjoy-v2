import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Request as UndiciRequest } from "undici";
import { afterEach, describe, expect, it, vi } from "vitest";
import routes from "~/routes";
import DeveloperPlayground, {
  curlFor,
  loader,
  meta,
  playgroundFetchOptions,
  playgroundNetworkError,
  playgroundOperationGroups,
  playgroundPath,
  playgroundBodyError,
  playgroundResponseFromFetchResult,
  playgroundRequestId,
  PLAYGROUND_OPERATIONS,
} from "~/routes/developers.playground";
import { API_V1_SCOPE_REQUIREMENTS } from "~/lib/api-v1-contract.server";
import { API_V1_PLAYGROUND_MANIFEST } from "~/lib/generated/api-v1-playground";
import { createUserSessionCookie } from "~/lib/session.server";
import { createTestRoutesStub } from "../utils";

const { posthogCapture } = vi.hoisted(() => ({
  posthogCapture: vi.fn(),
}));

vi.mock("@posthog/react", () => ({
  usePostHog: () => ({ capture: posthogCapture }),
}));

type PlaygroundLoaderData = Awaited<ReturnType<typeof loader>>;

function cookieHeader(setCookie: string) {
  return setCookie.split(";")[0];
}

async function signedInPlaygroundData() {
  const env = { SESSION_SECRET: "playground-test-secret" };
  const sessionCookie = await createUserSessionCookie("chef_playground_test", env);
  return loader({
    request: new UndiciRequest("https://spoonjoy.app/api/playground", {
      headers: { Cookie: cookieHeader(sessionCookie) },
    }) as unknown as Request,
    context: { cloudflare: { env } },
  } as any);
}

async function renderPlayground(data?: PlaygroundLoaderData) {
  const resolvedData = data ?? await loader();
  const Stub = createTestRoutesStub([
    { path: "/developers/playground", Component: DeveloperPlayground, loader: () => resolvedData },
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
    posthogCapture.mockClear();
  });

  it("is registered with API aliases before the legacy /api/* catch-all", () => {
    const routeConfig = JSON.stringify(routes);

    expect(routeConfig).toContain("developers/playground");
    expect(routeConfig).toContain("routes/developers.playground.tsx");
    expect(routeConfig.indexOf("api/playground")).toBeLessThan(routeConfig.indexOf("api/*"));
    expect(routeConfig.indexOf("api/try")).toBeLessThan(routeConfig.indexOf("api/*"));
  });

  it("publishes every generated API v1 operation from the OpenAPI playground manifest", async () => {
    const data = await loader();

    expect(data.manifest).toEqual(API_V1_PLAYGROUND_MANIFEST);
    expect(data.viewer.isAuthenticated).toBe(false);
    expect(data.manifest.operations).toEqual(PLAYGROUND_OPERATIONS);
    const v1Operations = data.manifest.operations.filter((operation) => operation.path.startsWith("/api/v1"));
    expect(v1Operations.map((operation) => ({
      method: operation.method,
      path: operation.path,
      auth: operation.auth,
      scopes: [...operation.scopes],
    }))).toEqual(API_V1_SCOPE_REQUIREMENTS.map((requirement) => ({
      method: requirement.method,
      path: requirement.path,
      auth: requirement.auth === "bearer" ? "authenticated" : "optional",
      scopes: [...requirement.scopes],
    })));
    expect(data.manifest.operations.map((operation) => operation.id)).toContain("POST /api/v1/tokens");
    expect(data.manifest.operations.map((operation) => operation.id)).toContain("PATCH /api/v1/shopping-list/items/{itemId}");
    expect(data.manifest.operations.map((operation) => operation.id)).toEqual(expect.arrayContaining([
      "POST /oauth/register",
      "GET /oauth/authorize",
      "POST /oauth/token",
      "POST /oauth/revoke",
      "POST /api/tools/start_agent_connection",
      "POST /api/tools/poll_agent_connection",
      "POST /mcp",
    ]));
    expect(data.manifest.authFlows.map((flow) => flow.id)).toEqual(["oauth-pkce", "delegated-approval", "mcp"]);
    expect(data.manifest.oauthScopeMap["kitchen:read"]).toEqual([
      "cookbooks:read",
      "public:read",
      "recipes:read",
      "shopping_list:read",
    ]);
    expect(data.manifest.oauthScopeMap["shopping_list:write"]).toEqual(["shopping_list:write"]);
    expect(data.manifest.currentCapabilities.notYetAvailable).toContain("webhooks, REST Hooks, SSE, and event subscriptions");
    expect(data.canonicalUrl).toBe("https://spoonjoy.app/api/playground");
    expect(data.ogImageUrl).toBe("https://spoonjoy.app/og/pages/api-playground.png");
    expect(data.manifest.clientScenarios.map((scenario) => scenario.id)).toEqual([
      "cloudflare-worker-sync",
      "browser-extension-shopping-sync",
      "no-code-connector",
      "public-data-export",
    ]);
    expect(data.manifest.operations.find((operation) => operation.id === "POST /oauth/token")?.risk).toBe("secret");
    expect(data.manifest.operations.find((operation) => operation.id === "POST /api/tools/poll_agent_connection")?.risk).toBe("secret");
    expect(data.manifest.operations.find((operation) => operation.id === "GET /api/v1/recipes")?.profiles).toEqual(["full", "connector", "sdk"]);
    expect(data.manifest.operations.find((operation) => operation.id === "POST /oauth/token")?.profiles).toEqual(["full", "sdk"]);
    expect(data.manifest.operations.find((operation) => operation.id === "POST /mcp")?.profiles).toEqual(["full"]);
    expect(data.manifest.operations.length).toBe(24);
  });

  it("uses the configured public origin for playground OG URLs", async () => {
    const data = await loader({
      request: new Request("https://spoonjoy-v2.mendelow-studio.workers.dev/developers/playground"),
      context: { cloudflare: { env: { SPOONJOY_BASE_URL: "https://spoonjoy.app" } } },
    } as any);

    expect(data.canonicalUrl).toBe("https://spoonjoy.app/api/playground");
    expect(data.ogImageUrl).toBe("https://spoonjoy.app/og/pages/api-playground.png");
  });

  it("groups generated operations by OpenAPI tag", () => {
    expect(playgroundOperationGroups().map((group) => group.tag)).toEqual([
      "Discovery",
      "Recipes",
      "Cookbooks",
      "Shopping List",
      "Tokens",
      "OAuth",
      "Agent Approval",
      "MCP",
    ]);
  });

  it("declares playground metadata", async () => {
    const data = await loader({ request: new Request("https://local.spoonjoy.test/developers/playground") });

    expect(meta({ data })).toEqual([
      { title: "Spoonjoy API Playground | Spoonjoy" },
      {
        name: "description",
        content: "Try every Spoonjoy API v1, OAuth, delegated approval, and MCP operation from the generated developer playground.",
      },
      { property: "og:site_name", content: "Spoonjoy" },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "Spoonjoy API Playground" },
      {
        property: "og:description",
        content: "Try every Spoonjoy API v1, OAuth, delegated approval, and MCP operation from the generated developer playground.",
      },
      { property: "og:url", content: "https://local.spoonjoy.test/api/playground" },
      { property: "og:image", content: "https://local.spoonjoy.test/og/pages/api-playground.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:type", content: "image/png" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Spoonjoy API Playground" },
      {
        name: "twitter:description",
        content: "Try every Spoonjoy API v1, OAuth, delegated approval, and MCP operation from the generated developer playground.",
      },
      { name: "twitter:image", content: "https://local.spoonjoy.test/og/pages/api-playground.png" },
    ]);
  });

  it("captures safe playground view, surface, operation, and auth-mode telemetry from generated metadata", async () => {
    await renderPlayground();

    await waitFor(() => expect(posthogCapture).toHaveBeenCalledWith(
      "spoonjoy.developer.playground.viewed",
      expect.objectContaining({
        page: "api_playground",
        auth_status: "anonymous",
        surface: "full",
        operation_count: API_V1_PLAYGROUND_MANIFEST.operations.length,
        operation_id: "GET /api/v1/recipes",
        operation_group: "Recipes",
        method: "GET",
      }),
    ));

    fireEvent.click(screen.getByRole("radio", { name: "Connector" }));
    expect(posthogCapture).toHaveBeenCalledWith(
      "spoonjoy.developer.playground.surface_selected",
      expect.objectContaining({
        surface: "connector",
        operation_count: API_V1_PLAYGROUND_MANIFEST.operations.filter((operation) => operation.profiles.includes("connector")).length,
      }),
    );

    fireEvent.change(screen.getByLabelText(/Search operations/i), { target: { value: "cookbooks/{id}" } });
    fireEvent.click(await screen.findByRole("button", { name: /Read one public cookbook/i }));
    expect(posthogCapture).toHaveBeenCalledWith(
      "spoonjoy.developer.playground.operation_selected",
      expect.objectContaining({
        operation_id: "GET /api/v1/cookbooks/{id}",
        operation_group: "Cookbooks",
        operation_kind: "read",
        operation_risk: "safe",
        method: "GET",
        surface: "connector",
      }),
    );

    fireEvent.click(screen.getByRole("radio", { name: "Bearer" }));
    expect(posthogCapture).toHaveBeenCalledWith(
      "spoonjoy.developer.playground.auth_mode_selected",
      expect.objectContaining({
        operation_id: "GET /api/v1/cookbooks/{id}",
        operation_group: "Cookbooks",
        auth_mode: "bearer",
        auth_status: "anonymous",
      }),
    );

    const serialized = JSON.stringify(posthogCapture.mock.calls);
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("Bearer ");
    expect(serialized).not.toContain("sj_");
    expect(serialized).not.toContain("?query=");
    expect(serialized).not.toContain("request_body");
    expect(serialized).not.toContain("response_body");
  });

  it("builds request paths from path and query parameters", () => {
    const recipeSearch = PLAYGROUND_OPERATIONS.find((operation) => operation.id === "GET /api/v1/recipes")!;
    const recipeDetail = PLAYGROUND_OPERATIONS.find((operation) => operation.id === "GET /api/v1/recipes/{id}")!;

    expect(playgroundPath(recipeSearch, { query: "pasta", q: "", limit: "10" })).toBe("/api/v1/recipes?query=pasta&limit=10");
    expect(playgroundPath(recipeSearch, { query: "", q: "", limit: "" })).toBe("/api/v1/recipes");
    expect(playgroundPath(recipeDetail, { id: "recipe/with/slash" })).toBe("/api/v1/recipes/recipe%2Fwith%2Fslash");
    expect(playgroundPath(recipeDetail, { id: "" })).toBe("/api/v1/recipes/REPLACE_id");
  });

  it("builds timestamp request IDs when crypto UUIDs are unavailable", () => {
    expect(playgroundRequestId(null, 12345)).toBe("pg_12345");
    expect(playgroundRequestId({ randomUUID: () => "uuid-1" })).toBe("pg_uuid-1");
  });

  it("builds fetch options for session, anonymous, bearer, and JSON-body requests", () => {
    const root = PLAYGROUND_OPERATIONS.find((operation) => operation.id === "GET /api/v1")!;
    const createToken = PLAYGROUND_OPERATIONS.find((operation) => operation.id === "POST /api/v1/tokens")!;
    const deleteItem = PLAYGROUND_OPERATIONS.find((operation) => operation.id === "DELETE /api/v1/shopping-list/items/{itemId}")!;

    expect(playgroundFetchOptions(root, "session", "", "", "pg_session")).toEqual({
      method: "GET",
      credentials: "same-origin",
      headers: { "X-Request-Id": "pg_session" },
    });
    expect(playgroundFetchOptions(root, "anonymous", "", "", "pg_anon")).toEqual({
      method: "GET",
      credentials: "omit",
      headers: { "X-Request-Id": "pg_anon" },
    });
    expect(playgroundFetchOptions(root, "bearer", " sj_test_token ", "", "pg_bearer")).toEqual({
      method: "GET",
      credentials: "omit",
      headers: { Authorization: "Bearer sj_test_token", "X-Request-Id": "pg_bearer" },
    });
    expect(playgroundFetchOptions(root, "bearer", " ", "{\"ignored\":true}", "pg_bearer_blank")).toEqual({
      method: "GET",
      credentials: "omit",
      headers: { "X-Request-Id": "pg_bearer_blank" },
    });
    expect(playgroundFetchOptions(createToken, "session", "", "{\"name\":\"Client\"}", "pg_post")).toEqual({
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Request-Id": "pg_post" },
      body: "{\"name\":\"Client\"}",
    });
    expect(playgroundFetchOptions(deleteItem, "bearer", "sj_delete", "", "pg_delete", {
      itemId: "item_1",
      "X-Client-Mutation-Id": "delete:item_1:test",
    })).toEqual({
      method: "DELETE",
      credentials: "omit",
      headers: {
        Authorization: "Bearer sj_delete",
        "X-Client-Mutation-Id": "delete:item_1:test",
        "X-Request-Id": "pg_delete",
      },
    });
    expect(playgroundBodyError(createToken, "")).toBe("This operation requires a request body.");
    expect(playgroundBodyError(createToken, "{bad")).toBe("JSON body is not valid.");
    expect(playgroundBodyError(createToken, "{\"name\":\"Client\"}")).toBeNull();
  });

  it("renders all operations and sends the default public recipes request anonymously", async () => {
    const fetchMock = vi.fn(async () => mockApiResponse({
      ok: true,
      requestId: "req_playground",
      data: { app: "spoonjoy" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await renderPlayground();
    expect(await screen.findByRole("heading", { name: "Spoonjoy API Playground" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create a bearer credential/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Remove a shopping-list item/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "All APIs" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Connector" })).toBeInTheDocument();
    expect(screen.getAllByText("/api/v1/openapi.json").length).toBeGreaterThan(0);
    expect(screen.getByText("Omits cookies and Authorization for public-only requests.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Send Request" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/recipes?limit=20", {
      method: "GET",
      credentials: "omit",
      headers: expect.objectContaining({ "X-Request-Id": expect.stringMatching(/^pg_/) }),
    });
    expect((fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers.Authorization).toBeUndefined();
    expect(await screen.findByText("200 OK")).toBeInTheDocument();
    expect(screen.getByText("Request ID: req_playground")).toBeInTheDocument();
    expect(screen.getByText(/GET \/api\/v1\/recipes\?limit=20 - \d+ ms/)).toBeInTheDocument();
    expect(screen.getByText(/"app": "spoonjoy"/)).toBeInTheDocument();

    fetchMock.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Send Request" }));
    expect(await screen.findByText("0 NETWORK ERROR")).toBeInTheDocument();
    expect(screen.getByText("offline")).toBeInTheDocument();
  });

  it("captures safe sign-in handoff telemetry without URL or token values", async () => {
    await renderPlayground();

    fireEvent.click(await screen.findByRole("radio", { name: "Session" }));
    posthogCapture.mockClear();
    fireEvent.click(screen.getByRole("link", { name: "Sign in" }));

    expect(posthogCapture).toHaveBeenCalledWith(
      "spoonjoy.developer.playground.sign_in_clicked",
      expect.objectContaining({
        operation_id: "GET /api/v1/recipes",
        operation_group: "Recipes",
        auth_mode: "session",
        auth_status: "anonymous",
      }),
    );
    const serialized = JSON.stringify(posthogCapture.mock.calls);
    expect(serialized).not.toContain("/login?redirectTo=/api/playground");
    expect(serialized).not.toContain("https://spoonjoy.app");
    expect(serialized).not.toContain("sj_");
    expect(serialized).not.toContain("code_verifier");
    expect(serialized).not.toContain("state_");
  });

  it("captures safe request and response telemetry without query, body, token, or response payloads", async () => {
    const fetchMock = vi.fn(async () => mockApiResponse({
      ok: true,
      requestId: "req_playground",
      data: { recipes: [{ id: "recipe_1", title: "Private pasta" }] },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await renderPlayground();
    await screen.findByRole("heading", { name: "Spoonjoy API Playground" });
    posthogCapture.mockClear();
    fireEvent.change(screen.getByLabelText(/Query/), { target: { value: "private pasta" } });
    fireEvent.click(screen.getByRole("button", { name: "Send Request" }));

    await waitFor(() => expect(posthogCapture).toHaveBeenCalledWith(
      "spoonjoy.developer.playground.request_submitted",
      expect.objectContaining({
        operation_id: "GET /api/v1/recipes",
        operation_group: "Recipes",
        method: "GET",
        auth_mode: "anonymous",
        request_body_present: false,
        validation_error_count: 0,
      }),
    ));
    await waitFor(() => expect(posthogCapture).toHaveBeenCalledWith(
      "spoonjoy.developer.playground.response_received",
      expect.objectContaining({
        operation_id: "GET /api/v1/recipes",
        operation_group: "Recipes",
        method: "GET",
        auth_mode: "anonymous",
        outcome: "success",
        response_status: 200,
        response_status_class: "2xx",
        latency_bucket: expect.any(String),
      }),
    ));

    fetchMock.mockResolvedValueOnce(mockApiResponse({
      ok: true,
      requestId: "req_token",
      data: {
        token: "sj_secret_token_value",
        credential: { id: "cred_1" },
      },
    }, { status: 201, statusText: "Created" }));
    posthogCapture.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /Create a bearer credential/i }));
    fireEvent.change(screen.getByLabelText("JSON body"), {
      target: { value: "{\"name\":\"Kitchen secret token\",\"clientMutationId\":\"secret-mutation\",\"scopes\":[\"recipes:read\"]}" },
    });
    fireEvent.click(screen.getByLabelText(/I understand this request can change real Spoonjoy data/i));
    fireEvent.click(screen.getByRole("button", { name: "Send Request" }));

    await waitFor(() => expect(posthogCapture).toHaveBeenCalledWith(
      "spoonjoy.developer.playground.request_submitted",
      expect.objectContaining({
        operation_id: "POST /api/v1/tokens",
        operation_group: "Tokens",
        method: "POST",
        auth_mode: "session",
        request_body_present: true,
      }),
    ));
    await waitFor(() => expect(posthogCapture).toHaveBeenCalledWith(
      "spoonjoy.developer.playground.response_received",
      expect.objectContaining({
        operation_id: "POST /api/v1/tokens",
        operation_group: "Tokens",
        method: "POST",
        auth_mode: "session",
        outcome: "success",
        response_status: 201,
        response_status_class: "2xx",
      }),
    ));

    const serialized = JSON.stringify(posthogCapture.mock.calls);
    expect(serialized).not.toContain("private pasta");
    expect(serialized).not.toContain("?query=");
    expect(serialized).not.toContain("req_playground");
    expect(serialized).not.toContain("req_token");
    expect(serialized).not.toContain("Kitchen secret token");
    expect(serialized).not.toContain("secret-mutation");
    expect(serialized).not.toContain("clientMutationId");
    expect(serialized).not.toContain("sj_secret_token_value");
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("response_body");
  });

  it("reflects a signed-in Spoonjoy session after returning from login", async () => {
    const fetchMock = vi.fn(async () => mockApiResponse({
      ok: true,
      requestId: "req_signed_in",
      data: { recipes: [] },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const data = await signedInPlaygroundData();
    expect(data.viewer.isAuthenticated).toBe(true);

    await renderPlayground(data);

    expect(await screen.findByRole("radio", { name: "Session" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Uses your signed-in Spoonjoy session for same-origin API calls.")).toBeInTheDocument();
    expect(screen.getByText("Signed in to Spoonjoy. Session requests will include your browser login.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Send Request" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/recipes?limit=20", {
      method: "GET",
      credentials: "same-origin",
      headers: expect.objectContaining({ "X-Request-Id": expect.stringMatching(/^pg_/) }),
    });
  });

  it("uses query params and bearer auth only after the user enables it", async () => {
    const fetchMock = vi.fn(async () => mockApiResponse({
      ok: true,
      requestId: "req_playground",
      data: { recipes: [] },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await renderPlayground();
    fireEvent.click(await screen.findByRole("button", { name: /Search public recipes/i }));
    fireEvent.change(screen.getByLabelText(/Query/), { target: { value: "pasta" } });
    fireEvent.change(document.querySelector<HTMLInputElement>("#param-query-limit")!, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("radio", { name: "Bearer" }));
    fireEvent.change(screen.getByLabelText("Bearer token"), { target: { value: "sj_test_token" } });
    fireEvent.click(screen.getByRole("button", { name: "Send Request" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/recipes?query=pasta&limit=5", {
      method: "GET",
      credentials: "omit",
      headers: expect.objectContaining({
        Authorization: "Bearer sj_test_token",
        "X-Request-Id": expect.stringMatching(/^pg_/),
      }),
    });
  });

  it("filters operations by generated connector profile and search text", async () => {
    await renderPlayground();
    await screen.findByRole("heading", { name: "Spoonjoy API Playground" });

    fireEvent.click(screen.getByRole("radio", { name: "Connector" }));
    expect(screen.getByRole("radio", { name: "Connector" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("link", { name: /Open Spec/i })).toHaveAttribute("href", "/api/v1/openapi.connector.json");
    expect(screen.queryByRole("button", { name: /Exchange or refresh an OAuth token/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Search public recipes/i })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Search operations/i), { target: { value: "cookbooks/{id}" } });
    expect(await screen.findByRole("button", { name: /Read one public cookbook/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Search public recipes/i })).not.toBeInTheDocument();
  });

  it("sends generated JSON-body operations with session auth by default", async () => {
    const fetchMock = vi.fn(async () => mockApiResponse({
      ok: true,
      requestId: "req_playground",
      data: { token: "sj_secret" },
    }, { status: 201, statusText: "Created" }));
    vi.stubGlobal("fetch", fetchMock);

    await renderPlayground();
    fireEvent.click(await screen.findByRole("button", { name: /Create a bearer credential/i }));
    expect(screen.getByText("Authenticated chef")).toBeInTheDocument();
    expect(screen.getByText("tokens:write")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("JSON body"), {
      target: { value: "{\"name\":\"External client\",\"scopes\":[\"recipes:read\"]}" },
    });
    expect(screen.getByRole("button", { name: "Send Request" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/I understand this request can change real Spoonjoy data/i));
    fireEvent.click(screen.getByRole("button", { name: "Send Request" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/tokens", {
      method: "POST",
      credentials: "same-origin",
      headers: expect.objectContaining({
        "Content-Type": "application/json",
        "X-Request-Id": expect.stringMatching(/^pg_/),
      }),
      body: "{\"name\":\"External client\",\"scopes\":[\"recipes:read\"]}",
    });
    expect(await screen.findByText("201 Created")).toBeInTheDocument();
  });

  it("blocks blank bearer mode before sending private requests", async () => {
    const fetchMock = vi.fn(async () => mockApiResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await renderPlayground();
    fireEvent.click(await screen.findByRole("button", { name: /Read the authenticated shopping list/i }));
    fireEvent.click(screen.getByRole("radio", { name: "Bearer" }));

    expect(screen.getAllByText("Paste a bearer token before sending in Bearer mode.").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Send Request" })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders required path parameters for generated detail operations", async () => {
    await renderPlayground();

    fireEvent.click(await screen.findByRole("button", { name: /Read one public recipe/i }));

    expect(await screen.findByText(/path required/i)).toBeInTheDocument();
    expect(document.querySelector<HTMLInputElement>("#param-path-id")).toHaveAttribute("placeholder", "recipe_1");
    expect(screen.getAllByText(/REPLACE_id/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Set required parameters before sending/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Send Request" })).toBeDisabled();
  });

  it("can intentionally omit auth for public requests", async () => {
    const fetchMock = vi.fn(async () => mockApiResponse({ ok: true, data: { ok: true } }));
    vi.stubGlobal("fetch", fetchMock);

    await renderPlayground();
    fireEvent.click(await screen.findByRole("radio", { name: "Anonymous" }));
    fireEvent.click(screen.getByRole("button", { name: "Send Request" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/recipes?limit=20", {
      method: "GET",
      credentials: "omit",
      headers: expect.objectContaining({ "X-Request-Id": expect.stringMatching(/^pg_/) }),
    });
  });

  it("renders portable curl for bearer mode and body requests", () => {
    const root = PLAYGROUND_OPERATIONS.find((operation) => operation.id === "GET /api/v1")!;
    const createToken = PLAYGROUND_OPERATIONS.find((operation) => operation.id === "POST /api/v1/tokens")!;

    expect(curlFor("/api/v1", root, "session", "")).toContain("Session mode is browser-only");
    expect(curlFor("/api/v1", root, "session", "")).toContain("await fetch(\"/api/v1\"");
    expect(curlFor("/api/v1", root, "anonymous", "")).toBe(
      "curl 'https://spoonjoy.app/api/v1' \\\n  -H 'X-Request-Id: pg_example'",
    );
    expect(curlFor("/api/v1/tokens", createToken, "session", "{\"name\":\"Client\"}")).toBe(
      "// Session mode is browser-only: run from a signed-in Spoonjoy page.\nawait fetch(\"/api/v1/tokens\", {\n  method: \"POST\",\n  credentials: \"same-origin\",\n  headers: {\n    \"Content-Type\": \"application/json\",\n  },\n  body: \"{\\\"name\\\":\\\"Client\\\"}\",\n});",
    );
    expect(curlFor("/api/v1/tokens", createToken, "bearer", "{\"name\":\"Client\"}")).toContain(
      "-H 'Authorization: Bearer $SPOONJOY_TOKEN'",
    );
    expect(curlFor("/api/v1/tokens", createToken, "bearer", "{\"name\":\"Client\"}")).toContain(
      "--data '{\"name\":\"Client\"}'",
    );
  });

  it("redacts token-bearing responses while preserving explicit copyable secrets", async () => {
    const response = await playgroundResponseFromFetchResult(new Response(JSON.stringify({
      ok: true,
      data: {
        token: "sj_secret_token_value",
        refresh_token: "ort_refresh_token_value",
        nested: { deviceCode: "sjdc_device_code_value" },
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Request-Id": "req_secret" },
    }), {}, { maskSecrets: true });

    expect(response.body).toContain("sj_...redacted");
    expect(response.body).toContain("ort_...redacted");
    expect(response.body).toContain("sjdc_...redacted");
    expect(response.body).not.toContain("sj_secret_token_value");
    expect(response.secrets).toEqual([
      { label: "token", value: "sj_secret_token_value" },
      { label: "refresh token", value: "ort_refresh_token_value" },
      { label: "device code", value: "sjdc_device_code_value" },
    ]);
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
      headers: [{ name: "Content-Type", value: "text/plain" }],
      body: "(empty response)",
    });
  });

  it("formats non-OK text responses without a status text", async () => {
    const response = await playgroundResponseFromFetchResult(new Response("Too many requests", {
      status: 429,
      headers: { "Retry-After": "60" },
    }));

    expect(response).toEqual({
      status: 429,
      statusText: "ERROR",
      requestId: null,
      headers: [
        { name: "Retry-After", value: "60" },
        { name: "Content-Type", value: "text/plain;charset=UTF-8" },
      ],
      body: "Too many requests",
    });
  });

  it("formats Error network failures", () => {
    expect(playgroundNetworkError(new Error("offline"))).toEqual({
      status: 0,
      statusText: "NETWORK ERROR",
      requestId: null,
      headers: [],
      body: "offline",
    });
  });

  it("formats non-Error network failures", () => {
    expect(playgroundNetworkError("offline")).toEqual({
      status: 0,
      statusText: "NETWORK ERROR",
      requestId: null,
      headers: [],
      body: "Request failed",
    });
  });
});
