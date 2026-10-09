import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.SPOONJOY_JOURNEYS_BASE_URL;
if (!baseURL) throw new Error("SPOONJOY_JOURNEYS_BASE_URL is required; journeys run only against QA in CI.");

export default defineConfig({
  testDir: "./e2e/journeys",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  // CAPTURE-ONLY branch: run just the capture journey.
  grep: /@capture/,
  failOnFlakyTests: true,
  workers: 2,
  timeout: 60_000,
  reporter: [["list"], ["html", { open: "never", outputFolder: "journeys-report" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // Capture-only: the personas setup must run despite the top-level @capture filter.
    { name: "personas", testMatch: /personas\.setup\.ts/, grep: /./, use: { ...devices["Desktop Chrome"] } },
    // A plain *.journey.ts runs on both devices. *.desktop.journey.ts / *.mobile.journey.ts
    // route to one device only; check:journeys still scans them (they end in .journey.ts).
    {
      name: "iphone-webkit",
      testMatch: /\.journey\.ts/,
      testIgnore: /\.desktop\.journey\.ts$/,
      dependencies: ["personas"],
      use: { ...devices["iPhone 15"] },
    },
    {
      name: "desktop-chrome",
      testMatch: /\.journey\.ts/,
      testIgnore: /\.mobile\.journey\.ts$/,
      dependencies: ["personas"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
