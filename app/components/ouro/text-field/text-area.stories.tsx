import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { TextArea } from "~/components/ouro/text-field/text-area";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

/** A themed panel. It follows the page's scheme (the `.dark` class on the root). */
function Surface({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        background: "var(--background)",
        color: "var(--foreground)",
        border: "1px solid var(--border)",
        borderRadius: "calc(var(--radius) + 4px)",
        padding: 24,
        display: "grid",
        gap: 24,
        maxWidth: 420,
      }}
    >
      {children}
    </div>
  );
}

const meta = {
  title: "Forms/TextArea",
  component: TextArea,
  parameters: { layout: "padded" },
  args: { label: "Notes", name: "notes", description: "Only you see these.", placeholder: "Anything to remember" },
  argTypes: {
    rows: { control: "number" },
    maxRows: { control: "number" },
    autoGrow: { control: "boolean" },
    required: { control: "boolean" },
    disabled: { control: "boolean" },
    hideLabel: { control: "boolean" },
    error: { control: "text" },
  },
} satisfies Meta<typeof TextArea>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

/** Grows with the text from two lines up to six, then scrolls. */
export const AutoGrow: Story = {
  render: () => (
    <Surface>
      <TextArea label="Message" name="message" autoGrow rows={2} maxRows={6} placeholder="Write to the cook" />
    </Surface>
  ),
};

/** Plain, described and required, invalid, and disabled. */
export const States: Story = {
  parameters: { screenshot: { name: "text-area-states" } },
  render: () => (
    <Surface>
      <TextArea label="Method" name="method" defaultValue={"Boil the pasta.\nStir in the ricotta and lemon."} />
      <TextArea label="Notes" name="notes" required description="Only you see these." placeholder="Anything to remember" />
      <TextArea label="Review" name="review" error="Keep it under 500 characters." defaultValue="Lovely, but needed more salt." />
      <TextArea label="Shared notes" name="shared" disabled description="Only the owner can edit these." defaultValue="Use fresh lemons." />
    </Surface>
  ),
};
