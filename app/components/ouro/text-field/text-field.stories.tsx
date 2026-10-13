import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { TextField } from "~/components/ouro/text-field/text-field";

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

/** A 16px magnifier in the text color, as an app's icon library would draw it. */
function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" />
    </svg>
  );
}

const meta = {
  title: "Forms/TextField",
  component: TextField,
  parameters: { layout: "padded" },
  args: { label: "Email", type: "email", name: "email", placeholder: "you@example.com" },
  argTypes: {
    type: { control: "select", options: ["text", "email", "password", "tel", "url", "search", "date", "time"] },
    required: { control: "boolean" },
    disabled: { control: "boolean" },
    hideLabel: { control: "boolean" },
    clearable: { control: "boolean" },
    error: { control: "text" },
    description: { control: "text" },
  },
} satisfies Meta<typeof TextField>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

/** Each type sets the phone keyboard and autofill. Date and time open the OS picker. */
export const Types: Story = {
  parameters: { screenshot: { name: "text-field-types" } },
  render: () => (
    <Surface>
      <TextField label="Recipe name" name="name" defaultValue="Lemon ricotta pasta" />
      <TextField label="Email" type="email" name="email" placeholder="you@example.com" />
      <TextField label="Password" type="password" name="password" defaultValue="pasta-night" />
      <TextField label="Phone" type="tel" name="phone" placeholder="+1 555 0100" />
      <TextField label="Source" type="url" name="url" placeholder="https://" />
      <TextField label="Search recipes" type="search" name="q" placeholder="Pasta, soup, tacos" />
      <TextField label="Cook on" type="date" name="date" defaultValue="2026-10-11" />
      <TextField label="Start at" type="time" name="time" defaultValue="18:30" />
    </Surface>
  ),
};

/** Text and icons inside the box, and the clear button. */
export const Adornments: Story = {
  parameters: { screenshot: { name: "text-field-adornments" } },
  render: () => (
    <Surface>
      <TextField label="Search recipes" hideLabel type="search" name="q" clearable startAdornment={<SearchIcon />} defaultValue="Pasta" />
      <TextField label="Price" name="price" inputMode="decimal" startAdornment="$" endAdornment="per jar" defaultValue="4.50" />
      <TextField label="Weight" name="weight" inputMode="decimal" endAdornment="kg" />
    </Surface>
  ),
};

/** Described, required, invalid with one or several messages, and disabled. */
export const States: Story = {
  parameters: { screenshot: { name: "text-field-states" } },
  render: () => (
    <Surface>
      <TextField label="Email" type="email" name="email" required description="We send the shopping list here." placeholder="you@example.com" />
      <TextField label="Source" type="url" name="url" error="Enter a full address, starting with https://." defaultValue="example.com/pasta" />
      <TextField
        label="New password"
        type="password"
        name="password"
        autoComplete="new-password"
        required
        error={["Use 8 or more characters.", "Add a number."]}
        defaultValue="pasta"
      />
      <TextField label="Cookbook" name="cookbook" disabled description="Shared cookbooks can't be renamed." defaultValue="Weeknights" />
    </Surface>
  ),
};
