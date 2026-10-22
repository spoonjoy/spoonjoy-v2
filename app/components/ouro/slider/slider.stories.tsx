import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { Slider } from "~/components/ouro/slider/slider";

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
  title: "Forms/Slider",
  component: Slider,
  parameters: { layout: "padded" },
  args: { label: "Spice level", name: "spice", defaultValue: 3, min: 0, max: 5, showValue: true },
  argTypes: {
    disabled: { control: "boolean" },
    hideLabel: { control: "boolean" },
    showValue: { control: "boolean" },
    error: { control: "text" },
    description: { control: "text" },
  },
} satisfies Meta<typeof Slider>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

/** A range has two thumbs; the value shows formatted for the locale. */
export const Range: Story = {
  parameters: { screenshot: { name: "slider-range" } },
  render: () => (
    <Surface>
      <Slider label="Price" name="price" defaultValue={[10, 40]} min={0} max={60} showValue format={{ style: "currency", currency: "USD", maximumFractionDigits: 0 }} />
      <Slider label="Volume" name="volume" defaultValue={0.4} min={0} max={1} step={0.05} showValue format={{ style: "percent" }} />
      <Slider label="Kochzeit" name="kochzeit" defaultValue={[20, 45]} min={0} max={90} showValue thumbLabels={["Von", "Bis"]} locale="de-DE" />
    </Surface>
  ),
};

/** Described, invalid and disabled. */
export const States: Story = {
  parameters: { screenshot: { name: "slider-states" } },
  render: () => (
    <Surface>
      <Slider label="Spice level" name="spice" defaultValue={2} min={0} max={5} showValue description="0 is mild, 5 is very hot." />
      <Slider label="Servings" name="servings" defaultValue={0} min={0} max={12} showValue error="Pick at least one serving." />
      <Slider label="Oven" name="oven" defaultValue={180} min={100} max={250} showValue disabled />
    </Surface>
  ),
};
