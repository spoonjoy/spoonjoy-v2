import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ReactNode } from "react";
import { Alert } from "~/components/ouro/alert/alert";
import { Button } from "~/components/ouro/button/button";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

const tones = ["primary", "secondary", "destructive", "success", "warning"] as const;

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
  title: "Display/Alert",
  component: Alert,
  parameters: { layout: "padded" },
  args: { title: "Recipe saved", description: "It's in your cookbook now." },
  argTypes: {
    tone: { control: "inline-radio", options: tones },
  },
} satisfies Meta<typeof Alert>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

const copy = {
  primary: ["New: meal plans", "Plan the week from your saved recipes."],
  secondary: ["Shared cookbook", "Changes you make here show for everyone in it."],
  destructive: ["Couldn't save", "Check your connection and try again."],
  success: ["Recipe saved", "It's in your cookbook now."],
  warning: ["Two jars left", "Restock the pantry before Sunday."],
} as const;

/** Every tone. Destructive and warning use `role="alert"`; the others `role="status"`. */
export const Tones: Story = {
  parameters: { screenshot: { name: "alert-tones" } },
  render: () => (
    <Surface>
      {tones.map((tone) => (
        <Alert key={tone} tone={tone} title={copy[tone][0]} description={copy[tone][1]} />
      ))}
    </Surface>
  ),
};

function Dismissible() {
  const [error, setError] = useState(true);
  return (
    <Surface>
      {error && (
        <Alert
          tone="destructive"
          title="Couldn't save"
          description="Check your connection and try again."
          action={
            <Button size="sm" tone="destructive" variant="soft" onClick={() => setError(false)}>
              Try again
            </Button>
          }
          onDismiss={() => setError(false)}
        />
      )}
      {/* Stays on the page, so it keeps focus when it brings the alert back; the alert hands focus here when it goes. */}
      <Button variant="outline" tone="secondary" onClick={() => setError(true)}>
        Show the error again
      </Button>
    </Surface>
  );
}

/** An error with an action and a close button. */
export const WithAction: Story = {
  render: () => <Dismissible />,
};
