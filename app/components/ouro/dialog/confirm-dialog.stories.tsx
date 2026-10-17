import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "~/components/ouro/button/button";
import { ConfirmDialog } from "~/components/ouro/dialog/confirm-dialog";

const meta = {
  title: "Overlays/ConfirmDialog",
  component: ConfirmDialog,
  parameters: { layout: "centered" },
  args: {
    title: "Delete recipe?",
    description: "Shakshuka will be removed from every cookbook. This can't be undone.",
    confirmLabel: "Delete",
    tone: "destructive",
    onConfirm: () => new Promise((resolve) => setTimeout(resolve, 1200)),
    trigger: (
      <Button tone="destructive" variant="soft">
        Delete recipe
      </Button>
    ),
  },
  argTypes: {
    tone: { control: "inline-radio", options: ["primary", "destructive"] },
    trigger: { table: { disable: true } },
  },
} satisfies Meta<typeof ConfirmDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Cancel has focus, an outside press does nothing, and it stays centered on phones. Delete shows the busy state while `onConfirm` runs. */
export const Destructive: Story = {
  parameters: { screenshot: { name: "confirm-dialog-open", open: true } },
};

/** A rejected `onConfirm` keeps the confirmation open, so the user can retry or cancel. */
export const FailingAction: Story = {
  name: "Failing action",
  render: function Render() {
    const [error, setError] = useState<string>();
    return (
      <ConfirmDialog
        title="Leave cookbook?"
        description={error ?? "You can be invited back later."}
        confirmLabel="Leave"
        onConfirm={() =>
          new Promise<void>((_, reject) => setTimeout(() => reject(new Error("You're offline.")), 800)).catch(
            (failure: Error) => {
              setError(`${failure.message} Try again.`);
              throw failure;
            },
          )
        }
        trigger={<Button variant="outline">Leave cookbook</Button>}
      />
    );
  },
};
