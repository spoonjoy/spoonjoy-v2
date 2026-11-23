import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createRoutesStub } from "react-router";
import { RecipeVisibilityDefaultSection } from "~/components/account/RecipeVisibilityDefaultSection";

describe("RecipeVisibilityDefaultSection", () => {
  function setup(answer: { success: boolean; intent: string; message?: string }, choices?: Array<"public" | "household" | "private">) {
    const posted: Array<Record<string, string>> = [];
    const Stub = createRoutesStub([
      {
        path: "/account/settings",
        Component: () => <RecipeVisibilityDefaultSection value="public" choices={choices} />,
        action: async ({ request }) => {
          posted.push(Object.fromEntries((await request.formData()).entries()) as Record<string, string>);
          return answer;
        },
      },
    ]);
    render(<Stub initialEntries={["/account/settings"]} />);
    return posted;
  }

  it("saves the default the cook picks and says so", async () => {
    const user = userEvent.setup();
    const posted = setup({ success: true, intent: "setRecipeVisibilityDefault" });

    const group = await screen.findByRole("radiogroup", { name: "Who can see your new recipes" });
    expect(within(group).getByRole("radio", { name: /Public/ })).toBeChecked();
    await user.click(within(group).getByRole("radio", { name: /Only me/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Saved.");
    expect(posted).toEqual([{ intent: "setRecipeVisibilityDefault", visibility: "private" }]);
  });

  it("shows why a save was refused", async () => {
    const user = userEvent.setup();
    setup({ success: false, intent: "setRecipeVisibilityDefault", message: "Choose public or only me." });

    await user.click(await screen.findByRole("button", { name: "Save" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Choose public or only me.");
  });

  it("offers Household as the default only when it is a choice", async () => {
    const user = userEvent.setup();
    const posted = setup({ success: true, intent: "setRecipeVisibilityDefault" }, ["public", "household", "private"]);

    const group = await screen.findByRole("radiogroup", { name: "Who can see your new recipes" });
    await user.click(within(group).getByRole("radio", { name: /Household/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Saved.");
    expect(posted).toEqual([{ intent: "setRecipeVisibilityDefault", visibility: "household" }]);
  });

  it("leaves Household out when it is not a choice", async () => {
    setup({ success: true, intent: "setRecipeVisibilityDefault" });
    const group = await screen.findByRole("radiogroup", { name: "Who can see your new recipes" });
    expect(within(group).queryByRole("radio", { name: /Household/ })).toBeNull();
  });
});
