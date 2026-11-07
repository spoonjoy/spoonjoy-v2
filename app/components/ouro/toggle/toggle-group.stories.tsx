import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ReactNode, type SVGProps } from "react";
import { ToggleGroup } from "~/components/ouro/toggle/toggle-group";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

function icon(path: ReactNode) {
  return function Icon(props: SVGProps<SVGSVGElement>) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
        {path}
      </svg>
    );
  };
}
const BoldIcon = icon(<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" />);
const ItalicIcon = icon(<path d="M14 5h-4M14 19h-4M14 5l-4 14" />);
const UnderlineIcon = icon(<path d="M7 4v7a5 5 0 0 0 10 0V4M5 20h14" />);
const LeftIcon = icon(<path d="M4 6h16M4 12h10M4 18h16" />);
const CenterIcon = icon(<path d="M4 6h16M7 12h10M4 18h16" />);
const RightIcon = icon(<path d="M4 6h16M10 12h10M4 18h16" />);

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
      }}
    >
      {children}
    </div>
  );
}

const styles = [
  { value: "bold", label: "Bold", icon: BoldIcon, hideLabel: true },
  { value: "italic", label: "Italic", icon: ItalicIcon, hideLabel: true },
  { value: "underline", label: "Underline", icon: UnderlineIcon, hideLabel: true },
];
const alignment = [
  { value: "left", label: "Left", icon: LeftIcon },
  { value: "center", label: "Center", icon: CenterIcon },
  { value: "right", label: "Right", icon: RightIcon },
];

const meta = {
  title: "Actions/ToggleGroup",
  component: ToggleGroup,
  parameters: { layout: "padded" },
  args: { label: "Alignment", items: alignment, defaultValue: "left" },
  argTypes: {
    variant: { control: "inline-radio", options: ["plain", "outline"] },
    size: { control: "inline-radio", options: ["sm", "md", "lg"] },
    hideLabel: { control: "boolean" },
    disabled: { control: "boolean" },
  },
} satisfies Meta<typeof ToggleGroup>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. The arrow keys move between toggles. */
export const Playground: Story = {};

/** One at a time with labels; several at once as an icon toolbar; outline; disabled. */
export const Modes: Story = {
  parameters: { screenshot: { name: "toggle-group-modes" } },
  render: () => (
    <Surface>
      <ToggleGroup label="Alignment" items={alignment} defaultValue="center" />
      <ToggleGroup label="Text style" multiple items={styles} defaultValue={["bold", "underline"]} />
      <ToggleGroup label="Size" variant="outline" size="sm" items={[{ value: "s", label: "S" }, { value: "m", label: "M" }, { value: "l", label: "L" }]} defaultValue="m" />
      <ToggleGroup label="Archived filters" disabled items={alignment} defaultValue="left" />
    </Surface>
  ),
};

/** Controlled, several at once: the value is a list. */
export const Controlled: Story = {
  render: function Render() {
    const [value, setValue] = useState<string[]>(["bold"]);
    return (
      <Surface>
        <ToggleGroup label="Text style" hideLabel multiple items={styles} value={value} onValueChange={setValue} />
        <span
          style={{
            fontWeight: value.includes("bold") ? 700 : 400,
            fontStyle: value.includes("italic") ? "italic" : "normal",
            textDecoration: value.includes("underline") ? "underline" : "none",
          }}
        >
          Lemon ricotta pasta
        </span>
      </Surface>
    );
  },
};
