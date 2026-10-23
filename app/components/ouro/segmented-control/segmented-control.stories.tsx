import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ReactNode } from "react";
import { SegmentedControl } from "~/components/ouro/segmented-control/segmented-control";
import { Text } from "~/components/ouro/text/text";

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

const views = [
  { value: "list", label: "List" },
  { value: "grid", label: "Grid" },
  { value: "calendar", label: "Calendar" },
];

const meta = {
  title: "Navigation/SegmentedControl",
  component: SegmentedControl,
  parameters: { layout: "padded" },
  args: { label: "View", items: views },
  argTypes: {
    hideLabel: { control: "boolean" },
    fullWidth: { control: "boolean" },
    disabled: { control: "boolean" },
  },
} satisfies Meta<typeof SegmentedControl>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

/** Switching how a meal plan shows, in place. */
export const InContext: Story = {
  parameters: { screenshot: { name: "segmented-control" } },
  render: function Render(args) {
    const [view, setView] = useState("list");
    return (
      <Surface>
        <SegmentedControl {...args} hideLabel fullWidth value={view} onValueChange={setView} />
        <Text>Showing this week's meals as a {view}.</Text>
      </Surface>
    );
  },
};

/** A visible label, a disabled segment, and the whole control disabled. */
export const States: Story = {
  render: (args) => (
    <Surface>
      <SegmentedControl {...args} label="Units" items={[{ value: "metric", label: "Metric" }, { value: "us", label: "US" }]} />
      <SegmentedControl {...args} items={[views[0]!, views[1]!, { ...views[2]!, disabled: true }]} />
      <SegmentedControl {...args} label="Servings" disabled items={[{ value: "2", label: "2" }, { value: "4", label: "4" }, { value: "6", label: "6" }]} />
    </Surface>
  ),
};
