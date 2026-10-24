import type { Meta, StoryObj } from "@storybook/react-vite";
import { CodeBlock } from "~/components/ouro/code-block/code-block";
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
