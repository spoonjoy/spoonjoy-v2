import type { Meta, StoryObj } from "@storybook/react-vite";
import { ColorSchemeToggle } from "~/components/ouro/color-scheme-toggle/color-scheme-toggle";
import { Text } from "~/components/ouro/text/text";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names). The stories have no
// ColorSchemeProvider, so the page's scheme stays Storybook's until a choice is made.

const meta = {
  title: "Actions/ColorSchemeToggle",
  component: ColorSchemeToggle,
  parameters: { layout: "padded" },
  argTypes: { variant: { control: "inline-radio", options: ["menu", "segmented"] } },
} satisfies Meta<typeof ColorSchemeToggle>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. A choice switches the whole page. */
export const Playground: Story = {};

/** In a header, beside the account menu, and on a settings page. */
export const InContext: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 24, color: "var(--foreground)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
        <Text>
          <strong>Field Notes</strong>
        </Text>
        <ColorSchemeToggle />
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        <Text>Appearance</Text>
        <ColorSchemeToggle variant="segmented" label="Appearance" />
      </div>
    </div>
  ),
};

/** The segmented variant, mode "segmented", for the control matrix. */
export const Segmented: Story = { args: { variant: "segmented" }, parameters: { mode: "segmented" } };
