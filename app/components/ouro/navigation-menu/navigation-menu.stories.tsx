import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { NavigationMenu } from "~/components/ouro/navigation-menu/navigation-menu";
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
      }}
    >
      {children}
    </div>
  );
}

const items = [
  {
    label: "Recipes",
    links: [
      { label: "Browse", href: "/recipes", description: "Everything you have saved." },
      { label: "Drafts", href: "/recipes/drafts", description: "Recipes you have not finished." },
      { label: "Import", href: "/recipes/import", description: "Bring one in from a link." },
    ],
  },
  {
    label: "Cookbooks",
    links: [
      { label: "Yours", href: "/cookbooks" },
      { label: "Shared with you", href: "/cookbooks/shared" },
    ],
  },
  { label: "Pricing", href: "/pricing" },
];

const meta = {
  title: "Navigation/NavigationMenu",
  component: NavigationMenu,
  parameters: { layout: "padded" },
  args: { label: "Main", items, currentPath: "/recipes/drafts" },
} satisfies Meta<typeof NavigationMenu>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {
  parameters: { plainOpeners: ["Recipes"] },
};

/** A site's main navigation: two panels of links and a plain link. */
export const InContext: Story = {
  parameters: { screenshot: { name: "navigation-menu" } },
  render: (args) => (
    <Surface>
      <NavigationMenu {...args} />
      <Text>Hover or press Recipes to open its panel.</Text>
    </Surface>
  ),
};

/** A panel with a featured card beside a two-column grid of links, and a panel of content alone. */
export const Featured: Story = {
  args: {
    currentPath: undefined,
    items: [
      {
        label: "Recipes",
        columns: 2,
        content: (
          <a
            href="/recipes/short-ribs"
            style={{
              display: "grid",
              alignContent: "end",
              gap: 4,
              height: "100%",
              minHeight: 160,
              boxSizing: "border-box",
              padding: 16,
              borderRadius: "var(--radius)",
              background: "var(--muted)",
              color: "var(--foreground)",
              textDecoration: "none",
            }}
          >
            <strong>Short ribs of the week</strong>
            <span style={{ color: "var(--muted-foreground)", fontSize: 14 }}>Braised for six hours.</span>
          </a>
        ),
        links: [
          { label: "Browse", href: "/recipes", description: "Everything you have saved." },
          { label: "Drafts", href: "/recipes/drafts", description: "Recipes you have not finished." },
          { label: "Import", href: "/recipes/import", description: "Bring one in from a link." },
          { label: "Tags", href: "/recipes/tags", description: "Group them your way." },
        ],
      },
      { label: "Help", content: <Text>Write to us any time at help@example.com.</Text> },
      { label: "Pricing", href: "/pricing" },
    ],
  },
  render: (args) => (
    <Surface>
      <NavigationMenu {...args} />
      <Text>Hover or press Recipes to open its panel.</Text>
    </Surface>
  ),
};
