import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { Button } from "~/components/ouro/button/button";
import { Heading } from "~/components/ouro/text/heading";
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
  title: "Text/Heading",
  component: Heading,
  parameters: { layout: "padded" },
  args: { level: 2, children: "Gochujang braised short ribs" },
  argTypes: {
    level: { control: "inline-radio", options: [1, 2, 3, 4, 5, 6] },
    size: { control: "inline-radio", options: ["sm", "md", "lg", "xl", "2xl", "display"] },
    align: { control: "inline-radio", options: ["start", "center", "end"] },
  },
} satisfies Meta<typeof Heading>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

const description =
  "A deeply savory weeknight braise: short ribs seared hard, then simmered with gochujang, garlic, pear and soy until tender enough to pull apart with a spoon. Serve over rice with quick-pickled cucumbers.";

/** Heading levels set the tag and a default size; `size` changes only the look. */
export const Headings: Story = {
  render: () => (
    <Surface>
      {([1, 2, 3, 4, 5, 6] as const).map((level) => (
        <Heading key={level} level={level}>
          Heading level {level}
        </Heading>
      ))}
      <Heading level={2} size="sm">
        An h2 that looks small
      </Heading>
    </Surface>
  ),
};

/** `size="display"` is a landing page's hero headline: larger than `2xl`, and larger again from the `sm` breakpoint. */
export const Display: Story = {
  render: () => (
    <Surface>
      <Heading level={1} size="display" style={{ maxWidth: "16ch" }}>
        Dinner, sorted before you get home.
      </Heading>
      <Text size="lg" tone="muted">
        Plan the week, shop once, and cook from your phone.
      </Text>
    </Surface>
  ),
};

/** Text, Heading and Button together: a recipe card. */
export const RecipeCard: Story = {
  parameters: { screenshot: { name: "text" } },
  render: () => (
    <Surface>
      <article style={{ display: "grid", gap: 12, maxWidth: 380 }}>
        <Text size="sm" tone="primary">
          Korean · 3 hours
        </Text>
        <Heading level={2}>Gochujang braised short ribs</Heading>
        <Text tone="muted" lines={3}>
          {description}
        </Text>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <Button href="#cook">Start cooking</Button>
          <Button variant="soft" tone="secondary">
            Save
          </Button>
        </div>
      </article>
    </Surface>
  ),
};

/** Alignment follows the writing direction, as Text's does. */
export const Alignment: Story = {
  render: () => (
    <Surface>
      <Heading level={3} align="center">
        A centered heading
      </Heading>
    </Surface>
  ),
};
