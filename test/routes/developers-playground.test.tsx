import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Request as UndiciRequest } from "undici";
import { afterEach, describe, expect, it, vi } from "vitest";
import routes from "~/routes";
import DeveloperPlayground, {
  absoluteSpecUrl,
  curlFor,
  loader,
  meta,
  playgroundFetchOptions,
  playgroundNetworkError,
  playgroundOutcomeForStatus,
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
    vi.useRealTimers();
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
    expect(data.manifest.operations.map((operation) => operation.id)).toContain("GET /api/v1/search");
    expect(data.manifest.operations.map((operation) => operation.id)).toContain("POST /api/v1/tokens");
    expect(data.manifest.operations.map((operation) => operation.id)).toContain("PATCH /api/v1/shopping-list/items/{itemId}");
    expect(data.manifest.operations.map((operation) => operation.id)).toEqual(expect.arrayContaining([
      "GET /api/v1/recipes/{id}/covers",
      "PATCH /api/v1/recipes/{id}/covers",
      "PATCH /api/v1/recipes/{id}/covers/{coverId}",
      "DELETE /api/v1/recipes/{id}/covers/{coverId}",
      "POST /api/v1/recipes/{id}/covers/regenerate",
      "POST /api/v1/recipes/{id}/covers/from-spoon/{spoonId}",
    ]));
    expect(data.manifest.operations.map((operation) => operation.id)).toEqual(expect.arrayContaining([
      "POST /api/v1/cookbooks",
      "PATCH /api/v1/cookbooks/{id}",
      "DELETE /api/v1/cookbooks/{id}",
      "POST /api/v1/cookbooks/{id}/recipes/{recipeId}",
      "DELETE /api/v1/cookbooks/{id}/recipes/{recipeId}",
    ]));
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
    expect(data.manifest.oauthScopeMap["kitchen:write"]).toEqual([
      "kitchen:write",
      "shopping_list:write",
    ]);
    expect(data.manifest.oauthScopeMap["shopping_list:write"]).toEqual(["shopping_list:write"]);
    expect(data.manifest.currentCapabilities.notYetAvailable).toContain("webhooks, REST Hooks, SSE, and event subscriptions");
    expect(data.canonicalUrl).toBe("https://spoonjoy.app/api/playground");
    expect(data.ogImageUrl).toBe("https://spoonjoy.app/og/pages/api-playground.png");
    expect(data.manifest.clientScenarios.map((scenario) => scenario.id)).toEqual([
      "spoonjoy-apple-native-dogfood",
      "cloudflare-worker-sync",
      "browser-extension-shopping-sync",
      "no-code-connector",
      "public-data-export",
    ]);
    expect(data.manifest.operations.find((operation) => operation.id === "POST /oauth/token")?.risk).toBe("secret");
    expect(data.manifest.operations.find((operation) => operation.id === "POST /api/tools/poll_agent_connection")?.risk).toBe("secret");
    expect(data.manifest.operations.find((operation) => operation.id === "GET /api/v1/recipes")?.profiles).toEqual(["full", "connector", "sdk"]);
    expect(data.manifest.operations.find((operation) => operation.id === "POST /api/v1/recipes/import")?.profiles).toEqual(["full", "connector", "sdk"]);
    expect(data.manifest.operations.find((operation) => operation.id === "POST /api/v1/cookbooks")?.profiles).toEqual(["full", "connector", "sdk"]);
    expect(data.manifest.operations.find((operation) => operation.id === "POST /api/v1/cookbooks/{id}/recipes/{recipeId}")?.profiles).toEqual(["full", "connector", "sdk"]);
    expect(data.manifest.operations.find((operation) => operation.id === "GET /api/v1/recipes/{id}/spoons")?.profiles).toEqual(["full", "sdk"]);
    expect(data.manifest.operations.find((operation) => operation.id === "POST /api/v1/recipes/{id}/spoons")?.profiles).toEqual(["full", "sdk"]);
    expect(data.manifest.operations.find((operation) => operation.id === "GET /api/v1/recipes/{id}/covers")?.profiles).toEqual(["full", "sdk"]);
    expect(data.manifest.operations.find((operation) => operation.id === "POST /oauth/token")?.profiles).toEqual(["full", "sdk"]);
    expect(data.manifest.operations.find((operation) => operation.id === "POST /mcp")?.profiles).toEqual(["full"]);
    expect(data.manifest.operations.find((operation) => operation.id === "POST /api/v1/me/photo")?.requestBody).toMatchObject({
      contentType: "multipart/form-data",
      fields: [{ name: "photo", required: true, accept: "image/jpeg,image/png,image/gif,image/webp" }],
    });
    expect(data.manifest.operations.length).toBe(52);
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
      "Search",
      "Recipes",
      "Recipe Spoons",
      "Recipe Covers",
      "Cookbooks",
      "Account",
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
    expect(meta()).toEqual(expect.arrayContaining([
      { property: "og:url", content: "https://spoonjoy.app/api/playground" },
      { property: "og:image", content: "https://spoonjoy.app/og/pages/api-playground.png" },
    ]));
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

  it("builds SSR-safe spec URLs and response outcome classes", () => {
    const originalWindow = globalThis.window;
    vi.stubGlobal("window", undefined);
    expect(absoluteSpecUrl("/api/v1/openapi.sdk.json")).toBe("https://spoonjoy.app/api/v1/openapi.sdk.json");
    vi.stubGlobal("window", originalWindow);
    expect(absoluteSpecUrl("/api/v1/openapi.sdk.json")).toBe("http://localhost:3000/api/v1/openapi.sdk.json");

    expect(playgroundOutcomeForStatus(0)).toBe("network_error");
    expect(playgroundOutcomeForStatus(302)).toBe("success");
    expect(playgroundOutcomeForStatus(404)).toBe("error");
  });

  it("builds timestamp request IDs when crypto UUIDs are unavailable", () => {
    expect(playgroundRequestId(null, 12345)).toBe("pg_12345");
    expect(playgroundRequestId({ randomUUID: () => "uuid-1" })).toBe("pg_uuid-1");
  });

  it("builds fetch options for session, anonymous, bearer, and JSON-body requests", () => {
    const root = PLAYGROUND_OPERATIONS.find((operation) => operation.id === "GET /api/v1")!;
    const createToken = PLAYGROUND_OPERATIONS.find((operation) => operation.id === "POST /api/v1/tokens")!;
    const deleteItem = PLAYGROUND_OPERATIONS.find((operation) => operation.id === "DELETE /api/v1/shopping-list/items/{itemId}")!;
    const uploadPhoto = PLAYGROUND_OPERATIONS.find((operation) => operation.id === "POST /api/v1/me/photo")!;

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
    const generatedRequestId = playgroundFetchOptions(root, "anonymous", "", "");
    expect(generatedRequestId.headers).toEqual({ "X-Request-Id": expect.stringMatching(/^pg_/) });
    expect(playgroundBodyError(createToken, "")).toBe("This operation requires a request body.");
    expect(playgroundBodyError(createToken, "{bad")).toBe("JSON body is not valid.");
    expect(playgroundBodyError(createToken, "{\"name\":\"Client\"}")).toBeNull();

    const file = new File(["GIF89a"], "profile.gif", { type: "image/gif" });
    const multipartOptions = playgroundFetchOptions(uploadPhoto, "session", "", "", "pg_upload", {}, { photo: file });
    expect(multipartOptions).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      headers: { "X-Request-Id": "pg_upload" },
    });
    expect((multipartOptions.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    expect(multipartOptions.body).toBeInstanceOf(FormData);
    expect([...(multipartOptions.body as FormData).entries()]).toEqual([["photo", file]]);
    const emptyMultipartOptions = playgroundFetchOptions(uploadPhoto, "session", "", "", "pg_empty", {}, { photo: null });
    expect(emptyMultipartOptions.body).toBeUndefined();
    expect((emptyMultipartOptions.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    const legacyMultipartWithoutFields = {
      ...uploadPhoto,
      requestBody: { ...uploadPhoto.requestBody!, fields: undefined },
    } as unknown as typeof uploadPhoto;
    expect(playgroundFetchOptions(legacyMultipartWithoutFields, "session", "", "", "pg_legacy").body).toBeUndefined();
    expect(playgroundBodyError(uploadPhoto, "", {})).toBe("Select photo before sending.");
    expect(playgroundBodyError(uploadPhoto, "", { photo: file })).toBeNull();
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
    fireEvent.click(screen.getByRole("radio", { name: "Anonymous" }));
    expect(screen.getByText("You are signed in, but Anonymous mode intentionally omits your Spoonjoy session for this request.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Session" }));

    fireEvent.click(screen.getByRole("button", { name: "Send Request" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/recipes?limit=20", {
      method: "GET",
      credentials: "same-origin",
      headers: expect.objectContaining({ "X-Request-Id": expect.stringMatching(/^pg_/) }),
    });
  });

  it("switches an already-mounted playground to session mode after sign-in", async () => {
    vi.resetModules();
    let routeData: PlaygroundLoaderData = {
      manifest: API_V1_PLAYGROUND_MANIFEST,
      canonicalUrl: "https://spoonjoy.app/api/playground",
      ogImageUrl: "https://spoonjoy.app/og/pages/api-playground.png",
      viewer: { isAuthenticated: false },
    };
    vi.doMock("react-router", async (importOriginal) => ({
      ...await importOriginal<typeof import("react-router")>(),
      useLoaderData: () => routeData,
    }));
    vi.doMock("@posthog/react", () => ({
      usePostHog: () => ({ capture: posthogCapture }),
    }));
    try {
      const { default: IsolatedPlayground } = await import("~/routes/developers.playground");
      const { createMemoryRouter, RouterProvider } = await import("react-router");
      const React = await import("react");
      let forceRerender = () => {};
      function PlaygroundShell() {
        const [, setTick] = React.useState(0);
        forceRerender = () => setTick((tick) => tick + 1);
        return <IsolatedPlayground />;
      }
      const router = createMemoryRouter([
        { path: "/developers/playground", Component: PlaygroundShell },
      ], { initialEntries: ["/developers/playground"] });
      render(<RouterProvider router={router} />);

      fireEvent.click(await screen.findByRole("button", { name: /Read the authenticated shopping list/i }));
      fireEvent.click(screen.getByRole("radio", { name: "Bearer" }));
      expect(screen.getByRole("radio", { name: "Bearer" })).toHaveAttribute("aria-checked", "true");

      routeData = { ...routeData, viewer: { isAuthenticated: true } };
      act(() => forceRerender());

      await waitFor(() => expect(screen.getByRole("radio", { name: "Session" })).toHaveAttribute("aria-checked", "true"));
    } finally {
      vi.doUnmock("react-router");
      vi.doUnmock("@posthog/react");
      vi.resetModules();
    }
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

    fireEvent.click(screen.getByRole("button", { name: /Discover the Spoonjoy API/i }));
    fireEvent.click(screen.getByRole("radio", { name: "Connector" }));
    expect(screen.getByRole("radio", { name: "Connector" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("link", { name: /Open Spec/i })).toHaveAttribute("href", "/api/v1/openapi.connector.json");
    expect(screen.getByRole("button", { name: /Search public recipes/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: /Exchange or refresh an OAuth token/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Search public recipes/i })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Search operations/i), { target: { value: "cookbooks/{id}" } });
    expect(await screen.findByRole("button", { name: /Read one public cookbook/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Search public recipes/i })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Search operations/i), { target: { value: "definitely no operation" } });
    expect(await screen.findByText("No operations match this surface and search.")).toBeInTheDocument();
  });

  it("uses the first generated operation when a custom manifest has no recipe list", async () => {
    const manifestWithoutDefaultRecipe = {
      ...API_V1_PLAYGROUND_MANIFEST,
      operations: API_V1_PLAYGROUND_MANIFEST.operations.filter((operation) => operation.id !== "GET /api/v1/recipes"),
    };

    await renderPlayground({
      manifest: manifestWithoutDefaultRecipe,
      canonicalUrl: "https://spoonjoy.app/api/playground",
      ogImageUrl: "https://spoonjoy.app/og/pages/api-playground.png",
      viewer: { isAuthenticated: false },
    } as PlaygroundLoaderData);

    expect(await screen.findByRole("button", { name: /Discover the Spoonjoy API/i })).toHaveAttribute("aria-pressed", "true");
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

  it("sends generated multipart operations with selected files and safety reconfirmation", async () => {
    const fetchMock = vi.fn(async () => mockApiResponse({
      ok: true,
      requestId: "req_photo_upload",
      data: { profile: { id: "chef_playground_test", photoUrl: "/photos/profile.png" } },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await renderPlayground();
    fireEvent.click(await screen.findByRole("button", { name: /Upload the authenticated account profile photo/i }));
    expect(screen.getAllByText("account:write").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Multipart body")).toHaveTextContent("\"photo\": \"(binary image file)\"");

    const photoInput = screen.getByLabelText(/Photo/) as HTMLInputElement;
    expect(photoInput).toHaveAttribute("type", "file");
    expect(photoInput).toHaveAttribute("accept", "image/jpeg,image/png,image/gif,image/webp");
    expect(photoInput).toBeRequired();
    expect(photoInput).toHaveAccessibleDescription("multipart required - (binary image file)");
    expect(screen.getAllByText("Select photo before sending.").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Send Request" })).toBeDisabled();

    const riskCheckbox = screen.getByLabelText(/I understand this request can change real Spoonjoy data/i);
    fireEvent.click(riskCheckbox);
    expect(riskCheckbox).toBeChecked();

    const file = new File(["profile-bytes"], "profile.png", { type: "image/png" });
    fireEvent.change(photoInput, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByLabelText(/I understand this request can change real Spoonjoy data/i)).not.toBeChecked());
    expect(screen.getByText("Confirm this real-data operation before sending.")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/I understand this request can change real Spoonjoy data/i));
    await waitFor(() => expect(screen.getByRole("button", { name: "Send Request" })).not.toBeDisabled());

    fireEvent.submit(screen.getByRole("button", { name: "Send Request" }).closest("form")!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/me/photo", {
      method: "POST",
      credentials: "same-origin",
      headers: expect.objectContaining({ "X-Request-Id": expect.stringMatching(/^pg_/) }),
      body: expect.any(FormData),
    });
    const options = fetchMock.mock.calls[0][1] as RequestInit;
    expect((options.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    expect([...(options.body as FormData).entries()]).toEqual([["photo", file]]);
    expect(await screen.findByText("200 OK")).toBeInTheDocument();
  });

  it("renders optional multipart fields without accept or description metadata", async () => {
    const uploadPhoto = API_V1_PLAYGROUND_MANIFEST.operations.find((operation) => operation.id === "POST /api/v1/me/photo")!;
    const optionalMultipartManifest = {
      ...API_V1_PLAYGROUND_MANIFEST,
      operations: [{
        ...uploadPhoto,
        id: "POST /api/v1/me/photo-optional",
        operationId: "postApiV1MePhotoOptional",
        label: "Upload an optional profile photo",
        path: "/api/v1/me/photo-optional",
        risk: "safe",
        requestBody: {
          ...uploadPhoto.requestBody!,
          required: false,
          fields: [{
            name: "photo",
            label: "Photo",
            required: false,
            accept: "",
            description: "",
          }],
        },
      }],
    };

    await renderPlayground({
      manifest: optionalMultipartManifest,
      canonicalUrl: "https://spoonjoy.app/api/playground",
      ogImageUrl: "https://spoonjoy.app/og/pages/api-playground.png",
      viewer: { isAuthenticated: false },
    } as PlaygroundLoaderData);

    const optionalInput = await screen.findByLabelText(/Photo/) as HTMLInputElement;
    expect(optionalInput).not.toHaveAttribute("accept");
    expect(optionalInput).not.toBeRequired();
    expect(optionalInput).toHaveAttribute("aria-required", "false");
    expect(optionalInput).toHaveAccessibleDescription("multipart optional");

    fireEvent.change(optionalInput, { target: { files: null } });
    expect(screen.queryByText("Select photo before sending.")).not.toBeInTheDocument();
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
    fireEvent.submit(screen.getByRole("button", { name: "Send Request" }).closest("form")!);

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

  it("covers generated OAuth, mutation id, example body, and secret-response playground controls", async () => {
    const fetchMock = vi.fn(async () => mockApiResponse({
      ok: true,
      data: {
        token: "sj_secret_token_value",
        refresh_token: "ort_refresh_token_value",
      },
    }, { status: 201, statusText: "Created" }));
    vi.stubGlobal("fetch", fetchMock);

    await renderPlayground();

    fireEvent.click(await screen.findByRole("button", { name: /Redirect the chef through OAuth consent/i }));
    fireEvent.change(document.querySelector<HTMLInputElement>("#param-query-client_id")!, { target: { value: "cm_e2e_client" } });
    fireEvent.change(document.querySelector<HTMLInputElement>("#param-query-redirect_uri")!, { target: { value: "https://client.example/callback" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate PKCE + state" }));

    const bundle = await screen.findByLabelText("PKCE and state bundle");
    await waitFor(() => expect(bundle.textContent).toContain("code_verifier="));
    const codeVerifier = bundle.textContent?.match(/code_verifier=(.+)\n/)?.[1] ?? "";
    const state = bundle.textContent?.match(/state=(.+)\n/)?.[1] ?? "";
    const codeChallenge = bundle.textContent?.match(/code_challenge=(.+)$/)?.[1] ?? "";
    window.sessionStorage.setItem("spoonjoy.playground.pkce", JSON.stringify({
      code_verifier: codeVerifier,
      state,
      code_challenge: codeChallenge,
      client_id: "cm_e2e_client",
      redirect_uri: "https://client.example/callback",
    }));
    expect(state).toMatch(/^state_/);

    const callbackInput = screen.getByLabelText("OAuth callback URL");
    fireEvent.change(callbackInput, { target: { value: "http://%" } });
    await waitFor(() => expect(callbackInput).toHaveValue("http://%"));
    fireEvent.click(screen.getByRole("button", { name: "Prepare token exchange" }));
    expect(await screen.findByText("Callback URL is not a valid URL or query string.")).toBeInTheDocument();

    fireEvent.change(callbackInput, { target: { value: `?code=oac_123&state=${state}` } });
    await waitFor(() => expect(callbackInput).toHaveValue(`?code=oac_123&state=${state}`));
    fireEvent.click(screen.getByRole("button", { name: "Prepare token exchange" }));
    expect(await screen.findByRole("button", { name: /Exchange or refresh an OAuth token/i })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect((screen.getByLabelText("Form body") as HTMLTextAreaElement).value).toContain(
      "grant_type=authorization_code",
    ));

    fireEvent.click(screen.getByRole("button", { name: "Refresh Token" }));
    expect((screen.getByLabelText("Form body") as HTMLTextAreaElement).value).toContain("grant_type=refresh_token");

    fireEvent.click(screen.getByRole("button", { name: /Set a shopping-list item checked state/i }));
    fireEvent.change(document.querySelector<HTMLInputElement>("#param-path-itemId")!, { target: { value: "item_1" } });
    const checkBody = screen.getByLabelText("JSON body");
    fireEvent.click(screen.getByRole("button", { name: "Fresh mutation id" }));
    expect((checkBody as HTMLTextAreaElement).value).toContain("patchApiV1ShoppingListItem:");

    fireEvent.click(screen.getByRole("button", { name: /Remove a shopping-list item/i }));
    fireEvent.change(document.querySelector<HTMLInputElement>("#param-path-itemId")!, { target: { value: "item_1" } });
    const deleteBody = screen.getByLabelText("JSON body");
    expect((deleteBody as HTMLTextAreaElement).value).toContain("\"clientMutationId\": \"device-uuid-3\"");
    expect(document.querySelector<HTMLInputElement>("#param-header-X-Client-Mutation-Id")).toBeInTheDocument();
    expect(document.querySelector<HTMLInputElement>("#param-query-clientMutationId")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Revoke a bearer credential/i }));
    expect(screen.getByText(/A bearer credential may revoke its own credential id/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Create a bearer credential/i }));
    fireEvent.change(screen.getByLabelText("JSON body"), { target: { value: "{\"name\":\"Client\"}" } });
    fireEvent.click(screen.getByLabelText(/I understand this request can change real Spoonjoy data/i));
    fireEvent.click(screen.getByRole("button", { name: "Send Request" }));

    expect(await screen.findByText("Secret values hidden in response body")).toBeInTheDocument();
    expect(screen.getByLabelText("Response body")).toHaveTextContent("sj_...redacted");
    fireEvent.click(screen.getByRole("button", { name: "Clear response" }));
    expect(screen.getByLabelText("Response body")).toHaveTextContent("No response yet.");
  }, 10000);

  it("renders portable curl for bearer mode and body requests", () => {
    const root = PLAYGROUND_OPERATIONS.find((operation) => operation.id === "GET /api/v1")!;
    const createToken = PLAYGROUND_OPERATIONS.find((operation) => operation.id === "POST /api/v1/tokens")!;
    const authorize = PLAYGROUND_OPERATIONS.find((operation) => operation.id === "GET /oauth/authorize")!;
    const deleteItem = PLAYGROUND_OPERATIONS.find((operation) => operation.id === "DELETE /api/v1/shopping-list/items/{itemId}")!;
    const uploadPhoto = PLAYGROUND_OPERATIONS.find((operation) => operation.id === "POST /api/v1/me/photo")!;

    expect(curlFor("/api/v1", root, "session", "")).toContain("Session mode is browser-only");
    expect(curlFor("/api/v1", root, "session", "")).toContain("await fetch(\"/api/v1\"");
    expect(curlFor("/api/v1", root, "anonymous", "")).toBe(
      "curl 'https://spoonjoy.app/api/v1' \\\n  -H 'X-Request-Id: pg_example'",
    );
    expect(curlFor("/api/v1/tokens", createToken, "session", "{\"name\":\"Client\"}")).toBe(
      "// Session mode is browser-only: run from a signed-in Spoonjoy page.\nawait fetch(\"/api/v1/tokens\", {\n  method: \"POST\",\n  credentials: \"same-origin\",\n  headers: {\n    \"Content-Type\": \"application/json\",\n  },\n  body: \"{\\\"name\\\":\\\"Client\\\"}\",\n});",
    );
    expect(curlFor("/api/v1", root, "session", "manual body")).toContain("\"Content-Type\": \"application/json\"");
    expect(curlFor("/api/v1", root, "anonymous", "manual body")).toContain("-H 'Content-Type: application/json'");
    expect(curlFor("/api/v1/tokens", createToken, "bearer", "{\"name\":\"Client\"}")).toContain(
      "-H 'Authorization: Bearer $SPOONJOY_TOKEN'",
    );
    expect(curlFor("/api/v1/tokens", createToken, "bearer", "{\"name\":\"Client\"}")).toContain(
      "--data '{\"name\":\"Client\"}'",
    );
    expect(curlFor("/api/v1/me/photo", uploadPhoto, "bearer", "")).toContain("-F 'photo=@profile.jpg;type=image/jpeg'");
    expect(curlFor("/api/v1/me/photo", uploadPhoto, "bearer", "")).not.toContain("Content-Type");
    expect(curlFor("/api/v1/me/photo", uploadPhoto, "session", "")).toContain("const body = new FormData();");
    expect(curlFor("/api/v1/me/photo", uploadPhoto, "session", "", "https://spoonjoy.app", { "X-Request-Id": "req_photo" }))
      .toContain("\"X-Request-Id\": \"req_photo\"");
    const multipartWithoutFields = {
      ...uploadPhoto,
      requestBody: { ...uploadPhoto.requestBody!, fields: [] },
    };
    expect(curlFor("/api/v1/me/photo", multipartWithoutFields, "session", "")).toContain("body.append(\"file\", fileInput.files[0]);");
    expect(curlFor("/api/v1/me/photo", multipartWithoutFields, "bearer", "")).toContain("-F 'file=@profile.jpg;type=application/octet-stream'");
    expect(curlFor("/oauth/authorize?client_id=cm_1", authorize, "anonymous", "")).toContain(
      "open 'https://spoonjoy.app/oauth/authorize?client_id=cm_1'",
    );
    expect(curlFor(
      "/api/v1/shopping-list/items/item_1",
      deleteItem,
      "session",
      "",
      "https://preview.spoonjoy.test/",
      { itemId: "item_1", "X-Client-Mutation-Id": "delete:item_1:test" },
    )).toContain("\"X-Client-Mutation-Id\": \"delete:item_1:test\"");
    expect(curlFor(
      "/api/v1/shopping-list/items/item_1",
      deleteItem,
      "bearer",
      "",
      "https://preview.spoonjoy.test/",
      { itemId: "item_1", "X-Client-Mutation-Id": "delete:item_1:test" },
    )).toContain("-H 'X-Client-Mutation-Id: delete:item_1:test'");
  });

  it("redacts token-bearing responses while preserving explicit copyable secrets", async () => {
    const response = await playgroundResponseFromFetchResult(new Response(JSON.stringify({
      ok: true,
      data: {
        token: "sj_secret_token_value",
        refresh_token: "ort_refresh_token_value",
        nested: { deviceCode: "sjdc_device_code_value" },
        tokens: ["sj_array_token_value"],
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Request-Id": "req_secret" },
    }), {}, { maskSecrets: true });

    expect(response.body).toContain("sj_...redacted");
    expect(response.body).toContain("ort_...redacted");
    expect(response.body).toContain("sjdc_...redacted");
    expect(response.body).not.toContain("sj_secret_token_value");
    expect(response.body).not.toContain("sj_array_token_value");
    expect(response.secrets).toEqual([
      { label: "token", value: "sj_secret_token_value" },
      { label: "refresh token", value: "ort_refresh_token_value" },
      { label: "device code", value: "sjdc_device_code_value" },
      { label: "token", value: "sj_array_token_value" },
    ]);

    const duplicate = await playgroundResponseFromFetchResult(new Response("sj_duplicate_token sj_duplicate_token", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    }), {}, { maskSecrets: true });
    expect(duplicate.body).toBe("sj_...redacted sj_...redacted");
    expect(duplicate.secrets).toEqual([{ label: "secret", value: "sj_duplicate_token" }]);
  });

  it("masks token-like plain text responses", async () => {
    const response = await playgroundResponseFromFetchResult(new Response("token sj_text_token", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    }), {}, { maskSecrets: true });

    expect(response.body).toBe("token sj_...redacted");
    expect(response.secrets).toEqual([{ label: "secret", value: "sj_text_token" }]);
  });

  it("copies generated playground values and reports clipboard failures", async () => {
    const writeText = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("clipboard denied"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await renderPlayground();

    fireEvent.click(await screen.findByRole("button", { name: "Copy import URL" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("http://localhost:3000/api/v1/openapi.json"));
    expect(await screen.findByText("Copied Copy import URL")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy path" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Could not copy Copy path")).toBeInTheDocument();
    await new Promise((resolve) => window.setTimeout(resolve, 1700));
    expect(screen.queryByText("Could not copy Copy path")).not.toBeInTheDocument();
  });

  it("supports keyboard roving for surface and auth mode radio groups", async () => {
    await renderPlayground();

    const allApis = await screen.findByRole("radio", { name: "All APIs" });
    fireEvent.keyDown(allApis, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByRole("radio", { name: "Connector" })).toHaveFocus());
    expect(screen.getByRole("radio", { name: "Connector" })).toHaveAttribute("aria-checked", "true");

    fireEvent.keyDown(screen.getByRole("radio", { name: "Connector" }), { key: "End" });
    await waitFor(() => expect(screen.getByRole("radio", { name: "SDK" })).toHaveFocus());
    expect(screen.getByRole("radio", { name: "SDK" })).toHaveAttribute("aria-checked", "true");

    fireEvent.keyDown(screen.getByRole("radio", { name: "SDK" }), { key: "Home" });
    await waitFor(() => expect(screen.getByRole("radio", { name: "All APIs" })).toHaveFocus());
    fireEvent.keyDown(screen.getByRole("radio", { name: "All APIs" }), { key: "Escape" });
    expect(screen.getByRole("radio", { name: "All APIs" })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("button", { name: /Search public recipes/i }));
    const anonymous = screen.getByRole("radio", { name: "Anonymous" });
    fireEvent.keyDown(anonymous, { key: "ArrowLeft" });
    await waitFor(() => expect(screen.getByRole("radio", { name: "Bearer" })).toHaveFocus());
    expect(screen.getByRole("radio", { name: "Bearer" })).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(screen.getByRole("radio", { name: "Bearer" }), { key: "Enter" });
    expect(screen.getByRole("radio", { name: "Bearer" })).toHaveAttribute("aria-checked", "true");
  });

  it("handles OAuth callback validation failures and redirect submissions", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    await renderPlayground();
    fireEvent.click(await screen.findByRole("button", { name: /Redirect the chef through OAuth consent/i }));

    const callbackInput = screen.getByLabelText("OAuth callback URL");
    fireEvent.change(document.querySelector<HTMLInputElement>("#param-query-client_id")!, { target: { value: "cm_without_pkce" } });
    fireEvent.change(document.querySelector<HTMLInputElement>("#param-query-redirect_uri")!, { target: { value: "https://client.example/callback" } });
    fireEvent.change(document.querySelector<HTMLInputElement>("#param-query-state")!, { target: { value: "state_without_pkce" } });
    fireEvent.change(document.querySelector<HTMLInputElement>("#param-query-code_challenge")!, { target: { value: "challenge_without_pkce" } });
    const riskCheckbox = screen.getByLabelText(/I understand this request can change real Spoonjoy data/i);
    fireEvent.click(riskCheckbox);
    fireEvent.click(screen.getByRole("button", { name: "Open authorization URL" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith(
      expect.stringContaining("/oauth/authorize?"),
      "_blank",
      "noopener,noreferrer",
    ));
    open.mockClear();
    fireEvent.click(riskCheckbox);

    fireEvent.change(callbackInput, { target: { value: "?state=state_missing_code" } });
    fireEvent.click(screen.getByRole("button", { name: "Prepare token exchange" }));
    expect(await screen.findByText("Callback URL is missing code.")).toBeInTheDocument();

    fireEvent.change(callbackInput, { target: { value: "?code=oac_123&state=wrong_state" } });
    fireEvent.click(screen.getByRole("button", { name: "Prepare token exchange" }));
    expect(await screen.findByText("Callback state does not match the stored PKCE state.")).toBeInTheDocument();

    window.sessionStorage.setItem("spoonjoy.playground.pkce", JSON.stringify({
      state: "state_ok",
      code_verifier: "",
      client_id: "cm_client",
      redirect_uri: "https://client.example/callback",
    }));
    fireEvent.change(callbackInput, { target: { value: "?code=oac_123&state=state_ok" } });
    fireEvent.click(screen.getByRole("button", { name: "Prepare token exchange" }));
    expect(await screen.findByText("Missing code_verifier, client_id, or redirect_uri. Generate PKCE and fill the authorize fields first.")).toBeInTheDocument();

    fireEvent.change(document.querySelector<HTMLInputElement>("#param-query-client_id")!, { target: { value: "cm_client" } });
    fireEvent.change(document.querySelector<HTMLInputElement>("#param-query-redirect_uri")!, { target: { value: "https://client.example/callback" } });
    fireEvent.change(document.querySelector<HTMLInputElement>("#param-query-state")!, { target: { value: "state_redirect" } });
    fireEvent.change(document.querySelector<HTMLInputElement>("#param-query-code_challenge")!, { target: { value: "challenge_redirect" } });
    window.sessionStorage.removeItem("spoonjoy.playground.pkce");
    fireEvent.click(screen.getByRole("button", { name: "Generate PKCE + state" }));
    await screen.findByLabelText("PKCE and state bundle");
    fireEvent.click(screen.getByLabelText(/I understand this request can change real Spoonjoy data/i));
    fireEvent.click(screen.getByRole("button", { name: "Open authorization URL" }));

    await waitFor(() => expect(open).toHaveBeenCalledWith(
      expect.stringContaining("/oauth/authorize?"),
      "_blank",
      "noopener,noreferrer",
    ));
    expect(window.sessionStorage.getItem("spoonjoy.playground.pkce")).toContain("code_verifier");

    const bundle = screen.getByLabelText("PKCE and state bundle");
    await waitFor(() => expect(bundle.textContent).not.toContain("state_redirect"));
    const state = bundle.textContent?.match(/state=(.+)\n/)?.[1] ?? "";
    window.sessionStorage.removeItem("spoonjoy.playground.pkce");
    fireEvent.change(callbackInput, {
      target: { value: `https://client.example/callback?code=oac_456&state=${state}` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Prepare token exchange" }));
    expect(await screen.findByRole("button", { name: /Exchange or refresh an OAuth token/i })).toHaveAttribute("aria-pressed", "true");
    expect((screen.getByLabelText("Form body") as HTMLTextAreaElement).value).toContain("code=oac_456");
  });

  it("reports when a custom manifest omits the OAuth token operation", async () => {
    const manifestWithoutToken = {
      ...API_V1_PLAYGROUND_MANIFEST,
      operations: API_V1_PLAYGROUND_MANIFEST.operations.filter((operation) => operation.id !== "POST /oauth/token"),
    };
    await renderPlayground({
      manifest: manifestWithoutToken,
      canonicalUrl: "https://spoonjoy.app/api/playground",
      ogImageUrl: "https://spoonjoy.app/og/pages/api-playground.png",
      viewer: { isAuthenticated: false },
    } as PlaygroundLoaderData);

    fireEvent.click(await screen.findByRole("button", { name: /Redirect the chef through OAuth consent/i }));
    window.sessionStorage.setItem("spoonjoy.playground.pkce", JSON.stringify({
      state: "state_ok",
      code_verifier: "verifier_ok",
      client_id: "cm_client",
      redirect_uri: "https://client.example/callback",
    }));
    fireEvent.change(screen.getByLabelText("OAuth callback URL"), {
      target: { value: "?code=oac_123&state=state_ok" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Prepare token exchange" }));

    expect(await screen.findByText("OAuth token operation is not available in this playground manifest.")).toBeInTheDocument();
  });

  it("switches from bearer mode to token creation with session auth", async () => {
    await renderPlayground();

    fireEvent.click(await screen.findByRole("button", { name: /Read the authenticated shopping list/i }));
    fireEvent.click(screen.getByRole("radio", { name: "Bearer" }));
    fireEvent.click(screen.getByRole("button", { name: "Create a token with Session auth" }));

    expect(await screen.findByRole("button", { name: /Create a bearer credential/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("radio", { name: "Session" })).toHaveAttribute("aria-checked", "true");
    expect((screen.getByLabelText("JSON body") as HTMLTextAreaElement).value).toContain("scopes");
  });

  it("recovers from invalid JSON when generating body mutation ids", async () => {
    await renderPlayground();

    fireEvent.click(await screen.findByRole("button", { name: /Set a shopping-list item checked state/i }));
    fireEvent.change(document.querySelector<HTMLInputElement>("#param-path-itemId")!, { target: { value: "item_1" } });
    fireEvent.change(screen.getByLabelText("JSON body"), { target: { value: "{bad json" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Fresh mutation id" })[0]);

    expect((screen.getByLabelText("JSON body") as HTMLTextAreaElement).value).toContain("clientMutationId");
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
      elapsedMs: 0,
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
      elapsedMs: 0,
    });
  });

  it("formats Error network failures", () => {
    expect(playgroundNetworkError(new Error("offline"))).toEqual({
      status: 0,
      statusText: "NETWORK ERROR",
      requestId: null,
      headers: [],
      body: "offline",
      elapsedMs: 0,
    });
  });

  it("formats non-Error network failures", () => {
    expect(playgroundNetworkError("offline")).toEqual({
      status: 0,
      statusText: "NETWORK ERROR",
      requestId: null,
      headers: [],
      body: "Request failed",
      elapsedMs: 0,
    });
  });
});
