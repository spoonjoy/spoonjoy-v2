import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type CSSProperties } from "react";
import { Button } from "~/components/ouro/button/button";
import { Dialog } from "~/components/ouro/dialog/dialog";
import {
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogPopup,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
  DialogViewport,
} from "~/components/ouro/dialog/dialog-parts";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

const stack: CSSProperties = { display: "grid", gap: 12 };
const row: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" };
const caption: CSSProperties = {
  fontWeight: 500, fontSize: "12px", lineHeight: "16px",
  color: "var(--muted-foreground)",
  letterSpacing: "0.02em",
  textTransform: "uppercase",
};
const body: CSSProperties = { fontWeight: 400, fontSize: "16px", lineHeight: "24px", color: "var(--foreground)", margin: 0 };
const input: CSSProperties = {
  fontWeight: 400, fontSize: "16px", lineHeight: "24px",
  padding: "10px 12px",
  borderRadius: "var(--radius)",
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--foreground)",
};

function RecipeForm() {
  return (
    <div style={stack}>
      <label style={{ ...stack, gap: 6, fontWeight: 500, fontSize: "14px", lineHeight: "20px" }}>
        Name
        <input data-test-harness="" defaultValue="Shakshuka" style={input} />
      </label>
      <label style={{ ...stack, gap: 6, fontWeight: 500, fontSize: "14px", lineHeight: "20px" }}>
        Serves
        <input data-test-harness="" defaultValue="4" inputMode="numeric" style={input} />
      </label>
    </div>
  );
}

function Lines({ count }: { count: number }) {
  return (
    <div style={stack}>
      {Array.from({ length: count }, (_, index) => (
        <p key={index} style={body}>
          Step {index + 1}. Simmer the tomatoes with the peppers and spices until thick, then make wells for the eggs.
        </p>
      ))}
    </div>
  );
}

const meta = {
  title: "Overlays/Dialog",
  component: Dialog,
  parameters: { layout: "centered" },
  args: {
    title: "Edit recipe",
    trigger: <Button>Edit</Button>,
    children: <RecipeForm />,
  },
  argTypes: {
    presentation: { control: "inline-radio", options: ["auto", "dialog", "sheet"] },
    size: { control: "inline-radio", options: ["sm", "md", "lg"] },
    trigger: { table: { disable: true } },
    children: { table: { disable: true } },
    footer: { table: { disable: true } },
  },
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Centered from 640px up; narrow the window (or open on a phone) to get the bottom sheet. */
export const Playground: Story = {};

/** `footer` holds the actions: a row at the end on wider screens, stacked on phones with the primary action at the bottom. */
export const WithFooter: Story = {
  parameters: { screenshot: { name: "dialog-open", open: true } },
  args: {
    description: "Changes are saved to every cookbook with this recipe.",
    footer: (
      <>
        <Button variant="outline" tone="secondary">
          Cancel
        </Button>
        <Button>Save</Button>
      </>
    ),
  },
};

/** `size` caps the centered dialog's width at 24, 32 or 40rem. */
export const Sizes: Story = {
  render: () => (
    <div style={row}>
      {(["sm", "md", "lg"] as const).map((size) => (
        <Dialog key={size} title={`Size ${size}`} size={size} trigger={<Button variant="soft">{size}</Button>}>
          <Lines count={2} />
        </Dialog>
      ))}
    </div>
  ),
};

/** `presentation` fixes the form at every width. */
export const Presentations: Story = {
  render: () => (
    <div style={row}>
      {(["auto", "dialog", "sheet"] as const).map((presentation) => (
        <Dialog
          key={presentation}
          title={`presentation="${presentation}"`}
          presentation={presentation}
          trigger={<Button variant="soft">{presentation}</Button>}
        >
          <Lines count={2} />
        </Dialog>
      ))}
    </div>
  ),
};

/** Long content scrolls inside the dialog, which keeps clear of the screen edges. */
export const LongContent: Story = {
  render: () => (
    <Dialog title="Method" trigger={<Button>Show method</Button>}>
      <Lines count={24} />
    </Dialog>
  ),
};

/** `hideTitle` keeps the title as the dialog's name for screen readers. */
export const HiddenTitle: Story = {
  args: { hideTitle: true, children: <Lines count={2} /> },
};

/** `open` and `onOpenChange` put the dialog under your state. It stays open when a resize changes its form. */
export const Controlled: Story = {
  parameters: { plainOpeners: ["Open"] },
  render: function Render() {
    const [open, setOpen] = useState(false);
    return (
      <div style={row}>
        <Button onClick={() => setOpen(true)}>Open</Button>
        <span style={caption}>{open ? "open" : "closed"}</span>
        <Dialog
          title="Controlled"
          open={open}
          onOpenChange={setOpen}
          footer={<Button onClick={() => setOpen(false)}>Done</Button>}
        >
          <p style={body}>Press Escape, tap outside or use the close button: each calls onOpenChange(false).</p>
        </Dialog>
      </div>
    );
  },
};

/** Built from parts. A part given no `render` is a plain button of its own: here the trigger and the close button. */
export const Parts: Story = {
  render: () => (
    <DialogRoot>
      <DialogTrigger>Edit recipe</DialogTrigger>
      <DialogPortal>
        <DialogBackdrop />
        <DialogViewport>
          <DialogPopup>
            <DialogTitle>Edit recipe</DialogTitle>
            <DialogContent>Changes are saved to every cookbook with this recipe.</DialogContent>
            <DialogFooter>
              <DialogClose>Close</DialogClose>
            </DialogFooter>
          </DialogPopup>
        </DialogViewport>
      </DialogPortal>
    </DialogRoot>
  ),
};
