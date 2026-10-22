import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useRef, useState } from "react";
import { Switch } from "~/components/ouro/switch/switch";
import { SyncStatus, type SyncState } from "~/components/ouro/sync-status/sync-status";
import { TextArea } from "~/components/ouro/text-field/text-area";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

const meta = {
  title: "Feedback/SyncStatus",
  component: SyncStatus,
  parameters: { layout: "padded" },
  args: { status: "saved" },
  argTypes: {
    status: { control: "inline-radio", options: ["saved", "saving", "offline", "error"] },
  },
} satisfies Meta<typeof SyncStatus>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

/** Every state, with Retry where there is a problem. */
export const States: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 12, color: "var(--foreground)" }}>
      {(["saved", "saving", "offline", "error"] as const).map((status) => (
        <SyncStatus key={status} status={status} onRetry={() => {}} />
      ))}
    </div>
  ),
};

/** Under an editor that saves as you type. Turn the connection off to keep changes on the device; Retry once it is back. */
export const InContext: Story = {
  render: function Editor() {
    const [online, setOnline] = useState(true);
    const [status, setStatus] = useState<SyncState>("saved");
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => () => clearTimeout(timer.current), []);
    const save = (connected: boolean) => {
      clearTimeout(timer.current);
      if (!connected) return setStatus("offline");
      setStatus("saving");
      timer.current = setTimeout(() => setStatus("saved"), 700);
    };
    return (
      <div style={{ display: "grid", gap: 12, maxWidth: 420, color: "var(--foreground)" }}>
        <TextArea label="Trail notes" defaultValue="Ridge path closed past the second bridge." onChange={() => save(online)} />
        <SyncStatus status={status} onRetry={() => save(online)} />
        <Switch label="Connected" checked={online} onCheckedChange={(next) => {
          setOnline(next);
          if (!next) setStatus("offline");
        }} />
      </div>
    );
  },
};
