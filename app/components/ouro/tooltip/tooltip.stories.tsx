import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CSSProperties } from "react";
import { Button } from "~/components/ouro/button/button";
import { Tooltip } from "~/components/ouro/tooltip/tooltip";
import { OuroProvider } from "~/lib/ouro/ouro-provider";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

const row: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" };

function Icon({ d }: { d: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="none">
      <path d={d} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const bookmark = "M4 2.5h8v11l-4-3-4 3z";
const share = "M8 2v8M5 5l3-3 3 3M3 9v4h10V9";
const print = "M4 6V2h8v4M4 11H2V6h12v5h-2M4 9h8v5H4z";

const meta = {
  title: "Overlays/Tooltip",
  component: Tooltip,
  parameters: { layout: "centered" },
  args: {
    content: "Add to cookbook",
    children: (
      <Button aria-label="Save" variant="plain" tone="secondary">
        <Icon d={bookmark} />
      </Button>
    ),
  },
  argTypes: {
    side: { control: "inline-radio", options: ["top", "bottom", "left", "right"] },
    align: { control: "inline-radio", options: ["start", "center", "end"] },
    children: { table: { disable: true } },
  },
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Hover or focus the icon button. The button has its own name, `aria-label`; the tooltip only shows it. */
export const Playground: Story = {
  parameters: { screenshot: { name: "tooltip-open", focus: true } },
};

/** Inside `OuroProvider`, once one tooltip shows, its neighbours open instantly. */
export const Toolbar: Story = {
  render: () => (
    <OuroProvider>
      <div style={row}>
        {[
          ["Save", "Add to cookbook", bookmark],
          ["Share", "Share recipe", share],
          ["Print", "Print recipe", print],
        ].map(([label, content, d]) => (
          <Tooltip key={label} content={content!} side="bottom">
            <Button aria-label={label} variant="plain" tone="secondary">
              <Icon d={d!} />
            </Button>
          </Tooltip>
        ))}
      </div>
    </OuroProvider>
  ),
};
