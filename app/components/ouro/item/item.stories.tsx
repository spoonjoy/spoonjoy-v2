import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { Button } from "~/components/ouro/button/button";
import { Item } from "~/components/ouro/item/item";
import { ItemGroup } from "~/components/ouro/item/item-group";
import { Text } from "~/components/ouro/text/text";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

/** A recipe photo as an inline SVG, so the story makes no request. */
function photo(from: string, to: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="1" height="1" fill="url(#g)"/><circle cx=".5" cy=".5" r=".3" fill="#fff" fill-opacity=".85"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function Page({ children }: { children: ReactNode }) {
  return <div style={{ background: "var(--background)", color: "var(--foreground)", padding: 24, display: "grid", gap: 16 }}>{children}</div>;
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

const meta = {
  title: "Lists/Item",
  component: Item,
  parameters: { layout: "padded" },
  args: { title: "Braised short ribs", description: "Four hours, mostly hands-off" },
  argTypes: {
    variant: { control: "inline-radio", options: ["plain", "outline"] },
    size: { control: "inline-radio", options: ["md", "sm"] },
    mediaSize: { control: "inline-radio", options: ["icon", "sm", "md", "lg"] },
  },
} satisfies Meta<typeof Item>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

/** A recipe row that is a link with a save action, a settings row whose action drops under it on a phone, and an icon row. */
export const InContext: Story = {
  parameters: { screenshot: { name: "item" } },
  render: () => (
    <Page>
      <Item
        variant="outline"
        href="#short-ribs"
        media={<img src={photo("#f59e0b", "#7c2d12")} alt="" />}
        mediaSize="lg"
        title="Braised short ribs"
        description={
          <Text as="span" size="sm" tone="muted" lines={2}>
            Seared hard, then braised low in red wine and stock until they fall apart. Rest overnight for the best flavor.
          </Text>
        }
        actions={
          <Button variant="outline" size="sm">
            Save
          </Button>
        }
      />
      <Item
        variant="outline"
        title="Sync token"
        description="sj_4f2a… · recipes:read, cookbooks:read · Created May 2"
        actions={
          <Button tone="destructive" variant="soft" size="sm">
            Revoke
          </Button>
        }
        stackBelow="sm"
      />
      <Item variant="outline" media={<BellIcon />} mediaSize="icon" title="Notifications" description="When a cook saves your recipe" size="sm" />
    </Page>
  ),
};

/** A recipe list: rows with the photo beside the text, and on a phone the photo full width above it. */
export const RecipeList: Story = {
  render: () => (
    <Page>
      <ItemGroup label="Recipes">
        {[
          { title: "Braised short ribs", time: "Four hours", colors: ["#f59e0b", "#7c2d12"] },
          { title: "Lemon olive oil cake", time: "One hour", colors: ["#fde047", "#a16207"] },
        ].map((recipe) => (
          <Item
            key={recipe.title}
            href={`#${recipe.title.toLowerCase().replace(/ /g, "-")}`}
            media={<img src={photo(recipe.colors[0]!, recipe.colors[1]!)} alt="" />}
            mediaSize="lg"
            mediaAbove="sm"
            title={recipe.title}
            description={recipe.time}
          />
        ))}
      </ItemGroup>
    </Page>
  ),
};
