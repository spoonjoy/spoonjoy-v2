import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { NumberField } from "~/components/ouro/number-field/number-field";

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
  title: "Forms/NumberField",
  component: NumberField,
  parameters: { layout: "padded" },
  args: { label: "Servings", name: "servings", defaultValue: 4, min: 1, max: 24 },
  argTypes: {
    required: { control: "boolean" },
    disabled: { control: "boolean" },
    readOnly: { control: "boolean" },
    hideLabel: { control: "boolean" },
    error: { control: "text" },
    description: { control: "text" },
  },
} satisfies Meta<typeof NumberField>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. Drag the label sideways with a mouse to scrub. */
export const Playground: Story = {};

/** Currency, percent and units, formatted for the locale, with steps that fit each. */
export const Formats: Story = {
  parameters: { screenshot: { name: "number-field-formats" } },
  render: () => (
    <Surface>
      <NumberField label="Price" name="price" defaultValue={4.5} min={0} step={0.5} format={{ style: "currency", currency: "USD" }} />
      <NumberField label="Hydration" name="hydration" defaultValue={0.7} min={0} max={1} step={0.01} format={{ style: "percent" }} />
      <NumberField label="Flour" name="flour" defaultValue={500} min={0} step={10} largeStep={100} format={{ style: "unit", unit: "gram" }} />
      <NumberField label="Preis" name="preis" defaultValue={1234.5} format={{ style: "currency", currency: "EUR" }} locale="de-DE" decrementLabel="Weniger" incrementLabel="Mehr" />
    </Surface>
  ),
};

/** Described, required, invalid, read-only and disabled. */
export const States: Story = {
  parameters: { screenshot: { name: "number-field-states" } },
  render: () => (
    <Surface>
      <NumberField label="Servings" name="servings" required description="Scales the shopping list." defaultValue={4} min={1} />
      <NumberField label="Oven" name="oven" error="Ovens go up to 250°C." defaultValue={300} max={250} />
      <NumberField label="Calories" name="calories" readOnly defaultValue={640} description="Worked out from the ingredients." />
      <NumberField label="Prep time" name="prep" disabled defaultValue={15} />
    </Surface>
  ),
};
