import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { Skeleton } from "~/components/ouro/skeleton/skeleton";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

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
        gap: 16,
        maxWidth: 420,
      }}
    >
      {children}
    </div>
  );
}

const meta = {
  title: "Feedback/Skeleton",
  component: Skeleton,
  parameters: { layout: "padded" },
  argTypes: { shape: { control: "inline-radio", options: ["rect", "text", "circle", "row", "card"] } },
} satisfies Meta<typeof Skeleton>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

/** A recipe card while it loads: an avatar, two lines of text and a photo. */
export const RecipeCard: Story = {
  parameters: { screenshot: { name: "skeleton-recipe-card" } },
  render: () => (
    <Surface>
      <div aria-busy="true" aria-label="Loading recipe" role="group" style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Skeleton shape="circle" />
          <div style={{ display: "grid", gap: 8, flex: 1 }}>
            <Skeleton shape="text" className="w-1/2" />
            <Skeleton shape="text" className="w-1/3" />
          </div>
        </div>
        <Skeleton className="h-40" />
        <Skeleton shape="text" />
        <Skeleton shape="text" className="w-4/5" />
      </div>
    </Surface>
  ),
};

/** A paragraph while it loads: three lines of small text, each one line box tall, the last shorter. */
export const Paragraph: Story = {
  render: () => (
    <Surface>
      <div aria-busy="true" aria-label="Loading the note" role="group">
        <Skeleton shape="text" size="sm" lines={3} />
      </div>
    </Surface>
  ),
};

/** Avatars at each of Avatar's sizes. */
export const Avatars: Story = {
  render: () => (
    <Surface>
      <div aria-busy="true" aria-label="Loading people" role="group" style={{ display: "flex", alignItems: "end", gap: 12 }}>
        {(["xs", "sm", "md", "lg", "xl", "2xl"] as const).map((size) => (
          <Skeleton key={size} shape="circle" size={size} />
        ))}
      </div>
    </Surface>
  ),
};

/** A list while it loads: six rows the height of Items with a picture, a title and a description. */
export const ListRows: Story = {
  parameters: { screenshot: { name: "skeleton-list-rows" } },
  render: () => (
    <Surface>
      <div aria-busy="true" aria-label="Loading conversations" role="group">
        <Skeleton shape="row" count={6} />
      </div>
    </Surface>
  ),
};

/** Cards while they load, each its own element, so they sit in the grid the cards will fill. */
export const Cards: Story = {
  parameters: { screenshot: { name: "skeleton-cards" } },
  render: () => (
    <div aria-busy="true" aria-label="Loading recipes" role="group" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16, maxWidth: 720 }}>
      <Skeleton shape="card" count={3} />
    </div>
  ),
};
