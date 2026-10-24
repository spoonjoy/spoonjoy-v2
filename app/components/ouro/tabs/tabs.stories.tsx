import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { Tabs } from "~/components/ouro/tabs/tabs";
import { TabsIndicator, TabsList, TabsPanel, TabsRoot, TabsTab } from "~/components/ouro/tabs/tabs-parts";
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
        gap: 24,
        maxWidth: 560,
      }}
    >
      {children}
    </div>
  );
}

const recipe = [
  {
    value: "ingredients",
    label: "Ingredients",
    content: <Text>2 cups flour, 1 cup water, 1 tsp salt, 1 tsp yeast.</Text>,
  },
  {
    value: "method",
    label: "Method",
    content: <Text>Mix, knead for ten minutes, then let it rise until doubled.</Text>,
  },
  { value: "notes", label: "Notes", content: <Text>The dough keeps overnight in the fridge.</Text> },
];

const meta = {
  title: "Navigation/Tabs",
  component: Tabs,
  parameters: { layout: "padded" },
  args: { label: "Recipe", items: recipe },
  argTypes: {
    orientation: { control: "inline-radio", options: ["horizontal", "vertical"] },
    activation: { control: "inline-radio", options: ["automatic", "manual"] },
  },
} satisfies Meta<typeof Tabs>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

/** A recipe's sections, as an app shows them. */
export const InContext: Story = {
  parameters: { screenshot: { name: "tabs" } },
  render: (args) => (
    <Surface>
      <Tabs {...args} />
    </Surface>
  ),
};

/** Tabs in a column beside the panel, for settings pages. */
export const Vertical: Story = {
  args: {
    label: "Settings",
    orientation: "vertical",
    items: [
      { value: "profile", label: "Profile", content: <Text>Your name and photo.</Text> },
      { value: "kitchen", label: "Kitchen", content: <Text>Units and default servings.</Text> },
      { value: "sharing", label: "Sharing", content: <Text>Who can see your cookbooks.</Text>, disabled: true },
    ],
  },
  parameters: { screenshot: { name: "tabs-vertical" } },
  render: (args) => (
    <Surface>
      <Tabs {...args} />
    </Surface>
  ),
};

/** Built from parts, for a tab that holds more than its label. */
export const Parts: Story = {
  render: () => (
    <Surface>
      <TabsRoot defaultValue="saved">
        <TabsList aria-label="Recipes">
          <TabsTab value="saved">Saved</TabsTab>
          <TabsTab value="drafts">
            Drafts{" "}
            <span aria-hidden="true" style={{ fontVariantNumeric: "tabular-nums", color: "var(--muted-foreground)" }}>
              3
            </span>
            <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" }}>
              , 3 recipes
            </span>
          </TabsTab>
          <TabsIndicator />
        </TabsList>
        <TabsPanel value="saved">
          <Text>Twelve saved recipes.</Text>
        </TabsPanel>
        <TabsPanel value="drafts">
          <Text>Three drafts.</Text>
        </TabsPanel>
      </TabsRoot>
    </Surface>
  ),
};

const searchScopes = [
  { value: "all", label: "All", href: "/search?q=soup" },
  { value: "recipes", label: "Recipes", href: "/search?q=soup&scope=recipes" },
  { value: "cookbooks", label: "Cookbooks", href: "/search?q=soup&scope=cookbooks" },
  { value: "chefs", label: "Chefs", href: "/search?q=soup&scope=chefs" },
];

/**
 * Tabs that are links, for views of one page that each have a URL: a search's scopes. The
 * current one comes from the router's path and is marked `aria-current="page"`.
 */
export const Links: Story = {
  parameters: { mode: "links" },
  render: () => (
    <Surface>
      <Tabs label="Search scope" items={searchScopes} currentPath="/search?q=soup&scope=recipes" />
      <Text>Twelve recipes with soup in them.</Text>
    </Surface>
  ),
};

/** Links in a column, for a search's scopes beside its results. On a phone they become a row. */
export const LinksVertical: Story = {
  parameters: { mode: "links" },
  render: () => (
    <Surface>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
        <Tabs label="Search scope" orientation="vertical" items={searchScopes} currentPath="/search?q=soup&scope=chefs" />
        <Text>Three chefs who make soup.</Text>
      </div>
    </Surface>
  ),
};
