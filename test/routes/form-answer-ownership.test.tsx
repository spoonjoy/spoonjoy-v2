import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Form as RouterForm, useActionData } from "react-router";
import { describe, expect, it } from "vitest";
import NewRecipe from "~/routes/recipes.new";
import NewStep from "~/routes/recipes.$id.steps.new";
import EditStep from "~/routes/recipes.$id.steps.$stepId.edit";
import AccountSettings from "~/routes/account.settings";
import { createTestRoutesStub } from "../utils";

function unrelatedForm() {
  return <RouterForm method="post"><input type="hidden" name="intent" value="unrelated" /><button>Other action</button></RouterForm>;
}

describe("form-local accepted Router answers", () => {
  it("keeps the profile answer across an unrelated account intent with overlapping fields", async () => {
    const loaderData = {
      user: { id: "u", email: "cook@example.com", username: "cook", hasPassword: true, oauthAccounts: [], photoUrl: null, passkeys: [] },
      notifications: { pushSubscribed: false },
    };
    function Page() {
      const answer = useActionData<{ intent: string }>();
      return <><AccountSettings />{unrelatedForm()}<output data-testid="accepted-intent">{answer?.intent}</output></>;
    }
    const Stub = createTestRoutesStub([{
      id: "account",
      path: "/account/settings",
      Component: Page,
      loader: () => loaderData,
      action: async ({ request }) => {
        const posted = await request.formData();
        return posted.get("intent") === "unrelated"
          ? { intent: "removePassword", success: false, fieldErrors: { currentPassword: "Another form refused" } }
          : { intent: "updateUserInfo", success: false, fieldErrors: { email: "Taken", currentPassword: "Check password" } };
      },
    }]);
    render(<Stub initialEntries={["/account/settings"]} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit", exact: true }));
    const email = screen.getByRole("textbox", { name: "Email", exact: true });
    await user.click(screen.getByRole("button", { name: "Save", exact: true }));
    await waitFor(() => expect(email).toHaveFocus());
    expect(email).toHaveAccessibleDescription("Taken");
    await user.type(email, ".changed");
    expect(email).not.toHaveAttribute("aria-invalid", "true");
    await user.click(screen.getByRole("button", { name: "Other action" }));
    await waitFor(() => expect(screen.getByTestId("accepted-intent")).toHaveTextContent("removePassword"));
    expect(screen.queryByText("Another form refused")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Other action" })).toHaveFocus();
    expect(email).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Check password")).toBeVisible();
  });
  it.each(["fast", "held"] as const)("restores equal %s recipe refusals after clearing, but not for unrelated route data", async (speed) => {
    let calls = 0;
    let release: (() => void) | undefined;
    const Stub = createTestRoutesStub([{
      id: "new",
      path: "/recipes/new",
      Component: () => <><NewRecipe />{unrelatedForm()}</>,
      loader: () => null,
      action: async ({ request }) => {
        const posted = await request.formData();
        if (posted.get("intent") === "unrelated") return { errors: { title: "Unrelated refusal" } };
        calls++;
        if (speed === "held" && calls === 2) await new Promise<void>((resolve) => { release = resolve; });
        return { errors: { title: "Taken", general: "Try again" } };
      },
    }]);
    render(<Stub initialEntries={["/recipes/new"]} />);
    const user = userEvent.setup();
    const title = await screen.findByRole("textbox", { name: "Title", exact: true });
    const save = screen.getByRole("button", { name: "Create recipe", exact: true });
    await user.type(title, "Taken recipe");
    await user.click(save);
    await waitFor(() => expect(title).toHaveAccessibleDescription("Taken"));
    expect(title).toHaveFocus();
    const firstAlert = screen.getByRole("alert");
    await user.type(title, " changed");
    expect(title).not.toHaveAttribute("aria-invalid", "true");
    await user.click(screen.getByRole("button", { name: "Other action" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Other action" })).toHaveFocus());
    expect(screen.queryByText("Unrelated refusal")).not.toBeInTheDocument();
    expect(title).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toBe(firstAlert);
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);
    if (speed === "held") {
      await waitFor(() => expect(release).toBeDefined());
      expect(title).not.toHaveAttribute("aria-invalid", "true");
      expect(screen.getByRole("alert")).toBe(firstAlert);
      await act(async () => release!());
    }
    await waitFor(() => expect(title).toHaveAccessibleDescription("Taken"));
    expect(title).toHaveFocus();
    expect(screen.getByRole("alert")).not.toBe(firstAlert);
    expect(calls).toBe(2);
  });

  it.each(["new", "edit"] as const)("does not attribute a different action to the %s step form", async (kind) => {
    const loaderData = {
      recipe: { id: "r", title: "Recipe" },
      nextStepNum: 1,
      step: { id: "s", stepNum: 1, stepTitle: "", description: "Cook", ingredients: [], usingSteps: [] },
      availableSteps: [],
    };
    const path = kind === "new" ? "/recipes/r/steps/new" : "/recipes/r/steps/s/edit";
    const Step = kind === "new" ? NewStep : EditStep;
    const Stub = createTestRoutesStub([{
      id: "step",
      path,
      Component: () => <><Step />{unrelatedForm()}</>,
      loader: () => loaderData,
      action: async ({ request }) => {
        const posted = await request.formData();
        return posted.get("intent") === "unrelated"
          ? { errors: { description: "Other form refused" } }
          : { errors: { description: "Refused", general: "Try again" } };
      },
    }]);
    render(<Stub initialEntries={[path]} />);
    const description = await screen.findByRole("textbox", { name: "Description", exact: true });
    if (kind === "new") fireEvent.change(description, { target: { value: "Cook" } });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: kind === "new" ? "Create" : "Update", exact: true }));
    await waitFor(() => expect(description).toHaveAccessibleDescription("Refused"));
    await user.type(description, " again");
    expect(description).not.toHaveAttribute("aria-invalid", "true");
    const alert = screen.getByRole("alert");
    await user.click(screen.getByRole("button", { name: "Other action" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Other action" })).toHaveFocus());
    expect(screen.queryByText("Other form refused")).not.toBeInTheDocument();
    expect(description).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toBe(alert);
  });
});
