import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef, useState, type CSSProperties } from "react";
import { Button } from "~/components/ouro/button/button";
import { Popover } from "~/components/ouro/popover/popover";
import {
  PopoverClose,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  PopoverRoot,
  PopoverTitle,
  PopoverTrigger,
} from "~/components/ouro/popover/popover-parts";
import { TextField } from "~/components/ouro/text-field/text-field";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

const row: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" };
const stack: CSSProperties = { display: "grid", gap: 12 };
const caption: CSSProperties = {
  fontWeight: 500, fontSize: "12px", lineHeight: "16px",
  color: "var(--muted-foreground)",
  letterSpacing: "0.02em",
  textTransform: "uppercase",
};

function Filters() {
  return (
    <div style={stack}>
      <TextField label="Ingredient" defaultValue="Tomato" />
      <TextField label="Ready in (minutes)" defaultValue="30" inputMode="numeric" />
    </div>
  );
}

const meta = {
  title: "Overlays/Popover",
  component: Popover,
  parameters: { layout: "centered" },
  args: {
    title: "Share recipe",
    description: "Anyone with the link can view it.",
    trigger: <Button variant="soft">Share</Button>,
    children: <TextField label="Link" defaultValue="https://spoonjoy.app/r/shakshuka" readOnly />,
  },
  argTypes: {
    side: { control: "inline-radio", options: ["top", "bottom", "left", "right"] },
    align: { control: "inline-radio", options: ["start", "center", "end"] },
    presentation: { control: "inline-radio", options: ["popover", "auto", "sheet"] },
    trigger: { table: { disable: true } },
    children: { table: { disable: true } },
  },
} satisfies Meta<typeof Popover>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Beside its trigger at every width, flipping when there is no room. */
export const Playground: Story = {
  parameters: { screenshot: { name: "popover-open", open: true } },
};

/** `presentation="auto"` turns a popover with fields into a bottom sheet below 640px. */
export const AutoPresentation: Story = {
  args: {
    title: "Filters",
    description: undefined,
    presentation: "auto",
    trigger: <Button variant="outline" tone="secondary">Filters</Button>,
    children: <Filters />,
  },
};

/** `side` and `align` place it around the trigger. */
export const Sides: Story = {
  render: () => (
    <div style={row}>
      {(["top", "bottom", "left", "right"] as const).map((side) => (
        <Popover key={side} title={`side="${side}"`} side={side} trigger={<Button variant="soft">{side}</Button>}>
          A short note about this recipe.
        </Popover>
      ))}
    </div>
  ),
};

/** `open`, `onOpenChange` and `anchor` put it under your state, pointing at your own button. */
export const Controlled: Story = {
  parameters: { plainOpeners: ["Servings"] },
  render: function Render() {
    const [open, setOpen] = useState(false);
    const anchor = useRef<HTMLButtonElement>(null);
    return (
      <div style={row}>
        <Button ref={anchor} variant="soft" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          Servings
        </Button>
        <span style={caption}>{open ? "open" : "closed"}</span>
        <Popover title="Servings" open={open} onOpenChange={setOpen} anchor={anchor}>
          <TextField label="Serves" defaultValue="4" inputMode="numeric" />
        </Popover>
      </div>
    );
  },
};

/** Built from parts. A part given no `render` is a plain button of its own: here the trigger, and the close button screen readers reach. */
export const Parts: Story = {
  render: () => (
    <PopoverRoot>
      <PopoverTrigger>Share</PopoverTrigger>
      <PopoverPortal>
        <PopoverPositioner>
          <PopoverPopup>
            <PopoverTitle>Share recipe</PopoverTitle>
            Anyone with the link can view it.
            <PopoverClose>Close</PopoverClose>
          </PopoverPopup>
        </PopoverPositioner>
      </PopoverPortal>
    </PopoverRoot>
  ),
};
