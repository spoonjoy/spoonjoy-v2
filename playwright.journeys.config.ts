import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.SPOONJOY_JOURNEYS_BASE_URL;
if (!baseURL) throw new Error("SPOONJOY_JOURNEYS_BASE_URL is required; journeys run only against QA in CI.");

export default defineConfig({
  testDir: "./e2e/journeys",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
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
    { name: "personas", testMatch: /personas\.setup\.ts/, use: { ...devices["Desktop Chrome"] } },
    { name: "iphone-webkit", testMatch: /\.journey\.ts/, dependencies: ["personas"], use: { ...devices["iPhone 15"] } },
    { name: "desktop-chrome", testMatch: /\.journey\.ts/, dependencies: ["personas"], use: { ...devices["Desktop Chrome"] } },
  ],
});
