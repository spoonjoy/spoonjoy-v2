import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, type ReactNode } from "react";
import { Button } from "~/components/ouro/button/button";
import { Toaster } from "~/components/ouro/toast/toaster";
import { toast } from "~/lib/ouro/toast";

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
        display: "flex",
        flexWrap: "wrap",
        gap: 12,
        alignItems: "center",
      }}
    >
      {children}
    </div>
  );
}

const meta = {
  title: "Feedback/Toast",
  component: Toaster,
  parameters: { layout: "padded" },
} satisfies Meta<typeof Toaster>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Press a button to show a toast. Hover or focus the toasts to pause them; swipe one down or sideways to dismiss it. */
export const Playground: Story = {
  render: (args) => (
    <Surface>
      <Button onClick={() => toast("Recipe saved", { tone: "success", description: "Find it in your cookbook." })}>Save recipe</Button>
      <Toaster {...args} />
    </Surface>
  ),
};

/** One toast per tone. `secondary`, the default, has no icon. */
export const Tones: Story = {
  render: (args) => (
    <Surface>
      <Button variant="soft" tone="secondary" onClick={() => toast("Copied to clipboard")}>
        Secondary
      </Button>
      <Button variant="soft" onClick={() => toast("A new version is ready", { tone: "primary", description: "Reload to update." })}>
        Primary
      </Button>
      <Button variant="soft" tone="success" onClick={() => toast("Recipe saved", { tone: "success" })}>
        Success
      </Button>
      <Button variant="soft" tone="warning" onClick={() => toast("You're offline", { tone: "warning", description: "Changes save when you reconnect." })}>
        Warning
      </Button>
      <Button variant="soft" tone="destructive" onClick={() => toast("Couldn't save", { tone: "destructive", description: "Check your connection." })}>
        Destructive
      </Button>
      <Toaster {...args} />
    </Surface>
  ),
};

/** An Undo action: pressing it runs the callback and dismisses the toast. */
export const WithAction: Story = {
  render: (args) => (
    <Surface>
      <Button
        tone="destructive"
        variant="soft"
        onClick={() => toast("Recipe deleted", { action: { label: "Undo", onClick: () => toast("Recipe restored", { tone: "success" }) } })}
      >
        Delete recipe
      </Button>
      <Toaster {...args} />
    </Surface>
  ),
};

function ShowOnMount() {
  useEffect(() => {
    toast("Recipe saved", { tone: "success", description: "Find it in your cookbook.", duration: 0 });
    toast("Recipe deleted", { duration: 0, action: { label: "Undo", onClick: () => {} } });
    toast("Couldn't sync", { tone: "destructive", description: "We'll try again in a minute.", duration: 0 });
    return () => toast.dismiss();
  }, []);
  return null;
}

/** Three toasts, stacked: the newest in front and the older ones peeking above it. They stay until dismissed. */
export const Stack: Story = {
  parameters: {
    screenshot: { name: "toaster-stack" },
    conformance: {
      focusExit: {
        // Every dismiss button is reachable at rest. The last toast's leaves no toast to hand focus to, and a
        // press that came from no control has nowhere to go back to, so focus stays on the page (Toaster's tests).
        "toaster/close Dismiss": "the last toast's dismiss button, pressed with focus from nowhere, leaves focus on the page, as Toaster does on purpose",
      },
    },
  },
  render: (args) => (
    <Surface>
      <span style={{ color: "var(--muted-foreground)" }}>Hover the toasts to fan them out.</span>
      <Toaster {...args} />
      <ShowOnMount />
    </Surface>
  ),
};
