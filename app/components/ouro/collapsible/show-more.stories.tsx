import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ReactNode } from "react";
import { ShowMore } from "~/components/ouro/collapsible/show-more";
import { Link } from "~/components/ouro/link/link";
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
        gap: 16,
        maxWidth: 420,
      }}
    >
      {children}
    </div>
  );
}

const titles = [
  "Braised short ribs",
  "Lemon ricotta pancakes",
  "Charred broccoli with tahini",
  "Weeknight dal",
  "Tomato and white bean soup",
  "Sheet-pan gnocchi",
  "Miso butter salmon",
  "Pear and ginger crumble",
  "Green shakshuka",
];

const rows = (list: string[]) =>
  list.map((title) => (
    <Link key={title} href={`#${title.toLowerCase().replaceAll(" ", "-")}`} tone="secondary" className="block py-2">
      {title}
    </Link>
  ));

const description =
  "Brown the short ribs in batches, then soften onions, carrots and celery in the fat. Stir in tomato paste, " +
  "deglaze with red wine, return the ribs, cover with stock and braise for three hours, until the meat falls " +
  "from the bone. Rest overnight, lift off the fat, and reheat gently before serving over polenta.";

const meta = {
  title: "Lists/ShowMore",
  component: ShowMore,
  parameters: { layout: "padded" },
  args: { items: rows(titles), initialCount: 4 },
} satisfies Meta<typeof ShowMore>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

/** A list cut to its first four, and a description cut to three lines. */
export const InContext: Story = {
  parameters: { screenshot: { name: "show-more" } },
  render: (args) => (
    <Surface>
      <ShowMore lines={3}>
        <Text>{description}</Text>
      </ShowMore>
      <ShowMore {...args} />
    </Surface>
  ),
};

/** Pages from the server: Show more loads three more and moves focus to the first new one. */
export const LoadMore: Story = {
  render: function Render() {
    const [count, setCount] = useState(3);
    const [loading, setLoading] = useState(false);
    return (
      <Surface>
        <ShowMore
          items={rows(titles.slice(0, count))}
          hasMore={count < titles.length}
          loading={loading}
          href={`?after=${count}`}
          loadedLabel={(shown) => `Showing ${shown} recipes`}
          onShowMore={() => {
            setLoading(true);
            setTimeout(() => {
              setCount((value) => value + 3);
              setLoading(false);
            }, 600);
          }}
        />
      </Surface>
    );
  },
};
