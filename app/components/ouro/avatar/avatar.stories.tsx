import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CSSProperties, ReactNode } from "react";
import { Avatar, AvatarGroup } from "~/components/ouro/avatar/avatar";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

/** A drawn portrait as a data URL, so stories load no network image. */
function portrait(background: string, skin: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${background}"/>` +
    `<circle cx="32" cy="26" r="12" fill="${skin}"/><path d="M10 64c2-14 11-21 22-21s20 7 22 21z" fill="${skin}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const people = [
  { name: "Ada Lovelace", src: portrait("#c7d2fe", "#8d5524") },
  { name: "Grace Hopper", src: undefined },
  { name: "Alan Turing", src: portrait("#bbf7d0", "#f1c27d") },
  { name: "Katherine Johnson", src: undefined },
  { name: "Edsger Dijkstra", src: portrait("#fde68a", "#e0ac69") },
];

const row: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 };

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
        gap: 16,
      }}
    >
      {children}
    </div>
  );
}

const meta = {
  title: "Display/Avatar",
  component: Avatar,
  parameters: { layout: "padded" },
  args: { name: "Ada Lovelace", src: people[0]!.src },
  argTypes: {
    size: { control: "inline-radio", options: ["xs", "sm", "md", "lg", "xl", "2xl", "3xl"] },
  },
} satisfies Meta<typeof Avatar>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. Clear `src` to see the initials. */
export const Playground: Story = {};

/** Every size, with a picture and with initials. */
export const Sizes: Story = {
  render: () => (
    <Surface>
      {[people[0]!, people[1]!].map((person) => (
        <div key={person.name} style={row}>
          {(["xs", "sm", "md", "lg", "xl", "2xl", "3xl"] as const).map((size) => (
            <Avatar key={size} name={person.name} src={person.src} size={size} />
          ))}
        </div>
      ))}
    </Surface>
  ),
};

/** A stacked group with a "+N" count, and an avatar beside a written name (`alt=""`, so the name is read once). */
export const Group: Story = {
  parameters: { screenshot: { name: "avatar-group" } },
  render: () => (
    <Surface>
      <AvatarGroup label="Cooks on this recipe" max={3}>
        {people.map((person) => (
          <Avatar key={person.name} name={person.name} src={person.src} />
        ))}
      </AvatarGroup>
      <AvatarGroup label="Cookbook members" size="sm" total={24}>
        {people.slice(0, 4).map((person) => (
          <Avatar key={person.name} name={person.name} src={person.src} />
        ))}
      </AvatarGroup>
      <div style={{ ...row, gap: 8 }}>
        <Avatar name="Grace Hopper" alt="" size="sm" />
        <span>Grace Hopper</span>
      </div>
    </Surface>
  ),
};
