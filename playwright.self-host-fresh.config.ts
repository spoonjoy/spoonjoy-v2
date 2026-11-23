// A just-started self-hosted server with an empty data folder (SPOONJOY_JOURNEYS_BASE_URL), as
// its owner first meets it: the Self-host Image workflow runs these before it seeds the QA kitchen.
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.SPOONJOY_JOURNEYS_BASE_URL;
if (!baseURL) throw new Error("SPOONJOY_JOURNEYS_BASE_URL is required: the address of a fresh self-hosted server.");

export default defineConfig({
  testDir: "./e2e/self-host",
  outputDir: process.env.SPOONJOY_JOURNEYS_RESULTS_DIR || "test-results-self-host-fresh",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: { baseURL, trace: "retain-on-failure", screenshot: "on", ...devices["Desktop Chrome"] },
});
