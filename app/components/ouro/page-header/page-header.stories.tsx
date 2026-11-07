import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "~/components/ouro/badge/badge";
import { Breadcrumb } from "~/components/ouro/breadcrumb/breadcrumb";
import { Button } from "~/components/ouro/button/button";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { Text } from "~/components/ouro/text/text";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

const meta = {
  title: "Layout/PageHeader",
  component: PageHeader,
  parameters: { layout: "padded" },
  args: { eyebrow: "Settings", title: "Billing", description: "Your plan, invoices and payment method." },
  argTypes: { level: { control: "inline-radio", options: [1, 2] }, size: { control: "inline-radio", options: ["md", "lg"] } },
} satisfies Meta<typeof PageHeader>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

/** The top of a project page: a trail, a cover image, badges and actions, then the page's content. */
export const InContext: Story = {
  args: { title: "Harbor survey" },
  render: () => (
    <div style={{ display: "grid", gap: 24, maxWidth: 880, color: "var(--foreground)" }}>
      <PageHeader
        breadcrumb={
          <Breadcrumb
            items={[
              { label: "Projects", href: "#projects" },
              { label: "Harbor survey" },
            ]}
          />
        }
        media={
          <div
            role="img"
            aria-label="Survey map"
            style={{ height: 160, background: "linear-gradient(135deg, var(--muted), var(--accent))" }}
          />
        }
        eyebrow="Project"
        title="Harbor survey"
        description="Depth readings and photos from the east harbor, shared with three teams."
        actions={
          <>
            <Button variant="outline" tone="secondary">
              Share
            </Button>
            <Button>Edit</Button>
          </>
        }
        divider
      >
        <Badge>Active</Badge>
      </PageHeader>
      <Text>The project's readings follow here.</Text>
    </div>
  ),
};

/** A landing or profile page's larger title. */
export const Large: Story = { args: { size: "lg", eyebrow: "Welcome back", title: "Good morning, Sam", description: undefined } };
