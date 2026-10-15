import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { Button } from "~/components/ouro/button/button";
import { Item } from "~/components/ouro/item/item";
import { ItemGroup } from "~/components/ouro/item/item-group";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

/** A recipe photo as an inline SVG, so the story makes no request. */
function photo(from: string, to: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="1" height="1" fill="url(#g)"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function Page({ children }: { children: ReactNode }) {
  return <div style={{ background: "var(--background)", color: "var(--foreground)", padding: 24, display: "grid", gap: 24 }}>{children}</div>;
}

const recipes = [
  { slug: "short-ribs", title: "Braised short ribs", by: "Ari · 4 servings", colors: ["#f59e0b", "#7c2d12"] },
  { slug: "lemon-pasta", title: "Lemon pasta", by: "Sam · 2 servings", colors: ["#fde047", "#a16207"] },
  { slug: "green-curry", title: "Green curry", by: "Noor · 6 servings", colors: ["#86efac", "#166534"] },
];

const credentials = [
  { id: "cli", name: "CLI", detail: "sj_9c1d… · recipes:read · Last used today" },
  { id: "sync", name: "Sync", detail: "sj_4f2a… · recipes:read, cookbooks:write · Created May 2" },
];

const meta = {
  title: "Lists/ItemGroup",
  component: ItemGroup,
  parameters: { layout: "padded" },
  args: { label: "Recipes" },
  argTypes: { variant: { control: "inline-radio", options: ["divided", "outline", "plain"] } },
} satisfies Meta<typeof ItemGroup>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {
  render: (args) => (
    <ItemGroup {...args}>
      {recipes.map((recipe) => (
        <Item key={recipe.slug} href={`#${recipe.slug}`} media={<img src={photo(recipe.colors[0]!, recipe.colors[1]!)} alt="" />} title={recipe.title} description={recipe.by} />
      ))}
    </ItemGroup>
  ),
};

/** Recipe rows that are links, a settings list in an outlined group, and an empty group. */
export const InContext: Story = {
  parameters: { screenshot: { name: "item-group" } },
  render: () => (
    <Page>
      <ItemGroup label="Recently cooked">
        {recipes.map((recipe) => (
          <Item
            key={recipe.slug}
            href={`#${recipe.slug}`}
            media={<img src={photo(recipe.colors[0]!, recipe.colors[1]!)} alt="" />}
            mediaSize="md"
            title={recipe.title}
            description={recipe.by}
          />
        ))}
      </ItemGroup>
      <ItemGroup label="Bearer credentials" variant="outline">
        {credentials.map((credential) => (
          <Item
            key={credential.id}
            title={credential.name}
            description={credential.detail}
            actions={
              <Button tone="destructive" variant="soft" size="sm" aria-label={`Revoke ${credential.name}`}>
                Revoke
              </Button>
            }
            stackBelow="sm"
          />
        ))}
      </ItemGroup>
      <ItemGroup label="OAuth app connections" empty="No active OAuth app connections.">
        {[]}
      </ItemGroup>
    </Page>
  ),
};
