import type { Meta, StoryObj } from "@storybook/react-vite";
import { ImageField } from "~/components/ouro/image-field/image-field";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names). The saved photo is
// drawn inline, so the stories need no network.

const portrait = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="#e8d5b7"/><circle cx="120" cy="96" r="44" fill="#8c6a4f"/><path d="M40 240 C50 170 190 170 200 240 Z" fill="#8c6a4f"/></svg>',
)}`;

const meta = {
  title: "Forms/ImageField",
  component: ImageField,
  parameters: { layout: "padded" },
  args: { label: "Photo", description: "PNG or JPG, up to 5 MB.", maxSize: 5 * 1024 * 1024 },
  argTypes: { shape: { control: "inline-radio", options: ["rect", "circle"] } },
} satisfies Meta<typeof ImageField>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

/** A profile photo already saved, round, cropped on change, with Remove. */
export const InContext: Story = {
  args: { label: "Profile photo", name: "photo", src: portrait, alt: "", shape: "circle", crop: { outputWidth: 512 }, onRemove: () => {} },
};

/** A wide cover with an error. */
export const Invalid: Story = { args: { label: "Cover", aspect: 16 / 9, required: true, error: "Add a cover photo." } };
