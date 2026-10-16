import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { Collapsible } from "~/components/ouro/collapsible/collapsible";
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
        gap: 16,
        maxWidth: 420,
      }}
    >
      {children}
    </div>
  );
}

const meta = {
  title: "Lists/Collapsible",
  component: Collapsible,
  parameters: { layout: "padded" },
  args: {
    title: "Nutrition facts",
    children: <Text>Per serving: 420 calories, 18g protein, 12g fat, 54g carbohydrate.</Text>,
  },
  argTypes: { disabled: { control: "boolean" }, defaultOpen: { control: "boolean" } },
} satisfies Meta<typeof Collapsible>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

/** Under a recipe: one section closed, one open. */
export const InContext: Story = {
  parameters: { screenshot: { name: "collapsible" } },
  render: (args) => (
    <Surface>
      <Text>Short ribs braised in red wine, with polenta.</Text>
      <Collapsible {...args} />
      <Collapsible title="Equipment" defaultOpen>
        <Text>A heavy pot with a lid, and tongs.</Text>
      </Collapsible>
    </Surface>
  ),
};
