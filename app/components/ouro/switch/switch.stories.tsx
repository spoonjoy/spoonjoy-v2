import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ReactNode } from "react";
import { Switch } from "~/components/ouro/switch/switch";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

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
        gap: 24,
        maxWidth: 420,
      }}
    >
      {children}
    </div>
  );
}

/** Settings that apply at once, each controlled. */
function SettingsList() {
  const [timers, setTimers] = useState(true);
  const [awake, setAwake] = useState(false);
  return (
    <>
      <Switch label="Cooking timers" description="Sound an alarm when a step is done." checked={timers} onCheckedChange={setTimers} />
      <Switch label="Keep screen awake" description="While a recipe is open." checked={awake} onCheckedChange={setAwake} />
    </>
  );
}

const meta = {
  title: "Forms/Switch",
  component: Switch,
  parameters: { layout: "padded" },
  args: { label: "Cooking timers", name: "timers" },
  argTypes: {
    required: { control: "boolean" },
    disabled: { control: "boolean" },
    hideLabel: { control: "boolean" },
    error: { control: "text" },
    description: { control: "text" },
  },
} satisfies Meta<typeof Switch>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. Press and hold to feel the thumb stretch. */
export const Playground: Story = {};

/** Controlled switches for settings that take effect at once. */
export const Settings: Story = {
  render: () => (
    <Surface>
      <SettingsList />
    </Surface>
  ),
};

/** Off, on, with an error, and disabled off and on. */
export const States: Story = {
  parameters: { screenshot: { name: "switch-states" } },
  render: () => (
    <Surface>
      <Switch label="Metric units" name="metric" />
      <Switch label="Show nutrition" name="nutrition" defaultChecked />
      <Switch label="Nightly backups" name="backups" required error="Backups must be on for shared cookbooks." />
      <Switch label="Offline mode" name="offline" disabled description="Download a recipe first." />
      <Switch label="Sync" name="sync" disabled defaultChecked />
    </Surface>
  ),
};
