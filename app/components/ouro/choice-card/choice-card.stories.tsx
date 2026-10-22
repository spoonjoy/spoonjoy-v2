import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChoiceCard } from "~/components/ouro/choice-card/choice-card";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names). The pictures are
// drawn inline, so the stories need no network.

const swatch = (from: string, to: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="160" height="120" fill="url(#g)"/></svg>`)}`;

const covers = [
  { value: "dawn", label: "Dawn", description: "Soft and warm", media: <img src={swatch("#f6d365", "#fda085")} alt="" /> },
  { value: "noon", label: "Noon", description: "Bright and clear", media: <img src={swatch("#89f7fe", "#66a6ff")} alt="" /> },
  { value: "dusk", label: "Dusk", description: "Deep and calm", media: <img src={swatch("#a18cd1", "#3b2667")} alt="" /> },
];

const meta = {
  title: "Forms/ChoiceCard",
  component: ChoiceCard,
  parameters: { layout: "padded" },
  args: { legend: "Cover", items: covers, defaultValue: "noon", name: "cover" },
  argTypes: { columns: { control: "inline-radio", options: [2, 3, 4] } },
} satisfies Meta<typeof ChoiceCard>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

/** Choosing a plan, with no pictures, two to a row. */
export const InContext: Story = {
  args: {
    legend: "Plan",
    description: "You can change it at any time.",
    columns: 2,
    defaultValue: "team",
    items: [
      { value: "solo", label: "Solo", description: "One person, five projects" },
      { value: "team", label: "Team", description: "Up to ten people, unlimited projects" },
      { value: "school", label: "School", description: "Classes and teachers", disabled: true },
    ],
  },
};

/** Nothing chosen yet, with an error. */
export const Invalid: Story = { args: { defaultValue: undefined, required: true, error: "Choose a cover." } };
