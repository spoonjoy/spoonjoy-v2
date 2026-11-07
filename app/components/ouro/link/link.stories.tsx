import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { Link } from "~/components/ouro/link/link";
import { Text } from "~/components/ouro/text/text";
import { OuroProvider, type OuroLinkComponent } from "~/lib/ouro/ouro-provider";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

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
        alignContent: "start",
      }}
    >
      {children}
    </div>
  );
}

const meta = {
  title: "Text/Link",
  component: Link,
  parameters: { layout: "padded" },
  args: { href: "#recipes", children: "Browse recipes" },
  argTypes: {
    tone: { control: "inline-radio", options: ["primary", "secondary", "destructive", "success", "warning"] },
    external: { control: "boolean" },
  },
} satisfies Meta<typeof Link>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

/** Links in running text, in navigation, and one that opens a new tab. */
export const InContext: Story = {
  parameters: { screenshot: { name: "link" } },
  render: () => (
    <Surface>
      <Text>
        Braise the short ribs as in <Link href="#braising">our braising guide</Link>, then rest them overnight.
      </Text>
      <nav aria-label="Recipe" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <Link href="#ingredients" tone="secondary">
          Ingredients
        </Link>
        <Link href="#method" tone="secondary">
          Method
        </Link>
        <Link href="#notes" tone="secondary">
          Notes
        </Link>
      </nav>
      <Text size="sm" tone="muted">
        Adapted from <Link href="https://example.com/short-ribs" external>the original recipe</Link>.
      </Text>
    </Surface>
  ),
};

/** Every tone. `secondary` is the page's foreground; the underline still marks it as a link. */
export const Tones: Story = {
  render: () => (
    <Surface>
      {(["primary", "secondary", "destructive", "success", "warning"] as const).map((tone) => (
        <Text key={tone}>
          <Link href={`#${tone}`} tone={tone}>
            {tone[0]!.toUpperCase() + tone.slice(1)} link
          </Link>
        </Text>
      ))}
    </Surface>
  ),
};

/** Stands in for an app's router link, and marks the links it renders. */
const StandInRouterLink: OuroLinkComponent = (props) => <a data-router-link="" {...props} />;

/**
 * A link to a path the router has no page for (a resource route, a download, a sign-in that
 * starts on the server) takes `reloadDocument`: a plain `<a>`, in the same look, that the
 * browser loads itself.
 */
export const DocumentNavigation: Story = {
  render: () => (
    <OuroProvider linkComponent={StandInRouterLink}>
      <Surface>
        <Text>
          Connect your agent with <Link href="#mcp" reloadDocument>the MCP server&apos;s details</Link>, or <Link href="#recipes">browse recipes</Link>.
        </Text>
      </Surface>
    </OuroProvider>
  ),
};
