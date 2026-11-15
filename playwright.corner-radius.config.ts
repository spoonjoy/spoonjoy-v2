import { defineConfig, devices } from "@playwright/test";

// The corner-radius check in each engine: Chromium and WebKit draw corner-shape, Firefox does not, so
// it takes Ouro's Safari factor. Run it against a built Storybook (STORYBOOK_URL), as the Storybook
// workflow does: pnpm build-storybook, serve storybook-static, then pnpm test:e2e:corner-radius.
if (!process.env.STORYBOOK_URL) throw new Error("STORYBOOK_URL is required: the URL of a built Spoonjoy Storybook.");

export default defineConfig({
  testDir: "./e2e/storybook",
  testMatch: /corner-radius\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: "list",
  use: { baseURL: process.env.STORYBOOK_URL },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
