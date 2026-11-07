import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import * as page from "~/components/cookbook/page";

describe("cookbook page layout", () => {
  it("keeps the cookbook layout around its own content", () => {
    const { container } = render(
      <page.CookbookPage className="custom-page">
        <h2>Recipes</h2>
        <p>One dish from this kitchen.</p>
      </page.CookbookPage>,
    );

    expect(container.firstElementChild).toHaveClass("sj-page", "custom-page");
    expect(container.firstElementChild?.firstElementChild).toHaveClass("sj-page-frame");
    expect(screen.getByRole("heading", { name: "Recipes" })).toBeInTheDocument();
    expect(screen.getByText("One dish from this kitchen.")).toBeInTheDocument();
  });

  it.each(["CookbookSectionTitle", "RuledEmptyState", "SettingsPanel"])("does not own the shared %s presentation primitive", (name) => {
    expect(page).not.toHaveProperty(name);
  });
});
