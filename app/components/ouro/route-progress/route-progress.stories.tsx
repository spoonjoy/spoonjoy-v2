import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { RouteProgress } from "~/components/ouro/route-progress/route-progress";
import { Switch } from "~/components/ouro/switch/switch";
import { Text } from "~/components/ouro/text/text";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

const meta = {
  title: "Feedback/RouteProgress",
  component: RouteProgress,
  parameters: { layout: "padded" },
  args: { active: true },
} satisfies Meta<typeof RouteProgress>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. The bar runs along the top of the page it is loading over. */
export const Playground: Story = {
  parameters: { ouroCheck: { holdIntervals: true } },
  render: (args) => (
    <div style={{ display: "grid", gap: 12, color: "var(--foreground)" }}>
      <RouteProgress {...args} />
      <Text>The page you are on stays in place while the next one loads.</Text>
    </div>
  ),
  play: async ({ canvasElement, args }) => {
    if (!args.active) return;
    for (let frame = 0; frame < 600; frame++) {
      if (canvasElement.querySelector('[data-ouro-part="bar"][data-open]')) return;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    throw new Error("RouteProgress did not open.");
  },
};

/** A navigation that starts and ends: turn the switch on, as a router would while it loads the next page. */
export const InContext: Story = {
  render: function InContextStory() {
    const [active, setActive] = useState(false);
    return (
      <div style={{ display: "grid", gap: 12, color: "var(--foreground)" }}>
        <RouteProgress active={active} />
        <Text>A click that waits on the server shows the bar at the top until the next page arrives.</Text>
        <Switch label="Loading the next page" checked={active} onCheckedChange={setActive} />
      </div>
    );
  },
};
