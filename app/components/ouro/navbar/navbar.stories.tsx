import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { Button } from "~/components/ouro/button/button";
import { Navbar } from "~/components/ouro/navbar/navbar";
import { Text } from "~/components/ouro/text/text";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

/** A themed frame. It follows the page's scheme (the `.dark` class on the root). */
function Surface({ children, height }: { children: ReactNode; height?: number }) {
  return (
    <div
      style={{
        background: "var(--background)",
        color: "var(--foreground)",
        border: "1px solid var(--border)",
        borderRadius: "calc(var(--radius) + 4px)",
        overflow: "hidden",
        height,
      }}
    >
      {children}
    </div>
  );
}

const items = [
  { label: "Recipes", href: "/recipes" },
  { label: "Cookbooks", href: "/cookbooks" },
  { label: "Shopping list", href: "/shopping-list" },
];

const meta = {
  title: "Navigation/Navbar",
  component: Navbar,
  parameters: { layout: "padded" },
  args: { label: "Main", items, currentPath: "/recipes" },
} satisfies Meta<typeof Navbar>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. Narrow the window below 640px to see the menu button. */
export const Playground: Story = {};

/** An app's top bar: brand, sections and an action. On a phone the sections move into a sheet. */
export const InContext: Story = {
  parameters: { screenshot: { name: "navbar" } },
  render: (args) => (
    <Surface>
      <Navbar
        {...args}
        brand={
          <Text>
            <strong>Spoonjoy</strong>
          </Text>
        }
        actions={
          <Button size="sm" href="/recipes/new">
            New recipe
          </Button>
        }
      />
      <div style={{ padding: 24 }}>
        <Text>Twelve saved recipes.</Text>
      </div>
    </Surface>
  ),
};

/** A group of links opens a panel in the bar, and is listed under its name in the phone's sheet. */
export const Groups: Story = {
  args: {
    currentPath: "/recipes/drafts",
    items: [
      {
        label: "Recipes",
        links: [
          { label: "Browse", href: "/recipes", description: "Everything you have saved." },
          { label: "Drafts", href: "/recipes/drafts", description: "Recipes you have not finished." },
        ],
      },
      { label: "Cookbooks", href: "/cookbooks" },
    ],
  },
};
