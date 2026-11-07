import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { Spinner } from "~/components/ouro/spinner/spinner";

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
        gap: 20,
      }}
    >
      {children}
    </div>
  );
}

const row = { display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" } as const;

const meta = {
  title: "Feedback/Spinner",
  component: Spinner,
  parameters: { layout: "padded" },
  args: { label: "Loading" },
  argTypes: {
    size: { control: "inline-radio", options: ["sm", "md", "lg"] },
    tone: { control: "inline-radio", options: [undefined, "primary", "secondary", "destructive", "success", "warning"] },
  },
} satisfies Meta<typeof Spinner>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

/** Sizes and tones. Without a tone the spinner takes the text color around it. */
export const SizesAndTones: Story = {
  parameters: { screenshot: { name: "spinner" } },
  render: () => (
    <Surface>
      <div style={row}>
        <Spinner size="sm" />
        <Spinner />
        <Spinner size="lg" />
      </div>
      <div style={row}>
        {(["primary", "secondary", "destructive", "success", "warning"] as const).map((tone) => (
          <Spinner key={tone} tone={tone} label={`Loading, ${tone}`} />
        ))}
      </div>
      <div style={{ ...row, color: "var(--muted-foreground)" }}>
        <Spinner size="sm" label="Loading recipes" />
        <span>Loading recipes…</span>
      </div>
    </Surface>
  ),
};
