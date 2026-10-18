import { act, type ComponentType, type ReactElement } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import DeveloperPlayground, { loader as playgroundLoader } from "~/routes/developers.playground";
import OAuthCallback from "~/routes/oauth.callback";
import { createTestRoutesStub } from "../utils";

vi.mock("@posthog/react", () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}));

// The page is served from an origin that is neither the production fallback
// nor happy-dom's own location, so any render that reads `window` disagrees.
const SERVED_ORIGIN = "https://qa.spoonjoy.test";

function routeTree(id: string, path: string, Component: ComponentType, loaderData: unknown): () => ReactElement {
  return () => {
    const Stub = createTestRoutesStub([{ id, path, Component, loader: () => loaderData }]);
    return <Stub initialEntries={[path]} hydrationData={{ loaderData: { [id]: loaderData } }} />;
  };
}

// renderToString runs where the Worker runs: there is no `window`.
function renderOnServer(tree: () => ReactElement) {
  vi.stubGlobal("window", undefined);
  try {
    return renderToString(tree());
  } finally {
    vi.unstubAllGlobals();
  }
}

describe("server and client render the same markup", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  async function hydrate(tree: () => ReactElement) {
    container = document.createElement("div");
    container.innerHTML = renderOnServer(tree);
    document.body.appendChild(container);
    const serverHtml = container.innerHTML;

    const recoverableErrors: unknown[] = [];
    await act(async () => {
      root = hydrateRoot(container!, tree(), {
        onRecoverableError: (error) => {
          recoverableErrors.push(error);
        },
      });
    });
    return { container, serverHtml, recoverableErrors };
  }

  it("hydrates /developers/playground signed out without a mismatch", async () => {
    const data = await playgroundLoader({
      request: new Request(`${SERVED_ORIGIN}/developers/playground`),
      context: { cloudflare: { env: null } },
    });
    const { container, serverHtml, recoverableErrors } = await hydrate(
      routeTree("developers-playground", "/developers/playground", DeveloperPlayground, data),
    );

    expect(recoverableErrors).toEqual([]);
    expect(serverHtml).toContain(`${SERVED_ORIGIN}/api/v1/openapi.json`);
    expect(container.textContent).toContain(`${SERVED_ORIGIN}/api/v1/openapi.json`);
  });

  it("hydrates /oauth/callback signed out without a mismatch", async () => {
    const { container, recoverableErrors } = await hydrate(
      routeTree("oauth-callback", "/oauth/callback", OAuthCallback, null),
    );

    expect(recoverableErrors).toEqual([]);
    expect(container.textContent).toContain("Continue in Spoonjoy");
  });
});
