import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ReactNode } from "react";
import { Pagination } from "~/components/ouro/pagination/pagination";
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
        gap: 24,
      }}
    >
      {children}
    </div>
  );
}

const meta = {
  title: "Navigation/Pagination",
  component: Pagination,
  parameters: { layout: "padded" },
  args: { page: 6, pageCount: 12, href: "?page={page}" },
} satisfies Meta<typeof Pagination>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. The pages are links: `href="?page={page}"`. */
export const Playground: Story = {};

/** Under a list. Below 640px the numbers give way to "Page 6 of 12". */
export const InContext: Story = {
  parameters: { screenshot: { name: "pagination" } },
  render: (args) => (
    <Surface>
      <Text>Recipes 51 to 60 of 118</Text>
      <Pagination {...args} />
    </Surface>
  ),
};

function Paged() {
  const [page, setPage] = useState(1);
  return (
    <Surface>
      <Text>Showing page {page}</Text>
      <Pagination page={page} pageCount={5} onPageChange={setPage} />
    </Surface>
  );
}

/** Buttons with `onPageChange`, for a list that pages in place. */
export const Buttons: Story = {
  parameters: { mode: "button" },
  render: () => <Paged />,
};

/** Previous and Next only, for a list without a count of its rows: `hasNextPage` enables Next. */
export const PreviousAndNext: Story = {
  parameters: { screenshot: { name: "pagination-previous-next" } },
  render: () => (
    <Surface>
      <Text>Recipes 21 to 30</Text>
      <Pagination page={3} hasNextPage href="?page={page}" />
    </Surface>
  ),
};
