/**
 * Tests for StepDependencySelector component.
 *
 * This component allows selecting which previous steps this step depends on:
 * - Dropdown/multi-select of previous steps
 * - AI suggestion badges with accept/dismiss
 * - Only shows steps that come BEFORE current step
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StepDependencySelector } from "~/components/recipe/StepDependencySelector";

// Step data structure for testing
interface StepInfo {
  stepNum: number;
  description: string;
}

// AI suggestion structure
interface AiSuggestion {
  stepNum: number;
  reason?: string;
}

describe("StepDependencySelector", () => {
  // Helper to create test steps
  function createTestSteps(count: number): StepInfo[] {
    return Array.from({ length: count }, (_, i) => ({
      stepNum: i + 1,
      description: `Step ${i + 1} description`,
    }));
  }

  describe("rendering", () => {
    it('renders "Uses output from" label', () => {
      const steps = createTestSteps(3);
      render(
        <StepDependencySelector
          currentStepNum={3}
          allSteps={steps}
          selectedDependencies={[]}
          onChange={vi.fn()}
        />,
      );

      expect(screen.getByText(/uses output from/i)).toBeInTheDocument();
    });

    it("shows dropdown with previous steps only (not current or future)", () => {
      const steps = createTestSteps(5);
      render(
        <StepDependencySelector
          currentStepNum={3}
          allSteps={steps}
          selectedDependencies={[]}
          onChange={vi.fn()}
        />,
      );

      // Open the dropdown
      const dropdown = screen.getByRole("combobox");
      expect(dropdown).toBeInTheDocument();

      // Click to open dropdown
      userEvent.click(dropdown);

      // Should show steps 1 and 2 only (before step 3)
      expect(
        screen.getByRole("option", { name: /step 1/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("option", { name: /step 2/i }),
      ).toBeInTheDocument();

      // Should NOT show step 3 (current) or steps 4-5 (future)
      expect(
        screen.queryByRole("option", { name: /step 3/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("option", { name: /step 4/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("option", { name: /step 5/i }),
      ).not.toBeInTheDocument();
    });

    it("no dropdown shown for Step 1 (no previous steps)", () => {
      const steps = createTestSteps(3);
      render(
        <StepDependencySelector
          currentStepNum={1}
          allSteps={steps}
          selectedDependencies={[]}
          onChange={vi.fn()}
        />,
      );

      // Dropdown should not be present for step 1
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

      // Should show message indicating no previous steps
      expect(screen.getByText(/no previous steps/i)).toBeInTheDocument();
    });
  });

  describe("selection", () => {
    it("can select multiple dependencies", async () => {
      const steps = createTestSteps(4);
      const onChange = vi.fn();
      render(
        <StepDependencySelector
          currentStepNum={4}
          allSteps={steps}
          selectedDependencies={[]}
          onChange={onChange}
        />,
      );

      // Open dropdown
      const dropdown = screen.getByRole("combobox");
      await userEvent.click(dropdown);

      // Select step 1
      await userEvent.click(screen.getByRole("option", { name: /step 1/i }));

      // Select step 2
      await userEvent.click(dropdown);
      await userEvent.click(screen.getByRole("option", { name: /step 2/i }));

      // onChange should have been called with the selected steps
      expect(onChange).toHaveBeenCalledWith(expect.arrayContaining([1]));
      expect(onChange).toHaveBeenLastCalledWith(expect.arrayContaining([1, 2]));
    });

    it("onChange called with selected step numbers", async () => {
      const steps = createTestSteps(3);
      const onChange = vi.fn();
      render(
        <StepDependencySelector
          currentStepNum={3}
          allSteps={steps}
          selectedDependencies={[]}
          onChange={onChange}
        />,
      );

      // Open dropdown and select step 2
      const dropdown = screen.getByRole("combobox");
      await userEvent.click(dropdown);
      await userEvent.click(screen.getByRole("option", { name: /step 2/i }));

      // onChange should be called with array containing step number 2
      expect(onChange).toHaveBeenCalledWith([2]);
    });

    it("selected dependencies shown as chips/tags", () => {
      const steps = createTestSteps(4);
      render(
        <StepDependencySelector
          currentStepNum={4}
          allSteps={steps}
          selectedDependencies={[1, 2]}
          onChange={vi.fn()}
        />,
      );

      // Selected dependencies should be visible as chips
      const step1Chip = screen.getByRole("group", { name: /step 1/i });
      const step2Chip = screen.getByRole("group", { name: /step 2/i });

      expect(step1Chip).toBeInTheDocument();
      expect(step2Chip).toBeInTheDocument();
    });

    it("can remove selected dependency", async () => {
      const steps = createTestSteps(4);
      const onChange = vi.fn();
      render(
        <StepDependencySelector
          currentStepNum={4}
          allSteps={steps}
          selectedDependencies={[1, 2]}
          onChange={onChange}
        />,
      );

      // Find the remove button on step 1 chip
      const step1Chip = screen.getByRole("group", { name: /step 1/i });
      const removeButton = within(step1Chip).getByRole("button", {
        name: /remove step 1/i,
      });

      await userEvent.click(removeButton);

      // onChange should be called without step 1
      expect(onChange).toHaveBeenCalledWith([2]);
    });
  });

  describe("AI suggestions", () => {
    it("AI suggestions shown as badges when provided", () => {
      const steps = createTestSteps(4);
      const aiSuggestions: AiSuggestion[] = [
        { stepNum: 2, reason: "Uses the dough from step 2" },
      ];
      render(
        <StepDependencySelector
          currentStepNum={4}
          allSteps={steps}
          selectedDependencies={[]}
          onChange={vi.fn()}
          aiSuggestions={aiSuggestions}
        />,
      );

      // AI suggestion should be visible as a badge
      expect(
        screen.getByText(/step 2 looks like a dependency/i),
      ).toBeInTheDocument();
    });

    it("clicking AI suggestion adds it to selection", async () => {
      const steps = createTestSteps(4);
      const onChange = vi.fn();
      const aiSuggestions: AiSuggestion[] = [
        { stepNum: 2, reason: "Uses the dough from step 2" },
      ];
      render(
        <StepDependencySelector
          currentStepNum={4}
          allSteps={steps}
          selectedDependencies={[]}
          onChange={onChange}
          aiSuggestions={aiSuggestions}
        />,
      );

      // Click the "add it" button on the suggestion
      const addButton = screen.getByRole("button", { name: /add it/i });
      await userEvent.click(addButton);

      // onChange should be called with the suggested step
      expect(onChange).toHaveBeenCalledWith([2]);
    });

    it("dismiss button removes AI suggestion", async () => {
      const steps = createTestSteps(4);
      const aiSuggestions: AiSuggestion[] = [
        { stepNum: 2, reason: "Uses the dough from step 2" },
      ];
      render(
        <StepDependencySelector
          currentStepNum={4}
          allSteps={steps}
          selectedDependencies={[]}
          onChange={vi.fn()}
          aiSuggestions={aiSuggestions}
        />,
      );

      // Click the dismiss button
      const dismissButton = screen.getByRole("button", { name: /dismiss/i });
      await userEvent.click(dismissButton);

      // Suggestion should no longer be visible
      expect(
        screen.queryByText(/step 2 looks like a dependency/i),
      ).not.toBeInTheDocument();
    });
  });

  describe("disabled state", () => {
    it("disabled prop disables all interactions", () => {
      const steps = createTestSteps(4);
      const aiSuggestions: AiSuggestion[] = [
        { stepNum: 2, reason: "Uses output from step 2" },
      ];
      render(
        <StepDependencySelector
          currentStepNum={4}
          allSteps={steps}
          selectedDependencies={[1]}
          onChange={vi.fn()}
          aiSuggestions={aiSuggestions}
          disabled
        />,
      );

      // Dropdown should be disabled
      const dropdown = screen.getByRole("combobox");
      expect(dropdown).toBeDisabled();

      // Remove buttons on chips should be disabled
      const step1Chip = screen.getByRole("group", { name: /step 1/i });
      const removeButton = within(step1Chip).getByRole("button", {
        name: /remove step 1/i,
      });
      expect(removeButton).toBeDisabled();

      // AI suggestion buttons should be disabled
      const addButton = screen.getByRole("button", { name: /add it/i });
      const dismissButton = screen.getByRole("button", { name: /dismiss/i });
      expect(addButton).toBeDisabled();
      expect(dismissButton).toBeDisabled();
    });
  });

  describe("edge cases", () => {
    it("Step 2 shows only 1 possible dependency (step 1)", async () => {
      const steps = createTestSteps(5);
      const onChange = vi.fn();
      render(
        <StepDependencySelector
          currentStepNum={2}
          allSteps={steps}
          selectedDependencies={[]}
          onChange={onChange}
        />,
      );

      // Open dropdown
      const dropdown = screen.getByRole("combobox");
      await userEvent.click(dropdown);

      // Should only show step 1
      expect(
        screen.getByRole("option", { name: /step 1/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("option", { name: /step 2/i }),
      ).not.toBeInTheDocument();
    });

    it("handles many steps (5+) with all previous steps available", async () => {
      const steps = createTestSteps(7);
      render(
        <StepDependencySelector
          currentStepNum={7}
          allSteps={steps}
          selectedDependencies={[]}
          onChange={vi.fn()}
        />,
      );

      // Open dropdown
      const dropdown = screen.getByRole("combobox");
      await userEvent.click(dropdown);

      // Should show steps 1-6
      for (let i = 1; i <= 6; i++) {
        expect(
          screen.getByRole("option", { name: new RegExp(`step ${i}`, "i") }),
        ).toBeInTheDocument();
      }
    });

    it("does not duplicate when selecting already-selected step", async () => {
      const steps = createTestSteps(4);
      const onChange = vi.fn();
      render(
        <StepDependencySelector
          currentStepNum={4}
          allSteps={steps}
          selectedDependencies={[1]}
          onChange={onChange}
        />,
      );

      // Open dropdown and click step 1 again (already selected)
      const dropdown = screen.getByRole("combobox");
      await userEvent.click(dropdown);
      await userEvent.click(screen.getByRole("option", { name: /step 1/i }));

      // onChange should not be called since step 1 is already selected
      expect(onChange).not.toHaveBeenCalled();
    });

    it("does not duplicate when accepting already-selected AI suggestion", async () => {
      const steps = createTestSteps(4);
      const onChange = vi.fn();
      const aiSuggestions: AiSuggestion[] = [
        { stepNum: 1, reason: "Already selected" },
      ];
      render(
        <StepDependencySelector
          currentStepNum={4}
          allSteps={steps}
          selectedDependencies={[1]}
          onChange={onChange}
          aiSuggestions={aiSuggestions}
        />,
      );

      // Click "Add it" on suggestion for step 1 (already selected)
      const addButton = screen.getByRole("button", { name: /add it/i });
      await userEvent.click(addButton);

      // onChange should not be called since step 1 is already selected
      expect(onChange).not.toHaveBeenCalled();
    });

    it("handles many AI suggestions", () => {
      const steps = createTestSteps(6);
      const aiSuggestions: AiSuggestion[] = [
        { stepNum: 1, reason: "Reason 1" },
        { stepNum: 2, reason: "Reason 2" },
        { stepNum: 3, reason: "Reason 3" },
        { stepNum: 4, reason: "Reason 4" },
      ];
      render(
        <StepDependencySelector
          currentStepNum={6}
          allSteps={steps}
          selectedDependencies={[]}
          onChange={vi.fn()}
          aiSuggestions={aiSuggestions}
        />,
      );

      // All 4 suggestions should be visible
      expect(
        screen.getByText(/step 1 looks like a dependency/i),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/step 2 looks like a dependency/i),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/step 3 looks like a dependency/i),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/step 4 looks like a dependency/i),
      ).toBeInTheDocument();
    });

    it("handles rapid accept/dismiss on multiple suggestions", async () => {
      const steps = createTestSteps(5);
      const onChange = vi.fn();
      const aiSuggestions: AiSuggestion[] = [
        { stepNum: 1 },
        { stepNum: 2 },
        { stepNum: 3 },
      ];
      render(
        <StepDependencySelector
          currentStepNum={5}
          allSteps={steps}
          selectedDependencies={[]}
          onChange={onChange}
          aiSuggestions={aiSuggestions}
        />,
      );

      // Get all Add and Dismiss buttons
      const addButtons = screen.getAllByRole("button", { name: /add it/i });
      const dismissButtons = screen.getAllByRole("button", {
        name: /dismiss/i,
      });

      // Accept step 1
      await userEvent.click(addButtons[0]);
      expect(onChange).toHaveBeenCalledWith([1]);

      // Dismiss step 2
      await userEvent.click(dismissButtons[1]);
      expect(
        screen.queryByText(/step 2 looks like a dependency/i),
      ).not.toBeInTheDocument();

      // Accept step 3
      await userEvent.click(
        screen.getAllByRole("button", { name: /add it/i })[1],
      ); // Now index 1 is step 3
      expect(onChange).toHaveBeenLastCalledWith([1, 3]);
    });

    it("handles empty AI suggestions array", () => {
      const steps = createTestSteps(4);
      render(
        <StepDependencySelector
          currentStepNum={4}
          allSteps={steps}
          selectedDependencies={[]}
          onChange={vi.fn()}
          aiSuggestions={[]}
        />,
      );

      // No suggestion badges should be visible
      expect(
        screen.queryByText(/looks like a dependency/i),
      ).not.toBeInTheDocument();
    });

    it("gracefully handles selection for non-existent step in allSteps", () => {
      const steps = createTestSteps(3);
      // selectedDependencies includes step 99 which doesn't exist in allSteps
      render(
        <StepDependencySelector
          currentStepNum={3}
          allSteps={steps}
          selectedDependencies={[1, 99]}
          onChange={vi.fn()}
        />,
      );

      // Step 1 should be shown as a chip
      expect(
        screen.getByRole("group", { name: /step 1/i }),
      ).toBeInTheDocument();

      // Step 99 should not be shown (returns null from map)
      expect(
        screen.queryByRole("group", { name: /step 99/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("accessibility", () => {
    it("dropdown has proper ARIA attributes", async () => {
      const steps = createTestSteps(4);
      render(
        <StepDependencySelector
          currentStepNum={4}
          allSteps={steps}
          selectedDependencies={[]}
          onChange={vi.fn()}
        />,
      );

      const dropdown = screen.getByRole("combobox");
      expect(dropdown).toHaveAttribute("aria-expanded", "false");
      expect(dropdown).toHaveAttribute("aria-haspopup", "listbox");

      // Open dropdown
      await userEvent.click(dropdown);
      expect(dropdown).toHaveAttribute("aria-expanded", "true");
    });

    it("options have proper aria-selected attributes", async () => {
      const steps = createTestSteps(4);
      render(
        <StepDependencySelector
          currentStepNum={4}
          allSteps={steps}
          selectedDependencies={[2]}
          onChange={vi.fn()}
        />,
      );

      // Open dropdown
      await userEvent.click(screen.getByRole("combobox"));

      // Step 2 should be marked as selected
      expect(screen.getByRole("option", { name: /step 2/i })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(screen.getByRole("option", { name: /step 1/i })).toHaveAttribute(
        "aria-selected",
        "false",
      );
    });

    it("remove button has accessible label", () => {
      const steps = createTestSteps(4);
      render(
        <StepDependencySelector
          currentStepNum={4}
          allSteps={steps}
          selectedDependencies={[1]}
          onChange={vi.fn()}
        />,
      );

      const chip = screen.getByRole("group", { name: /step 1/i });
      const removeButton = within(chip).getByRole("button", {
        name: /remove step 1/i,
      });
      expect(removeButton).toHaveAttribute("aria-label", "Remove step 1");
    });
  });
});
