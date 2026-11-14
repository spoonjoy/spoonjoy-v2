import type { Meta, StoryObj } from "@storybook/react-vite";
import { CodeBlock } from "~/components/ouro/code-block/code-block";
import type { EmojiCatalogue } from "~/components/ouro/emoji/emoji";
import { Text } from "~/components/ouro/text/text";

// Layout here uses inline styles and the theme's CSS variables (shadcn's names).

const config = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, open: true, proxy: { "/api": "http://localhost:8787" } },
});`;

const meta = {
  title: "Display/CodeBlock",
  component: CodeBlock,
  parameters: { layout: "padded" },
  args: { code: "npm install --save-dev vitest", language: "bash" },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 560 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CodeBlock>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Try every prop. */
export const Playground: Story = {};

/** A step in a setup guide: a command, then a file with its name as the caption. */
export const InContext: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 12, color: "var(--foreground)" }}>
      <Text>Install the test runner:</Text>
      <CodeBlock language="bash" code="npm install --save-dev vitest" />
      <Text>Then point the dev server at your API:</Text>
      <CodeBlock title="vite.config.ts" language="ts" code={config} />
    </div>
  ),
};

/** A long command wrapped instead of scrolled, with no copy button. */
export const Wrapped: Story = {
  args: { code: `curl -X POST https://api.example.com/v1/projects -H "Authorization: Bearer $TOKEN" -d '{"name":"Field notes","public":false}'`, wrap: true, copy: false },
};

// Made-up image emoji, drawn here, for code that holds emoji characters.
const svg = (body: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${body}</svg>`)}`;
const emoji: EmojiCatalogue = {
  categories: [
    {
      id: "symbols",
      label: "Symbols",
      items: [
        { id: "rocket", name: "Rocket", text: "🚀", src: svg('<path d="M16 3c6 4 8 11 6 18h-12C8 14 10 7 16 3z" fill="#7c5cff"/><circle cx="16" cy="13" r="3" fill="#fff"/><path d="M12 22l-3 6 5-3zm8 0 3 6-5-3z" fill="#e8435a"/>') },
        { id: "party", name: "Party popper", shortcodes: ["party"], text: "🎉", src: svg('<path d="M5 28 12 9l11 11z" fill="#ffb400"/><circle cx="22" cy="6" r="2" fill="#e8435a"/><circle cx="27" cy="12" r="2" fill="#2bb673"/>') },
      ],
    },
  ],
};

/**
 * `catalogue` draws the emoji characters in the code as an app's own pictures, 1em square, over
 * the characters, which stay in the text: the lines keep their length, and copying gives the
 * characters. `:party:` stays as typed.
 */
export const EmojiInCode: Story = {
  args: {
    title: "release.ts",
    language: "ts",
    catalogue: emoji,
    code: `const banner = "Release day 🚀🎉";\n// :party: stays as typed\nnotify(banner);`,
  },
};
