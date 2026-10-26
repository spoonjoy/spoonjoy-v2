import type { Meta, StoryObj } from "@storybook/react-vite";
import { Link } from "~/components/ouro/link/link";
import { Heading } from "~/components/ouro/text/heading";
import { SkipLink } from "~/components/ouro/skip-link/skip-link";
import { Text } from "~/components/ouro/text/text";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

const meta = {
  title: "Navigation/SkipLink",
  component: SkipLink,
  parameters: { layout: "fullscreen" },
  args: { target: "story-main" },
  render: (args) => (
    <div style={{ background: "var(--background)", color: "var(--foreground)", minHeight: 320 }}>
      <SkipLink {...args} />
      <header style={{ display: "flex", gap: 16, padding: "12px 24px", borderBottom: "1px solid var(--border)" }}>
        <Link href="/recipes" tone="secondary">
          Recipes
        </Link>
        <Link href="/cookbooks" tone="secondary">
          Cookbooks
        </Link>
        <Link href="/shopping-list" tone="secondary">
          Shopping list
        </Link>
      </header>
      <main id={args.target} style={{ padding: 24 }}>
        <Heading level={1}>Braised short ribs</Heading>
        <Text>Press Tab once: the skip link shows at the top corner. Press Enter to jump here, past the links.</Text>
      </main>
    </div>
  ),
} satisfies Meta<typeof SkipLink>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. Press Tab to show the link. */
export const Playground: Story = {};

/** The first tab stop on a page with a header of links. */
export const InContext: Story = { args: { target: "story-main-content", children: "Skip to the recipe" } };
