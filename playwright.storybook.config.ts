import { defineConfig, devices } from "@playwright/test";

// The accessibility check of every story in the built Storybook (e2e/storybook), in both themes.
// CI builds Storybook, serves storybook-static and points STORYBOOK_URL at it
// (.github/workflows/storybook.yml).
if (!process.env.STORYBOOK_URL) throw new Error("STORYBOOK_URL is required: the URL of a built Spoonjoy Storybook.");

export default defineConfig({
  testDir: "./e2e/storybook",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  failOnFlakyTests: true,
  workers: 4,
  // The list in the job log is the report: the Storybook workflow's deploy contract allows no
  // artifact uploads (scripts/deployment-preflight.ts).
  reporter: "list",
  use: { baseURL: process.env.STORYBOOK_URL },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
