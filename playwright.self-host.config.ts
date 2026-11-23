// The Journeys config, pointed at a self-hosted server (SPOONJOY_JOURNEYS_BASE_URL), with a
// screenshot of every test for the Self-host Image workflow's proof.
import { defineConfig } from "@playwright/test";
import journeys from "./playwright.journeys.config";

export default defineConfig({
  ...journeys,
  use: { ...journeys.use, screenshot: "on" },
});
