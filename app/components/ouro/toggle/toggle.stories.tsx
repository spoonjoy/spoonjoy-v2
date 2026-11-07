import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ReactNode, type SVGProps } from "react";
import { Toggle } from "~/components/ouro/toggle/toggle";

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
const StarIcon = icon(<path d="M12 4l2.4 5 5.6.8-4 3.9.9 5.5L12 16.6 7.1 19.2l.9-5.5-4-3.9 5.6-.8z" />);

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
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 12,
      }}
    >
      {children}
    </div>
  );
}

const meta = {
  title: "Actions/Toggle",
  component: Toggle,
  parameters: { layout: "padded" },
  args: { label: "Bold" },
  argTypes: {
    variant: { control: "inline-radio", options: ["plain", "outline"] },
    size: { control: "inline-radio", options: ["sm", "md", "lg"] },
    hideLabel: { control: "boolean" },
    disabled: { control: "boolean" },
  },
} satisfies Meta<typeof Toggle>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. Press it to see the pressed tint; tab to see the focus ring. */
export const Playground: Story = { args: { icon: BoldIcon } };

/** Off and on, plain and outline, with and without a visible label, and disabled. */
export const States: Story = {
  parameters: { screenshot: { name: "toggle-states" } },
  render: () => (
    <Surface>
      <Toggle label="Bold" icon={BoldIcon} hideLabel />
      <Toggle label="Italic" icon={ItalicIcon} hideLabel defaultPressed />
      <Toggle label="Favorite" icon={StarIcon} variant="outline" />
      <Toggle label="Favorite" icon={StarIcon} variant="outline" defaultPressed />
      <Toggle label="Show completed" size="sm" />
      <Toggle label="Show completed" size="sm" defaultPressed />
      <Toggle label="Archived" disabled />
    </Surface>
  ),
};

/** Controlled: the pressed state lives in the app. */
export const Controlled: Story = {
  render: function Render() {
    const [bold, setBold] = useState(false);
    return (
      <Surface>
        <Toggle label="Bold" icon={BoldIcon} hideLabel pressed={bold} onPressedChange={setBold} />
        <span style={{ fontWeight: bold ? 700 : 400 }}>Lemon ricotta pasta</span>
      </Surface>
    );
  },
};
