import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type CSSProperties } from "react";
import { Button } from "~/components/ouro/button/button";
import { Sheet } from "~/components/ouro/sheet/sheet";
import {
  SheetBackdrop,
  SheetClose,
  SheetContent,
  SheetPopup,
  SheetPortal,
  SheetRoot,
  SheetTitle,
  SheetTrigger,
  SheetViewport,
} from "~/components/ouro/sheet/sheet-parts";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

const stack: CSSProperties = { display: "grid", gap: 12 };
const row: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" };
const caption: CSSProperties = {
  fontWeight: 500, fontSize: "12px", lineHeight: "16px",
  color: "var(--muted-foreground)",
  letterSpacing: "0.02em",
  textTransform: "uppercase",
};
const body: CSSProperties = { fontWeight: 400, fontSize: "16px", lineHeight: "24px", color: "var(--foreground)", margin: 0 };

const cookbooks = ["Weeknight dinners", "Baking", "Grandma's recipes", "Meal prep", "Holidays"];

/** A list of cookbook rows, the content Spoonjoy's save sheet shows. */
function CookbookList() {
  const [saved, setSaved] = useState<string[]>(["Baking"]);
  return (
    <div style={{ display: "grid", gap: 4 }}>
      {cookbooks.map((name) => {
        const on = saved.includes(name);
        return (
          <Button
            key={name}
            variant={on ? "soft" : "plain"}
            tone={on ? "primary" : "secondary"}
            fullWidth
            aria-pressed={on}
            onClick={() => setSaved(on ? saved.filter((item) => item !== name) : [...saved, name])}
          >
            {on ? `${name} (saved)` : name}
          </Button>
        );
      })}
    </div>
  );
}

function Lines({ count }: { count: number }) {
  return (
    <div style={stack}>
      {Array.from({ length: count }, (_, index) => (
        <p key={index} style={body}>
          Step {index + 1}. Whisk the eggs with a pinch of salt, then fold in the herbs and let it rest for a minute.
        </p>
      ))}
    </div>
  );
}

const meta = {
  title: "Overlays/Sheet",
  component: Sheet,
  parameters: { layout: "centered" },
  args: { title: "Save to cookbook", trigger: <Button>Save</Button>, children: <CookbookList /> },
  argTypes: {
    side: { control: "inline-radio", options: ["bottom", "top", "left", "right"] },
    trigger: { table: { disable: true } },
    children: { table: { disable: true } },
  },
} satisfies Meta<typeof Sheet>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The default bottom sheet. Drag it down to dismiss, or pull it up to feel the stretch. */
export const Playground: Story = {};

export const WithDescription: Story = {
  parameters: { screenshot: { name: "sheet-open", open: true } },
  args: { description: "Tap a cookbook to save or remove this recipe." },
};

/** `hideTitle` keeps the title as the dialog's name for screen readers. */
export const HiddenTitle: Story = {
  args: { hideTitle: true },
};

/** Each edge. Side sheets fill the height and leave a strip of the page visible. */
export const Sides: Story = {
  render: () => (
    <div style={row}>
      {(["bottom", "top", "left", "right"] as const).map((side) => (
        <Sheet key={side} title={`From the ${side}`} side={side} trigger={<Button variant="soft">{side}</Button>}>
          <Lines count={3} />
        </Sheet>
      ))}
    </div>
  ),
};

/** `snapPoints={[0.5, 1]}` opens at half height; drag up for full height, down to dismiss. */
export const SnapPoints: Story = {
  render: () => (
    <Sheet title="Method" snapPoints={[0.5, 1]} trigger={<Button>Show method</Button>}>
      <Lines count={14} />
    </Sheet>
  ),
};

/** Long content scrolls inside the sheet, which stops short of the top of the screen. */
export const LongContent: Story = {
  render: () => (
    <Sheet title="Method" trigger={<Button>Show method</Button>}>
      <Lines count={20} />
    </Sheet>
  ),
};

/** Inputs stay visible above the software keyboard (try it on a phone). */
export const WithForm: Story = {
  render: () => (
    <Sheet title="Add a note" trigger={<Button>Add note</Button>}>
      <label style={{ ...stack, gap: 6, fontWeight: 500, fontSize: "14px", lineHeight: "20px" }}>
        Note
        <input
          data-test-harness=""
          placeholder="Less salt next time"
          // Tailwind's base styles draw a placeholder at half the text color, below 4.5:1.
          className="placeholder:text-muted-foreground"
          style={{
            fontWeight: 400, fontSize: "16px", lineHeight: "24px",
            padding: "10px 12px",
            borderRadius: "var(--radius)",
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--foreground)",
          }}
        />
      </label>
    </Sheet>
  ),
};

/** `open` and `onOpenChange` put the sheet under your state. */
export const Controlled: Story = {
  parameters: { plainOpeners: ["Open"] },
  render: function Render() {
    const [open, setOpen] = useState(false);
    return (
      <div style={row}>
        <Button onClick={() => setOpen(true)}>Open</Button>
        <span style={caption}>{open ? "open" : "closed"}</span>
        <Sheet title="Controlled" open={open} onOpenChange={setOpen}>
          <p style={body}>Swipe down, press Escape or tap outside: each calls onOpenChange(false).</p>
          <div style={{ marginTop: 16 }}>
            <Button variant="soft" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </Sheet>
      </div>
    );
  },
};

/** Built from parts. A part given no `render` is a plain button of its own: here the trigger and the close button. */
export const Parts: Story = {
  render: () => (
    <SheetRoot>
      <SheetTrigger>Add note</SheetTrigger>
      <SheetPortal>
        <SheetBackdrop />
        <SheetViewport>
          <SheetPopup>
            <SheetTitle>Add a note</SheetTitle>
            <SheetContent>
              Notes stay with this recipe.
              <SheetClose>Close</SheetClose>
            </SheetContent>
          </SheetPopup>
        </SheetViewport>
      </SheetPortal>
    </SheetRoot>
  ),
};

const looks = [
  { name: "Ocean", color: "oklch(0.55 0.15 245)" },
  { name: "Forest", color: "oklch(0.52 0.12 150)" },
  { name: "Sunset", color: "oklch(0.62 0.17 45)" },
] as const;

/**
 * `modal={false}`: a panel beside a page that stays in use, here a live preview of a look. No
 * backdrop dims the page, its controls stay in reach, and the sheet closes with Escape or its
 * close button.
 */
export const NonModal: Story = {
  parameters: { screenshot: { name: "sheet-non-modal", open: true }, layout: "fullscreen" },
  render: function Render() {
    const [look, setLook] = useState<(typeof looks)[number]>(looks[0]);
    return (
      <div style={{ ...stack, padding: 24, maxWidth: 520 }}>
        <span style={caption}>Preview</span>
        <div style={{ display: "grid", gap: 8, padding: 16, borderRadius: 12, border: "1px solid var(--border)" }}>
          <p style={{ ...body, fontWeight: 600 }}>Shakshuka for two</p>
          <p style={{ ...body, color: "var(--muted-foreground)" }}>Eggs poached in a spiced tomato sauce, ready in 25 minutes.</p>
          <span style={{ height: 8, borderRadius: 4, background: look.color }} />
        </div>
        <div style={row}>
          <Sheet title="Look" description="Pick one; the page shows it at once." side="right" modal={false} trigger={<Button variant="soft">Change look</Button>}>
            <div style={{ display: "grid", gap: 4 }}>
              {looks.map((item) => (
                <Button key={item.name} variant={item === look ? "soft" : "plain"} tone={item === look ? "primary" : "secondary"} fullWidth aria-pressed={item === look} onClick={() => setLook(item)}>
                  {item.name}
                </Button>
              ))}
            </div>
          </Sheet>
          <span style={caption}>{look.name}</span>
        </div>
      </div>
    );
  },
};
