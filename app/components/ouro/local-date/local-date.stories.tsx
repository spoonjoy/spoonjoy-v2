import type { Meta, StoryObj } from "@storybook/react-vite";
import { LocalDate } from "~/components/ouro/local-date/local-date";
import { Text } from "~/components/ouro/text/text";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

const meta = {
  title: "Text/LocalDate",
  component: LocalDate,
  parameters: { layout: "padded" },
  args: { value: "2026-06-01T09:30:00Z" },
  argTypes: {
    format: { control: "inline-radio", options: ["date", "month", "datetime", "time"] },
  },
} satisfies Meta<typeof LocalDate>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

/** One instant in each format, in the reader's own time zone. */
export const Formats: Story = {
  render: () => (
    <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 16px", margin: 0, color: "var(--foreground)" }}>
      {(["date", "month", "datetime", "time"] as const).map((format) => (
        <div key={format} style={{ display: "contents" }}>
          <dt style={{ color: "var(--muted-foreground)" }}>{format}</dt>
          <dd style={{ margin: 0 }}>
            <LocalDate value="2026-06-01T09:30:00Z" format={format} />
          </dd>
        </div>
      ))}
    </dl>
  ),
};

/** A calendar date with no time of day, such as a due date: the same day for every reader, wherever they are. */
export const CalendarDate: Story = {
  render: () => (
    <Text>
      Due <LocalDate value="2026-06-01" />, billed for <LocalDate value="2026-06" format="month" />.
    </Text>
  ),
};

/** Inside a line of text, in other languages. */
export const InContext: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 8, color: "var(--foreground)" }}>
      <Text>
        Trail reopens <LocalDate value="2026-06-01T09:30:00Z" />.
      </Text>
      <Text tone="muted" size="sm">
        Mis à jour le <LocalDate value="2026-06-01T09:30:00Z" format="datetime" locale="fr-FR" />
      </Text>
      <Text tone="muted" size="sm">
        Aktualisiert <LocalDate value="2026-06-01T09:30:00Z" format="month" locale="de-DE" />
      </Text>
    </div>
  ),
};
