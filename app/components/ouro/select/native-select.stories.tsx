import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { NativeSelect } from "~/components/ouro/select/native-select";

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

const countries = [
  { label: "Oceania", options: [{ value: "au", label: "Australia" }, { value: "nz", label: "New Zealand" }] },
  { label: "Africa", options: [{ value: "ke", label: "Kenya" }, { value: "za", label: "South Africa" }] },
];

const meta = {
  title: "Forms/NativeSelect",
  component: NativeSelect,
  parameters: { layout: "padded" },
  args: { label: "Country", name: "country", autoComplete: "country", placeholder: "Choose a country", options: countries },
  argTypes: {
    required: { control: "boolean" },
    disabled: { control: "boolean" },
    hideLabel: { control: "boolean" },
    error: { control: "text" },
    description: { control: "text" },
  },
} satisfies Meta<typeof NativeSelect>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

/** A required placeholder, a chosen value, an error, and a disabled select. */
export const States: Story = {
  parameters: { screenshot: { name: "native-select-states" } },
  render: () => (
    <Surface>
      <NativeSelect label="Country" name="country" autoComplete="country" placeholder="Choose a country" required description="Where we ship the box." options={countries} />
      <NativeSelect label="Unit" name="unit" defaultValue="g" options={[{ value: "g", label: "Grams" }, { value: "oz", label: "Ounces" }]} />
      <NativeSelect label="Oven" name="oven" error="Choose how your oven heats." defaultValue="" placeholder="Choose one">
        <option value="fan">Fan</option>
        <option value="conventional">Conventional</option>
      </NativeSelect>
      <NativeSelect label="Language" name="language" disabled defaultValue="en" options={[{ value: "en", label: "English" }]} />
    </Surface>
  ),
};
