import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ChecklistRow } from "~/components/shopping/checklist-row";

// Print hides the tick box and turns `.sj-checklist-row` into one column (app/styles/tailwind.css). Every
// grid that holds a box must carry the class, or its name prints in the empty 2rem box column at no width.
describe("ChecklistRow print layout", () => {
  it.each([
    ["a plain row", {}],
    ["a toggle row", { onToggle: () => {} }],
    ["a toggle row with an action", { onToggle: () => {}, action: <button type="button">Remove</button> }],
    ["a press row", { onPress: () => {} }],
  ])("marks the grid holding the tick box in %s", (_label, props) => {
    const { container } = render(<ChecklistRow name="jasmine rice" quantity="1 cup" {...props} />);
    const boxes = container.querySelectorAll(".sj-checklist-box");
    expect(boxes).toHaveLength(1);
    expect(boxes[0].parentElement).toHaveClass("sj-checklist-row", "grid-cols-[2rem_minmax(0,1fr)]");
  });
});
