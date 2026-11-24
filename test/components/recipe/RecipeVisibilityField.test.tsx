import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RecipeVisibilityField } from "~/components/recipe/RecipeVisibilityField";

describe("RecipeVisibilityField", () => {
  it("answers the level the cook picks, either way, and shows a household recipe as Only me", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RecipeVisibilityField value="household" onChange={onChange} />);

    const group = screen.getByRole("radiogroup", { name: "Who can see this recipe" });
    expect(screen.getByRole("radio", { name: /^Only me/ })).toBeChecked();
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
