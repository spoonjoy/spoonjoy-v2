import { afterEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { useLocation } from "react-router";
import { createTestRoutesStub } from "../utils";
import { useRedirectToWithHash } from "~/hooks/use-redirect-hash";

function Probe() {
  const redirectTo = useRedirectToWithHash();
  const location = useLocation();
  return (
    <>
      <p data-testid="redirect">{redirectTo ?? "none"}</p>
      <p data-testid="search">{location.search}</p>
    </>
  );
}

function renderAt(entry: string, hash: string) {
  window.history.replaceState(null, "", `/login${hash}`);
  const Stub = createTestRoutesStub([{ path: "/login", Component: Probe }]);
  render(<Stub initialEntries={[entry]} />);
}

afterEach(() => window.history.replaceState(null, "", "/"));

describe("useRedirectToWithHash", () => {
  it("moves the page fragment into redirectTo", async () => {
    renderAt("/login?redirectTo=%2Faccount%2Fsettings&x=1", "#delete-account");
    await waitFor(() => expect(screen.getByTestId("redirect")).toHaveTextContent("/account/settings#delete-account"));
    expect(new URLSearchParams(screen.getByTestId("search").textContent!).get("x")).toBe("1");
  });

  it.each([
    ["without a fragment", "/login?redirectTo=%2Fa", "", "/a"],
    ["with a fragment already", "/login?redirectTo=%2Fb%23top", "#other", "/b#top"],
    ["without a redirect", "/login", "#other", "none"],
  ])("leaves redirectTo alone %s", async (_case, entry, hash, expected) => {
    renderAt(entry, hash);
    expect(await screen.findByTestId("redirect")).toHaveTextContent(expected);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByTestId("redirect")).toHaveTextContent(expected);
  });
});
