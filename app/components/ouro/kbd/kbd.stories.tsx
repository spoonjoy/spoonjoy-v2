import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { Kbd } from "~/components/ouro/kbd/kbd";
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
        gap: 12,
      }}
    >
      {children}
    </div>
  );
}

const meta = {
  title: "Text/Kbd",
  component: Kbd,
  parameters: { layout: "padded" },
  args: { keys: ["mod", "k"] },
} satisfies Meta<typeof Kbd>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. On a Mac, iPhone or iPad `mod` is ⌘; elsewhere it is Ctrl. */
export const Playground: Story = {};

/** Shortcuts in running text, at each text size. */
export const InContext: Story = {
  parameters: { screenshot: { name: "kbd" } },
  render: () => (
    <Surface>
      <Text>
        Press <Kbd keys={["mod", "k"]} /> to search your recipes.
      </Text>
      <Text size="sm" tone="muted">
        <Kbd keys={["shift", "enter"]} /> adds a new line; <Kbd keys={["escape"]} /> closes the editor.
      </Text>
      <Text size="lg">
        <Kbd keys={["mod", "alt", "up"]} /> moves a step up.
      </Text>
    </Surface>
  ),
};
