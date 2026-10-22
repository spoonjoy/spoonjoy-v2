import type { Meta, StoryObj } from "@storybook/react-vite";
import { ShareButton } from "~/components/ouro/share-button/share-button";
import { Text } from "~/components/ouro/text/text";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

const meta = {
  title: "Actions/ShareButton",
  component: ShareButton,
  parameters: { layout: "padded" },
  args: { url: "https://example.com/notes/42", title: "Trail notes" },
  argTypes: {
    variant: { control: "inline-radio", options: ["solid", "soft", "outline", "plain"] },
    size: { control: "inline-radio", options: ["sm", "md", "lg"] },
  },
} satisfies Meta<typeof ShareButton>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. On a phone or in Safari a click opens the share sheet; elsewhere it copies the link and says "Link copied". */
export const Playground: Story = {};

/** In a page header beside the title, and as an icon in a toolbar. */
export const InContext: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 24, maxWidth: 480, color: "var(--foreground)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Text as="span" size="lg" className="min-w-0 flex-1 truncate">
          <strong>Trail notes</strong>
        </Text>
        <ShareButton url="https://example.com/notes/42" title="Trail notes" label="Share notes" />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 4, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
        <ShareButton url="https://example.com/notes/42/map" title="Trail map" label="Share map" hideLabel variant="plain" />
      </div>
    </div>
  ),
};
