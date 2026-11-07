import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ReactNode } from "react";
import { FileField, type FileRejection } from "~/components/ouro/file-field/file-field";

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
  title: "Forms/FileField",
  component: FileField,
  parameters: { layout: "padded" },
  args: { label: "Recipe photo", name: "photo", accept: "image/*", description: "PNG or JPG, up to 5 MB." },
  argTypes: {
    multiple: { control: "boolean" },
    required: { control: "boolean" },
    disabled: { control: "boolean" },
    hideLabel: { control: "boolean" },
    error: { control: "text" },
    accept: { control: "text" },
    maxSize: { control: "number" },
  },
} satisfies Meta<typeof FileField>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. Drop a file on the zone, or press it to choose one. */
export const Playground: Story = {};

/** Empty, described, invalid and disabled. */
export const States: Story = {
  parameters: { screenshot: { name: "file-field-states" } },
  render: () => (
    <Surface>
      <FileField label="Recipe photo" name="photo" accept="image/*" description="PNG or JPG, up to 5 MB." />
      <FileField label="Attachments" name="attachments" multiple required />
      <FileField label="Cover image" name="cover" accept="image/*" error="Choose a cover image." />
      <FileField label="Archive" name="archive" disabled />
    </Surface>
  ),
};

/** Files that are too large are left out, and the app shows why with `error`. */
export const Limits: Story = {
  parameters: { mode: "multiple" },
  render: function Render() {
    const [rejected, setRejected] = useState<FileRejection[]>([]);
    return (
      <Surface>
        <FileField
          label="Attachments"
          name="attachments"
          multiple
          maxSize={1024 * 1024}
          accept=".pdf,.txt,image/*"
          description="PDF, text or images, up to 1 MB each."
          onReject={setRejected}
          onFilesChange={() => setRejected([])}
          error={rejected.map(({ file, reason }) => `${file.name} ${reason === "size" ? "is larger than 1 MB" : "is not a PDF, text file or image"}.`)}
        />
      </Surface>
    );
  },
};

/** Chooses files the way a person does: puts them in the input and tells it they changed. */
function choose(canvasElement: HTMLElement, names: string[]) {
  const input = canvasElement.querySelector<HTMLInputElement>('input[type="file"]')!;
  const files = new DataTransfer();
  for (const name of names) files.items.add(new File([name], name, { type: "text/plain" }));
  input.files = files.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/** A chosen file is listed with a button that removes it. The story chooses one. */
export const WithFile: Story = {
  render: () => (
    <Surface>
      <FileField label="Recipe card" name="card" />
    </Surface>
  ),
  play: async ({ canvasElement }) => choose(canvasElement, ["shakshuka.txt"]),
};

/** Chosen files are listed, each with a button that removes it. The story chooses two. */
export const WithFiles: Story = {
  parameters: { mode: "multiple" },
  render: () => (
    <Surface>
      <FileField label="Attachments" name="attachments" multiple />
    </Surface>
  ),
  play: async ({ canvasElement }) => choose(canvasElement, ["shopping-list.txt", "method.txt"]),
};
