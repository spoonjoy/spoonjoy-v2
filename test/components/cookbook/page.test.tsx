import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  CookbookHeader,
  CookbookPage,
  CookbookSectionTitle,
  FoodHero,
  ObjectRow,
  RuledEmptyState,
  SettingsPanel,
} from "~/components/cookbook/page";

describe("cookbook page primitives", () => {
  it("renders the page, header, section title, empty state, and settings panel branches", () => {
    const { container } = render(
      <CookbookPage className="custom-page">
        <CookbookHeader
          eyebrow="Kitchen"
          title="Sunday Book"
          action={<button type="button">Tune</button>}
        >
          <p>Private family recipes.</p>
        </CookbookHeader>
        <CookbookHeader eyebrow="Archive" title="Plain Book" />
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
    expect(screen.getByText("Kitchen")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sunday Book" })).toBeInTheDocument();
    expect(screen.getByText("Private family recipes.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tune" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Plain Book" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recipes" })).toHaveClass("custom-section");
    expect(screen.getByRole("heading", { name: "Nothing here" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start" })).toHaveAttribute("href", "/recipes/new");
    expect(screen.getByRole("heading", { name: "Quiet shelf" })).toBeInTheDocument();
    expect(screen.getByTestId("settings")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Preferences" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Plain settings" })).toBeInTheDocument();
  });

  it("renders linked and unlinked food heroes with and without images", () => {
    const { container } = render(
      <div>
        <FoodHero title="No-photo soup" className="hero-extra">
          <p>Still worth cooking.</p>
        </FoodHero>
        <FoodHero
          href="https://example.com/recipes/pasta"
          imageUrl="https://example.com/pasta.jpg"
          eyebrow="Pasta"
          title="Pasta night"
        />
      </div>,
    );

    expect(container.querySelector(".hero-extra")).toBeInTheDocument();
    expect(screen.getByText("No-photo soup")).toBeInTheDocument();
    expect(screen.getByText("Still worth cooking.")).toBeInTheDocument();
    const linkedHero = screen.getByRole("link", { name: /Pasta night/ });
    expect(linkedHero).toHaveAttribute("href", "https://example.com/recipes/pasta");
    expect(screen.getByRole("img", { name: "Pasta night" })).toHaveAttribute("src", "https://example.com/pasta.jpg");
    expect(screen.getByText("Pasta")).toBeInTheDocument();
  });

  it("renders object rows with optional image, subtitle, and stamp", () => {
    const { container } = render(
      <div>
        <ObjectRow
          href="https://example.com/recipes/stew"
          imageUrl="https://example.com/stew.jpg"
          title="Winter stew"
          subtitle="By ari"
          stamp="cook"
        />
        <ObjectRow href="https://example.com/recipes/plain" title="Plain toast" />
      </div>,
    );

    expect(screen.getByRole("link", { name: /Winter stew/ })).toHaveAttribute("href", "https://example.com/recipes/stew");
    expect(container.querySelector("img")).toHaveAttribute("src", "https://example.com/stew.jpg");
    expect(screen.getByText("By ari")).toBeInTheDocument();
    expect(screen.getByText("cook")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Plain toast/ })).toHaveAttribute("href", "https://example.com/recipes/plain");
  });
});
