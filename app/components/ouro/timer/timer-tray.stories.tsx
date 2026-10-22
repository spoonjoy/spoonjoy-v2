import type { Meta, StoryObj } from "@storybook/react-vite";
import { TimerTray } from "~/components/ouro/timer/timer-tray";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names). Timers live in
// localStorage, so each story writes the timers it shows before it renders.

function stored(id: string, value: unknown) {
  localStorage.setItem(`ouro-timer:${id}`, JSON.stringify(value));
}

const meta = {
  title: "Feedback/TimerTray",
  component: TimerTray,
  parameters: { layout: "fullscreen" },
  args: { timers: [] },
  render: (args) => {
    stored("story-tray-oven", { status: "paused", duration: 2400, remainingMs: 1_325_000 });
    stored("story-tray-eggs", { status: "done", duration: 420, endedAt: Date.UTC(2026, 0, 1) });
    return (
      <div style={{ color: "var(--foreground)" }}>
        <TimerTray
          {...args}
          timers={[
            { timerId: "story-tray-oven", label: "Oven", duration: 2400, href: "#oven" },
            { timerId: "story-tray-eggs", label: "Eggs", duration: 420 },
            { timerId: "story-tray-idle", label: "Not started", duration: 60 },
          ]}
        />
        <p style={{ margin: 16 }}>The page's content goes on below the tray.</p>
      </div>
    );
  },
} satisfies Meta<typeof TimerTray>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

/** A paused timer and one at zero, under a header; the idle timer does not show. */
export const InContext: Story = { args: { label: "Kitchen timers" } };
