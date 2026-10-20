import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { Button } from "~/components/ouro/button/button";
import { Separator } from "~/components/ouro/separator/separator";
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
      }}
    >
      {children}
    </div>
  );
}

const meta = {
  title: "Display/Separator",
  component: Separator,
  parameters: { layout: "padded" },
  argTypes: {
    orientation: { control: "inline-radio", options: ["horizontal", "vertical"] },
    decorative: { control: "boolean" },
  },
  render: (args) => (
    <Surface>
      <div style={{ display: "flex", flexDirection: args.orientation === "vertical" ? "row" : "column", gap: 12, minHeight: 48 }}>
        <Text>Ingredients</Text>
        <Separator {...args} />
        <Text>Method</Text>
      </div>
    </Surface>
  ),
} satisfies Meta<typeof Separator>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

/** Between sections, and between actions in a row. */
export const InContext: Story = {
  parameters: { screenshot: { name: "separator" } },
  render: () => (
    <Surface>
      <Text>Brown the short ribs in batches, then set them aside.</Text>
      <Separator />
      <Text>Soften the onions in the same pot, scraping up the browned bits.</Text>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Button variant="plain" tone="secondary" size="sm">
          Edit
        </Button>
        <Separator orientation="vertical" decorative className="my-2" />
        <Button variant="plain" tone="secondary" size="sm">
          Share
        </Button>
      </div>
    </Surface>
  ),
};
