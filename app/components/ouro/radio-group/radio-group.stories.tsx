import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { Radio, RadioGroup } from "~/components/ouro/radio-group/radio-group";

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

const sizes = [
  { value: "small", label: "Small", description: "Serves 2." },
  { value: "medium", label: "Medium", description: "Serves 4." },
  { value: "large", label: "Large", description: "Serves 6." },
  { value: "party", label: "Party", description: "Sold out this week.", disabled: true },
];

const meta = {
  title: "Forms/RadioGroup",
  component: RadioGroup,
  parameters: { layout: "padded" },
  args: { legend: "Size", name: "size", options: sizes, defaultValue: "medium" },
  argTypes: {
    orientation: { control: "inline-radio", options: ["vertical", "horizontal"] },
    required: { control: "boolean" },
    disabled: { control: "boolean" },
    hideLegend: { control: "boolean" },
    error: { control: "text" },
    description: { control: "text" },
  },
} satisfies Meta<typeof RadioGroup>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

/** Choices from `options`, with descriptions and one disabled choice. The arrow keys move and pick. */
export const Sizes: Story = {
  parameters: { screenshot: { name: "radio-group-sizes" } },
  render: () => (
    <Surface>
      <RadioGroup legend="Size" name="size" description="How many people you're cooking for." options={sizes} defaultValue="medium" />
    </Surface>
  ),
};

/** Short choices in a row that wraps. */
export const Horizontal: Story = {
  render: () => (
    <Surface>
      <RadioGroup
        legend="Crust"
        name="crust"
        orientation="horizontal"
        defaultValue="thin"
        options={[{ value: "thin", label: "Thin" }, { value: "classic", label: "Classic" }, { value: "deep", label: "Deep dish" }]}
      />
    </Surface>
  ),
};

/** Required with an error, the whole group disabled, and `Radio` children. */
export const States: Story = {
  parameters: { screenshot: { name: "radio-group-states" } },
  render: () => (
    <Surface>
      <RadioGroup legend="Delivery" name="delivery" required error="Choose how you get your order." options={[{ value: "pickup", label: "Pick up" }, { value: "deliver", label: "Deliver" }]} />
      <RadioGroup legend="Units" name="units" disabled defaultValue="metric" options={[{ value: "metric", label: "Metric" }, { value: "us", label: "US" }]} />
      <RadioGroup legend="Spice" name="spice" defaultValue="medium">
        <Radio value="mild" label="Mild" />
        <Radio value="medium" label="Medium" description={<>Most cooks pick <strong>this</strong>.</>} />
      </RadioGroup>
    </Surface>
  ),
};
