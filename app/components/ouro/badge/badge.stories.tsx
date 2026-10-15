import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type CSSProperties, type ReactNode, type SVGProps } from "react";
import { Badge } from "~/components/ouro/badge/badge";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

const tones = ["primary", "secondary", "destructive", "success", "warning"] as const;
const variants = ["solid", "soft", "outline"] as const;

const row: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 };

function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m3.5 8.5 3 3 6-7" />
    </svg>
  );
}

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
      }}
    >
      {children}
    </div>
  );
}

const meta = {
  title: "Display/Badge",
  component: Badge,
  parameters: { layout: "padded" },
  args: { children: "Vegetarian" },
  argTypes: {
    tone: { control: "inline-radio", options: tones },
    variant: { control: "inline-radio", options: variants },
  },
} satisfies Meta<typeof Badge>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

/** Every tone in every variant. */
export const Tones: Story = {
  parameters: { screenshot: { name: "badge-tones" } },
  render: () => (
    <Surface>
      {variants.map((variant) => (
        <div key={variant} style={row}>
          {tones.map((tone) => (
            <Badge key={tone} tone={tone} variant={variant}>
              {tone}
            </Badge>
          ))}
        </div>
      ))}
    </Surface>
  ),
};

function FilterChips() {
  const [active, setActive] = useState<string[]>(["Quick"]);
  const toggle = (name: string) => setActive((current) => (current.includes(name) ? current.filter((item) => item !== name) : [...current, name]));
  return (
    <div role="group" aria-label="Filters" style={row}>
      {["Quick", "Vegan", "One pot"].map((name) => {
        const on = active.includes(name);
        return (
          <Badge key={name} onClick={() => toggle(name)} aria-pressed={on} variant={on ? "solid" : "outline"} tone={on ? "primary" : "secondary"} icon={on ? CheckIcon : undefined}>
            {name}
          </Badge>
        );
      })}
    </div>
  );
}

/** Status labels, tag links and filter chips that toggle with `aria-pressed`. On phones, each link and button has a 44px touch target. */
export const InContext: Story = {
  render: () => (
    <Surface>
      <div style={row}>
        <strong>Short ribs</strong>
        <Badge tone="success" variant="soft">
          Published
        </Badge>
        <Badge>3 servings</Badge>
      </div>
      <nav aria-label="Tags" style={row}>
        <Badge href="#braise" variant="outline">
          Braise
        </Badge>
        <Badge href="#winter" variant="outline">
          Winter
        </Badge>
      </nav>
      <FilterChips />
    </Surface>
  ),
};
