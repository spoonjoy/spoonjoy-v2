import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTestRoutesStub } from "../../utils";
import { ReportOrBlockButton } from "~/components/moderation/ReportOrBlockButton";

const toast = vi.hoisted(() => vi.fn());
vi.mock("~/lib/ouro/toast", () => ({ toast }));

function renderButton(act: (fields: Record<string, FormDataEntryValue>) => Promise<unknown>) {
  const Stub = createTestRoutesStub([
    {
      path: "/recipes/r1",
      Component: () => (
        <ReportOrBlockButton targetType="recipe" targetId="r1" chefId="c1" chefUsername="loud_chef" targetLabel="this recipe" triggerTestId="report" />
      ),
    },
    { path: "/moderation", action: async ({ request }: { request: Request }) => act(Object.fromEntries(await request.formData())) },
  ]);
  render(<Stub initialEntries={["/recipes/r1"]} />);
}

describe("ReportOrBlockButton", () => {
  it("reports the content with a reason and details, then thanks the chef", async () => {
    const user = userEvent.setup();
    const act = vi.fn(async () => ({ intent: "report", success: true }));
    renderButton(act);

    await user.click(await screen.findByTestId("report"));
    expect(await screen.findByRole("dialog", { name: "Report this recipe" })).toBeInTheDocument();
    const send = screen.getByRole("button", { name: "Send report" });
    expect(send).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: "Spam" }));
    await user.type(screen.getByLabelText("Anything else (optional)"), "ads");
    await user.click(send);

    await waitFor(() =>
      expect(act).toHaveBeenCalledWith({ intent: "report", targetType: "recipe", targetId: "r1", reason: "spam", details: "ads" }),
    );
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/^Thanks\./), { tone: "success" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("blocks the chef", async () => {
    const user = userEvent.setup();
    const act = vi.fn(async () => ({ intent: "block", success: true }));
    renderButton(act);

    await user.click(await screen.findByRole("button", { name: "Report" }));
    await user.click(await screen.findByRole("button", { name: "Block @loud_chef" }));
    await waitFor(() => expect(act).toHaveBeenCalledWith({ intent: "block", chefId: "c1" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining("You blocked @loud_chef"), { tone: "success" }));
  });

  it("shows the server's error, or a generic one", async () => {
    const user = userEvent.setup();
    const act = vi.fn()
      .mockResolvedValueOnce({ intent: "block", success: false, error: "You can't block yourself." })
      .mockResolvedValueOnce({ intent: "block", success: false });
    renderButton(act);

    await user.click(await screen.findByRole("button", { name: "Report" }));
    await user.click(await screen.findByRole("button", { name: "Block @loud_chef" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You can't block yourself.");
    await user.click(screen.getByRole("button", { name: "Block @loud_chef" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong. Try again."));
  });
});
