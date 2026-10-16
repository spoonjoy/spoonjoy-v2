import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { Text } from "~/components/ouro/text/text";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

function Surface({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        background: "var(--background)",
        border: "1px solid var(--border)",
        borderRadius: "calc(var(--radius) + 4px)",
        padding: 24,
        display: "grid",
        gap: 16,
        alignContent: "start",
      }}
    >
      {children}
    </div>
  );
}

const meta = {
  title: "Text/Text",
  component: Text,
  parameters: { layout: "padded" },
  args: { children: "Braise the short ribs low and slow until they fall from the bone." },
  argTypes: {
    as: { control: "inline-radio", options: ["p", "span", "div"] },
    size: { control: "inline-radio", options: ["sm", "md", "lg"] },
    tone: { control: "select", options: ["default", "muted", "secondary", "primary", "success", "warning", "destructive"] },
    align: { control: "inline-radio", options: ["start", "center", "end"] },
  },
} satisfies Meta<typeof Text>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** The three sizes, and every tone. Tones use contrast-tested `<tone>-ink` colors. */
export const SizesAndTones: Story = {
  render: () => (
    <Surface>
      <Text size="lg">Large: a lead paragraph that opens a recipe.</Text>
      <Text>Medium: the default for body copy and steps.</Text>
      <Text size="sm">Small: captions, metadata and fine print.</Text>
      <div style={{ display: "grid", gap: 6 }}>
        <Text tone="muted">Muted: updated 2 days ago</Text>
        <Text tone="secondary">Secondary: 4 servings</Text>
        <Text tone="primary">Primary: 3 new comments</Text>
        <Text tone="success">Success: saved to Weeknight dinners</Text>
        <Text tone="warning">Warning: contains tree nuts</Text>
        <Text tone="destructive">Destructive: could not save the recipe</Text>
      </div>
    </Surface>
  ),
};

const description =
  "A deeply savory weeknight braise: short ribs seared hard, then simmered with gochujang, garlic, pear and soy until tender enough to pull apart with a spoon. Serve over rice with quick-pickled cucumbers.";

/** `truncate` cuts to one line; `lines` clamps to many. Both end in an ellipsis. */
export const TruncateAndClamp: Story = {
  render: () => (
    <Surface>
      <div style={{ display: "grid", gap: 12, maxWidth: 320 }}>
        <Text size="sm" tone="muted">
          truncate
        </Text>
        <Text truncate>{description}</Text>
        <Text size="sm" tone="muted">
          lines={"{2}"}
        </Text>
        <Text lines={2}>{description}</Text>
        <Text size="sm" tone="muted">
          lines={"{3}"}
        </Text>
        <Text lines={3}>{description}</Text>
      </div>
    </Surface>
  ),
};

/** Alignment follows the writing direction: `start` is the left in English. */
export const Alignment: Story = {
  render: () => (
    <Surface>
      <Text align="start">Start-aligned</Text>
      <Text align="center">Centered</Text>
      <Text align="end">End-aligned</Text>
    </Surface>
  ),
};
