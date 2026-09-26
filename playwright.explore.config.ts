import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.SPOONJOY_JOURNEYS_BASE_URL;
if (!baseURL) throw new Error("SPOONJOY_JOURNEYS_BASE_URL is required; the explore suite runs only against QA in CI.");

export default defineConfig({
  testDir: "./e2e/journeys",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 2,
  // Explore visits every route in the list per persona, running axe and a full-page screenshot
  // on each, so a single persona x device test needs much more room than a journey's timeout.
  timeout: 300_000,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "explore-report" }],
    // Merges every test's "summary" attachment into one explore-report/summary.json once the
    // run ends; see e2e/journeys/support/explore-report.ts for why that can't just be written
    // from inside each test.
    ["./e2e/journeys/support/explore-report.ts"],
  ],
  use: {
    baseURL,
    trace: "retain-on-failure",
    video: "on",
    screenshot: "on",
  },
  projects: [
    { name: "personas", testMatch: /personas\.setup\.ts/, use: { ...devices["Desktop Chrome"] } },
    { name: "iphone-webkit", testMatch: /\.explore\.ts/, dependencies: ["personas"], use: { ...devices["iPhone 15"] } },
    { name: "desktop-chrome", testMatch: /\.explore\.ts/, dependencies: ["personas"], use: { ...devices["Desktop Chrome"] } },
  ],
});
