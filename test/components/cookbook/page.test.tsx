import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  CookbookPage,
  CookbookSectionTitle,
  RuledEmptyState,
  SettingsPanel,
} from "~/components/cookbook/page";

describe("cookbook page primitives", () => {
  it("renders the page, section title, empty state, and settings panel branches", () => {
    const { container } = render(
      <CookbookPage className="custom-page">
        <CookbookSectionTitle className="custom-section">Recipes</CookbookSectionTitle>
        <RuledEmptyState title="Nothing here" action={<a href="/recipes/new">Start</a>}>
          Add the first dish.
        </RuledEmptyState>
        <RuledEmptyState title="Quiet shelf" />
        <SettingsPanel title="Preferences" action={<button type="button">Save</button>} testId="settings">
          <p>Notifications</p>
        </SettingsPanel>
        <SettingsPanel title="Plain settings">
          <p>No action</p>
        </SettingsPanel>
      </CookbookPage>,
    );

    expect(container.firstElementChild).toHaveClass("sj-page", "custom-page");
    expect(screen.getByRole("heading", { name: "Recipes" })).toHaveClass("custom-section");
    expect(screen.getByRole("heading", { name: "Nothing here" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start" })).toHaveAttribute("href", "/recipes/new");
    expect(screen.getByRole("heading", { name: "Quiet shelf" })).toBeInTheDocument();
    expect(screen.getByTestId("settings")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Preferences" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Plain settings" })).toBeInTheDocument();
  });
});
