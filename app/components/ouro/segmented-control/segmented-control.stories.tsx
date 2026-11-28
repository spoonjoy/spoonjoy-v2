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

/** In a window toolbar: a glass capsule where only the checked segment shows its label, with its count in a small pill. */
export const Glass: Story = {
  render: function Render(args) {
    const dot = <svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5" fill="currentColor" /></svg>;
    return (
      <Surface>
        <SegmentedControl
          {...args}
          glass
          hideLabel
          label="Browse"
          defaultValue="places"
          items={[
            { value: "places", label: "Places", icon: dot, count: 14 },
            { value: "people", label: "People", icon: dot, count: 3 },
            { value: "dates", label: "Dates", icon: dot },
          ]}
        />
      </Surface>
    );
  },
};

/** A visible label, a segment off with a reason, and every segment off with one. */
export const States: Story = {
  render: (args) => (
    <Surface>
      <SegmentedControl {...args} label="Units" items={[{ value: "metric", label: "Metric" }, { value: "us", label: "US" }]} />
      <SegmentedControl {...args} items={[views[0]!, views[1]!, { ...views[2]!, disabledReason: "Maps need a connection" }]} />
      <SegmentedControl {...args} label="Servings" items={["2", "4", "6"].map((value) => ({ value, label: value, disabledReason: "Pick a recipe first" }))} />
    </Surface>
  ),
};

/** A switch on a slide that keeps out of the way: with a mouse it shows while the pointer rests on it or focus is in it. */
export const RevealOnHover: Story = {
  render: function Render(args) {
    const [show, setShow] = useState("teaser");
    return (
      <Surface>
        <Text>The braising guide is {show === "teaser" ? "coming soon" : "ready to try"}.</Text>
        <SegmentedControl
          {...args}
          label="Show the guide as"
          hideLabel
          revealOnHover
          items={[
            { value: "teaser", label: "Coming soon" },
            { value: "invitation", label: "Ready to try" },
          ]}
          value={show}
          onValueChange={setShow}
        />
      </Surface>
    );
  },
};
