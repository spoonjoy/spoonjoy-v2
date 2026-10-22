import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ReactNode } from "react";
import { Button } from "~/components/ouro/button/button";
import { Checklist, type ChecklistItemData } from "~/components/ouro/checklist/checklist";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

/** A themed panel. It follows the page's scheme (the `.dark` class on the root). */
function Surface({ children, dir }: { children: ReactNode; dir?: "rtl" }) {
  return (
    <div
      dir={dir}
      style={{
        background: "var(--background)",
        color: "var(--foreground)",
        border: "1px solid var(--border)",
        borderRadius: "calc(var(--radius) + 4px)",
        padding: 20,
        display: "grid",
        gap: 16,
        maxWidth: 420,
      }}
    >
      {children}
    </div>
  );
}

const oats: ChecklistItemData[] = [
  { id: "oats", label: "rolled oats", value: "1 cup", checked: true },
  { id: "milk", label: "milk", description: "or oat milk", value: "1 cup", checked: true },
  { id: "yogurt", label: "Greek yogurt", value: "½ cup", checked: false },
  { id: "chia", label: "chia seeds", value: "2 tbsp", checked: false },
  { id: "maple", label: "maple syrup", value: "1 tbsp", checked: false },
  { id: "berries", label: "berries, to serve", checked: false },
];

/** Holds the items as an app's state does: a toggle checks one, Clear checked unchecks them all. */
function useItems(initial: ChecklistItemData[]) {
  const [items, setItems] = useState(initial);
  return {
    items,
    setItems,
    onCheckedChange: (id: string, checked: boolean) => setItems((list) => list.map((item) => (item.id === id ? { ...item, checked } : item))),
    onClearChecked: () => setItems((list) => list.map((item) => ({ ...item, checked: false }))),
  };
}

function Ingredients({ initial = oats, ...rest }: { initial?: ChecklistItemData[] | undefined; description?: string | undefined; hideLabel?: boolean | undefined }) {
  const state = useItems(initial);
  return <Checklist label="Ingredients" items={state.items} onCheckedChange={state.onCheckedChange} onClearChecked={state.onClearChecked} {...rest} />;
}

const meta = {
  title: "Lists/Checklist",
  component: Checklist,
  parameters: { layout: "padded" },
  args: { label: "Ingredients", items: oats, onCheckedChange: () => {} },
  argTypes: {
    hideLabel: { control: "boolean" },
    description: { control: "text" },
    clearLabel: { control: "text" },
  },
  render: (args) => (
    <Surface>
      <Ingredients initial={args.items as ChecklistItemData[]} description={args.description as string | undefined} hideLabel={args.hideLabel} />
    </Surface>
  ),
} satisfies Meta<typeof Checklist>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try the props: tick rows off, then clear them. */
export const Playground: Story = {};

/** A recipe's ingredients in cook mode: two ticked off, four to go. */
export const InContext: Story = {
  parameters: { screenshot: { name: "checklist-in-context" } },
  render: () => (
    <Surface>
      <div style={{ display: "grid", gap: 4 }}>
        <h2 style={{ margin: 0, fontSize: 20, lineHeight: "28px", fontWeight: 600 }}>Overnight oats</h2>
        <p style={{ margin: 0, fontSize: 14, color: "var(--muted-foreground)" }}>Serves 2 · 5 minutes, then overnight</p>
      </div>
      <Ingredients description="Tick each one off as it goes in the jar." />
    </Surface>
  ),
};

/** A shopping list: checked rows leave when cleared, and new ones arrive at the end. */
function ShoppingList() {
  const [items, setItems] = useState<ChecklistItemData[]>(() =>
    ["bananas", "eggs", "sourdough", "butter", "spinach", "lemons", "parmesan", "olive oil", "garlic", "basil", "rice", "coffee"].map((label, index) => ({ id: label, label, checked: index % 3 === 0 })),
  );
  const [next, setNext] = useState(1);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Checklist
        label="Shopping list"
        items={items}
        onCheckedChange={(id, checked) => setItems((list) => list.map((item) => (item.id === id ? { ...item, checked } : item)))}
        onClearChecked={() => setItems((list) => list.filter((item) => !item.checked))}
        clearLabel="Remove checked"
        empty="Nothing left to buy."
      />
      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setItems((list) => [...list, { id: `extra-${next}`, label: `extra item ${next}`, checked: false }]);
            setNext((count) => count + 1);
          }}
        >
          Add an item
        </Button>
      </div>
    </div>
  );
}

/** A long list whose checked rows leave, and to which rows can be added. */
export const LongList: Story = {
  render: () => (
    <Surface>
      <ShoppingList />
    </Surface>
  ),
};

/** Right to left: the box at the start, the value at the end, and the strike drawn from the right. */
export const RTL: Story = {
  render: () => (
    <Surface dir="rtl">
      <Ingredients
        initial={[
          { id: "flour", label: "קמח", value: "2 כוסות", checked: true },
          { id: "sugar", label: "סוכר", value: "חצי כוס", checked: false },
          { id: "eggs", label: "ביצים", value: "3", checked: false },
        ]}
      />
    </Surface>
  ),
};

/** No rows yet: the `empty` content shows. */
export const Empty: Story = {
  render: () => (
    <Surface>
      <Checklist label="Shopping list" items={[]} onCheckedChange={() => {}} empty="Nothing on the list yet." />
    </Surface>
  ),
};

/** Each row with an action of its own beside it: its own tab stop, which does not toggle the row. */
function WithActionsList() {
  const state = useItems(oats.slice(0, 4));
  const [swapped, setSwapped] = useState<string | null>(null);
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <Checklist
        label="Ingredients"
        items={state.items.map((item) => ({
          ...item,
          action: (
            <Button variant="plain" size="sm" onClick={() => setSwapped(item.label)}>
              Swap<span className="sr-only"> {item.label}</span>
            </Button>
          ),
        }))}
        onCheckedChange={state.onCheckedChange}
        onClearChecked={state.onClearChecked}
      />
      <p style={{ margin: 0, fontSize: 14, color: "var(--muted-foreground)" }}>{swapped ? `Finding a swap for ${swapped}.` : "Choose Swap to find a substitute."}</p>
    </div>
  );
}

/** Rows with an action each: Swap finds a substitute without ticking the row. */
export const WithActions: Story = {
  render: () => (
    <Surface>
      <WithActionsList />
    </Surface>
  ),
};
