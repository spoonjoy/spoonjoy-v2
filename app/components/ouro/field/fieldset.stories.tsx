import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { Field } from "~/components/ouro/field/field";
import { FieldControl } from "~/components/ouro/field/field-parts";
import { Fieldset } from "~/components/ouro/field/fieldset";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

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
        gap: 32,
        maxWidth: 480,
      }}
    >
      {children}
    </div>
  );
}

function AddressFields() {
  return (
    <>
      <Field label="Street" name="street" required>
        <FieldControl autoComplete="street-address" defaultValue="12 Orchard Lane" />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
        <Field label="City" name="city" required>
          <FieldControl autoComplete="address-level2" defaultValue="Portland" />
        </Field>
        <Field label="Postcode" name="postcode">
          <FieldControl autoComplete="postal-code" defaultValue="97201" />
        </Field>
      </div>
    </>
  );
}

const meta = {
  title: "Forms/Fieldset",
  component: Fieldset,
  parameters: { layout: "padded" },
  args: { legend: "Shipping address", description: "Where we send your order.", children: <AddressFields /> },
  argTypes: {
    disabled: { control: "boolean" },
    hideLegend: { control: "boolean" },
  },
} satisfies Meta<typeof Fieldset>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

/** A group with a description, and the same group disabled: every control inside is disabled at once. */
export const Address: Story = {
  parameters: { screenshot: { name: "fieldset" } },
  render: () => (
    <Surface>
      <Fieldset legend="Shipping address" description="Where we send your order.">
        <AddressFields />
      </Fieldset>
      <Fieldset legend="Billing address" description="Same as shipping." disabled>
        <AddressFields />
      </Fieldset>
    </Surface>
  ),
};
