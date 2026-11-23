import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { createTestRoutesStub } from "../utils";
import AccountSettings from "~/routes/account.settings";

describe("Account settings - a self-hosted server's single sign-on", () => {
  it("shows the account's OpenID Connect link among the connected accounts", async () => {
    const loaderData = {
      user: {
        id: "u1",
        email: "owner@example.test",
        username: "owner",
        hasPassword: false,
        oauthAccounts: [{ provider: "oidc:https://auth.example.test/realms/kitchen", providerUsername: "owner-at-keycloak" }],
        photoUrl: null,
        passkeys: [],
      },
      notifications: { pushSubscribed: false, preferences: {} },
    };
    const Stub = createTestRoutesStub([{ path: "/account/settings", Component: AccountSettings, loader: () => loaderData }]);
    render(<Stub initialEntries={["/account/settings"]} />);

    const section = await screen.findByTestId("oauth-providers-section");
    const row = within(section).getByTestId("single-sign-on-account");
    expect(within(row).getByText("Single sign-on")).toBeInTheDocument();
    expect(within(row).getByText("owner-at-keycloak")).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Link Google" })).toBeInTheDocument();
  });
});
