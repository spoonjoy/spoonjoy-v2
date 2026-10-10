import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { ChecklistRow } from "~/components/shopping/checklist-row";

describe("ChecklistRow layout", () => {
  // On a phone the amount used to be cut off ("⅓ c…") while the name had room to wrap.
  it("keeps the amount on one line and lets a long name wrap instead of truncating", () => {
    render(
      <ChecklistRow
        name="extra-virgin olive oil from the good bottle"
        quantity="2 ½ tablespoons"
        quantityTestId="row-amount"
        onToggle={() => undefined}
      />,
    );
    const amount = screen.getByTestId("row-amount");
    expect(amount).toHaveTextContent("2 ½ tablespoons");
    expect(amount).toHaveClass("whitespace-nowrap");
    expect(amount.className).not.toMatch(/truncate|max-w-|break-words/);

    const name = screen.getByText("extra-virgin olive oil from the good bottle");
    expect(name).toHaveClass("break-words");
    expect(name).not.toHaveClass("truncate");
  });
});
