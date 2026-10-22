import type { Meta, StoryObj } from "@storybook/react-vite";
import { CopyButton } from "~/components/ouro/copy-button/copy-button";
import { Text } from "~/components/ouro/text/text";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

const meta = {
  title: "Actions/CopyButton",
  component: CopyButton,
  parameters: { layout: "padded" },
  args: { value: "pk_live_51Hx2vQ" },
  argTypes: {
    variant: { control: "inline-radio", options: ["solid", "soft", "outline", "plain"] },
    size: { control: "inline-radio", options: ["sm", "md", "lg"] },
  },
} satisfies Meta<typeof CopyButton>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. A click copies the value and says "Copied" for two seconds. */
export const Playground: Story = {};

/** Beside a key on a settings page, and as an icon beside a link. */
export const InContext: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 16, maxWidth: 420, color: "var(--foreground)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Text as="span" size="sm" className="min-w-0 flex-1 truncate">
          <code>pk_live_51Hx2vQ</code>
        </Text>
        <CopyButton value="pk_live_51Hx2vQ" label="Copy key" />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <Text as="span" size="sm" tone="muted" className="min-w-0 flex-1 truncate">
          https://example.com/invite/7Gk2
        </Text>
        <CopyButton value="https://example.com/invite/7Gk2" label="Copy invite link" hideLabel variant="plain" />
      </div>
    </div>
  ),
};
