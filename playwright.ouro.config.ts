import { defineConfig, devices } from "@playwright/test";

// Ouro UI's end-to-end specs (e2e/ouro, installed from its shadcn registry) open Ouro's stories in
// Spoonjoy's own Storybook, built with Spoonjoy's Tailwind and theme. CI builds Storybook, serves
// storybook-static and points OURO_E2E_URL at it (.github/workflows/storybook.yml). They are
// component checks, not journeys: the Save dialog on the real app is proven by the Journeys run.
if (!process.env.OURO_E2E_URL) throw new Error("OURO_E2E_URL is required: the URL of a built Spoonjoy Storybook.");

export default defineConfig({
  testDir: "./e2e/ouro",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  failOnFlakyTests: true,
  // The list in the job log is the report: the Storybook workflow's deploy contract allows no
  // artifact uploads (scripts/deployment-preflight.ts).
  reporter: "list",
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
