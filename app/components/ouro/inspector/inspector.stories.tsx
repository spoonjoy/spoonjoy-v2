import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ReactNode } from "react";
import { Badge } from "~/components/ouro/badge/badge";
import { Button } from "~/components/ouro/button/button";
import { Checklist, type ChecklistItemData } from "~/components/ouro/checklist/checklist";
import { Inspector } from "~/components/ouro/inspector/inspector";
import { Switch } from "~/components/ouro/switch/switch";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

const docsHref = (item: string) => `https://ui.ouro.bot/docs/${item}/`;

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
        gap: 20,
        maxWidth: 420,
      }}
    >
      {children}
    </div>
  );
}

const ingredients: ChecklistItemData[] = [
  { id: "oats", label: "rolled oats", value: "1 cup", checked: true },
  { id: "milk", label: "milk", value: "1 cup", checked: false },
  { id: "chia", label: "chia seeds", value: "2 tbsp", checked: false },
];

/** A recipe page with X-ray on: every Ouro component outlined and tagged, and the list a tap away. */
function RecipePage({ initiallyOpen, sources }: { initiallyOpen: boolean; sources?: boolean }) {
  const [xray, setXray] = useState(initiallyOpen);
  const [items, setItems] = useState(ingredients);
  return (
    <Surface>
      <Switch label="X-ray" description="Outline every Ouro component on this page." checked={xray} onCheckedChange={setXray} />
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 20, lineHeight: "28px", fontWeight: 600 }}>Overnight oats</h2>
        <Badge tone="success" variant="soft">
          Vegetarian
        </Badge>
      </div>
      <Checklist
        label="Ingredients"
        items={items}
        onCheckedChange={(id, checked) => setItems((list) => list.map((item) => (item.id === id ? { ...item, checked } : item)))}
      />
      <Button>Start cooking</Button>
      <Inspector
        open={xray}
        onOpenChange={setXray}
        docsHref={docsHref}
        {...(sources ? { sourceHref: (item: string) => `https://github.com/ourostack/ouro-ui/tree/main/registry/ouro/components/ouro/${item}` } : {})}
      />
    </Surface>
  );
}

const meta = {
  title: "App setup/Inspector",
  component: Inspector,
  parameters: { layout: "padded" },
  args: { open: true, onOpenChange: () => {}, docsHref },
} satisfies Meta<typeof Inspector>;
export default meta;

type Story = StoryObj<typeof meta>;

/** X-ray off: turn it on with the switch. */
export const Playground: Story = {
  render: () => <RecipePage initiallyOpen={false} />,
};

/** X-ray on over a recipe page, with docs and source links in its list. */
export const InContext: Story = {
  render: () => <RecipePage initiallyOpen sources />,
};
