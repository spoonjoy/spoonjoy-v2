import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { ScrollArea } from "~/components/ouro/scroll-area/scroll-area";
import { Text } from "~/components/ouro/text/text";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

function Surface({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        background: "var(--background)",
        color: "var(--foreground)",
        border: "1px solid var(--border)",
        borderRadius: "calc(var(--radius) + 4px)",
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

const steps = [
  "Pat the short ribs dry and season them well.",
  "Sear them hard on every side, in batches.",
  "Soften onion, carrot and celery in the fat.",
  "Stir in tomato paste until it darkens.",
  "Pour in the wine and scrape up the browned bits.",
  "Add stock to come halfway up the ribs.",
  "Cover and braise at 160°C for three hours.",
  "Rest overnight, then lift off the fat.",
  "Reduce the sauce until it coats a spoon.",
  "Warm the ribs in the sauce and serve.",
];

const tags = ["Braise", "Weeknight", "Make ahead", "Freezer friendly", "Dairy free", "One pot", "Winter", "Sunday"];

const meta = {
  title: "Layout/ScrollArea",
  component: ScrollArea,
  parameters: { layout: "padded" },
  args: { label: "Method", className: "h-48", children: null },
  argTypes: { orientation: { control: "inline-radio", options: ["vertical", "horizontal", "both"] } },
} satisfies Meta<typeof ScrollArea>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {
  render: (args) => (
    <Surface>
      <ScrollArea {...args}>
        <div style={{ padding: 16, display: "grid", gap: 12 }}>
          {steps.map((step, index) => (
            <Text key={step}>
              {index + 1}. {step}
            </Text>
          ))}
        </div>
      </ScrollArea>
    </Surface>
  ),
};

/** A recipe's method in a fixed height, and a row of tags that scrolls sideways. */
export const InContext: Story = {
  parameters: { screenshot: { name: "scroll-area" } },
  render: () => (
    <div style={{ background: "var(--background)", padding: 24, display: "grid", gap: 16 }}>
      <Surface>
        <ScrollArea className="h-48" label="Method">
          <div style={{ padding: 16, display: "grid", gap: 12 }}>
            {steps.map((step, index) => (
              <Text key={step}>
                {index + 1}. {step}
              </Text>
            ))}
          </div>
        </ScrollArea>
      </Surface>
      <ScrollArea orientation="horizontal" label="Tags">
        <div style={{ display: "flex", gap: 8, paddingBottom: 12 }}>
          {tags.map((tag) => (
            <span
              key={tag}
              style={{ whiteSpace: "nowrap", padding: "4px 12px", borderRadius: 999, background: "var(--secondary)", color: "var(--secondary-foreground)" }}
            >
              {tag}
            </span>
          ))}
        </div>
      </ScrollArea>
    </div>
  ),
};
