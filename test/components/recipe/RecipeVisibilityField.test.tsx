import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RecipeVisibilityField } from "~/components/recipe/RecipeVisibilityField";

describe("RecipeVisibilityField", () => {
  it("offers public, household and only me, and answers the level the cook picks", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RecipeVisibilityField value="household" onChange={onChange} />);

    const group = screen.getByRole("radiogroup", { name: "Who can see this recipe" });
    expect(group.textContent).toMatch(/Public.*Household.*Only me/s);
    expect(screen.getByRole("radio", { name: /^Household/ })).toBeChecked();
    expect(group).toBeEnabled();
    await user.click(screen.getByRole("radio", { name: /^Public/ }));
    expect(onChange).toHaveBeenLastCalledWith("public");
  });

  it("answers private when the cook picks Only me", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RecipeVisibilityField value="public" onChange={onChange} />);

    await user.click(screen.getByRole("radio", { name: /^Only me/ }));
    expect(onChange).toHaveBeenLastCalledWith("private");
  });
});
