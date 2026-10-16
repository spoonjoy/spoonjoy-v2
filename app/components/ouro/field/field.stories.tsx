import { Form } from "@base-ui/react/form";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ReactNode } from "react";
import { Button } from "~/components/ouro/button/button";
import { Field } from "~/components/ouro/field/field";
import { FieldControl } from "~/components/ouro/field/field-parts";

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

const meta = {
  title: "Forms/Field",
  component: Field,
  parameters: { layout: "padded" },
  args: {
    label: "Email",
    description: "We send the shopping list here.",
    name: "email",
    children: <FieldControl type="email" placeholder="you@example.com" />,
  },
  argTypes: {
    required: { control: "boolean" },
    disabled: { control: "boolean" },
    hideLabel: { control: "boolean" },
    error: { control: "text" },
  },
} satisfies Meta<typeof Field>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

/** Each state a field can be in: plain, described, required, invalid with one or several messages, and disabled. */
export const States: Story = {
  parameters: { screenshot: { name: "field-states" } },
  render: () => (
    <Surface>
      <Field label="Recipe name" name="name">
        <FieldControl defaultValue="Lemon ricotta pasta" />
      </Field>
      <Field label="Servings" name="servings" description="How many people it feeds.">
        <FieldControl type="number" defaultValue="4" />
      </Field>
      <Field label="Email" name="email" required description="We send the shopping list here.">
        <FieldControl type="email" placeholder="you@example.com" />
      </Field>
      <Field label="Source URL" name="url" error="Enter a full address, starting with https://.">
        <FieldControl type="url" defaultValue="example.com/pasta" />
      </Field>
      <Field label="Password" name="password" required error={["Use 8 or more characters.", "Add a number."]}>
        <FieldControl type="password" defaultValue="pasta" />
      </Field>
      <Field label="Cookbook" name="cookbook" disabled description="Shared cookbooks can't be renamed.">
        <FieldControl defaultValue="Weeknights" />
      </Field>
    </Surface>
  ),
};

/** `hideLabel` keeps the label as the control's name for screen readers, for a search box whose purpose is plain. */
export const HiddenLabel: Story = {
  render: () => (
    <Surface>
      <Field label="Search recipes" hideLabel name="q">
        <FieldControl type="search" placeholder="Search recipes" />
      </Field>
    </Surface>
  ),
};

/** Another element through `render`: a textarea for notes. */
export const OtherElement: Story = {
  render: () => (
    <Surface>
      <Field label="Notes" name="notes" description="Only you see these.">
        <FieldControl render={<textarea rows={3} />} className="h-24 py-2" />
      </Field>
    </Surface>
  ),
};

/** Server errors: Base UI's `Form` shows `errors` on the field with that `name`, as a server action returns them. */
function ServerErrorsDemo() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <Surface>
      <Form
        errors={errors}
        onSubmit={(event) => {
          event.preventDefault();
          setErrors({ email: "That email already has an account." });
        }}
        style={{ display: "grid", gap: 16 }}
      >
        <Field label="Email" name="email">
          <FieldControl type="email" defaultValue="ari@example.com" />
        </Field>
        <div>
          <Button type="submit">Create account</Button>
        </div>
      </Form>
    </Surface>
  );
}

export const ServerErrors: Story = { render: () => <ServerErrorsDemo /> };
