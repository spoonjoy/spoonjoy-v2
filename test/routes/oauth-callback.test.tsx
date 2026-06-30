import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createTestRoutesStub } from "../utils";
import OAuthCallback, { loader, meta } from "~/routes/oauth.callback";

describe("oauth.callback route", () => {
  it("strips OAuth query values before rendering the fallback", () => {
    const response = loader({
      request: new Request("https://spoonjoy.app/oauth/callback?code=oac_secret&state=state_secret"),
      params: {},
      context: { cloudflare: { env: null } },
    } as never);

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/oauth/callback");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Location")).not.toContain("oac_secret");
    expect(response.headers.get("Location")).not.toContain("state_secret");
  });

  it("marks clean callback fallback responses as private and no-store", () => {
    const response = loader({
      request: new Request("https://spoonjoy.app/oauth/callback"),
      params: {},
      context: { cloudflare: { env: null } },
    } as never);

    expect(response).toHaveProperty("type", "DataWithResponseInit");
    expect(response.init?.headers).toMatchObject({
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    });
  });

  it("publishes noindex metadata for callback URLs", () => {
    expect(meta({} as never)).toEqual([
      { title: "Spoonjoy Apple Callback | Spoonjoy" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
      { name: "description", content: "Secure Spoonjoy Apple OAuth callback." },
    ]);
  });

  it("renders a safe fallback without exposing OAuth query values", async () => {
    const Stub = createTestRoutesStub([
      { path: "/oauth/callback", Component: OAuthCallback, loader },
    ]);
    const { container } = render(
      <Stub initialEntries={["/oauth/callback?code=oac_secret&state=state_secret"]} />,
    );

    expect(await screen.findByRole("heading", { name: "Continue in Spoonjoy" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open spoonjoy/i })).toHaveAttribute("href", "/");
    expect(container.textContent).not.toContain("oac_secret");
    expect(container.textContent).not.toContain("state_secret");
  });
});
