import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ReactNode } from "react";
import { Item } from "~/components/ouro/item/item";
import { Reorderable } from "~/components/ouro/reorderable/reorderable";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

function Page({ children }: { children: ReactNode }) {
  return <div style={{ background: "var(--background)", color: "var(--foreground)", padding: 24, maxWidth: 480, display: "grid", gap: 12 }}>{children}</div>;
}

const steps = [
  { id: "sear", title: "Sear the ribs", text: "Brown them hard on every side." },
  { id: "soften", title: "Soften the onions", text: "Low heat, ten minutes." },
  { id: "wine", title: "Add the wine", text: "Scrape up everything stuck to the pot." },
  { id: "braise", title: "Braise", text: "Three hours at 150°C, covered." },
];

const meta = {
  title: "Lists/Reorderable",
  component: Reorderable,
  parameters: { layout: "padded" },
  args: {
    label: "Steps",
    items: steps.map((step) => ({ id: step.id, label: step.title })),
  },
  argTypes: { items: { control: false } },
  render: (args) => (
    <Page>
      <Reorderable {...args} />
    </Page>
  ),
} satisfies Meta<typeof Reorderable>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. Drag a handle, click or tap one for a menu of moves, or focus one and press Space, then the arrow keys. */
export const Playground: Story = {};

function RecipeSteps() {
  const [order, setOrder] = useState(steps.map((step) => step.id));
  return (
    <Page>
      <Reorderable
        label="Steps"
        items={steps.map((step) => ({ id: step.id, label: step.title, content: <Item title={step.title} description={step.text} /> }))}
        onReorder={setOrder}
      />
      <p data-testid="saved-order" style={{ margin: 0, fontSize: 14, color: "var(--muted-foreground)" }}>
        Saved order: {order.join(", ")}
      </p>
    </Page>
  );
}

/** A recipe's steps as `Item` rows. `onReorder` reports each drop; the line below shows what an app would save. */
export const InContext: Story = {
  parameters: { screenshot: { name: "reorderable" } },
  render: () => <RecipeSteps />,
};

/** A long list that scrolls in place: hold a row near its top or bottom edge to scroll while dragging. */
export const ScrollsInPlace: Story = {
  render: () => (
    <Page>
      <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
        <Reorderable
          label="Shopping list"
          className="max-h-64 overflow-auto px-2"
          items={["Short ribs", "Onions", "Carrots", "Celery", "Garlic", "Tomato paste", "Red wine", "Stock", "Thyme", "Bay leaves"].map((name) => ({
            id: name,
            label: name,
          }))}
        />
      </div>
    </Page>
  ),
};
