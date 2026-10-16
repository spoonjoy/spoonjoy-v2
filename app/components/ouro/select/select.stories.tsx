import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { Select } from "~/components/ouro/select/select";
import { SelectGroup, SelectItem } from "~/components/ouro/select/select-parts";

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

const courses = [
  { value: "starter", label: "Starter" },
  { value: "main", label: "Main" },
  { value: "side", label: "Side" },
  { value: "dessert", label: "Dessert" },
];

const meta = {
  title: "Forms/Select",
  component: Select,
  parameters: { layout: "padded" },
  args: { label: "Course", name: "course", placeholder: "Choose a course", options: courses },
  argTypes: {
    required: { control: "boolean" },
    disabled: { control: "boolean" },
    hideLabel: { control: "boolean" },
    error: { control: "text" },
    description: { control: "text" },
  },
} satisfies Meta<typeof Select>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

/** A placeholder, a description, an error, and a disabled select. */
export const States: Story = {
  parameters: { screenshot: { name: "select-states" } },
  render: () => (
    <Surface>
      <Select label="Course" name="course" placeholder="Choose a course" required description="Where it sits in the menu." options={courses} />
      <Select label="Cuisine" name="cuisine" defaultValue="none" error="Choose the recipe's cuisine." options={[{ value: "none", label: "None" }, { value: "italian", label: "Italian" }]} />
      <Select label="Cookbook" name="cookbook" disabled defaultValue="weeknights" description="Shared cookbooks can't be moved." options={[{ value: "weeknights", label: "Weeknights" }]} />
    </Surface>
  ),
};

/** Groups with headings, from options or from SelectGroup and SelectItem children. */
export const Groups: Story = {
  parameters: { screenshot: { name: "select-open", open: true } },
  render: () => (
    <Surface>
      <Select
        label="Produce"
        name="produce"
        defaultValue="leek"
        options={[
          { label: "Fruit", options: [{ value: "apple", label: "Apple" }, { value: "lemon", label: "Lemon" }] },
          { label: "Vegetables", options: [{ value: "leek", label: "Leek" }, { value: "kale", label: "Kale", disabled: true }] },
        ]}
      />
      <Select label="Pan" name="pan" placeholder="Choose a pan">
        <SelectGroup label="Stovetop">
          <SelectItem value="skillet">Skillet</SelectItem>
          <SelectItem value="saucepan">Saucepan</SelectItem>
        </SelectGroup>
        <SelectGroup label="Oven">
          <SelectItem value="sheet">Sheet pan</SelectItem>
        </SelectGroup>
      </Select>
    </Surface>
  ),
};

/** Several values: the list stays open while you choose, and the value is a list. */
export const Multiple: Story = {
  render: () => (
    <Surface>
      <Select
        label="Tags"
        name="tags"
        multiple
        defaultValue={["quick", "vegetarian"]}
        options={[
          { value: "quick", label: "Quick" },
          { value: "vegetarian", label: "Vegetarian" },
          { value: "spicy", label: "Spicy" },
          { value: "make-ahead", label: "Make ahead" },
        ]}
      />
    </Surface>
  ),
};

/** A long list: on a phone it opens as a bottom sheet you scroll with your thumb. */
export const LongList: Story = {
  render: () => (
    <Surface>
      <Select
        label="Ingredient"
        name="ingredient"
        placeholder="Choose an ingredient"
        options={["Anchovy", "Basil", "Butter", "Capers", "Carrot", "Celery", "Chili", "Cumin", "Dill", "Egg", "Fennel", "Garlic", "Ginger", "Honey", "Kale", "Leek", "Lemon", "Lime", "Mint", "Miso", "Onion", "Paprika", "Parsley", "Rice", "Saffron", "Sage", "Shallot", "Thyme", "Tomato", "Yogurt"].map((name) => ({ value: name.toLowerCase(), label: name }))}
      />
    </Surface>
  ),
};
