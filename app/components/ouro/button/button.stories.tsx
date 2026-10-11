import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type CSSProperties, type ReactNode, type SVGProps } from "react";
import { Button } from "~/components/ouro/button/button";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

function icon(path: ReactNode) {
  return function Icon(props: SVGProps<SVGSVGElement>) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
      >
        {path}
      </svg>
    );
  };
}
const PlusIcon = icon(<path d="M12 5v14M5 12h14" />);
const ArrowRightIcon = icon(<path d="M5 12h14M13 6l6 6-6 6" />);
const TrashIcon = icon(<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />);
const DownloadIcon = icon(<path d="M12 4v11M7 10l5 5 5-5M5 20h14" />);
const HeartIcon = icon(<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" />);
const ExternalIcon = icon(<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />);

const tones = ["primary", "secondary", "destructive", "success", "warning"] as const;
const variants = ["solid", "soft", "outline", "plain"] as const;

const row: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 };
const stack: CSSProperties = { display: "grid", gap: 16 };
const caption: CSSProperties = {
  fontWeight: 500, fontSize: "12px", lineHeight: "16px",
  color: "var(--muted-foreground)",
  letterSpacing: "0.02em",
  textTransform: "uppercase",
};

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
        gap: 20,
      }}
    >
      {children}
    </div>
  );
}

const meta = {
  title: "Actions/Button",
  component: Button,
  parameters: { layout: "padded" },
  args: { children: "Save recipe" },
  argTypes: {
    tone: { control: "inline-radio", options: tones },
    variant: { control: "inline-radio", options: variants },
    size: { control: "inline-radio", options: ["sm", "md", "lg"] },
    loading: { control: "boolean" },
    fullWidth: { control: "boolean" },
    disabled: { control: "boolean" },
  },
} satisfies Meta<typeof Button>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. Press and hold to feel the spring; tab to see the focus ring. */
export const Playground: Story = {
  parameters: { layout: "centered" },
  args: { startIcon: HeartIcon },
};

/** Every tone in every variant, in light and dark. */
export const TonesAndVariants: Story = {
  render: () => (
    <Surface>
      {variants.map((variant) => (
        <div key={variant} style={stack}>
          <span style={caption}>{variant}</span>
          <div style={row}>
            {tones.map((tone) => (
              <Button key={tone} tone={tone} variant={variant}>
                {tone[0]!.toUpperCase() + tone.slice(1)}
              </Button>
            ))}
          </div>
        </div>
      ))}
    </Surface>
  ),
};

/**
 * Three sizes. Each is taller on phones (md is 44px) and steps down to desktop
 * density from 640px; resize the viewport to see it.
 */
export const Sizes: Story = {
  render: () => (
    <Surface>
      {(["sm", "md", "lg"] as const).map((size) => (
        <div key={size} style={row}>
          <Button size={size} startIcon={PlusIcon}>
            New recipe
          </Button>
          <Button size={size} variant="soft" endIcon={ArrowRightIcon}>
            Continue
          </Button>
          <Button size={size} variant="outline" tone="secondary" startIcon={DownloadIcon}>
            Export
          </Button>
          <Button size={size} variant="plain" tone="secondary" aria-label="Add">
            <PlusIcon aria-hidden="true" style={{ width: "1.25em", height: "1.25em" }} />
          </Button>
        </div>
      ))}
    </Surface>
  ),
};

function SaveDemo({ variant }: { variant: (typeof variants)[number] }) {
  const [saving, setSaving] = useState(false);
  return (
    <Button
      variant={variant}
      loading={saving}
      startIcon={HeartIcon}
      onClick={() => {
        setSaving(true);
        setTimeout(() => setSaving(false), 1600);
      }}
    >
      Save to cookbook
    </Button>
  );
}

/**
 * Press any button: the label fades out, a spinner fades in at the exact center,
 * and the width never changes. Focus stays on the button while it is busy.
 */
export const Loading: Story = {
  render: () => (
    <Surface>
      <div style={row}>
        {variants.map((variant) => (
          <SaveDemo key={variant} variant={variant} />
        ))}
      </div>
      <div style={row}>
        <Button loading size="sm">
          Saving
        </Button>
        <Button loading>Saving</Button>
        <Button loading size="lg" tone="destructive">
          Deleting
        </Button>
      </div>
    </Surface>
  ),
};

/** `href` makes a link that looks like a button. External links open safely. */
export const Links: Story = {
  render: () => (
    <Surface>
      <div style={row}>
        <Button href="#recipes" endIcon={ArrowRightIcon}>
          Browse recipes
        </Button>
        <Button href="https://github.com/ourostack/ouro-ui" target="_blank" variant="outline" tone="secondary" endIcon={ExternalIcon}>
          Source on GitHub
        </Button>
        <Button href="#cookbooks" variant="plain">
          See all cookbooks
        </Button>
      </div>
    </Surface>
  ),
};

/** Disabled buttons fade and ignore presses. Prefer `loading` while an action runs. */
export const Disabled: Story = {
  render: () => (
    <Surface>
      <div style={row}>
        {variants.map((variant) => (
          <Button key={variant} variant={variant} disabled>
            {variant[0]!.toUpperCase() + variant.slice(1)}
          </Button>
        ))}
      </div>
    </Surface>
  ),
};

/** A real layout: a phone-width form footer with a full-width primary action. */
export const InContext: Story = {
  parameters: { layout: "centered" },
  render: () => (
    <div style={{ width: 360, display: "grid", gap: 20 }}>
      <Surface>
        <div style={{ display: "grid", gap: 8 }}>
          <Button fullWidth size="lg" startIcon={PlusIcon}>
            Add to shopping list
          </Button>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Button variant="soft" tone="secondary" fullWidth>
              Cancel
            </Button>
            <Button variant="soft" tone="destructive" startIcon={TrashIcon} fullWidth>
              Delete
            </Button>
          </div>
        </div>
      </Surface>
    </div>
  ),
};
