import type { Meta, StoryObj } from "@storybook/react-vite";
import { RelativeTime } from "~/components/ouro/relative-time/relative-time";
import { Text } from "~/components/ouro/text/text";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

const MINUTE = 60_000;
// Stories render once per load, so the times are set from when the story module loads, to the
// hour: an app sends the instant with its server's HTML, and every page that loads this module in
// the same hour (the server's render and the reader's hydration) agrees on it, as that would.
const loaded = Math.floor(Date.now() / (60 * MINUTE)) * 60 * MINUTE;

const meta = {
  title: "Text/RelativeTime",
  component: RelativeTime,
  parameters: { layout: "padded" },
  args: { value: new Date(loaded - 3 * 24 * 60 * MINUTE) },
  argTypes: {
    numeric: { control: "inline-radio", options: ["auto", "always"] },
  },
} satisfies Meta<typeof RelativeTime>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. Hover it for the full date and time. */
export const Playground: Story = {};

/** Comments on a note, each saying how long ago it was posted. */
export const InContext: Story = {
  render: () => (
    <ul style={{ display: "grid", gap: 12, maxWidth: 420, margin: 0, padding: 0, listStyle: "none", color: "var(--foreground)" }}>
      {[
        ["Avery", "Bridge is open again.", 2 * MINUTE],
        ["Sam", "Mud past the second gate.", 5 * 60 * MINUTE],
        ["Jordan", "Saw a heron at the lake.", 26 * 60 * MINUTE],
        ["Riley", "Trail map updated.", 9 * 24 * 60 * MINUTE],
      ].map(([name, text, ago]) => (
        <li key={name as string} style={{ display: "grid", gap: 2 }}>
          <Text size="sm">
            <strong>{name}</strong>{" "}
            <Text as="span" size="sm" tone="muted">
              <RelativeTime value={loaded - (ago as number)} />
            </Text>
          </Text>
          <Text size="sm">{text}</Text>
        </li>
      ))}
    </ul>
  ),
};

/** A calendar date with no time of day, such as a due date: whole days from the reader's own today. Hover it for the date. */
export const CalendarDate: Story = {
  render: () => (
    <Text>
      Library books due <RelativeTime value="2026-06-02" />.
    </Text>
  ),
};
