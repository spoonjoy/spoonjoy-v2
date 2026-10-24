import type { Meta, StoryObj } from "@storybook/react-vite";
import { Timer } from "~/components/ouro/timer/timer";
import { TimerTray } from "~/components/ouro/timer/timer-tray";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names). Timers with a
// `timerId` live in localStorage, so a story that shows one part way writes it before it renders.

function stored(id: string, value: unknown) {
  localStorage.setItem(`ouro-timer:${id}`, JSON.stringify(value));
}

const meta = {
  title: "Feedback/Timer",
  component: Timer,
  parameters: { layout: "padded" },
  args: { label: "Pasta", duration: 600 },
  argTypes: { size: { control: "inline-radio", options: ["md", "lg"] } },
} satisfies Meta<typeof Timer>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. Start it to see Pause and Cancel. */
export const Playground: Story = {};

/** A step's timer with the tray above it, which lists the other timers still going. */
export const InContext: Story = {
  render: () => {
    stored("story-sauce", { status: "paused", duration: 1200, remainingMs: 415_000 });
    return (
      <div style={{ display: "grid", gap: 16, maxWidth: 480, color: "var(--foreground)" }}>
        <TimerTray timers={[{ timerId: "story-sauce", label: "Sauce", duration: 1200, href: "#step-1" }]} />
        <p style={{ margin: 0 }}>Boil the pasta until it is just tender.</p>
        <Timer label="Pasta" duration={600} timerId="story-pasta" />
      </div>
    );
  },
};

/** Paused part way, with Resume and Cancel. */
export const Paused: Story = {
  render: () => {
    stored("story-paused", { status: "paused", duration: 300, remainingMs: 125_000 });
    return <Timer label="Rest" duration={300} timerId="story-paused" />;
  },
};

/** At zero: "Time's up", with Dismiss and Restart. */
export const Finished: Story = {
  render: () => {
    stored("story-finished", { status: "done", duration: 300, endedAt: Date.UTC(2026, 0, 1) });
    return <Timer label="Bread" duration={300} timerId="story-finished" size="lg" />;
  },
};

/** Three seconds long, to hear it reach zero. */
export const Short: Story = { args: { label: "Tea", duration: 3 } };

/** Three seconds long with `alert="repeat"`: it chimes and vibrates every 2.5 seconds until Dismiss, Restart or 15 seconds pass. */
export const Repeating: Story = { args: { label: "Tea", duration: 3, alert: "repeat", repeatFor: 15 } };
