import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Celebrate } from "~/components/ouro/celebrate/celebrate";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

const meta = {
  title: "Feedback/Celebrate",
  component: Celebrate,
  parameters: { layout: "centered" },
  args: { show: true, message: "List cleared" },
} satisfies Meta<typeof Celebrate>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. Turn `show` off and on for another burst. */
export const Playground: Story = {};

function Chores() {
  const [done, setDone] = useState<string[]>([]);
  const chores = ["Water the plants", "Take out the bins", "Book the dentist"];
  return (
    <div style={{ display: "grid", gap: 12, minWidth: 280, color: "var(--foreground)" }}>
      {chores.map((chore) => (
        <label key={chore} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            data-test-harness=""
            type="checkbox"
            checked={done.includes(chore)}
            onChange={(event) => setDone((list) => (event.target.checked ? [...list, chore] : list.filter((item) => item !== chore)))}
          />
          {chore}
        </label>
      ))}
      <div style={{ display: "flex", justifyContent: "center", minHeight: 40 }}>
        <Celebrate show={done.length === chores.length} message="All done for today" />
      </div>
    </div>
  );
}

/** Ticking the last chore bursts the confetti and says "All done for today". */
export const InContext: Story = { args: { show: false }, render: () => <Chores /> };
