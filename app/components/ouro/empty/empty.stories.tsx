import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { Button } from "~/components/ouro/button/button";
import { Empty } from "~/components/ouro/empty/empty";
import { Heading } from "~/components/ouro/text/heading";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

function Page({ children }: { children: ReactNode }) {
  return <div style={{ background: "var(--background)", color: "var(--foreground)", padding: 24, display: "grid", gap: 24 }}>{children}</div>;
}

function BookIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
    </svg>
  );
}

const meta = {
  title: "Display/Empty",
  component: Empty,
  parameters: { layout: "padded" },
  args: { title: "No recipes yet", description: "Start by creating your first recipe for this pantry." },
  argTypes: {
    variant: { control: "inline-radio", options: ["outline", "plain"] },
    align: { control: "inline-radio", options: ["center", "start"] },
  },
} satisfies Meta<typeof Empty>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

/** An empty pantry with its way out, and a plain, start-aligned empty list. */
export const InContext: Story = {
  parameters: { screenshot: { name: "empty" } },
  render: () => (
    <Page>
      <Heading level={2}>Recipes</Heading>
      <Empty
        icon={<BookIcon />}
        title="No recipes yet"
        description="Start by creating your first recipe for this pantry."
        action={<Button href="#new">Create recipe</Button>}
      />
      <Empty variant="plain" align="start" title="No saved recipes" description="Save a recipe and it shows up here." />
    </Page>
  ),
};
