import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState, type ReactNode } from "react";
import { Avatar } from "~/components/ouro/avatar/avatar";
import { Badge } from "~/components/ouro/badge/badge";
import { Combobox, type ComboboxItem } from "~/components/ouro/combobox/combobox";

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

const herbs = ["Basil", "Chives", "Coriander", "Dill", "Mint", "Oregano", "Parsley", "Rosemary", "Sage", "Tarragon", "Thyme"];
const recipes = ["Lemon ricotta pasta", "Leek and potato soup", "Lentil dal", "Lime tart", "Pea risotto", "Pumpkin soup", "Tomato tart"];

const meta = {
  title: "Forms/Combobox",
  component: Combobox,
  parameters: { layout: "padded" },
  args: { label: "Herb", name: "herb", items: herbs, placeholder: "Pick a herb" },
  argTypes: {
    required: { control: "boolean" },
    disabled: { control: "boolean" },
    hideLabel: { control: "boolean" },
    loading: { control: "boolean" },
    error: { control: "text" },
    description: { control: "text" },
  },
} satisfies Meta<typeof Combobox>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. Type to filter; on a phone it opens as a sheet. */
export const Playground: Story = {};

/** One item, several items as chips, and free text with suggestions. */
export const Modes: Story = {
  parameters: { screenshot: { name: "combobox-modes" } },
  render: () => (
    <Surface>
      <Combobox label="Herb" name="herb" items={herbs} defaultValue="Dill" />
      <Combobox label="Herbs" name="herbs" multiple items={herbs} defaultValue={["Basil", "Mint"]} placeholder="Add a herb" />
      <Combobox label="Cuisine" name="cuisine" allowCustomValue items={["Indian", "Italian", "Mexican", "Thai"]} placeholder="Any cuisine" />
    </Surface>
  ),
};

/** Items that come from a search: the app filters in onInputChange and sets loading. */
export const Search: Story = {
  render: function Render() {
    const [text, setText] = useState("");
    const [items, setItems] = useState<string[]>(recipes);
    const [loading, setLoading] = useState(false);
    useEffect(() => {
      setLoading(true);
      const timer = setTimeout(() => {
        setItems(recipes.filter((recipe) => recipe.toLowerCase().includes(text.toLowerCase())));
        setLoading(false);
      }, 400);
      return () => clearTimeout(timer);
    }, [text]);
    return (
      <Surface>
        <Combobox label="Recipe" name="recipe" items={items} loading={loading} onInputChange={setText} placeholder="Search recipes" />
      </Surface>
    );
  },
};

/** Described, required, invalid and disabled. */
export const States: Story = {
  parameters: { screenshot: { name: "combobox-states" } },
  render: () => (
    <Surface>
      <Combobox label="Herb" name="herb" items={herbs} required description="For the green sauce." placeholder="Pick a herb" />
      <Combobox label="Garnish" name="garnish" items={herbs} error="Pick a garnish." />
      <Combobox label="Herbs" name="herbs" multiple items={herbs} defaultValue={["Parsley"]} disabled description="Locked for this recipe." />
    </Surface>
  ),
};

const people = [
  { id: "rowan", name: "Rowan Vale", title: "Principal Engineer, Platform Services and Developer Experience", direct: true },
  { id: "iris", name: "Iris Okafor", title: "Product Designer" },
  { id: "mara", name: "Mara Quill", title: "Engineering Manager, Payments" },
  { id: "theo", name: "Theo Brandt", title: "Support Lead" },
  { id: "priya", name: "Priya Okafor", title: "Data Scientist" },
];

const personItem = (person: (typeof people)[number]): ComboboxItem => ({
  value: person.id,
  label: person.name,
  description: person.title,
  media: <Avatar name={person.name} alt="" size="xs" />,
  meta: person.direct ? <Badge>1:1</Badge> : null,
});

/**
 * A people picker: each person with their picture, job title and a "1:1" mark, and their picture
 * on the chip. `autoHighlight` lets Enter pick the top match; the app keeps the text
 * (`inputValue`) and clears it after each pick; the second field is read-only.
 */
export const People: Story = {
  parameters: { screenshot: { name: "combobox-people", open: true } },
  render: function Render() {
    const [text, setText] = useState("");
    const [picked, setPicked] = useState<string[]>(["iris"]);
    const shown = people.filter((person) => picked.includes(person.id) || person.name.toLowerCase().includes(text.toLowerCase()));
    return (
      <Surface>
        <Combobox
          label="To"
          multiple
          autoHighlight
          items={shown.map(personItem)}
          inputValue={text}
          onInputChange={setText}
          value={picked}
          onValueChange={(next) => {
            setPicked(next);
            setText("");
          }}
          placeholder="Enter a name"
        />
        <Combobox label="Sent to" multiple readOnly items={people.map(personItem)} defaultValue={["rowan", "mara"]} description="Read-only while the message sends." />
      </Surface>
    );
  },
};
