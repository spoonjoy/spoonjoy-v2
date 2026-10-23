import type { Meta, StoryObj } from "@storybook/react-vite";
import { TabBar } from "~/components/ouro/tab-bar/tab-bar";
import { Text } from "~/components/ouro/text/text";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

/** A stroked 24px icon, as lucide-react draws them. */
const icon = (path: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={path} />
  </svg>
);

const items = [
  { label: "Home", href: "/", icon: icon("M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"), paths: ["/account"] },
  { label: "Recipes", href: "/recipes", icon: icon("M4 19.5V4.5A1.5 1.5 0 0 1 5.5 3H20v16H5.5a1.5 1.5 0 0 0 0 3H20") },
  { label: "Cookbooks", href: "/cookbooks", icon: icon("M4 4h4v16H4zM10 4h4v16h-4zM16 5l4 1-3 14-4-1z") },
  { label: "Shopping", href: "/shopping-list", icon: icon("M6 7h12l-1 14H7zM9 7a3 3 0 0 1 6 0") },
];
const search = { label: "Search", href: "/search", icon: icon("M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5") };

const meta = {
  title: "Navigation/TabBar",
  component: TabBar,
  parameters: { layout: "fullscreen" },
  args: { label: "Main", items, accessory: search, currentPath: "/recipes", hideFrom: "never" },
  argTypes: { hideFrom: { control: "inline-radio", options: ["sm", "md", "lg", "xl", "never"] } },
  render: (args) => (
    <div style={{ background: "var(--background)", color: "var(--foreground)", minHeight: 480 }}>
      <div style={{ padding: 24, display: "grid", gap: 12 }}>
        <Text>Short ribs, braised until they fall apart.</Text>
        <Text tone="secondary">The tab bar stays at the bottom of the screen; the page keeps room for it at its end.</Text>
      </div>
      <TabBar {...args} />
    </div>
  ),
} satisfies Meta<typeof TabBar>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

/** A phone app's tabs: the current page from the path, and Search set apart. It hides from 640px, as an app's Navbar takes over. */
export const InContext: Story = { args: { hideFrom: "sm", currentPath: "/account/settings" } };
