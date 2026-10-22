import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { ImageCropper } from "~/components/ouro/image-cropper/image-cropper";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names). The photo is drawn
// inline, so the stories need no network.

const landscape = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><rect width="640" height="420" fill="#9ad0ec"/><circle cx="470" cy="110" r="56" fill="#ffd166"/><path d="M0 300 L180 160 L330 300 L470 190 L640 330 V420 H0 Z" fill="#3d7a5a"/></svg>',
)}`;

function Cropping({ shape, aspect }: { shape?: "rect" | "circle"; aspect?: number }) {
  const [open, setOpen] = useState(false);
  const [cropped, setCropped] = useState<string | null>(null);
  return (
    <div style={{ display: "grid", gap: 12, justifyItems: "start", color: "var(--foreground)" }}>
      <button data-test-harness="" type="button" onClick={() => setOpen(true)}>
        Crop photo
      </button>
      {cropped ? <img src={cropped} alt="The cropped photo" width={96} style={{ borderRadius: shape === "circle" ? "50%" : 8 }} /> : null}
      <ImageCropper
        open={open}
        onOpenChange={setOpen}
        image={landscape}
        shape={shape}
        aspect={aspect}
        outputWidth={256}
        onCrop={(file) => setCropped(URL.createObjectURL(file))}
      />
    </div>
  );
}

const meta = {
  title: "Forms/ImageCropper",
  component: ImageCropper,
  parameters: { layout: "padded", plainOpeners: ["Crop photo"] },
  args: { open: false, onOpenChange: () => {}, image: landscape, onCrop: () => {} },
  render: () => <Cropping />,
} satisfies Meta<typeof ImageCropper>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Opens on Crop photo: drag the photo or use the arrow keys, zoom with the slider. */
export const Playground: Story = {};

/** A round frame for a profile photo. */
export const InContext: Story = { render: () => <Cropping shape="circle" /> };

/** A wide frame for a cover. */
export const Wide: Story = { render: () => <Cropping aspect={16 / 9} /> };
