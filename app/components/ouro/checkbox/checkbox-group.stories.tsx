import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { Checkbox } from "~/components/ouro/checkbox/checkbox";
import { CheckboxGroup } from "~/components/ouro/checkbox/checkbox-group";

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

const herbs = [
  { value: "basil", label: "Basil", description: "Sweet and peppery." },
  { value: "mint", label: "Mint" },
  { value: "sage", label: "Sage" },
  { value: "dill", label: "Dill", disabled: true, description: "Out of season." },
];

const meta = {
  title: "Forms/CheckboxGroup",
  component: CheckboxGroup,
  parameters: { layout: "padded" },
  args: { legend: "Herbs", name: "herbs", options: herbs, defaultValue: ["basil"] },
  argTypes: {
    required: { control: "boolean" },
    disabled: { control: "boolean" },
    hideLegend: { control: "boolean" },
    error: { control: "text" },
    description: { control: "text" },
  },
} satisfies Meta<typeof CheckboxGroup>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

/** Choices from `options`, with descriptions and one disabled choice. */
export const Herbs: Story = {
  parameters: { screenshot: { name: "checkbox-group-herbs" } },
  render: () => (
    <Surface>
      <CheckboxGroup legend="Herbs" name="herbs" description="Pick any you have fresh." options={herbs} defaultValue={["basil", "sage"]} />
    </Surface>
  ),
};

/** Required with an error, and the whole group disabled. */
export const States: Story = {
  parameters: { screenshot: { name: "checkbox-group-states" } },
  render: () => (
    <Surface>
      <CheckboxGroup legend="Diet" name="diet" required error="Pick at least one." options={[{ value: "vegetarian", label: "Vegetarian" }, { value: "vegan", label: "Vegan" }]} />
      <CheckboxGroup legend="Allergens" name="allergens" disabled description="Set by your household." options={[{ value: "nuts", label: "Nuts" }, { value: "gluten", label: "Gluten" }]} defaultValue={["nuts"]} />
    </Surface>
  ),
};

/** `Checkbox` children, for choices `options` cannot express. */
export const Children: Story = {
  render: () => (
    <Surface>
      <CheckboxGroup legend="Notify me" name="notify" defaultValue={["new"]}>
        <Checkbox value="new" label="New recipes" description={<>From cooks you follow, <strong>daily</strong>.</>} />
        <Checkbox value="comments" label="Comments on my recipes" />
      </CheckboxGroup>
    </Surface>
  ),
};
