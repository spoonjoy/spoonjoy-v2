import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { AspectRatio } from "~/components/ouro/aspect-ratio/aspect-ratio";
import { Button } from "~/components/ouro/button/button";
import { Card } from "~/components/ouro/card/card";
import { Heading } from "~/components/ouro/text/heading";
import { Text } from "~/components/ouro/text/text";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

/** A cover image as an inline SVG, so the story makes no request. */
function cover(from: string, to: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="4" height="3" fill="url(#g)"/><circle cx="2" cy="1.6" r="0.9" fill="#fff" fill-opacity=".85"/><circle cx="2" cy="1.6" r="0.55" fill="${to}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function Page({ children }: { children: ReactNode }) {
  return <div style={{ background: "var(--background)", color: "var(--foreground)", padding: 24, display: "grid", gap: 16 }}>{children}</div>;
}

function ShareIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
    </svg>
  );
}

const meta = {
  title: "Display/Card",
  component: Card,
  parameters: { layout: "padded" },
  args: { title: "Pantry", description: "What you have on hand", children: "Flour, rice, black beans, two lemons." },
  argTypes: {
    variant: { control: "inline-radio", options: ["outline", "plain"] },
    size: { control: "inline-radio", options: ["md", "sm"] },
  },
} satisfies Meta<typeof Card>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

/** Cookbook tiles that are links, with a share action that stays its own tab stop, and a settings card. */
export const InContext: Story = {
  parameters: { mode: "link", screenshot: { name: "card" } },
  render: () => (
    <Page>
      <Heading level={2}>Cookbooks</Heading>
      <ul style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", margin: 0, padding: 0 }}>
        {[
          { title: "Weeknight dinners", count: 12, colors: ["#f59e0b", "#b45309"] },
          { title: "Sunday bakes", count: 7, colors: ["#fda4af", "#be123c"] },
          { title: "Pantry staples", count: 1, colors: ["#86efac", "#15803d"] },
        ].map((book) => (
          <Card
            key={book.title}
            as="li"
            href={`#${book.title.toLowerCase().replace(/ /g, "-")}`}
            media={
              <AspectRatio ratio={4 / 3}>
                <img src={cover(book.colors[0]!, book.colors[1]!)} alt="" />
              </AspectRatio>
            }
            title={book.title}
            description={`${book.count} ${book.count === 1 ? "recipe" : "recipes"}`}
            action={
              <Button variant="plain" size="sm" aria-label={`Share ${book.title}`}>
                <ShareIcon />
              </Button>
            }
          />
        ))}
      </ul>
      <Card
        title="Profile"
        description="How other cooks see you"
        action={<Button variant="outline">Edit</Button>}
        footer={<Text size="sm" tone="muted">Updated today</Text>}
      >
        <Text>Ari cooks mostly braises and anything with lemons.</Text>
      </Card>
    </Page>
  ),
};

/** A small card, and a plain card for structure inside a surface of your own. */
export const SizesAndVariants: Story = {
  render: () => (
    <Page>
      <Heading level={2}>Account</Heading>
      <Card size="sm" title="Small" description="16px padding, for dense grids">
        <Text size="sm">Two passkeys, one password.</Text>
      </Card>
      <Card variant="plain" title="Plain" description="No frame or padding" footer={<Button size="sm">Add a passkey</Button>}>
        <Text size="sm">Passkeys sign you in with your face or fingerprint.</Text>
      </Card>
    </Page>
  ),
};

/** A cookbook tile with its share button over the cover: the button takes its own taps, and the rest of the tile opens the cookbook. */
export const ShareOverCover: Story = {
  parameters: { mode: "link" },
  render: () => (
    <Page>
      <Heading level={2}>Cookbooks</Heading>
      <Card
        href="#weeknight-dinners"
        media={
          <>
            <AspectRatio ratio={4 / 3}>
              <img src={cover("#f59e0b", "#b45309")} alt="" />
            </AspectRatio>
            <Button variant="soft" size="sm" className="absolute end-2 top-2" aria-label="Share Weeknight dinners">
              <ShareIcon />
            </Button>
          </>
        }
        title="Weeknight dinners"
        description="12 recipes"
        style={{ maxWidth: 320 }}
      />
    </Page>
  ),
};

/** A settings panel whose action drops under the title on a phone. */
export const SettingsPanel: Story = {
  render: () => (
    <Page>
      <Card
        title="Passkeys"
        description="Sign in with your face or fingerprint"
        action={<Button variant="outline">Add a passkey</Button>}
        stackBelow="sm"
      >
        <Text size="sm">Two passkeys: iPhone and MacBook.</Text>
      </Card>
    </Page>
  ),
};
