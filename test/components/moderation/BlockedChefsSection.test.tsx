import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTestRoutesStub } from "../../utils";
import { BlockedChefsSection, type BlockedChefRow } from "~/components/moderation/BlockedChefsSection";

function renderSection(chefs: BlockedChefRow[], act = vi.fn(async () => ({ intent: "unblock", success: true }))) {
  const Stub = createTestRoutesStub([
    { path: "/account/settings", Component: () => <BlockedChefsSection chefs={chefs} /> },
    { path: "/moderation", action: async ({ request }: { request: Request }) => act(Object.fromEntries(await request.formData())) },
  ]);
  render(<Stub initialEntries={["/account/settings"]} />);
  return act;
}

describe("BlockedChefsSection", () => {
  it("explains how to block when nobody is blocked", async () => {
    renderSection([]);
    expect(await screen.findByRole("heading", { name: "Blocked chefs" })).toBeInTheDocument();
    expect(screen.getByText(/You haven't blocked anyone/)).toBeInTheDocument();
  });

  it("links each blocked chef and unblocks them", async () => {
    const user = userEvent.setup();
    const act = renderSection([{ id: "c1", username: "loud_chef" }]);
    expect(await screen.findByRole("link", { name: "@loud_chef" })).toHaveAttribute("href", "/users/loud_chef");
    await user.click(screen.getByRole("button", { name: "Unblock" }));
    await waitFor(() => expect(act).toHaveBeenCalledWith({ intent: "unblock", chefId: "c1" }));
  });
});
