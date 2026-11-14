import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type CSSProperties } from "react";
import { Button } from "~/components/ouro/button/button";
import { Dialog } from "~/components/ouro/dialog/dialog";
import {
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogPopup,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
  DialogViewport,
} from "~/components/ouro/dialog/dialog-parts";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names). The photos are
// drawn inline, so the stories need no network.

const stack: CSSProperties = { display: "grid", gap: 12 };
const row: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" };
const caption: CSSProperties = {
  fontWeight: 500, fontSize: "12px", lineHeight: "16px",
  color: "var(--muted-foreground)",
  letterSpacing: "0.02em",
  textTransform: "uppercase",
};
const body: CSSProperties = { fontWeight: 400, fontSize: "16px", lineHeight: "24px", color: "var(--foreground)", margin: 0 };
const input: CSSProperties = {
  fontWeight: 400, fontSize: "16px", lineHeight: "24px",
  padding: "10px 12px",
  borderRadius: "var(--radius)",
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--foreground)",
};

function RecipeForm() {
  return (
    <div style={stack}>
      <label style={{ ...stack, gap: 6, fontWeight: 500, fontSize: "14px", lineHeight: "20px" }}>
        Name
        <input data-test-harness="" defaultValue="Shakshuka" style={input} />
      </label>
      <label style={{ ...stack, gap: 6, fontWeight: 500, fontSize: "14px", lineHeight: "20px" }}>
        Serves
        <input data-test-harness="" defaultValue="4" inputMode="numeric" style={input} />
      </label>
    </div>
  );
}

/** A made-up landscape, drawn as an SVG. */
function photo(sky: string, sun: string, land: string, water: string): string {
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">` +
      `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky}"/><stop offset="1" stop-color="${sun}"/></linearGradient></defs>` +
      `<rect width="320" height="240" fill="url(#s)"/><circle cx="218" cy="72" r="26" fill="${sun}"/>` +
      `<path d="M0 149 L70 86 L134 149 L192 106 L320 149 V240 H0 Z" fill="${land}"/>` +
      `<rect y="149" width="320" height="91" fill="${water}"/></svg>`,
  )}`;
}

const places = [
  ["Harbor", "Green hills above a calm bay at noon", photo("#8ec5e8", "#ffd166", "#3d7a5a", "#2f6f8f")],
  ["Orchard", "Brown hills under an orange evening sky", photo("#f4a261", "#ffe8a3", "#6b4f3a", "#4a6c8c")],
  ["Lighthouse", "Dark hills against a red sunset", photo("#e76f51", "#f4d35e", "#2a3d45", "#264653")],
  ["Night ferry", "A pale moon over a dark sea", photo("#1d3557", "#f1faee", "#16262e", "#1b4965")],
  ["Salt flats", "Tan hills beside pale water", photo("#bde0fe", "#fefae0", "#a98467", "#8ecae6")],
  ["Pine ridge", "Dark ridges over a green lake", photo("#90be6d", "#f9c74f", "#283618", "#43aa8b")],
  ["Old mill", "Purple hills under a pink sky", photo("#cdb4db", "#ffc8dd", "#5e548e", "#7b8cde")],
  ["Tide pools", "An orange sun over bright blue water", photo("#48cae4", "#ffb703", "#023047", "#0077b6")],
  ["Vineyard", "Purple slopes under a peach sky", photo("#ffafcc", "#ffe5b4", "#6a4c93", "#8093f1")],
  ["Boathouse", "Blue hills over deep water at dawn", photo("#a8dadc", "#f1faee", "#457b9d", "#1d3557")],
] as const;

/** Ten 160px photos in a row that wraps: 1708px wide when there is room, so the dialog grows to its cap and wraps them. */
function Gallery() {
  return (
    <ul style={{ display: "flex", flexWrap: "wrap", gap: 12, margin: 0, padding: 0, listStyle: "none" }}>
      {places.map(([place, scene, src]) => (
        <li key={place}>
          <figure style={{ ...stack, gap: 6, margin: 0 }}>
            <img src={src} alt={scene} width={160} height={120} style={{ display: "block", borderRadius: "var(--radius)" }} />
            <figcaption style={caption}>{place}</figcaption>
          </figure>
        </li>
      ))}
    </ul>
  );
}

const cell: CSSProperties = { padding: "8px 12px", borderBottom: "1px solid var(--border)", textAlign: "start", verticalAlign: "top" };

/** A sailing timetable: seven columns, about 760px with each row on one line, and its cells wrap when there is less room. */
function Timetable() {
  const rows = [
    ["Morning crossing", "Harbor", "06:40", "Lighthouse", "07:25", "Daily", "Bikes welcome"],
    ["Island loop", "Lighthouse", "09:10", "Tide pools", "10:05", "Weekends", "Café on board"],
    ["Market run", "Orchard pier", "11:30", "Harbor", "12:10", "Saturdays", "Crates in the hold"],
    ["Evening crossing", "Harbor", "18:15", "Night ferry dock", "19:00", "Daily", "Last boat back"],
  ];
  const head = ["Sailing", "From", "Leaves", "To", "Arrives", "Runs", "Notes"];
  return (
    <table style={{ borderCollapse: "collapse", fontSize: "14px", lineHeight: "20px", color: "var(--foreground)" }}>
      <thead>
        <tr>
          {head.map((name) => (
            <th key={name} scope="col" style={{ ...cell, fontWeight: 500, color: "var(--muted-foreground)" }}>
              {name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row[0]}>
            {row.map((value, index) => (
              <td key={index} style={cell}>
                {value}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Lines({ count }: { count: number }) {
  return (
    <div style={stack}>
      {Array.from({ length: count }, (_, index) => (
        <p key={index} style={body}>
          Step {index + 1}. Simmer the tomatoes with the peppers and spices until thick, then make wells for the eggs.
        </p>
      ))}
    </div>
  );
}

const meta = {
  title: "Overlays/Dialog",
  component: Dialog,
  parameters: { layout: "centered" },
  args: {
    title: "Edit recipe",
    trigger: <Button>Edit</Button>,
    children: <RecipeForm />,
  },
  argTypes: {
    presentation: { control: "inline-radio", options: ["auto", "dialog", "sheet"] },
    size: { control: "inline-radio", options: ["auto", "sm", "md", "lg", "xl", "2xl", "full"] },
    trigger: { table: { disable: true } },
    children: { table: { disable: true } },
    footer: { table: { disable: true } },
  },
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Centered from 640px up; narrow the window (or open on a phone) to get the bottom sheet. */
export const Playground: Story = {};

/** `footer` holds the actions: a row at the end on wider screens, stacked on phones with the primary action at the bottom. */
export const WithFooter: Story = {
  parameters: { screenshot: { name: "dialog-open", open: true } },
  args: {
    description: "Changes are saved to every cookbook with this recipe.",
    footer: (
      <>
        <Button variant="outline" tone="secondary">
          Cancel
        </Button>
        <Button>Save</Button>
      </>
    ),
  },
};

/** By default the dialog fits its content: a short question keeps md's 32rem, so it never looks cramped. */
export const ShortQuestion: Story = {
  args: {
    title: "Discard your draft?",
    children: <p style={body}>The message you started won't be sent.</p>,
    footer: (
      <>
        <Button variant="outline" tone="secondary">
          Keep editing
        </Button>
        <Button tone="destructive">Discard</Button>
      </>
    ),
  },
};

/** Paragraphs wrap at a readable 65ch, so long text makes a comfortable column, not a dialog as wide as the screen. */
export const LongText: Story = {
  parameters: { screenshot: { name: "dialog-long-text-open", open: true } },
  args: {
    title: "How sharing works",
    description: "Read this once; it applies to every recipe you share.",
    children: (
      <div style={stack}>
        <p style={body}>
          A shared recipe stays yours. The people you share it with can cook from it, add notes in the margin and save a
          copy to their own cookbook, but only you can change the ingredients, the steps or the photos.
        </p>
        <p style={body}>
          When you edit a recipe you have shared, everyone sees the new version the next time they open it. Their margin
          notes stay where they were, and a note about a step you removed moves to the end, so nothing anyone wrote is lost.
        </p>
        <p style={body}>
          You can stop sharing at any time. The recipe leaves their cookbooks within a minute; copies they saved stay with
          them, marked as copies.
        </p>
      </div>
    ),
  },
};

/** A table with real width grows the dialog on a big screen, up to 70% of the screen and 56rem, and fits a smaller one. */
export const WideTable: Story = {
  parameters: { screenshot: { name: "dialog-wide-table-open", open: true } },
  args: {
    title: "Ferry timetable",
    description: "Summer sailings, from June to September.",
    children: <Timetable />,
  },
};

/** A gallery grows the dialog to its cap and wraps there; the description beside it keeps its readable measure. */
export const WideContent: Story = {
  parameters: { screenshot: { name: "dialog-wide-content-open", open: true } },
  args: {
    title: "Coast photos",
    description: "Ten places along the coast, photographed in October.",
    children: <Gallery />,
  },
};

/**
 * `size` caps the width. `auto`, the default, fits the content up to 70% of the screen (40 to 56rem); `xl`, `2xl` and
 * `full` raise the cap to 56rem, 72rem and the viewport; `sm`, `md` and `lg` pin 24, 32 and 40rem. Each opens the gallery.
 */
export const Sizes: Story = {
  render: () => (
    <div style={row}>
      {(["auto", "sm", "md", "lg", "xl", "2xl", "full"] as const).map((size) => (
        <Dialog key={size} title={`Size ${size}`} description="Ten places along the coast." size={size} trigger={<Button variant="soft">{size}</Button>}>
          <Gallery />
        </Dialog>
      ))}
    </div>
  ),
};

/** `presentation` fixes the form at every width. */
export const Presentations: Story = {
  render: () => (
    <div style={row}>
      {(["auto", "dialog", "sheet"] as const).map((presentation) => (
        <Dialog
          key={presentation}
          title={`presentation="${presentation}"`}
          presentation={presentation}
          trigger={<Button variant="soft">{presentation}</Button>}
        >
          <Lines count={2} />
        </Dialog>
      ))}
    </div>
  ),
};

/** Long content scrolls inside the dialog, which keeps clear of the screen edges. */
export const LongContent: Story = {
  render: () => (
    <Dialog title="Method" trigger={<Button>Show method</Button>}>
      <Lines count={24} />
    </Dialog>
  ),
};

/** `hideTitle` keeps the title as the dialog's name for screen readers. */
export const HiddenTitle: Story = {
  args: { hideTitle: true, children: <Lines count={2} /> },
};

/** `open` and `onOpenChange` put the dialog under your state. It stays open when a resize changes its form. */
export const Controlled: Story = {
  parameters: { plainOpeners: ["Open"] },
  render: function Render() {
    const [open, setOpen] = useState(false);
    return (
      <div style={row}>
        <Button onClick={() => setOpen(true)}>Open</Button>
        <span style={caption}>{open ? "open" : "closed"}</span>
        <Dialog
          title="Controlled"
          open={open}
          onOpenChange={setOpen}
          footer={<Button onClick={() => setOpen(false)}>Done</Button>}
        >
          <p style={body}>Press Escape, tap outside or use the close button: each calls onOpenChange(false).</p>
        </Dialog>
      </div>
    );
  },
};

/** Built from parts. A part given no `render` is a plain button of its own: here the trigger and the close button. */
export const Parts: Story = {
  render: () => (
    <DialogRoot>
      <DialogTrigger>Edit recipe</DialogTrigger>
      <DialogPortal>
        <DialogBackdrop />
        <DialogViewport>
          <DialogPopup>
            <DialogTitle>Edit recipe</DialogTitle>
            <DialogContent>Changes are saved to every cookbook with this recipe.</DialogContent>
            <DialogFooter>
              <DialogClose>Close</DialogClose>
            </DialogFooter>
          </DialogPopup>
        </DialogViewport>
      </DialogPortal>
    </DialogRoot>
  ),
};
