import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createTestRoutesStub } from "../../utils";
import { ForkRecipeButton } from "../../../app/components/recipe/ForkRecipeButton";

function renderButton(props?: Partial<React.ComponentProps<typeof ForkRecipeButton>>) {
  const Stub = createTestRoutesStub([
    {
      path: "/",
      Component: () => (
        <ForkRecipeButton
          recipeId="recipe-1"
          recipeTitle="Pasta"
          sourceChefUsername="alice"
          isOwner={false}
          {...props}
        />
      ),
    },
    {
      path: "/recipes/:id/fork",
      action: vi.fn(async () => null),
    },
  ]);
  return render(<Stub />);
}

describe("ForkRecipeButton", () => {
  it("renders the 'Fork' label when viewer is not the owner", async () => {
    renderButton({ isOwner: false });
    expect(
      await screen.findByRole("button", { name: /^fork$/i }),
    ).toBeInTheDocument();
  });

  it("renders the 'Make a variation' label when viewer is the owner", async () => {
    renderButton({ isOwner: true });
    expect(
      await screen.findByRole("button", { name: /make a variation/i }),
    ).toBeInTheDocument();
  });

  it("can render as an unchromed text trigger for recipe masthead actions", async () => {
    renderButton({
      triggerClassName: "masthead-action",
      triggerStyle: "text",
      triggerTestId: "recipe-header-fork-action",
    });

    const trigger = await screen.findByTestId("recipe-header-fork-action");
    expect(trigger).toHaveClass("masthead-action");
    expect(trigger).toHaveAccessibleName("Fork");
  });

  it("opens the dialog from the unchromed text trigger", async () => {
    renderButton({
      triggerStyle: "text",
      triggerTestId: "recipe-header-fork-action",
    });

    await userEvent.click(await screen.findByTestId("recipe-header-fork-action"));

    expect(await screen.findByRole("dialog")).toHaveTextContent("Fork");
  });

  it("opens the dialog with chef username and recipe title in the body when not owner", async () => {
    renderButton({ isOwner: false, recipeTitle: "Pasta", sourceChefUsername: "alice" });
    await userEvent.click(await screen.findByRole("button", { name: /^fork$/i }));
    const pastaMatches = await screen.findAllByText(/Pasta/);
    expect(pastaMatches.length).toBeGreaterThan(0);
    expect(screen.getByText(/alice/)).toBeInTheDocument();
  });

  it("opens a variation-oriented dialog body when the viewer is the owner", async () => {
    renderButton({ isOwner: true, recipeTitle: "Pasta" });
    await userEvent.click(
      await screen.findByRole("button", { name: /make a variation/i }),
    );
    const matches = await screen.findAllByText(/variation of/i);
    expect(matches.length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Pasta/i).length).toBeGreaterThan(0);
  });

  it("closes the dialog when Cancel is clicked", async () => {
    renderButton({ isOwner: false });
    await userEvent.click(await screen.findByRole("button", { name: /^fork$/i }));
    const cancel = await screen.findByRole("button", { name: /cancel/i });
    await userEvent.click(cancel);
    // Dialog body text ("Fork '<title>' by ...") should no longer be in the document.
    expect(screen.queryByText(/by alice/i)).toBeNull();
  });

  it("renders a Form posting to /recipes/<id>/fork with method=post inside the dialog", async () => {
    renderButton({ isOwner: false, recipeId: "abc-123" });
    await userEvent.click(await screen.findByRole("button", { name: /^fork$/i }));
    // Submit button is inside the dialog form. Use it to walk up to the form element.
    const submit = await screen.findByRole("button", { name: /^fork$/i });
    // The first "fork" button is the trigger; find the submit button by type attribute.
    const submitInForm = document.querySelector("form button[type='submit']");
    expect(submitInForm).not.toBeNull();
    const form = submitInForm!.closest("form") as HTMLFormElement | null;
    expect(form).not.toBeNull();
    expect(form!.getAttribute("action")).toBe("/recipes/abc-123/fork");
    expect(form!.getAttribute("method")?.toLowerCase()).toBe("post");
    // The trigger button is referenced to satisfy lint-style usage.
    expect(submit).toBeDefined();
  });

  it("uses the 'Make variation' submit label when viewer is the owner", async () => {
    renderButton({ isOwner: true });
    await userEvent.click(
      await screen.findByRole("button", { name: /make a variation/i }),
    );
    const submit = await screen.findByRole("button", { name: /make variation/i });
    expect(submit).toBeInTheDocument();
    expect(submit.getAttribute("type")).toBe("submit");
  });
});
