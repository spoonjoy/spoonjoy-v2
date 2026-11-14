import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { Badge } from "~/components/ouro/badge/badge";
import { DescriptionList } from "~/components/ouro/description-list/description-list";
import { Link } from "~/components/ouro/link/link";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

function Page({ children }: { children: ReactNode }) {
  return <div style={{ background: "var(--background)", color: "var(--foreground)", padding: 24, display: "grid", gap: 24, maxWidth: 720 }}>{children}</div>;
}

const meta = {
  title: "Display/DescriptionList",
  component: DescriptionList,
  parameters: { layout: "padded" },
  args: {
    items: [
      { term: "Prep time", details: "20 minutes" },
      { term: "Cook time", details: "4 hours" },
      { term: "Serves", details: "6" },
    ],
  },
  argTypes: { stackBelow: { control: "inline-radio", options: ["sm", "md"] } },
} satisfies Meta<typeof DescriptionList>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

/** A recipe's details: plain values, a link and a badge. The terms sit above their details on a phone. */
export const InContext: Story = {
  parameters: { screenshot: { name: "description-list" } },
  render: () => (
    <Page>
      <DescriptionList
        items={[
          { term: "Prep time", details: "20 minutes" },
          { term: "Cook time", details: "4 hours, mostly hands-off" },
          { term: "Serves", details: "6" },
          { term: "From", details: <Link href="#sunday-bakes">Sunday bakes</Link> },
          { term: "Status", details: <Badge tone="success" variant="soft">Published</Badge> },
        ]}
      />
    </Page>
  ),
};

/** In a 352px side pane on a wide screen, the list measures itself, not the window, so each term sits above its details. */
export const InANarrowPane: Story = {
  parameters: { screenshot: { name: "description-list-narrow-pane" } },
  render: () => (
    // On a phone the pane wraps below the recipe instead of squeezing it to nothing.
    <div style={{ background: "var(--background)", color: "var(--foreground)", padding: 24, display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-start" }}>
      <div style={{ flex: "1 1 12rem", color: "var(--muted-foreground)" }}>The recipe, with its steps and photos.</div>
      <div style={{ width: "min(100%, 352px)", flexShrink: 0, border: "1px solid var(--border)", borderRadius: "calc(var(--radius) + 4px)", padding: 16 }}>
        <DescriptionList
          items={[
            { term: "Saved", details: "You saved it after cooking it twice last month, both times on a Sunday." },
            { term: "Shared", details: "Two friends shared it with you, and one left a note about the oven." },
            { term: "Season", details: "Short ribs are on sale this week at the market you follow." },
          ]}
        />
      </div>
    </div>
  ),
};
