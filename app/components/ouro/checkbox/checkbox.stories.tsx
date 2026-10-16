import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ReactNode } from "react";
import { Checkbox } from "~/components/ouro/checkbox/checkbox";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

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
        maxWidth: 420,
      }}
    >
      {children}
    </div>
  );
}

const herbs = ["Basil", "Mint", "Sage"];

/** A "select all" box: mixed while some herbs are checked. */
function SelectAll() {
  const [checked, setChecked] = useState<string[]>(["Basil"]);
  const all = checked.length === herbs.length;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Checkbox
        label="All herbs"
        checked={all}
        indeterminate={checked.length > 0 && !all}
        onCheckedChange={(next) => setChecked(next ? herbs : [])}
      />
      <div style={{ display: "grid", gap: 12, paddingInlineStart: 28 }}>
        {herbs.map((herb) => (
          <Checkbox
            key={herb}
            label={herb}
            checked={checked.includes(herb)}
            onCheckedChange={(next) => setChecked((current) => (next ? [...current, herb] : current.filter((item) => item !== herb)))}
          />
        ))}
      </div>
    </div>
  );
}

const meta = {
  title: "Forms/Checkbox",
  component: Checkbox,
  parameters: { layout: "padded" },
  args: { label: "Email me new recipes", name: "newsletter" },
  argTypes: {
    required: { control: "boolean" },
    disabled: { control: "boolean" },
    hideLabel: { control: "boolean" },
    indeterminate: { control: "boolean" },
    error: { control: "text" },
    description: { control: "text" },
  },
} satisfies Meta<typeof Checkbox>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

/** Unchecked, checked, described, required with an error, and disabled. */
export const States: Story = {
  parameters: { screenshot: { name: "checkbox-states" } },
  render: () => (
    <Surface>
      <Checkbox label="Email me new recipes" name="newsletter" />
      <Checkbox label="Save to my cookbook" name="save" defaultChecked />
      <Checkbox label="Share with the family" name="share" description="Everyone in your household sees it." defaultChecked />
      <Checkbox label="I accept the terms" name="terms" required error="Accept the terms to continue." />
      <Checkbox label="Publish to the community" name="publish" disabled description="Verify your email first." />
      <Checkbox label="Keep private" name="private" disabled defaultChecked />
    </Surface>
  ),
};

/** A "select all" box shows a dash, announced as mixed, while some of its items are checked. */
export const Indeterminate: Story = {
  render: () => (
    <Surface>
      <SelectAll />
    </Surface>
  ),
};
