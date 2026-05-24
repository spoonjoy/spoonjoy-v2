import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StepOutputUseDisplay } from "~/components/StepOutputUseDisplay";

describe("StepOutputUseDisplay", () => {
  describe("when usingSteps is empty", () => {
    it("should render nothing when usingSteps array is empty", () => {
      const { container } = render(<StepOutputUseDisplay usingSteps={[]} />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe("when usingSteps has entries", () => {
    it("should render the section heading", () => {
      const usingSteps = [
        {
          id: "use-1",
          outputStepNum: 1,
          outputOfStep: { stepNum: 1, stepTitle: "Prep" },
        },
      ];

      render(<StepOutputUseDisplay usingSteps={usingSteps} />);

      expect(screen.getByText("Using outputs from")).toBeInTheDocument();
    });

    it("should render step output with title when stepTitle is present", () => {
      const usingSteps = [
        {
          id: "use-1",
          outputStepNum: 1,
          outputOfStep: { stepNum: 1, stepTitle: "Cook rice" },
        },
      ];

      render(<StepOutputUseDisplay usingSteps={usingSteps} />);

      expect(screen.getByText(/output of step 1: Cook rice/)).toBeInTheDocument();
    });

    it("should render step output without title when stepTitle is null", () => {
      const usingSteps = [
        {
          id: "use-1",
          outputStepNum: 1,
          outputOfStep: { stepNum: 1, stepTitle: null },
        },
      ];

      render(<StepOutputUseDisplay usingSteps={usingSteps} />);

      expect(screen.getByText("output of step 1")).toBeInTheDocument();
      // Should not have the colon when there's no title
      expect(screen.queryByText(/output of step 1:/)).not.toBeInTheDocument();
    });

    it("should render multiple step outputs in order", () => {
      const usingSteps = [
        {
          id: "use-1",
          outputStepNum: 1,
          outputOfStep: { stepNum: 1, stepTitle: "First step" },
        },
        {
          id: "use-2",
          outputStepNum: 2,
          outputOfStep: { stepNum: 2, stepTitle: "Second step" },
        },
        {
          id: "use-3",
          outputStepNum: 3,
          outputOfStep: { stepNum: 3, stepTitle: null },
        },
      ];

      render(<StepOutputUseDisplay usingSteps={usingSteps} />);

      expect(screen.getByText(/output of step 1: First step/)).toBeInTheDocument();
      expect(screen.getByText(/output of step 2: Second step/)).toBeInTheDocument();
      expect(screen.getByText("output of step 3")).toBeInTheDocument();
    });

    it("should render items in a list", () => {
      const usingSteps = [
        {
          id: "use-1",
          outputStepNum: 1,
          outputOfStep: { stepNum: 1, stepTitle: "Prep" },
        },
        {
          id: "use-2",
          outputStepNum: 2,
          outputOfStep: { stepNum: 2, stepTitle: "Cook" },
        },
      ];

      render(<StepOutputUseDisplay usingSteps={usingSteps} />);

      const listItems = screen.getAllByRole("listitem");
      expect(listItems).toHaveLength(2);
    });

    it("should apply correct container styling", () => {
      const usingSteps = [
        {
          id: "use-1",
          outputStepNum: 1,
          outputOfStep: { stepNum: 1, stepTitle: "Prep" },
        },
      ];

      const { container } = render(<StepOutputUseDisplay usingSteps={usingSteps} />);

      const outerDiv = container.firstChild as HTMLElement;
      expect(outerDiv).toHaveClass("border-y");
      expect(outerDiv).toHaveClass("border-[var(--sj-border)]");
      expect(outerDiv).toHaveClass("py-4");
      expect(outerDiv).toHaveClass("mt-4");
    });

    it("should render heading with correct styling", () => {
      const usingSteps = [
        {
          id: "use-1",
          outputStepNum: 1,
          outputOfStep: { stepNum: 1, stepTitle: "Prep" },
        },
      ];

      render(<StepOutputUseDisplay usingSteps={usingSteps} />);

      const heading = screen.getByText("Using outputs from");
      expect(heading.tagName.toLowerCase()).toBe("h4");
    });
  });
});
