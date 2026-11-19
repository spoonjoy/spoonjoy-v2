import type { Meta, StoryObj } from "@storybook/react-vite";
import { Item } from "~/components/ouro/item/item";
import { Link } from "~/components/ouro/link/link";
import { SectionHeader } from "~/components/ouro/section-header/section-header";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

const meta = {
  title: "Layout/SectionHeader",
  component: SectionHeader,
  parameters: { layout: "padded" },
  args: { title: "Your recipes", meta: "2 recipes · 2 cookbooks" },
  argTypes: { level: { control: "inline-radio", options: [2, 3] } },
} satisfies Meta<typeof SectionHeader>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

/** Two sections of a kitchen page, each with its count and a link to the whole list. */
export const InContext: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 32, maxWidth: 640, color: "var(--foreground)" }}>
      <section style={{ display: "grid", gap: 12 }}>
        <SectionHeader title="Your recipes" meta="2 recipes" actions={<Link href="#recipes">See all</Link>} />
        <Item title="Lemon rice" description="Serves 4" />
        <Item title="Green curry" description="Serves 2" />
      </section>
      <section style={{ display: "grid", gap: 12 }}>
        <SectionHeader title="Cookbook shelf" meta="2 shelves" />
        <Item title="Weeknights" description="12 recipes" />
      </section>
    </div>
  ),
};
