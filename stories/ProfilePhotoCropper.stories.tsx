import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ProfilePhotoCropper } from "../app/components/account/ProfilePhotoCropper";

// A small 4:3 (non-square) PNG so the circular viewport, zoom slider, and drag
// behavior are all observable: the wide image must be panned/zoomed to frame.
// Built once at module load and reused across stories.
const SAMPLE_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAYAAAChS3wfAAAACXBIWXMAAAsTAAALEwEAmpwYAAABq0lEQVR4nO2Z3W7CMAyF/VBJwzNsCDSQQGJX0AnyTgm06TPuarvI5EhMFdM2fhLs0FwcCdHS2l99TJyC0cIPWUAdALWAOgBqAXUA1ALqAKgF1AGwBfD58R5V1IkWALpUgC8W0KUH+CyboK2lb1aVb2fKu4ny3fMoCD/jd3gMz3m4Jmg3IiTYPY3OUvuivF3LBwCwE75ZVmcnfir8LV4jTwBbEZ7ktckf5WbK263MDMBOhMBvTb5viawANDeU/Z92yAHAfi2jJ3+U3Uj+AFzE0v9hhZniDcDW6Z7+dxX8sk4ADgAOq/jePxXegy2ANmH5/2cDYAFgkjZ5lJsyBuDG6SsA78EWQIfDTWIA3XjEF4C7hwUmathN0M0ZA2ju8Tf4yngdsH8TyQHYWvAFYBLbgP1S2ITdn4EPQybVOLzIZBw2qF1cK2S3IWLQClsZZTRus9wS05E2RReVt9luiupeNdTSt/Pqoqe+v/D9AHAG0F8nHHovRnCwCZqqsMLDY3jONdeGHACkFBQAulSALxbQpQd46mbErgmagQioA6AWUAdALaAOgFpAHQC1vgCFpidHvhYn/wAAAABJRU5ErkJggg==";

function dataUrlToFile(dataUrl: string, filename: string): File {
  const [header, base64] = dataUrl.split(",");
  const mime = header.match(/data:(.*);base64/)?.[1] ?? "image/png";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new File([bytes], filename, { type: mime });
}

const sampleFile = dataUrlToFile(SAMPLE_PNG_DATA_URL, "sample-4x3.png");

const meta: Meta<typeof ProfilePhotoCropper> = {
  title: "Account/ProfilePhotoCropper",
  component: ProfilePhotoCropper,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The crop-on-upload modal for profile photos. Drag the preview to reposition, use the zoom slider to scale, and Save to export a square blob. Loaded with a non-square (4:3) sample so the circular crop is visible.",
      },
    },
  },
  args: {
    file: sampleFile,
    onConfirm: fn(),
    onCancel: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const SmallOutput: Story = {
  args: {
    outputSize: 128,
  },
};
