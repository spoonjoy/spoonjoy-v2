import type { Meta, StoryObj } from "@storybook/react-vite";
import { AspectRatio } from "~/components/ouro/aspect-ratio/aspect-ratio";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

/** A photo as an inline SVG, so the story makes no request. */
function photo(from: string, to: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="3" height="2" fill="url(#g)"/><circle cx="1.5" cy="1" r=".6" fill="#fff" fill-opacity=".85"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const meta = {
  title: "Layout/AspectRatio",
  component: AspectRatio,
  parameters: { layout: "padded" },
  args: { ratio: 16 / 9, children: null },
  argTypes: { fit: { control: "inline-radio", options: ["cover", "contain"] } },
} satisfies Meta<typeof AspectRatio>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {
  render: (args) => (
    <div style={{ maxWidth: 480 }}>
      <AspectRatio {...args}>
        <img src={photo("#f59e0b", "#7c2d12")} alt="Short ribs in a dark pot" />
      </AspectRatio>
    </div>
  ),
};

/** One photo at video, photo and square ratios, cropped to fill; the last one letterboxed. */
export const Ratios: Story = {
  parameters: { screenshot: { name: "aspect-ratio" } },
  render: () => (
    <div style={{ background: "var(--background)", padding: 24, display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", alignItems: "start" }}>
      {[
        { ratio: 16 / 9, label: "16:9" },
        { ratio: 4 / 3, label: "4:3" },
        { ratio: 1, label: "1:1" },
      ].map(({ ratio, label }) => (
        <AspectRatio key={label} ratio={ratio}>
          <img src={photo("#f59e0b", "#7c2d12")} alt={`Short ribs at ${label}`} />
        </AspectRatio>
      ))}
      <div style={{ background: "var(--muted)" }}>
        <AspectRatio ratio={1} fit="contain">
          <img src={photo("#86efac", "#166534")} alt="Green curry, letterboxed" />
        </AspectRatio>
      </div>
    </div>
  ),
};
