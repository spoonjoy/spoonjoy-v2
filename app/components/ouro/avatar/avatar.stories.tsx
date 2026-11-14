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
  { name: "Ana Lind", src: portrait("#c7d2fe", "#8d5524") },
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
  args: { name: "Ana Lind", src: people[0]!.src },
  argTypes: {
    size: { control: "inline-radio", options: ["xs", "sm", "md", "lg", "xl", "2xl", "3xl"] },
    shape: { control: "inline-radio", options: ["circle", "square"] },
    color: { control: "inline-radio", options: ["colorful", "brand", "neutral"] },
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

/** A stroked 24px icon, as lucide-react draws them. */
function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
const calendar = "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z";
const bot = "M12 8V4H8M4 8h16v12H4zM2 14h2M20 14h2M9 13v2M15 13v2";

const presences = [
  { presence: "available", presenceLabel: "Available" },
  { presence: "busy", presenceLabel: "In a meeting" },
  { presence: "do-not-disturb", presenceLabel: "Do not disturb" },
  { presence: "away", presenceLabel: "Away" },
  { presence: "offline", presenceLabel: "Offline" },
  { presence: "out-of-office", presenceLabel: "Out of office" },
] as const;

/**
 * Presence: a dot whose shape says the state, with words screen readers hear after the name.
 * Wide initials ("MW") stay clear of the dot at every size. On a card, `--ouro-avatar-ring` gives the dot's ring the card's color.
 */
export const Presence: Story = {
  parameters: { screenshot: { name: "avatar-presence" } },
  render: () => (
    <Surface>
      {(["xs", "sm", "md", "lg", "3xl"] as const).map((size) => (
        <div key={size} style={row}>
          {presences.map((state, index) => (
            <Avatar key={state.presence} name={people[index % people.length]!.name} src={people[index % people.length]!.src} size={size} {...state} />
          ))}
        </div>
      ))}
      {presences.slice(0, 4).map((state) => (
        <div key={state.presence} style={row}>
          {(["xs", "sm", "md", "lg", "xl", "2xl", "3xl"] as const).map((size) => (
            <Avatar key={size} name="Mona Wells" size={size} {...state} />
          ))}
        </div>
      ))}
      <div style={{ ...row, background: "var(--card)", padding: 12, borderRadius: "var(--radius)", "--ouro-avatar-ring": "var(--card)" } as CSSProperties}>
        <Avatar name="Grace Hopper" presence="available" presenceLabel="Available" alt="" size="sm" />
        <span>Grace Hopper</span>
      </div>
    </Surface>
  ),
};

/** Initials take a hue from the name (or `idForColor`), here one name per hue; `brand` tints with the primary and `neutral` stays plain. */
export const Colors: Story = {
  parameters: { screenshot: { name: "avatar-colors" } },
  render: () => (
    <Surface>
      <div style={row}>
        {["Jean Sammet", "Ana Lind", "Alan Turing", "Dennis Ritchie", "Grace Hopper", "Radia Perlman", "Katherine Johnson", "Ken Thompson"].map((name) => (
          <Avatar key={name} name={name} />
        ))}
      </div>
      <div style={row}>
        <Avatar name="Weekly sync" color="brand" icon={<Icon d={calendar} />} />
        <Avatar name="Ana Lind" color="brand" />
        <Avatar name="Ana Lind" color="neutral" />
      </div>
    </Surface>
  ),
};

/** `shape="square"` for what is not a person (a team, a channel, an app, a bot) and `shape="agent"` for an AI agent, with initials or a picture. */
export const Shapes: Story = {
  parameters: { screenshot: { name: "avatar-shapes" } },
  render: () => (
    <Surface>
      {(["sm", "md", "xl"] as const).map((size) => (
        <div key={size} style={row}>
          <Avatar name="Ana Lind" size={size} />
          <Avatar name="Design reviews" shape="square" size={size} />
          <Avatar name="Release notes" shape="square" size={size} src={people[2]!.src} />
          <Avatar name="Build helper" shape="square" size={size} color="brand" icon={<Icon d={bot} />} />
          <Avatar name="Halden" shape="agent" size={size} />
          <Avatar name="Launch helper" shape="agent" size={size} src={people[4]!.src} />
        </div>
      ))}
    </Surface>
  ),
};

/** While the name is still loading (`name={null}`), each avatar shimmers in its own size and shape, and screen readers hear "Name loading". */
export const NameLoading: Story = {
  parameters: { screenshot: { name: "avatar-name-loading" } },
  render: () => (
    <Surface>
      <div style={row}>
        {(["sm", "md", "lg"] as const).map((size) => (
          <Avatar key={size} name={null} size={size} />
        ))}
        <Avatar name={null} size="lg" shape="square" />
        <Avatar name={null} size="lg" shape="agent" />
      </div>
    </Surface>
  ),
};
