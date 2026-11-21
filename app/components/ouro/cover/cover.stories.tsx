import type { Meta, StoryObj } from "@storybook/react-vite";
import { Cover } from "~/components/ouro/cover/cover";
import { Item } from "~/components/ouro/item/item";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

const meta = {
  title: "Display/Cover",
  component: Cover,
  parameters: { layout: "padded" },
  args: { title: "Lemon rice", size: "lg" },
  argTypes: {
    size: { control: "inline-radio", options: ["sm", "md", "lg", "fill"] },
    shape: { control: "inline-radio", options: ["rounded", "square"] },
  },
} satisfies Meta<typeof Cover>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

/** Recipes in a list, each row led by its cover: the initial where a recipe has no picture yet. */
export const InContext: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 4, maxWidth: 480, color: "var(--foreground)" }}>
      <Item media={<Cover title="Lemon rice" />} title="Lemon rice" description="Serves 4" />
      <Item media={<Cover title="Green curry" />} title="Green curry" description="Serves 2" />
      <Item media={<Cover title="Oat cookies" />} title="Oat cookies" description="Makes 24" />
    </div>
  ),
};

/** A page's hero: the cover at its container's width. */
export const Hero: Story = {
  render: () => (
    <div style={{ maxWidth: 480 }}>
      <Cover title="Lemon rice" size="fill" className="aspect-[4/3]" />
    </div>
  ),
};
