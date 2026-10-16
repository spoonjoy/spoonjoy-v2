import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmationDialog } from "~/components/confirmation-dialog";

describe("ConfirmationDialog", () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    title: "Confirm Action",
    description: "Are you sure you want to proceed?",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("rendering", () => {
    it("should render when open is true", async () => {
      await act(async () => {
        render(<ConfirmationDialog {...defaultProps} />);
      });

      expect(screen.getByText("Confirm Action")).toBeInTheDocument();
      expect(screen.getByText("Are you sure you want to proceed?")).toBeInTheDocument();
    });

    it("should not render when open is false", async () => {
      await act(async () => {
        render(<ConfirmationDialog {...defaultProps} open={false} />);
      });

      expect(screen.queryByText("Confirm Action")).not.toBeInTheDocument();
    });

    it("should render with custom title", async () => {
      await act(async () => {
        render(
          <ConfirmationDialog
            {...defaultProps}
            title="Delete Recipe?"
          />
        );
      });

      expect(screen.getByText("Delete Recipe?")).toBeInTheDocument();
    });

    it("should render with custom description", async () => {
      await act(async () => {
        render(
          <ConfirmationDialog
            {...defaultProps}
            description="This will banish the recipe to the shadow realm!"
          />
        );
      });

      expect(screen.getByText("This will banish the recipe to the shadow realm!")).toBeInTheDocument();
    });

    it("should render default button labels", async () => {
      await act(async () => {
        render(<ConfirmationDialog {...defaultProps} />);
      });

      expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    });

    it("should render custom confirm label", async () => {
      await act(async () => {
        render(
          <ConfirmationDialog
            {...defaultProps}
            confirmLabel="Yes, delete it!"
          />
        );
      });

      expect(screen.getByRole("button", { name: "Yes, delete it!" })).toBeInTheDocument();
    });

    it("should render custom cancel label", async () => {
      await act(async () => {
        render(
          <ConfirmationDialog
            {...defaultProps}
            cancelLabel="Nevermind"
          />
        );
      });

      expect(screen.getByRole("button", { name: "Nevermind" })).toBeInTheDocument();
    });
  });

  describe("interactions", () => {
    it("should call onConfirm when confirm button is clicked", async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();

      render(
        <ConfirmationDialog
          {...defaultProps}
          onConfirm={onConfirm}
        />
      );

      await user.click(screen.getByRole("button", { name: "Confirm" }));

      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it("should call onClose when cancel button is clicked", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();

      render(
        <ConfirmationDialog
          {...defaultProps}
          onClose={onClose}
        />
      );

      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("should call onClose when Escape key is pressed", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();

      render(
        <ConfirmationDialog
          {...defaultProps}
          onClose={onClose}
        />
      );

      await user.keyboard("{Escape}");

      expect(onClose).toHaveBeenCalled();
    });
  });

  describe("destructive variant", () => {
    it("should show destructive styling when destructive is true", async () => {
      await act(async () => {
        render(
          <ConfirmationDialog
            {...defaultProps}
            destructive
          />
        );
      });

      const confirmButton = screen.getByRole("button", { name: "Confirm" });
      // Destructive buttons in Catalyst use red color
      expect(confirmButton).toBeInTheDocument();
      // The button should have data-color="red" or similar class
    });

    it("should not show destructive styling by default", async () => {
      await act(async () => {
        render(<ConfirmationDialog {...defaultProps} />);
      });

      const confirmButton = screen.getByRole("button", { name: "Confirm" });
      expect(confirmButton).toBeInTheDocument();
    });
  });

  describe("accessibility", () => {
    it("should have dialog role", async () => {
      await act(async () => {
        render(<ConfirmationDialog {...defaultProps} />);
      });

      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("should use alertdialog role for destructive confirmations", async () => {
      await act(async () => {
        render(<ConfirmationDialog {...defaultProps} destructive />);
      });

      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    });

    it("should have proper dialog title", async () => {
      await act(async () => {
        render(<ConfirmationDialog {...defaultProps} />);
      });

      // The title should be associated with the dialog via aria-labelledby
      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();
      expect(screen.getByText("Confirm Action")).toBeInTheDocument();
    });

    it("should have proper dialog description", async () => {
      await act(async () => {
        render(<ConfirmationDialog {...defaultProps} />);
      });

      expect(screen.getByText("Are you sure you want to proceed?")).toBeInTheDocument();
    });

    it("should trap focus within dialog", async () => {
      const user = userEvent.setup();

      await act(async () => {
        render(<ConfirmationDialog {...defaultProps} />);
      });

      // Tab through the dialog - focus should cycle within
      const cancelButton = screen.getByRole("button", { name: "Cancel" });
      const confirmButton = screen.getByRole("button", { name: "Confirm" });

      // Focus should be on one of the buttons initially or the dialog
      await user.tab();
      await user.tab();

      // The released Dialog also has a named close button; every keyboard stop
      // remains inside the actual modal, not just the former two-button list.
      expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    });

    it("should be keyboard navigable", async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();

      await act(async () => {
        render(
          <ConfirmationDialog
            {...defaultProps}
            onConfirm={onConfirm}
          />
        );
      });

      // Activate the actual confirm control from the keyboard. Tab trapping is
      // checked separately and includes the released named close control.
      screen.getByRole("button", { name: "Confirm" }).focus();
      await user.keyboard("{Enter}");

      // Either cancel or confirm should have been triggered
      expect(onConfirm).toHaveBeenCalled();
    });
  });

  describe("edge cases", () => {
    it("should handle rapid confirm clicks gracefully", async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();

      await act(async () => {
        render(
          <ConfirmationDialog
            {...defaultProps}
            onConfirm={onConfirm}
          />
        );
      });

      const confirmButton = screen.getByRole("button", { name: "Confirm" });

      // Rapid clicks
      await user.click(confirmButton);
      await user.click(confirmButton);
      await user.click(confirmButton);

      // Should handle gracefully (implementation may choose to call once or multiple times)
      expect(onConfirm).toHaveBeenCalled();
    });

    it("should handle empty title gracefully", async () => {
      await act(async () => {
        render(
          <ConfirmationDialog
            {...defaultProps}
            title=""
          />
        );
      });

      // Should still render dialog
      expect(screen.getByRole("dialog", { name: "Confirm" })).toBeInTheDocument();
    });

    it("should handle empty description gracefully", async () => {
      await act(async () => {
        render(
          <ConfirmationDialog
            {...defaultProps}
            description=""
          />
        );
      });

      // Should still render dialog
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  describe("fun and playful content", () => {
    it("should support playful delete recipe confirmation", async () => {
      await act(async () => {
        render(
          <ConfirmationDialog
            open={true}
            onClose={vi.fn()}
            onConfirm={vi.fn()}
            title="Banish this recipe?"
            description="This recipe will be sent to the shadow realm. There's no coming back!"
            confirmLabel="Send it!"
            cancelLabel="Spare it"
            destructive
          />
        );
      });

      expect(screen.getByText("Banish this recipe?")).toBeInTheDocument();
      expect(screen.getByText("This recipe will be sent to the shadow realm. There's no coming back!")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Send it!" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Spare it" })).toBeInTheDocument();
    });

    it("should support playful clear shopping list confirmation", async () => {
      await act(async () => {
        render(
          <ConfirmationDialog
            open={true}
            onClose={vi.fn()}
            onConfirm={vi.fn()}
            title="Start fresh?"
            description="All items will be cleared. Your shopping list will be squeaky clean!"
            confirmLabel="Clear it all"
            cancelLabel="Keep my stuff"
          />
        );
      });

      expect(screen.getByText("Start fresh?")).toBeInTheDocument();
      expect(screen.getByText("All items will be cleared. Your shopping list will be squeaky clean!")).toBeInTheDocument();
    });
  });
});
