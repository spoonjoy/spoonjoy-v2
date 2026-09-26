import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import Login from "~/routes/login";
import { createTestRoutesStub } from "../utils";

// Replace the passkey button with a probe that shows the identifier prop it
// receives, so the test can check what the button would sign in with.
vi.mock("~/components/auth/PasskeySignInButton", () => ({
  PasskeySignInButton: ({ identifier }: { identifier: string }) => (
    <p data-testid="passkey-identifier">{identifier}</p>
  ),
}));

const TYPED = "typed_before_hydration";

function loginTree() {
  const Stub = createTestRoutesStub([
    {
      id: "login",
      path: "/login",
      Component: Login,
      loader: () => ({ oauthProviders: [] }),
    },
  ]);
  return (
    <Stub
      initialEntries={["/login"]}
      hydrationData={{ loaderData: { login: { oauthProviders: [] } } }}
    />
  );
}

describe("Login hydration", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;

  beforeAll(() => {
    // hydrateRoot is driven with React's act() directly, outside Testing Library.
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    // Browsers reflect the `autofocus` attribute on <button>; happy-dom does
    // not, which makes React report a false hydration mismatch on the submit
    // button's autoFocus={false}. Mirror the browser behaviour.
    Object.defineProperty(HTMLButtonElement.prototype, "autofocus", {
      configurable: true,
      get(this: HTMLButtonElement) {
        return this.hasAttribute("autofocus");
      },
    });
  });

  afterAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    Reflect.deleteProperty(HTMLButtonElement.prototype, "autofocus");
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  it("keeps an identifier typed before hydration and hands it to the passkey button", async () => {
    // Server-rendered markup, as the browser shows it before the JS loads.
    container = document.createElement("div");
    container.innerHTML = renderToString(loginTree());
    document.body.appendChild(container);

    const identifierInput = container.querySelector<HTMLInputElement>("#identifier")!;
    const passwordInput = container.querySelector<HTMLInputElement>("#password")!;
    expect(identifierInput.value).toBe("");

    // The person types while the client bundle is still loading.
    identifierInput.value = TYPED;

    await act(async () => {
      root = hydrateRoot(container!, loginTree());
    });

    // React adopted the server input rather than replacing it.
    expect(container.querySelector("#identifier")).toBe(identifierInput);
    expect(identifierInput.value).toBe(TYPED);
    expect(container.querySelector('[data-testid="passkey-identifier"]')).toHaveTextContent(TYPED);

    // Moving focus re-renders the Headless UI input. A controlled input would
    // have its DOM value reset to React state here.
    await act(async () => {
      identifierInput.focus();
    });
    await act(async () => {
      passwordInput.focus();
    });

    expect(identifierInput.value).toBe(TYPED);
    expect(container.querySelector('[data-testid="passkey-identifier"]')).toHaveTextContent(TYPED);
  });
});
