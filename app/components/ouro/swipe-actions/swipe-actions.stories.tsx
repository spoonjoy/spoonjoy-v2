import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ReactNode } from "react";
import { Item } from "~/components/ouro/item/item";
import { ItemGroup } from "~/components/ouro/item/item-group";
import { SwipeActions } from "~/components/ouro/swipe-actions/swipe-actions";
import { Toaster } from "~/components/ouro/toast/toaster";
import { toast } from "~/lib/ouro/toast";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

function Page({ children }: { children: ReactNode }) {
  return <div style={{ background: "var(--background)", color: "var(--foreground)", padding: 24, maxWidth: 480 }}>{children}</div>;
}

const meta = {
  title: "Lists/SwipeActions",
  component: SwipeActions,
  parameters: { layout: "padded" },
  args: {
    label: "Braised short ribs",
    children: <Item title="Braised short ribs" description="Swipe the row on a touch screen, or use its actions button" />,
    leading: [{ label: "Pin", tone: "primary", onClick: () => {} }],
    trailing: [
      { label: "Delete", tone: "destructive", onClick: () => {} },
      { label: "Archive", onClick: () => {} },
    ],
  },
  argTypes: { children: { control: false } },
  render: (args) => (
    <Page>
      <SwipeActions {...args} />
    </Page>
  ),
} satisfies Meta<typeof SwipeActions>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

const recipes = [
  { id: "shakshuka", title: "Shakshuka", note: "Thirty minutes" },
  { id: "short-ribs", title: "Braised short ribs", note: "Four hours, mostly hands-off" },
  { id: "lemon-tart", title: "Lemon tart", note: "Make the day before" },
];

function RecipeList() {
  const [list, setList] = useState(recipes);
  const [pinned, setPinned] = useState<string[]>([]);
  return (
    <Page>
      <ItemGroup label="Recipes" empty="No recipes left.">
        {list.map((recipe) => (
          <SwipeActions
            key={recipe.id}
            label={recipe.title}
            leading={[
              {
                label: pinned.includes(recipe.id) ? "Unpin" : "Pin",
                tone: "primary",
                onClick: () => setPinned((ids) => (ids.includes(recipe.id) ? ids.filter((id) => id !== recipe.id) : [...ids, recipe.id])),
              },
            ]}
            trailing={[
              {
                label: "Delete",
                tone: "destructive",
                // A full swipe deletes at once, so the toast offers the way back.
                onClick: () => {
                  setList((rows) => rows.filter((row) => row.id !== recipe.id));
                  toast(`${recipe.title} deleted`, {
                    action: { label: "Undo", onClick: () => setList((rows) => recipes.filter((row) => row.id === recipe.id || rows.includes(row))) },
                  });
                },
              },
              { label: "Share", onClick: () => toast(`Link to ${recipe.title} copied`) },
            ]}
          >
            <Item href={`#${recipe.id}`} title={recipe.title} description={pinned.includes(recipe.id) ? `Pinned · ${recipe.note}` : recipe.note} />
          </SwipeActions>
        ))}
      </ItemGroup>
      <Toaster />
    </Page>
  );
}

/** Recipe rows that are links: swipe one, or use its actions button. Delete removes the row and offers Undo in a toast. */
export const InContext: Story = {
  parameters: { screenshot: { name: "swipe-actions" } },
  render: () => <RecipeList />,
};
